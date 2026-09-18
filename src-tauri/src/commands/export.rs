use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::AppError;
use crate::export::{
    node_name, render_export, render_export_with_txt_columns, suggested_export_file_name,
    write_export_file, ExportMetaFlags,
};
use crate::model::ExportFormat;
use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSaved {
    pub path: String,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TxtExportColumns {
    pub size: bool,
    pub modified: bool,
    pub created: bool,
}

impl From<TxtExportColumns> for ExportMetaFlags {
    fn from(value: TxtExportColumns) -> Self {
        ExportMetaFlags {
            include_size: value.size,
            include_created_at: value.created,
            include_modified_at: value.modified,
        }
    }
}

fn txt_flags(format: ExportFormat, txt_columns: Option<TxtExportColumns>) -> Option<ExportMetaFlags> {
    if format == ExportFormat::Txt {
        txt_columns.map(ExportMetaFlags::from)
    } else {
        None
    }
}

#[tauri::command]
pub async fn save_export(
    state: State<'_, AppState>,
    path: String,
    format: ExportFormat,
    scan_id: u64,
    txt_columns: Option<TxtExportColumns>,
) -> Result<ExportSaved, AppError> {
    let guard = state.try_begin_export(scan_id)?;
    let result = guard.result();
    let columns = txt_flags(format, txt_columns);
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        write_export_file(&path, format, result.as_ref(), columns)
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
    txt_columns: Option<TxtExportColumns>,
) -> Result<String, AppError> {
    let guard = state.try_begin_export(scan_id)?;
    let rendered = match txt_flags(format, txt_columns) {
        Some(columns) => render_export_with_txt_columns(format, guard.result().as_ref(), Some(columns)),
        None => render_export(format, guard.result().as_ref()),
    }
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
