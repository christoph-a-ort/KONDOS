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
) -> Result<ScanResult, AppError> {
    let config = config.validated()?;
    let _guard = state.try_begin_scan()?;
    let cancel = state.cancel_flag();
    let emit_handle = app.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        scan::run(config, &cancel, |progress: ScanProgress| {
            let _ = emit_handle.emit(SCAN_PROGRESS_EVENT, &progress);
        })
    })
    .await
    .map_err(|_| {
        let _ = app.emit(
            SCAN_PROGRESS_EVENT,
            ScanProgress {
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
pub fn cancel_scan(state: State<'_, AppState>) -> Result<(), AppError> {
    state.request_cancel();
    Ok(())
}
