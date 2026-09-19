use std::path::Path;

use tauri::State;

use crate::error::{AppError, AppErrorKind};
use crate::model::{FsNode, ScanResult};
use crate::state::AppState;

const FILE_MISSING: &str = "Die Datei ist nicht mehr vorhanden.";
const FILE_NO_ASSOC: &str =
    "Für diesen Dateityp ist unter Windows kein Standardprogramm zugeordnet.";
const FILE_ACCESS_DENIED: &str = "Der Zugriff auf die Datei wurde verweigert.";
const FILE_OPEN_FAILED: &str = "Die Datei konnte nicht geöffnet werden.";
const NODE_UNKNOWN: &str = "Die ausgewählte Datei ist im aktuellen Ergebnis nicht enthalten.";
const NODE_IS_DIRECTORY: &str = "Ordner können nicht mit „Datei öffnen“ geöffnet werden.";

const SW_SHOWNORMAL: i32 = 1;
const SE_ERR_FNF: isize = 2;
const SE_ERR_PNF: isize = 3;
const SE_ERR_ACCESSDENIED: isize = 5;
const SE_ERR_ASSOCINCOMPLETE: isize = 27;
const SE_ERR_NOASSOC: isize = 31;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenPlan {
    pub path: String,
}

pub fn find_node<'a>(node: &'a FsNode, node_id: &str) -> Option<&'a FsNode> {
    match node {
        FsNode::File { id, .. } if id == node_id => Some(node),
        FsNode::Directory { id, children, .. } => {
            if id == node_id {
                return Some(node);
            }
            children.iter().find_map(|child| find_node(child, node_id))
        }
        FsNode::File { .. } => None,
    }
}

pub fn resolve_open_target(result: &ScanResult, node_id: &str) -> Result<OpenPlan, AppError> {
    let Some(node) = find_node(&result.root, node_id) else {
        return Err(AppError::invalid_config(NODE_UNKNOWN));
    };
    match node {
        FsNode::Directory { .. } => Err(AppError::invalid_config(NODE_IS_DIRECTORY)),
        FsNode::File { path, .. } => Ok(OpenPlan { path: path.clone() }),
    }
}

pub fn ensure_open_file_on_disk(path: &str) -> Result<(), AppError> {
    if path.trim().is_empty() || !Path::new(path).is_file() {
        return Err(AppError::invalid_path(FILE_MISSING));
    }
    Ok(())
}

pub fn prepare_open_with_default(
    state: &AppState,
    scan_id: u64,
    node_id: &str,
) -> Result<OpenPlan, AppError> {
    state.ensure_open_allowed()?;
    let snapshot = state.snapshot_for_content(scan_id)?;
    let plan = resolve_open_target(&snapshot, node_id)?;
    ensure_open_file_on_disk(&plan.path)?;
    Ok(plan)
}

pub fn open_error_from_shell_code(code: isize) -> AppError {
    let message = match code {
        SE_ERR_FNF | SE_ERR_PNF => FILE_MISSING,
        SE_ERR_NOASSOC | SE_ERR_ASSOCINCOMPLETE => FILE_NO_ASSOC,
        SE_ERR_ACCESSDENIED => FILE_ACCESS_DENIED,
        _ => FILE_OPEN_FAILED,
    };
    let kind = if code == SE_ERR_FNF || code == SE_ERR_PNF {
        AppErrorKind::InvalidPath
    } else {
        AppErrorKind::Internal
    };
    AppError::new(kind, message)
}

#[tauri::command]
pub fn open_with_default(
    state: State<'_, AppState>,
    scan_id: u64,
    node_id: String,
) -> Result<(), AppError> {
    let plan = prepare_open_with_default(&state, scan_id, &node_id)?;
    execute_open_with_default(&plan.path)
}

