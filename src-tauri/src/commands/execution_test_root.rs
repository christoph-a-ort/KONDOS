//! P2-L.4b.1: durable, path-exact test-scan-root approval. AppData only.
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::error::AppError;

use super::execution_preflight::{path_has_parent_dir, within_scan_root};

const VERSION: u64 = 1;
const DIR: &str = "execution-test-roots";

fn identity(root: &str) -> Result<String, AppError> {
    if root.is_empty() || root.contains('\0') {
        return Err(AppError::invalid_config("Ungültige Scanwurzel."));
    }
    let mut hash = 14_695_981_039_346_656_037u64;
    for byte in root.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(1_099_511_628_211);
    }
    Ok(format!("{hash:016x}"))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

pub(crate) fn approval_file(base: &Path, scan_root: &str) -> Result<PathBuf, AppError> {
    Ok(base.join(DIR).join(format!("{}.v1.json", identity(scan_root)?)))
}

fn productive_or_unsafe_root(scan_root: &str) -> bool {
    if scan_root.trim().is_empty() || scan_root.contains('\0') || path_has_parent_dir(scan_root) {
        return true;
    }
    let normalized = scan_root
        .replace('\\', "/")
        .trim()
        .trim_end_matches('/')
        .to_lowercase();
    if !normalized.contains('/') && !normalized.contains(':') {
        return true;
    }
    if normalized.starts_with("//") || normalized.starts_with("//?/") || normalized.starts_with("//./") {
        return true;
    }
    let drive_root = normalized.len() <= 3 && normalized.ends_with(':')
        || normalized.len() == 2 && normalized.as_bytes().get(1) == Some(&b':');
    if drive_root || normalized.chars().filter(|c| *c == '/').count() == 1 && normalized.ends_with(':') {
        return true;
    }
    let rest = normalized.split_once(':').map(|(_, path)| path.trim_start_matches('/')).unwrap_or(normalized.as_str());
    let first = rest.split('/').next().unwrap_or("");
    if rest.is_empty() || first.is_empty() {
        return true;
    }
    matches!(
        first,
        "windows" | "program files" | "program files (x86)" | "programdata" | "$recycle.bin"
    )
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TestRootApprovalView {
    pub approved: bool,
    pub scan_root: String,
    pub message: String,
}

pub(crate) fn inspect_test_root_at(base: &Path, scan_root: &str) -> Result<TestRootApprovalView, AppError> {
    if productive_or_unsafe_root(scan_root) {
        return Ok(TestRootApprovalView {
            approved: false,
            scan_root: scan_root.to_string(),
            message: "Diese Scanwurzel ist kein zulässiger Testpfad.".to_string(),
        });
    }
    match fs::read_to_string(approval_file(base, scan_root)?) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(TestRootApprovalView {
            approved: false,
            scan_root: scan_root.to_string(),
            message: "Dieser Testpfad ist nicht ausdrücklich freigegeben.".to_string(),
        }),
        Err(_) => Err(AppError::invalid_config(
            "Die Testpfad-Freigabe ist beschädigt und bleibt gesperrt.",
        )),
        Ok(raw) => {
            let value: Value = serde_json::from_str(&raw).map_err(|_| {
                AppError::invalid_config("Die Testpfad-Freigabe ist beschädigt und bleibt gesperrt.")
            })?;
            let stored = value
                .get("scanRoot")
                .and_then(Value::as_str)
                .unwrap_or("");
            let version = value.get("schemaVersion").and_then(Value::as_u64);
            if version != Some(VERSION) || stored.is_empty() || !within_scan_root(scan_root, stored) || !within_scan_root(stored, scan_root) {
                return Ok(TestRootApprovalView {
                    approved: false,
                    scan_root: scan_root.to_string(),
                    message: "Die gespeicherte Freigabe gehört nicht zu diesem konkreten Testpfad.".to_string(),
                });
            }
            Ok(TestRootApprovalView {
                approved: true,
                scan_root: stored.to_string(),
                message: "Dieser konkrete Testpfad ist ausdrücklich freigegeben.".to_string(),
            })
        }
    }
}

pub(crate) fn approve_test_root_at(
    base: &Path,
    scan_root: &str,
    explicit_confirm: bool,
) -> Result<TestRootApprovalView, AppError> {
    if !explicit_confirm {
        return Err(AppError::invalid_config(
            "Die Testpfad-Freigabe braucht eine ausdrückliche Bestätigung für genau diesen Pfad.",
        ));
    }
    if productive_or_unsafe_root(scan_root) {
        return Err(AppError::invalid_config(
            "Diese Scanwurzel ist kein zulässiger Testpfad.",
        ));
    }
    let dir = base.join(DIR);
    fs::create_dir_all(&dir).map_err(|_| AppError::internal())?;
    let path = approval_file(base, scan_root)?;
    let raw = json!({
        "schemaVersion": VERSION,
        "scanRoot": scan_root,
        "approvedAtMs": now_ms(),
    })
    .to_string();
    fs::write(&path, raw).map_err(|_| AppError::internal())?;
    inspect_test_root_at(base, scan_root)
}

pub(crate) fn require_approved_test_root(base: &Path, scan_root: &str) -> Result<(), AppError> {
    let view = inspect_test_root_at(base, scan_root)?;
    if view.approved {
        Ok(())
    } else {
        Err(AppError::invalid_config(view.message))
    }
}

fn app_data(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path().app_data_dir().map_err(|_| AppError::internal())
}

#[tauri::command]
pub fn inspect_test_scan_root(app: AppHandle, scan_root: String) -> Result<TestRootApprovalView, AppError> {
    inspect_test_root_at(&app_data(&app)?, &scan_root)
}

#[tauri::command]
pub fn approve_test_scan_root(
    app: AppHandle,
    scan_root: String,
    explicit_confirm: bool,
) -> Result<TestRootApprovalView, AppError> {
    approve_test_root_at(&app_data(&app)?, &scan_root, explicit_confirm)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "dotty-testroot-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn name_test_is_not_approval() {
        let app = dir();
        let root = r"C:\Users\Public\Documents\Test";
        let view = inspect_test_root_at(&app, root).unwrap();
        assert!(!view.approved);
        assert!(approve_test_root_at(&app, root, false).is_err());
        let _ = fs::remove_dir_all(app);
    }

    #[test]
    fn exact_path_approval_does_not_cover_another_path() {
        let app = dir();
        let root = app.to_string_lossy().replace('\\', "/");
        let other = format!("{root}-other");
        approve_test_root_at(&app, &root, true).unwrap();
        assert!(inspect_test_root_at(&app, &root).unwrap().approved);
        assert!(!inspect_test_root_at(&app, &other).unwrap().approved);
        let _ = fs::remove_dir_all(app);
    }

    #[test]
    fn system_roots_are_refused() {
        let app = dir();
        assert!(approve_test_root_at(&app, "C:\\", true).is_err());
        assert!(approve_test_root_at(&app, "C:\\Windows", true).is_err());
        assert!(approve_test_root_at(&app, "C:\\Windows\\Temp", true).is_err());
        assert!(approve_test_root_at(&app, "\\\\server\\share\\folder", true).is_err());
        let _ = fs::remove_dir_all(app);
    }
}
