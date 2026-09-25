use serde::Serialize;
use tauri::State;

use crate::error::AppError;
use crate::report::{
    write_report_pdf_file, write_report_xlsx_file, InventoryReportModel,
};
use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportExportSaved {
    pub path: String,
}

/// Persist an already-aggregated InventoryReportModel as XLSX.
/// No rescan / re-analysis. Occupancy: Exporting while writing.
#[tauri::command]
pub async fn export_inventory_report_xlsx(
    state: State<'_, AppState>,
    path: String,
    report: InventoryReportModel,
) -> Result<ReportExportSaved, AppError> {
    let scan_id = report.meta.scan_id;
    let _guard = state.try_begin_report_export(scan_id)?;
    let outcome = tauri::async_runtime::spawn_blocking(move || write_report_xlsx_file(&path, &report))
        .await
        .map_err(|_| AppError::internal())?;
    drop(_guard);
    Ok(ReportExportSaved {
        path: outcome?.to_string_lossy().into_owned(),
    })
}

/// Persist an already-aggregated InventoryReportModel as PDF.
/// No rescan / re-analysis. Occupancy: Exporting while writing.
#[tauri::command]
pub async fn export_inventory_report_pdf(
    state: State<'_, AppState>,
    path: String,
    report: InventoryReportModel,
) -> Result<ReportExportSaved, AppError> {
    let scan_id = report.meta.scan_id;
    let _guard = state.try_begin_report_export(scan_id)?;
    let outcome = tauri::async_runtime::spawn_blocking(move || write_report_pdf_file(&path, &report))
        .await
        .map_err(|_| AppError::internal())?;
    drop(_guard);
    Ok(ReportExportSaved {
        path: outcome?.to_string_lossy().into_owned(),
    })
}
