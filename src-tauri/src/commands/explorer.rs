use std::path::Path;
use std::process::Command;

use crate::error::AppError;

const EXPLORER_PROGRAM: &str = "explorer.exe";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExplorerPlan {
    OpenFolder {
        program: &'static str,
        args: Vec<String>,
    },
    SelectFile {
        path: String,
    },
}

pub fn ensure_explorer_path_exists(path: &str) -> Result<(), AppError> {
    if path.trim().is_empty() || !Path::new(path).exists() {
        return Err(AppError::invalid_path(
            "Der ausgewählte Eintrag ist nicht mehr vorhanden.",
        ));
    }
    Ok(())
}

pub fn plan_explorer(path: &str, directory: bool) -> Result<ExplorerPlan, AppError> {
    ensure_explorer_path_exists(path)?;
    if directory {
        Ok(ExplorerPlan::OpenFolder {
            program: EXPLORER_PROGRAM,
            args: vec![path.to_string()],
        })
    } else {
        Ok(ExplorerPlan::SelectFile {
            path: path.to_string(),
        })
    }
}

/// UTF-16 mit Nullterminator für Shell-APIs. Windows-Dateinamen enthalten kein `"`.
#[cfg(windows)]
pub fn wide_nul_path(path: &str) -> Vec<u16> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[tauri::command]
pub fn open_in_explorer(path: String, directory: bool) -> Result<(), AppError> {
    let plan = plan_explorer(&path, directory)?;
    execute_explorer(plan)
}

fn spawn_failed() -> AppError {
    AppError::new(
        crate::error::AppErrorKind::Internal,
        "Der Explorer konnte nicht geöffnet werden.",
    )
}

fn execute_explorer(plan: ExplorerPlan) -> Result<(), AppError> {
    match plan {
        ExplorerPlan::OpenFolder { program, args } => {
            Command::new(program)
                .args(&args)
                .spawn()
                .map_err(|_| spawn_failed())?;
            Ok(())
        }
        ExplorerPlan::SelectFile { path } => select_file_in_explorer(&path),
    }
}

/// Datei im Explorer anzeigen und markieren.
///
/// `SHParseDisplayName` erzeugt ein absolutes PIDL aus dem vollen Dateipfad.
/// `SHOpenFolderAndSelectItems` mit `cidl = 0` öffnet den Parent und markiert
/// genau dieses Item. `dwFlags = 0` startet die Datei nicht.
///
/// Automatisierte Tests dürfen keinen Explorer öffnen. Geprüft wird die
/// Vorbereitung (Existenz, Datei- vs. Ordnerzweig, UTF-16-Pfad). Manuell:
/// Parent-Fenster bereits offen, Markierung, keine Dateizuordnung.
#[cfg(windows)]
fn select_file_in_explorer(path: &str) -> Result<(), AppError> {
    use std::ffi::c_void;
    use std::ptr;

    const COINIT_APARTMENTTHREADED: u32 = 0x2;
    const S_OK: i32 = 0;
    const RPC_E_CHANGED_MODE: i32 = -2147417850; // 0x8001_0106

    #[link(name = "ole32")]
    extern "system" {
        fn CoInitializeEx(pvreserved: *mut c_void, dwcoinit: u32) -> i32;
        fn CoUninitialize();
    }

    #[link(name = "shell32")]
    extern "system" {
        fn SHParseDisplayName(
            psz_name: *const u16,
            pbc: *mut c_void,
            ppidl: *mut *mut c_void,
            sfgao_in: u32,
            psfgao_out: *mut u32,
        ) -> i32;
        fn SHOpenFolderAndSelectItems(
            pidl_folder: *const c_void,
            cidl: u32,
            apidl: *const *const c_void,
            dw_flags: u32,
        ) -> i32;
        fn ILFree(pidl: *mut c_void);
    }

    let wide = wide_nul_path(path);
    let com = unsafe { CoInitializeEx(ptr::null_mut(), COINIT_APARTMENTTHREADED) };
    if com < 0 && com != RPC_E_CHANGED_MODE {
        return Err(spawn_failed());
    }
    let uninit = com == S_OK;

    let mut pidl: *mut c_void = ptr::null_mut();
    let parsed = unsafe {
        SHParseDisplayName(
            wide.as_ptr(),
            ptr::null_mut(),
            &mut pidl,
            0,
            ptr::null_mut(),
        )
    };
    if parsed < 0 || pidl.is_null() {
        if !pidl.is_null() {
            unsafe { ILFree(pidl) };
        }
        if uninit {
            unsafe { CoUninitialize() };
        }
        return Err(spawn_failed());
    }

    // cidl = 0: pidl beschreibt das zu markierende Item; Parent wird geöffnet.
    let opened = unsafe { SHOpenFolderAndSelectItems(pidl, 0, ptr::null(), 0) };
    unsafe { ILFree(pidl) };
    if uninit {
        unsafe { CoUninitialize() };
    }
    if opened < 0 {
        return Err(spawn_failed());
    }
    Ok(())
}

