mod commands;
mod error;
mod export;
mod filter;
mod model;
mod scan;
mod state;

use commands::{cancel_scan, copy_export, save_export, start_scan, suggest_export_filename};
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
                if window.state::<AppState>().is_exporting() {
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            start_scan,
            cancel_scan,
            save_export,
            copy_export,
            suggest_export_filename
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
