use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::AppError;
use crate::report::model::InventoryReportModel;
use crate::report::xlsx::{self, ReportXlsxError};

/// Write inventory report XLSX via temp file then atomic replace.
pub fn write_report_xlsx_file(
    path: &str,
    report: &InventoryReportModel,
) -> Result<PathBuf, AppError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::export_failed("Es wurde kein Speicherort gewählt."));
    }

    let requested = Path::new(trimmed);
    if requested.is_dir() {
        return Err(report_write_failed(
            requested,
            "Bitte wählen Sie eine Datei, kein Verzeichnis.",
        ));
    }

    let target = apply_xlsx_extension(requested);
    if target.is_dir() {
        return Err(report_write_failed(
            &target,
            "Bitte wählen Sie eine Datei, kein Verzeichnis.",
        ));
    }

    let temp = temp_path_for(&target);
    if let Err(err) = write_temp(&temp, report) {
        let _ = fs::remove_file(&temp);
        return Err(report_write_failed(&target, &io_cause_from_write(&err)));
    }

    if let Err(err) = replace_file(&temp, &target) {
        let _ = fs::remove_file(&temp);
        return Err(report_write_failed(&target, io_cause(&err)));
    }

    Ok(target)
}

fn write_temp(temp: &Path, report: &InventoryReportModel) -> Result<(), WriteTempError> {
    let bytes = xlsx::build_report_xlsx_bytes(report).map_err(WriteTempError::Xlsx)?;
    let mut file = File::create(temp).map_err(WriteTempError::Io)?;
    file.write_all(&bytes).map_err(WriteTempError::Io)?;
    file.flush().map_err(WriteTempError::Io)?;
    file.sync_all().map_err(WriteTempError::Io)?;
    Ok(())
}

enum WriteTempError {
    Io(io::Error),
    Xlsx(ReportXlsxError),
}

fn io_cause_from_write(err: &WriteTempError) -> String {
    match err {
        WriteTempError::Io(io) => io_cause(io).to_string(),
        WriteTempError::Xlsx(xlsx) => xlsx.to_string(),
    }
}

fn apply_xlsx_extension(path: &Path) -> PathBuf {
    match path.file_name().and_then(|name| name.to_str()) {
        Some(name) => {
            let next = if let Some(index) = name.rfind('.') {
                if index > 0 && index < name.len() - 1 {
                    format!("{}.xlsx", &name[..index])
                } else {
                    format!("{name}.xlsx")
                }
            } else {
                format!("{name}.xlsx")
            };
            let trimmed = next.trim_end_matches([' ', '.']).to_string();
            match path.parent() {
                Some(parent) if !parent.as_os_str().is_empty() => parent.join(trimmed),
                _ => PathBuf::from(trimmed),
            }
        }
        None => path.with_extension("xlsx"),
    }
}

fn temp_path_for(target: &Path) -> PathBuf {
    let parent = target.parent().filter(|path| !path.as_os_str().is_empty());
    let name = target
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "report.xlsx".to_string());
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let temp_name = format!(
        ".{name}.dottyfm-report-{}-{nanos}.tmp",
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

fn report_write_failed(path: impl AsRef<Path>, cause: impl Into<String>) -> AppError {
    let target = path.as_ref().display().to_string();
    let cause = cause.into();
    AppError {
        kind: crate::error::AppErrorKind::ExportFailed,
        message: format!(
            "Die XLSX-Datei konnte nicht gespeichert werden.\nZiel:\n{target}\nUrsache:\n{cause}"
        ),
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
        _ => "Die Datei konnte nicht gespeichert werden.",
    }
}

#[cfg(test)]
mod tests {
    use super::temp_path_for;
    use std::path::Path;

    #[test]
    fn temp_name_uses_dottyfm_report_prefix() {
        let path = temp_path_for(Path::new(r"C:\out\bericht.xlsx"));
        let name = path.file_name().expect("temp name").to_string_lossy();
        assert!(name.contains(".dottyfm-report-"), "{name}");
        assert!(name.starts_with(".bericht.xlsx.dottyfm-report-"), "{name}");
        assert!(name.ends_with(".tmp"), "{name}");
    }
}
