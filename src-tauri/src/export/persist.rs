use std::fs::{self, File};
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::AppError;
use crate::model::{ExportFormat, ScanResult};

use super::filename::apply_export_extension;
use super::write_export;

pub fn write_export_file(
    path: &str,
    format: ExportFormat,
    result: &ScanResult,
) -> Result<PathBuf, AppError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::export_failed("Es wurde kein Speicherort gewählt."));
    }

    let requested = Path::new(trimmed);
    if requested.is_dir() {
        return Err(AppError::export_write_failed(
            format,
            requested,
            "Bitte wählen Sie eine Datei, kein Verzeichnis.",
        ));
    }

    let target = apply_export_extension(requested, format);
    if target.is_dir() {
        return Err(AppError::export_write_failed(
            format,
            &target,
            "Bitte wählen Sie eine Datei, kein Verzeichnis.",
        ));
    }

    let temp = temp_path_for(&target);
    if let Err(err) = write_temp(&temp, format, result) {
        let _ = fs::remove_file(&temp);
        return Err(AppError::export_write_failed(
            format,
            &target,
            io_cause(&err),
        ));
    }

    if let Err(err) = replace_file(&temp, &target) {
        let _ = fs::remove_file(&temp);
        return Err(AppError::export_write_failed(
            format,
            &target,
            io_cause(&err),
        ));
    }

    Ok(target)
}

fn write_temp(temp: &Path, format: ExportFormat, result: &ScanResult) -> io::Result<()> {
    let file = File::create(temp)?;
    let mut writer = BufWriter::with_capacity(64 * 1024, file);
    write_export(&mut writer, format, result)?;
    writer.flush()?;
    writer.get_ref().sync_all()?;
    Ok(())
}

fn temp_path_for(target: &Path) -> PathBuf {
    let parent = target.parent().filter(|path| !path.as_os_str().is_empty());
    let name = target
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "export".to_string());
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let temp_name = format!(
        ".{name}.kondos-export-{}-{nanos}.tmp",
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

fn io_cause(err: &io::Error) -> &'static str {
    match err.kind() {
        io::ErrorKind::PermissionDenied => "Zugriff verweigert.",
        io::ErrorKind::NotFound => "Pfad nicht gefunden.",
        io::ErrorKind::AlreadyExists => "Die Datei konnte nicht ersetzt werden.",
        io::ErrorKind::InvalidInput => "Der Pfad ist ungültig.",
        _ => "Die Datei konnte nicht gespeichert werden.",
    }
}
