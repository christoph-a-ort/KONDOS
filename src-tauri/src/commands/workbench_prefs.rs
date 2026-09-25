use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppErrorKind};

pub const WORKBENCH_PREFS_FILE_NAME: &str = "workbench-prefs.v1.json";

#[tauri::command]
pub fn load_workbench_prefs(app: AppHandle) -> Result<Option<String>, AppError> {
    let path = prefs_file_path(&app)?;
    read_workbench_prefs_file(&path)
}

#[tauri::command]
pub fn save_workbench_prefs(app: AppHandle, prefs_json: String) -> Result<(), AppError> {
    let path = prefs_file_path(&app)?;
    write_workbench_prefs_file(&path, &prefs_json)
}

fn prefs_file_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app.path().app_data_dir().map_err(|_| {
        AppError::new(
            AppErrorKind::Internal,
            "Das App-Datenverzeichnis konnte nicht ermittelt werden.",
        )
    })?;
    Ok(workbench_prefs_path(&dir))
}

pub fn workbench_prefs_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(WORKBENCH_PREFS_FILE_NAME)
}

/// Reads the prefs file. Missing file → `Ok(None)`. Invalid JSON / non-object → error.
pub fn read_workbench_prefs_file(path: &Path) -> Result<Option<String>, AppError> {
    match fs::read_to_string(path) {
        Ok(raw) => {
            validate_prefs_json(&raw)?;
            Ok(Some(raw))
        }
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(prefs_io_error(
            "Die Workbench-Einstellungen konnten nicht gelesen werden.",
            path,
            &err,
        )),
    }
}

/// Validates and atomically writes prefs JSON to `path`.
pub fn write_workbench_prefs_file(path: &Path, prefs_json: &str) -> Result<(), AppError> {
    validate_prefs_json(prefs_json)?;

    let parent = path.parent().filter(|dir| !dir.as_os_str().is_empty());
    if let Some(dir) = parent {
        fs::create_dir_all(dir).map_err(|err| {
            prefs_io_error(
                "Das App-Datenverzeichnis konnte nicht angelegt werden.",
                dir,
                &err,
            )
        })?;
    }

    let temp = temp_path_for(path);
    if let Err(err) = write_temp(&temp, prefs_json) {
        let _ = fs::remove_file(&temp);
        return Err(prefs_io_error(
            "Die Workbench-Einstellungen konnten nicht gespeichert werden.",
            path,
            &err,
        ));
    }

    if let Err(err) = replace_file(&temp, path) {
        let _ = fs::remove_file(&temp);
        return Err(prefs_io_error(
            "Die Workbench-Einstellungen konnten nicht gespeichert werden.",
            path,
            &err,
        ));
    }

    Ok(())
}

fn validate_prefs_json(raw: &str) -> Result<(), AppError> {
    let value: serde_json::Value = serde_json::from_str(raw).map_err(|_| {
        AppError::invalid_config("Die Workbench-Einstellungen sind kein gültiges JSON.")
    })?;
    if !value.is_object() {
        return Err(AppError::invalid_config(
            "Die Workbench-Einstellungen müssen ein JSON-Objekt sein.",
        ));
    }
    Ok(())
}

fn write_temp(temp: &Path, contents: &str) -> io::Result<()> {
    let mut file = File::create(temp)?;
    file.write_all(contents.as_bytes())?;
    file.flush()?;
    file.sync_all()?;
    Ok(())
}

fn temp_path_for(target: &Path) -> PathBuf {
    let parent = target.parent().filter(|path| !path.as_os_str().is_empty());
    let name = target
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "workbench-prefs".to_string());
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let temp_name = format!(
        ".{name}.dottyfm-prefs-{}-{nanos}.tmp",
        std::process::id()
    );
    match parent {
        Some(dir) => dir.join(temp_name),
        None => PathBuf::from(temp_name),
    }
}

fn replace_file(temp: &Path, target: &Path) -> io::Result<()> {
    match fs::rename(temp, target) {
        Ok(()) => Ok(()),
        Err(err) => {
            if target.exists() {
                replace_existing(temp, target)
            } else {
                Err(err)
            }
        }
    }
}

