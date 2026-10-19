mod commands;
mod content;
mod error;
mod export;
mod filter;
mod model;
mod report;
mod scan;
mod state;

#[cfg(feature = "lock-test-helper")]
pub use commands::scan_root_coordination::run_lock_test_helper;

use commands::{
    cancel_prepare_content, cancel_scan, classify_scan_root, copy_export,
    export_inventory_report_pdf, export_inventory_report_xlsx, load_workbench_prefs,
    open_in_explorer, open_with_default, path_exists, save_export, save_workbench_prefs,
    discard_virtual_plan_draft, list_virtual_plan_drafts, load_virtual_plan_draft, load_virtual_plan_preferences, save_virtual_plan_draft, save_virtual_plan_preferences,
    load_execution_journal, save_execution_journal,
    inspect_bound_execution, start_bound_execution, progress_bound_execution,
    prepare_bound_release, release_bound_execution,
    search_file_content, start_prepare_content, start_scan, suggest_export_filename,
};
use state::AppState;
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState::new())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<AppState>().is_close_blocked() {
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            start_scan,
            cancel_scan,
            classify_scan_root,
            save_export,
            copy_export,
            suggest_export_filename,
            export_inventory_report_xlsx,
            export_inventory_report_pdf,
            open_in_explorer,
            path_exists,
            open_with_default,
            start_prepare_content,
            cancel_prepare_content,
            search_file_content,
            load_workbench_prefs,
            save_workbench_prefs,
            load_virtual_plan_draft,
            list_virtual_plan_drafts,
            load_virtual_plan_preferences,
            save_virtual_plan_draft,
            save_virtual_plan_preferences,
            discard_virtual_plan_draft
            ,load_execution_journal, save_execution_journal
            ,inspect_bound_execution, start_bound_execution, progress_bound_execution
            ,prepare_bound_release, release_bound_execution
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
