use std::fmt;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::AppError;
use crate::report::model::InventoryReportModel;
use crate::report::pdf::{self, ReportPdfError};
use crate::report::xlsx::{self, ReportXlsxError};

/// Write inventory report XLSX via temp file then atomic replace.
pub fn write_report_xlsx_file(
    path: &str,
    report: &InventoryReportModel,
) -> Result<PathBuf, AppError> {
    write_report_bytes(path, "xlsx", "XLSX", || {
        xlsx::build_report_xlsx_bytes(report).map_err(BuildError::Xlsx)
    })
}

/// Write inventory report PDF via the same safe-write path as XLSX.
pub fn write_report_pdf_file(
    path: &str,
    report: &InventoryReportModel,
) -> Result<PathBuf, AppError> {
    write_report_bytes(path, "pdf", "PDF", || {
        pdf::build_report_pdf_bytes(report).map_err(BuildError::Pdf)
    })
}

fn write_report_bytes(
    path: &str,
    extension: &str,
    label: &str,
    build: impl FnOnce() -> Result<Vec<u8>, BuildError>,
) -> Result<PathBuf, AppError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::export_failed("Es wurde kein Speicherort gewählt."));
    }

    let requested = Path::new(trimmed);
    if requested.is_dir() {
        return Err(report_write_failed(
            requested,
            label,
            "Bitte wählen Sie eine Datei, kein Verzeichnis.",
        ));
    }

    let target = apply_extension(requested, extension);
    if target.is_dir() {
        return Err(report_write_failed(
            &target,
            label,
            "Bitte wählen Sie eine Datei, kein Verzeichnis.",
        ));
    }

    let temp = temp_path_for(&target);
    match build() {
        Ok(bytes) => {
            if let Err(err) = write_temp_bytes(&temp, &bytes) {
                let _ = fs::remove_file(&temp);
                return Err(report_write_failed(&target, label, io_cause(&err)));
            }
        }
        Err(err) => {
            let _ = fs::remove_file(&temp);
            return Err(report_write_failed(&target, label, &err.to_string()));
        }
    }

    if let Err(err) = replace_file(&temp, &target) {
        let _ = fs::remove_file(&temp);
        return Err(report_write_failed(&target, label, io_cause(&err)));
    }

    Ok(target)
}

fn write_temp_bytes(temp: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = File::create(temp)?;
    file.write_all(bytes)?;
    file.flush()?;
    file.sync_all()?;
    Ok(())
}

enum BuildError {
    Xlsx(ReportXlsxError),
    Pdf(ReportPdfError),
}

impl fmt::Display for BuildError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BuildError::Xlsx(err) => write!(f, "{err}"),
            BuildError::Pdf(err) => write!(f, "{err}"),
        }
    }
}

fn apply_extension(path: &Path, extension: &str) -> PathBuf {
    match path.file_name().and_then(|name| name.to_str()) {
        Some(name) => {
            let next = if let Some(index) = name.rfind('.') {
                if index > 0 && index < name.len() - 1 {
                    format!("{}.{}", &name[..index], extension)
                } else {
                    format!("{name}.{extension}")
                }
            } else {
                format!("{name}.{extension}")
            };
            let trimmed = next.trim_end_matches([' ', '.']).to_string();
            match path.parent() {
                Some(parent) if !parent.as_os_str().is_empty() => parent.join(trimmed),
                _ => PathBuf::from(trimmed),
            }
        }
        None => path.with_extension(extension),
    }
}

fn temp_path_for(target: &Path) -> PathBuf {
    let parent = target.parent().filter(|path| !path.as_os_str().is_empty());
    let name = target
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "report.bin".to_string());
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

fn report_write_failed(path: impl AsRef<Path>, label: &str, cause: impl Into<String>) -> AppError {
    let target = path.as_ref().display().to_string();
    let cause = cause.into();
    AppError {
        kind: crate::error::AppErrorKind::ExportFailed,
        message: format!(
            "Die {label}-Datei konnte nicht gespeichert werden.\nZiel:\n{target}\nUrsache:\n{cause}"
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
