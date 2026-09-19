use tauri::{AppHandle, Emitter, Manager, State};

use crate::content::{run_prepare_content, ContentProgress, ContentSearchResult, CONTENT_PROGRESS_EVENT};
use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub async fn start_prepare_content(
    app: AppHandle,
    state: State<'_, AppState>,
    scan_id: u64,
) -> Result<ContentProgress, AppError> {
    let guard = state.try_begin_prepare(scan_id)?;
    let cancel = guard.cancel_flag();
    let work_app = app.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let managed = work_app.state::<AppState>();
        run_prepare_content(&managed, scan_id, &cancel, |progress| {
            let _ = work_app.emit(CONTENT_PROGRESS_EVENT, &progress);
        })
    })
    .await;
    drop(guard);

    match outcome {
        Ok(Ok(progress)) => Ok(progress),
        Ok(Err(err)) => Err(err),
        Err(_) => {
            let failed = ContentProgress {
                scan_id,
                total_pdf_count: 0,
                processed_pdf_count: 0,
                searchable_count: 0,
                no_text_count: 0,
                problem_count: 0,
                current_file_name: String::new(),
                status: crate::content::ContentPrepareStatus::Failed,
            };
            let _ = app.emit(CONTENT_PROGRESS_EVENT, &failed);
            Err(AppError::internal())
        }
    }
}

#[tauri::command]
pub fn cancel_prepare_content(state: State<'_, AppState>, scan_id: u64) -> Result<(), AppError> {
    state.request_cancel_prepare(scan_id);
    Ok(())
}

#[tauri::command]
pub async fn search_file_content(
    app: AppHandle,
    state: State<'_, AppState>,
    scan_id: u64,
    query: String,
) -> Result<ContentSearchResult, AppError> {
    state.ensure_content_search_allowed()?;
    let work_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let managed = work_app.state::<AppState>();
        crate::content::search_file_content(&managed, scan_id, &query)
    })
    .await
    .map_err(|_| AppError::internal())?
}

#[cfg(test)]
mod tests {
    use crate::content::{run_prepare_content, ContentPrepareStatus};
    use crate::error::AppErrorKind;
    use crate::model::{DirectoryListing, FsNode, ScanResult, ScanStats};
    use crate::state::AppState;

    fn empty_result() -> ScanResult {
        ScanResult {
            root: FsNode::Directory {
                id: "/tmp/root".into(),
                name: "root".into(),
                path: "/tmp/root".into(),
                depth: 0,
                listing: DirectoryListing::Read,
                children: Vec::new(),
                size_bytes: None,
                created_at_ms: None,
                modified_at_ms: None,
            },
            warnings: Vec::new(),
            stats: ScanStats::default(),
        }
    }

    fn cancel_prepare_content_on_state(state: &AppState, scan_id: u64) {
        state.request_cancel_prepare(scan_id);
    }

    #[test]
    fn start_prepare_command_body_uses_guard_and_releases_occupancy() {
        let state = AppState::new();
        state.store_snapshot(1, empty_result());
        let guard = state.try_begin_prepare(1).expect("occupy");
        let cancel = guard.cancel_flag();
        let progress = run_prepare_content(&state, 1, &cancel, |_| {}).expect("run");
        drop(guard);
        assert_eq!(progress.status, ContentPrepareStatus::Completed);
        assert_eq!(progress.total_pdf_count, 0);
        assert!(state.content_cache_for(1).expect("cache").complete);
        assert!(!state.is_preparing_content());
        assert!(!state.is_close_blocked());
    }

    #[test]
    fn cancel_prepare_command_is_fail_closed_for_foreign_run() {
        let state = AppState::new();
        state.store_snapshot(4, empty_result());
        let guard = state.try_begin_prepare(4).expect("occupy");
        cancel_prepare_content_on_state(&state, 9);
        assert!(!guard.cancel_flag().load(std::sync::atomic::Ordering::SeqCst));
        cancel_prepare_content_on_state(&state, 4);
        assert!(guard.cancel_flag().load(std::sync::atomic::Ordering::SeqCst));
    }

    #[test]
    fn start_prepare_rejects_wrong_scan_id_before_occupying() {
        let state = AppState::new();
        state.store_snapshot(3, empty_result());
        match state.try_begin_prepare(9) {
            Ok(_) => panic!("must fail closed"),
            Err(err) => assert_eq!(err.kind, AppErrorKind::InvalidConfig),
        }
        assert!(!state.is_preparing_content());
    }

    #[test]
    fn search_command_body_returns_compact_result() {
        use crate::content::{search_file_content, ContentEntry, ContentFormat, ContentStatus};

        let state = AppState::new();
        state.store_snapshot(21, empty_result());
        state
            .store_snapshot(
                21,
                ScanResult {
                    root: FsNode::Directory {
                        id: "C:\\root".into(),
                        name: "root".into(),
                        path: "C:\\root".into(),
                        depth: 0,
                        listing: DirectoryListing::Read,
                        children: vec![FsNode::File {
                            id: "C:\\root\\protokoll.pdf".into(),
                            name: "protokoll.pdf".into(),
                            path: "C:\\root\\protokoll.pdf".into(),
                            depth: 1,
                            size_bytes: None,
                            created_at_ms: None,
                            modified_at_ms: None,
                        }],
                        size_bytes: None,
                        created_at_ms: None,
                        modified_at_ms: None,
                    },
                    warnings: Vec::new(),
                    stats: ScanStats::default(),
                },
            );
        state
            .insert_content_entry(
                21,
                ContentEntry {
                    path: "C:\\root\\protokoll.pdf".into(),
                    name: "protokoll.pdf".into(),
                    format: ContentFormat::Pdf,
                    status: ContentStatus::Searchable,
                    text: Some("Brandschutzklappe im Nachtrag".into()),
                    extracted_chars: 28,
                    truncated: false,
                },
            )
            .expect("seed");
        state.mark_content_complete(21).expect("complete");
        let result = search_file_content(&state, 21, "Nachtrag").expect("search");
        assert_eq!(result.scan_id, 21);
        assert_eq!(result.total_hit_count, 1);
        assert_eq!(result.returned_hit_count, 1);
        assert_eq!(result.hits[0].node_id, "C:\\root\\protokoll.pdf");
        assert!(result.hits[0].snippet.contains("Nachtrag"));
    }
}
