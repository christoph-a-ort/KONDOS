use std::path::Path;

use crate::error::AppError;

#[tauri::command]
pub fn save_export(path: String, contents: String) -> Result<(), AppError> {
    let path = path.trim();
    if path.is_empty() {
        return Err(AppError::export_failed(
            "Es wurde kein Speicherort gewählt.",
        ));
    }

    let target = Path::new(path);
    if target.is_dir() {
        return Err(AppError::export_failed(
            "Bitte wählen Sie eine Datei, kein Verzeichnis.",
        ));
    }

    std::fs::write(target, contents.as_bytes()).map_err(|_| {
        AppError::export_failed("Die Datei konnte nicht gespeichert werden.")
    })
}
