use serde::Serialize;
use tauri::State;

use crate::error::AppError;
use crate::export::{node_name, render_export, suggested_export_file_name, write_export_file};
use crate::model::ExportFormat;
use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSaved {
    pub path: String,
}

#[tauri::command]
pub async fn save_export(
    state: State<'_, AppState>,
    path: String,
    format: ExportFormat,
    scan_id: u64,
) -> Result<ExportSaved, AppError> {
    let guard = state.try_begin_export(scan_id)?;
    let result = guard.result();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        write_export_file(&path, format, result.as_ref())
    })
    .await
    .map_err(|_| AppError::internal())?;
    drop(guard);
    Ok(ExportSaved {
        path: outcome?.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn copy_export(
    state: State<'_, AppState>,
    format: ExportFormat,
    scan_id: u64,
) -> Result<String, AppError> {
    let guard = state.try_begin_export(scan_id)?;
    let rendered = render_export(format, guard.result().as_ref())
        .map_err(|_| AppError::export_failed("Der Export konnte nicht erzeugt werden."))?;
    drop(guard);
    Ok(rendered)
}

#[tauri::command]
pub fn suggest_export_filename(
    state: State<'_, AppState>,
    format: ExportFormat,
    scan_id: u64,
) -> Result<String, AppError> {
    let result = state.snapshot_for(scan_id)?;
    Ok(suggested_export_file_name(
        node_name(&result.root),
        format,
    ))
}
