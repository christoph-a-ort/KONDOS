mod commands;
mod error;
mod filter;
mod model;
mod scan;
mod state;

use commands::{cancel_scan, save_export, start_scan};
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            start_scan,
            cancel_scan,
            save_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
