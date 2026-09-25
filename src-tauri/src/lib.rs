mod commands;
mod content;
mod error;
mod export;
mod filter;
mod model;
mod report;
mod scan;
mod state;

use commands::{
    cancel_prepare_content, cancel_scan, classify_scan_root, copy_export,
    export_inventory_report_xlsx, load_workbench_prefs, open_in_explorer, open_with_default,
    save_export, save_workbench_prefs, search_file_content, start_prepare_content, start_scan,
    suggest_export_filename,
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
            open_in_explorer,
            open_with_default,
            start_prepare_content,
            cancel_prepare_content,
            search_file_content,
            load_workbench_prefs,
            save_workbench_prefs
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