#[cfg(windows)]
fn execute_open_with_default(path: &str) -> Result<(), AppError> {
    use std::ptr;

    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            hwnd: *mut std::ffi::c_void,
            lp_operation: *const u16,
            lp_file: *const u16,
            lp_parameters: *const u16,
            lp_directory: *const u16,
            n_show_cmd: i32,
        ) -> isize;
    }

    let verb = crate::commands::explorer::wide_nul_path("open");
    let file = crate::commands::explorer::wide_nul_path(path);
    let result = unsafe {
        ShellExecuteW(
            ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            ptr::null(),
            ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if result <= 32 {
        return Err(open_error_from_shell_code(result));
    }
    Ok(())
}

#[cfg(not(windows))]
fn execute_open_with_default(_path: &str) -> Result<(), AppError> {
    Err(AppError::new(AppErrorKind::Internal, FILE_OPEN_FAILED))
}

#[cfg(test)]
mod tests {
    use super::{
        ensure_open_file_on_disk, open_error_from_shell_code, prepare_open_with_default,
        resolve_open_target, FILE_ACCESS_DENIED, FILE_MISSING, FILE_NO_ASSOC, NODE_IS_DIRECTORY,
        NODE_UNKNOWN, SE_ERR_ACCESSDENIED, SE_ERR_FNF, SE_ERR_NOASSOC,
    };
    use crate::error::AppErrorKind;
    use crate::model::{DirectoryListing, FsNode, ScanResult, ScanStats};
    use crate::state::AppState;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_root() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "kondos-open-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ))
    }

    fn file_node(id: &str, path: &str, name: &str) -> FsNode {
        FsNode::File {
            id: id.into(),
            name: name.into(),
            path: path.into(),
            depth: 1,
            size_bytes: None,
            created_at_ms: None,
            modified_at_ms: None,
        }
    }

    fn dir_node(id: &str, path: &str, name: &str, children: Vec<FsNode>) -> FsNode {
        FsNode::Directory {
            id: id.into(),
            name: name.into(),
            path: path.into(),
            depth: 0,
            listing: DirectoryListing::Read,
            children,
            size_bytes: None,
            created_at_ms: None,
            modified_at_ms: None,
        }
    }

    fn result_with(root: FsNode) -> ScanResult {
        ScanResult {
            root,
            warnings: Vec::new(),
            stats: ScanStats::default(),
        }
    }

    fn fixture() -> (std::path::PathBuf, std::path::PathBuf, ScanResult) {
        let root = unique_root();
        fs::create_dir_all(&root).unwrap();
        let file = root.join("Angebot 1.pdf");
        fs::write(&file, b"ok").unwrap();
        let file_path = file.to_string_lossy().into_owned();
        let root_path = root.to_string_lossy().into_owned();
        let scan = result_with(dir_node(
            "root-id",
            &root_path,
            "root",
            vec![file_node("file-id", &file_path, "Angebot 1.pdf")],
        ));
        (root, file, scan)
    }

    #[test]
    fn valid_file_resolves_snapshot_path_not_caller_path() {
        let (root, file, scan) = fixture();
        let plan = resolve_open_target(&scan, "file-id").unwrap();
        assert_eq!(plan.path, file.to_string_lossy());
        ensure_open_file_on_disk(&plan.path).unwrap();
        let stray = resolve_open_target(&scan, &file.to_string_lossy());
        assert!(stray.is_err(), "filesystem path must not bypass nodeId lookup");
        let _ = fs::remove_file(&file);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn directory_node_is_rejected() {
        let (root, file, scan) = fixture();
        let err = resolve_open_target(&scan, "root-id").unwrap_err();
        assert_eq!(err.message, NODE_IS_DIRECTORY);
        let _ = fs::remove_file(&file);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn unknown_node_id_is_rejected() {
        let (root, file, scan) = fixture();
        let err = resolve_open_target(&scan, "missing-id").unwrap_err();
        assert_eq!(err.message, NODE_UNKNOWN);
        let _ = fs::remove_file(&file);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn wrong_scan_id_is_rejected() {
        let (root, file, scan) = fixture();
        let state = AppState::new();
        state.store_snapshot(3, scan);
        let err = prepare_open_with_default(&state, 9, "file-id").unwrap_err();
        assert_eq!(err.kind, AppErrorKind::InvalidConfig);
        let _ = fs::remove_file(&file);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_snapshot_is_rejected() {
        let state = AppState::new();
        let err = prepare_open_with_default(&state, 1, "file-id").unwrap_err();
        assert_eq!(err.kind, AppErrorKind::InvalidConfig);
    }

    #[test]
    fn missing_file_after_scan_is_controlled_error() {
        let (root, file, scan) = fixture();
        let state = AppState::new();
        state.store_snapshot(1, scan);
        fs::remove_file(&file).unwrap();
        let err = prepare_open_with_default(&state, 1, "file-id").unwrap_err();
        assert_eq!(err.message, FILE_MISSING);
        assert_eq!(err.kind, AppErrorKind::InvalidPath);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn scanning_blocks_open() {
        let (root, file, scan) = fixture();
        let state = AppState::new();
        state.store_snapshot(1, scan);
        let _guard = state.try_begin_scan(2).unwrap();
        assert!(prepare_open_with_default(&state, 1, "file-id").is_err());
        let _ = fs::remove_file(&file);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn exporting_blocks_open() {
        let (root, file, scan) = fixture();
        let state = AppState::new();
        state.store_snapshot(1, scan);
        let _guard = state.try_begin_export(1).unwrap();
        assert!(prepare_open_with_default(&state, 1, "file-id").is_err());
        let _ = fs::remove_file(&file);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn preparing_content_blocks_open() {
        let (root, file, scan) = fixture();
        let state = AppState::new();
        state.store_snapshot(1, scan);
        let _guard = state.try_begin_prepare(1).unwrap();
        assert!(prepare_open_with_default(&state, 1, "file-id").is_err());
        let _ = fs::remove_file(&file);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn idle_allows_open_plan_without_shellexecute() {
        let (root, file, scan) = fixture();
        let state = AppState::new();
        state.store_snapshot(1, scan);
        let plan = prepare_open_with_default(&state, 1, "file-id").unwrap();
        assert_eq!(plan.path, file.to_string_lossy());
        let _ = fs::remove_file(&file);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn shell_codes_map_to_user_messages() {
        assert_eq!(open_error_from_shell_code(SE_ERR_FNF).message, FILE_MISSING);
        assert_eq!(open_error_from_shell_code(SE_ERR_NOASSOC).message, FILE_NO_ASSOC);
        assert_eq!(
            open_error_from_shell_code(SE_ERR_ACCESSDENIED).message,
            FILE_ACCESS_DENIED
        );
        assert_eq!(
            open_error_from_shell_code(1).message,
            "Die Datei konnte nicht geöffnet werden."
        );
    }
}
