//! P2-L.10a: persistent naming-rule JSON in the app data directory.
use std::path::{Path, PathBuf};

use tauri::AppHandle;

use super::workbench_prefs::{app_data_json_path, read_workbench_prefs_file, write_workbench_prefs_file};
use crate::error::AppError;

pub const NAMING_RULES_FILE_NAME: &str = "naming-rules.v1.json";

#[tauri::command]
pub fn load_naming_rules(app: AppHandle) -> Result<Option<String>, AppError> {
    let path = app_data_json_path(&app, NAMING_RULES_FILE_NAME)?;
    read_workbench_prefs_file(&path)
}

#[tauri::command]
pub fn save_naming_rules(app: AppHandle, rules_json: String) -> Result<(), AppError> {
    let path = app_data_json_path(&app, NAMING_RULES_FILE_NAME)?;
    write_workbench_prefs_file(&path, &rules_json)
}

pub fn naming_rules_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(NAMING_RULES_FILE_NAME)
}

#[cfg(test)]
mod tests {
    use super::{naming_rules_path, NAMING_RULES_FILE_NAME};
    use crate::commands::workbench_prefs::{read_workbench_prefs_file, write_workbench_prefs_file};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_dir(label: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "dottyfm-naming-rules-{}-{}-{}",
            label,
            std::process::id(),
            nanos
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn missing_naming_rules_file_returns_none() {
        let dir = unique_dir("missing");
        let path = naming_rules_path(&dir);
        let loaded = read_workbench_prefs_file(&path).expect("read");
        assert!(loaded.is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn naming_rules_roundtrip() {
        let dir = unique_dir("roundtrip");
        let path = naming_rules_path(&dir);
        let json = r#"{"version":1,"rules":[{"id":"rule-a","name":"Rechnung","enabled":true}]}"#;
        write_workbench_prefs_file(&path, json).expect("write");
        let loaded = read_workbench_prefs_file(&path).expect("read").expect("present");
        assert_eq!(loaded, json);
        assert!(path.ends_with(NAMING_RULES_FILE_NAME));
        let _ = fs::remove_dir_all(&dir);
    }
}