#[cfg(not(windows))]
fn select_file_in_explorer(_path: &str) -> Result<(), AppError> {
    Err(spawn_failed())
}

#[cfg(test)]
mod tests {
    use super::{plan_explorer, ExplorerPlan, EXPLORER_PROGRAM};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[cfg(windows)]
    use super::wide_nul_path;

    fn unique_missing() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "kondos-missing-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ))
    }

    #[cfg(windows)]
    fn assert_wide_path(path: &str) {
        let wide = wide_nul_path(path);
        assert_eq!(*wide.last().expect("nul"), 0);
        let decoded: String = String::from_utf16(&wide[..wide.len() - 1]).expect("utf16");
        assert_eq!(decoded, path);
        assert!(!decoded.contains("/select"));
        assert!(!decoded.contains("cmd.exe"));
    }

    #[test]
    fn folder_uses_explorer_path_argument() {
        let fake = unique_missing();
        fs::create_dir_all(&fake).unwrap();
        let plan = plan_explorer(fake.to_str().unwrap(), true).unwrap();
        match plan {
            ExplorerPlan::OpenFolder { program, args } => {
                assert_eq!(program, EXPLORER_PROGRAM);
                assert_eq!(args, vec![fake.to_string_lossy().into_owned()]);
                assert!(!program.contains("cmd"));
                assert!(!args.iter().any(|arg| arg.contains("cmd.exe") || arg.contains("/select")));
            }
            ExplorerPlan::SelectFile { .. } => panic!("folder must stay explorer.exe branch"),
        }
        let _ = fs::remove_dir_all(&fake);
    }

    #[test]
    fn file_uses_select_file_plan_not_select_switch() {
        let root = unique_missing();
        fs::create_dir_all(&root).unwrap();
        let file = root.join("Angebot 1.pdf");
        fs::write(&file, b"ok").unwrap();
        let plan = plan_explorer(file.to_str().unwrap(), false).unwrap();
        match plan {
            ExplorerPlan::SelectFile { path } => {
                assert_eq!(path, file.to_string_lossy());
                assert!(!path.contains("/select"));
            }
            ExplorerPlan::OpenFolder { .. } => panic!("file must not use explorer.exe /select"),
        }
        let _ = fs::remove_file(&file);
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    #[test]
    fn file_wide_path_keeps_spaces_and_umlauts() {
        assert_wide_path(r"C:\Hausverwaltung\Datei.pdf");
        assert_wide_path(r"C:\Ordner mit Leerzeichen\Datei.pdf");
        assert_wide_path(r"C:\Prüfung\Änderung.pdf");
        assert_wide_path(r"C:\Äpfel Ordner\Angebot 1.pdf");
    }

    #[test]
    fn missing_path_is_rejected_before_launch() {
        let missing = unique_missing();
        let err = plan_explorer(missing.to_str().unwrap(), true).unwrap_err();
        assert_eq!(
            err.message,
            "Der ausgewählte Eintrag ist nicht mehr vorhanden."
        );
    }

    #[test]
    fn empty_path_is_rejected() {
        let err = plan_explorer("   ", false).unwrap_err();
        assert_eq!(
            err.message,
            "Der ausgewählte Eintrag ist nicht mehr vorhanden."
        );
    }

    #[test]
    fn existing_folder_and_file_keep_separate_branches() {
        let root = unique_missing();
        fs::create_dir_all(&root).unwrap();
        let file = root.join("Äpfel Datei.txt");
        fs::write(&file, b"ok").unwrap();
        let dir_plan = plan_explorer(root.to_str().unwrap(), true).unwrap();
        assert!(matches!(dir_plan, ExplorerPlan::OpenFolder { .. }));
        let file_plan = plan_explorer(file.to_str().unwrap(), false).unwrap();
        assert!(matches!(file_plan, ExplorerPlan::SelectFile { .. }));
        let _ = fs::remove_file(&file);
        let _ = fs::remove_dir_all(&root);
    }
}