#[cfg(windows)]
fn replace_existing(temp: &Path, target: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;

    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let from = wide(temp);
    let to = wide(target);
    let ok = unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok != 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(windows))]
fn replace_existing(temp: &Path, target: &Path) -> io::Result<()> {
    fs::rename(temp, target)
}

fn prefs_io_error(message: &str, path: &Path, err: &io::Error) -> AppError {
    let target = path.display().to_string();
    let cause = io_cause(err).to_string();
    AppError {
        kind: AppErrorKind::Internal,
        message: format!("{message}\nZiel:\n{target}\nUrsache:\n{cause}"),
        target_path: Some(target),
        cause: Some(cause),
    }
}

fn io_cause(err: &io::Error) -> &'static str {
    match err.kind() {
        io::ErrorKind::PermissionDenied => "Zugriff verweigert.",
        io::ErrorKind::NotFound => "Pfad nicht gefunden.",
        io::ErrorKind::AlreadyExists => "Die Datei konnte nicht ersetzt werden.",
        io::ErrorKind::InvalidInput => "Der Pfad ist ungültig.",
        _ => "Die Datei konnte nicht geschrieben werden.",
    }
}

#[cfg(test)]
mod tests {
    use super::{
        read_workbench_prefs_file, validate_prefs_json, workbench_prefs_path,
        write_workbench_prefs_file, WORKBENCH_PREFS_FILE_NAME,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "dottyfm-prefs-{}-{}-{}",
            label,
            std::process::id(),
            nanos
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn missing_file_returns_none() {
        let dir = unique_dir("missing");
        let path = workbench_prefs_path(&dir);
        let loaded = read_workbench_prefs_file(&path).expect("read");
        assert!(loaded.is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_then_read_roundtrip() {
        let dir = unique_dir("roundtrip");
        let path = workbench_prefs_path(&dir);
        let json = r#"{"version":1,"maxDepth":10,"rootPath":""}"#;
        write_workbench_prefs_file(&path, json).expect("write");
        let loaded = read_workbench_prefs_file(&path).expect("read").expect("present");
        assert_eq!(loaded, json);
        assert!(path.ends_with(WORKBENCH_PREFS_FILE_NAME));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn replace_existing_file() {
        let dir = unique_dir("replace");
        let path = workbench_prefs_path(&dir);
        write_workbench_prefs_file(&path, r#"{"version":1,"maxDepth":2}"#).expect("first");
        write_workbench_prefs_file(&path, r#"{"version":1,"maxDepth":10}"#).expect("second");
        let loaded = read_workbench_prefs_file(&path).expect("read").expect("present");
        assert!(loaded.contains("\"maxDepth\":10"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn invalid_json_rejected_on_read() {
        let dir = unique_dir("bad-json");
        let path = workbench_prefs_path(&dir);
        fs::write(&path, "{not json").expect("seed");
        let err = read_workbench_prefs_file(&path).expect_err("invalid");
        assert!(err.message.contains("JSON"));
        // Corrupted file must remain for diagnosis.
        assert_eq!(fs::read_to_string(&path).expect("keep"), "{not json");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn non_object_json_rejected() {
        assert!(validate_prefs_json("[1,2,3]").is_err());
        assert!(validate_prefs_json("\"text\"").is_err());
        assert!(validate_prefs_json("42").is_err());
        assert!(validate_prefs_json(r#"{"ok":true}"#).is_ok());
    }

    #[test]
    fn write_creates_missing_parent_directory() {
        let root = unique_dir("nested-root");
        let nested = root.join("nested").join("data");
        let path = workbench_prefs_path(&nested);
        assert!(!nested.exists());
        write_workbench_prefs_file(&path, r#"{"version":1}"#).expect("write");
        assert!(path.is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn invalid_json_rejected_on_write() {
        let dir = unique_dir("bad-write");
        let path = workbench_prefs_path(&dir);
        assert!(write_workbench_prefs_file(&path, "{broken").is_err());
        assert!(!path.exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
