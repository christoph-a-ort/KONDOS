use tauri::{AppHandle, Emitter, State};

use crate::error::AppError;
use crate::model::{ScanConfig, ScanProgress, ScanResult, ScanStatus};
use crate::scan;
use crate::state::AppState;

pub const SCAN_PROGRESS_EVENT: &str = "scan://progress";

#[tauri::command]
pub async fn start_scan(
    app: AppHandle,
    state: State<'_, AppState>,
    config: ScanConfig,
    scan_id: u64,
) -> Result<ScanResult, AppError> {
    let config = config.validated()?;
    let guard = state.try_begin_scan(scan_id)?;
    let cancel = guard.cancel_flag();
    let emit_handle = app.clone();
    let running_id = guard.scan_id();

    let result = tauri::async_runtime::spawn_blocking(move || {
        scan::run(config, &cancel, running_id, |progress: ScanProgress| {
            let _ = emit_handle.emit(SCAN_PROGRESS_EVENT, &progress);
        })
    })
    .await
    .map_err(|_| {
        let _ = app.emit(
            SCAN_PROGRESS_EVENT,
            ScanProgress {
                scan_id: running_id,
                processed_count: 0,
                current_path: String::new(),
                status: ScanStatus::Failed,
            },
        );
        AppError::internal()
    })?;

    result
}

#[tauri::command]
pub fn cancel_scan(state: State<'_, AppState>, scan_id: u64) -> Result<(), AppError> {
    state.request_cancel(scan_id);
    Ok(())
}
