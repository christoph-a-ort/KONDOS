//! P2-L.10b.7: confirmed sender mappings in the app data directory. Local only.
use std::path::{Path, PathBuf};

use tauri::AppHandle;

use super::workbench_prefs::{app_data_json_path, read_workbench_prefs_file, write_workbench_prefs_file};
use crate::error::AppError;

pub const LEARNED_SENDERS_FILE_NAME: &str = "learned-senders.v1.json";

#[tauri::command]
pub fn load_learned_senders(app: AppHandle) -> Result<Option<String>, AppError> {
    let path = app_data_json_path(&app, LEARNED_SENDERS_FILE_NAME)?;
    read_workbench_prefs_file(&path)
}

#[tauri::command]
pub fn save_learned_senders(app: AppHandle, mappings_json: String) -> Result<(), AppError> {
    let path = app_data_json_path(&app, LEARNED_SENDERS_FILE_NAME)?;
    write_workbench_prefs_file(&path, &mappings_json)
}

pub fn learned_senders_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(LEARNED_SENDERS_FILE_NAME)
}

#[cfg(test)]
mod tests {
    use super::{learned_senders_path, LEARNED_SENDERS_FILE_NAME};
    use crate::commands::workbench_prefs::{read_workbench_prefs_file, write_workbench_prefs_file};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_dir(label: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "dottyfm-learned-senders-{}-{}-{}",
            label,
            std::process::id(),
            nanos
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn missing_learned_senders_file_returns_none() {
        let dir = unique_dir("missing");
        let path = learned_senders_path(&dir);
        let loaded = read_workbench_prefs_file(&path).expect("read");
        assert!(loaded.is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn learned_senders_roundtrip() {
        let dir = unique_dir("roundtrip");
        let path = learned_senders_path(&dir);
        let json = r#"{"version":1,"mappings":[{"id":"sender-1","from":"SHGZ KGZ","to":"HGZ"}]}"#;
        write_workbench_prefs_file(&path, json).expect("write");
        let loaded = read_workbench_prefs_file(&path).expect("read").expect("present");
        assert_eq!(loaded, json);
        assert!(path.ends_with(LEARNED_SENDERS_FILE_NAME));
        assert!(!path.to_string_lossy().contains("git"));
        let _ = fs::remove_dir_all(&dir);
    }
}
