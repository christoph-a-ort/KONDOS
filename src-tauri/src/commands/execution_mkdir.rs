//! P2-L.4b.1: single-level real folder creation inside an approved test scan root.
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager, State};

use crate::error::AppError;
use crate::scan::must_not_follow;
use crate::state::AppState;

use super::execution_binding::{inspect_scan_root_at, progress_bound_run_locked, BoundExecutionView};
use super::execution_journal::{journal, journal_store, load_at};
use super::execution_preflight::{path_has_parent_dir, within_scan_root};
use super::execution_test_root::require_approved_test_root;
use super::scan_root_coordination::acquire_at;

const REAL_CHANGE_NOTICE: &str =
    "Jetzt erfolgt eine echte Dateisystemänderung. Es wird ausschließlich dieser eine Ordner angelegt.";

#[cfg(test)]
thread_local! {
    static MKDIR_FAULT: std::cell::RefCell<Option<&'static str>> = const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
pub(crate) fn set_mkdir_fault(fault: Option<&'static str>) {
    MKDIR_FAULT.with(|current| *current.borrow_mut() = fault);
}

fn injected_fault(stage: &str) -> bool {
    #[cfg(test)]
    {
        return MKDIR_FAULT.with(|current| current.borrow().as_deref() == Some(stage));
    }
    #[cfg(not(test))]
    {
        let _ = stage;
        false
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateFolderResult {
    pub outcome: String,
    pub target_path: String,
    pub message: String,
    pub created: bool,
    pub halted: bool,
    pub binding_status: String,
    pub journal_json: Option<String>,
    pub reminder: String,
}

fn app_data(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path().app_data_dir().map_err(|_| AppError::internal())
}

fn empty_view() -> BoundExecutionView {
    BoundExecutionView {
        status: "blocked".to_string(),
        journal_id: None,
        owner_run_id: None,
        journal_revision: None,
        journal_json: None,
        message: "Der gespeicherte Zustand ist unklar und bleibt gesperrt.".to_string(),
    }
}

fn blocked_result(target: &str, message: impl Into<String>, binding: BoundExecutionView) -> CreateFolderResult {
    CreateFolderResult {
        outcome: "blocked".to_string(),
        target_path: target.to_string(),
        message: message.into(),
        created: false,
        halted: true,
        binding_status: binding.status,
        journal_json: binding.journal_json,
        reminder: REAL_CHANGE_NOTICE.to_string(),
    }
}

fn with_binding(mut result: CreateFolderResult, binding: BoundExecutionView) -> CreateFolderResult {
    result.binding_status = binding.status;
    result.journal_json = binding.journal_json;
    result
}

fn same_path(left: &str, right: &str) -> bool {
    within_scan_root(left, right) && within_scan_root(right, left)
}

fn join_abs(scan_root: &str, relative: &str) -> String {
    let root = scan_root.replace('\\', "/").trim_end_matches('/').to_string();
    let relative = relative.replace('\\', "/");
    let rel = relative.trim_start_matches('/');
    if rel.is_empty() || rel == "." {
        root
    } else {
        format!("{root}/{rel}")
    }
}

fn invalid_folder_name(name: &str) -> bool {
    if name.is_empty() || name == "." || name == ".." {
        return true;
    }
    if name.contains(['\\', '/', ':', '*', '?', '"', '<', '>', '|', '\0']) {
        return true;
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return true;
    }
    matches!(
        name.to_ascii_lowercase().as_str(),
        "con" | "prn" | "aux" | "nul"
            | "com1" | "com2" | "com3" | "com4" | "com5" | "com6" | "com7" | "com8" | "com9"
            | "lpt1" | "lpt2" | "lpt3" | "lpt4" | "lpt5" | "lpt6" | "lpt7" | "lpt8" | "lpt9"
    )
}

fn relative_components(scan_root: &str, target: &str) -> Result<Vec<String>, AppError> {
    if path_has_parent_dir(scan_root) || path_has_parent_dir(target) {
        return Err(AppError::invalid_config(
            "Quelle oder Ziel liegt außerhalb der Scanwurzel oder enthält einen unzulässigen Pfad.",
        ));
    }
    if !within_scan_root(scan_root, target) {
        return Err(AppError::invalid_config(
            "Das Ziel liegt außerhalb der freigegebenen Scanwurzel.",
        ));
    }
    let root = scan_root.replace('\\', "/").trim().trim_end_matches('/').to_lowercase();
    let path = target.replace('\\', "/").trim().trim_end_matches('/').to_lowercase();
    if path == root {
        return Err(AppError::invalid_config("Die Scanwurzel selbst darf nicht angelegt werden."));
    }
    let rel = path[root.len() + 1..].to_string();
    let parts: Vec<String> = rel.split('/').map(str::to_string).collect();
    if parts.is_empty() || parts.iter().any(|part| invalid_folder_name(part)) {
        return Err(AppError::invalid_config("Der Zielordnername ist unzulässig."));
    }
    Ok(parts)
}

fn journal_error(message: &str) -> AppError {
    AppError::invalid_config(message)
}

fn parse_object(raw: &str) -> Result<Map<String, Value>, AppError> {
    let value: Value = serde_json::from_str(raw).map_err(|_| journal_error("Journal ist beschädigt und bleibt gesperrt."))?;
    value
        .as_object()
        .cloned()
        .ok_or_else(|| journal_error("Journal ist beschädigt und bleibt gesperrt."))
}

fn operation_at<'a>(object: &'a Map<String, Value>, operation_id: &str) -> Result<&'a Value, AppError> {
    let operations = object
        .get("operations")
        .and_then(Value::as_array)
        .ok_or_else(|| journal_error("Journalformat ist nicht zuverlässig interpretierbar und bleibt gesperrt."))?;
    operations
        .iter()
        .find(|entry| entry.get("id").and_then(Value::as_str) == Some(operation_id))
        .ok_or_else(|| journal_error("Die bestätigte Operation gehört nicht zum gespeicherten Plan."))
}

fn op_status(object: &Map<String, Value>, operation_id: &str) -> String {
    object
        .get("operationStatus")
        .and_then(Value::as_object)
        .and_then(|status| status.get(operation_id))
        .and_then(Value::as_str)
        .unwrap_or("pending")
        .to_string()
}

fn append_event(object: &mut Map<String, Value>, message: &str, operation_id: &str) {
    let events = object.entry("events".to_string()).or_insert_with(|| json!([]));
    let Some(list) = events.as_array_mut() else {
        return;
    };
    list.push(json!({
        "sequence": list.len() + 1,
        "atMs": 0,
        "message": message,
        "operationId": operation_id,
    }));
}

fn with_progress(
    raw: &str,
    expected_revision: u64,
    operation_id: &str,
    op_status_value: &str,
    journal_status: &str,
    phase: &str,
    target_path: &str,
    approved_root: &str,
    reason: Option<&str>,
    message: &str,
) -> Result<String, AppError> {
    let mut object = parse_object(raw)?;
    object.insert("revision".into(), json!(expected_revision + 1));
    object.insert("status".into(), json!(journal_status));
    object.insert("bindingStatus".into(), json!("reserved"));
    if let Some(reason) = reason {
        object.insert("reason".into(), json!(reason));
    }
    let status_map = object
        .entry("operationStatus".to_string())
        .or_insert_with(|| json!({}));
    if let Some(map) = status_map.as_object_mut() {
        map.insert(operation_id.to_string(), json!(op_status_value));
    }
    object.insert(
        "execution".into(),
        json!({
            "kind": "createFolder",
            "phase": phase,
            "operationId": operation_id,
            "targetPath": target_path,
            "approvedTestRoot": approved_root,
            "explicitConfirm": true,
        }),
    );
    append_event(&mut object, message, operation_id);
    serde_json::to_string(&Value::Object(object))
        .map_err(|_| journal_error("Journalformat ist nicht zuverlässig interpretierbar und bleibt gesperrt."))
}

fn halt_reason_from_ops(object: &Map<String, Value>, operation_id: &str) -> Option<String> {
    let status = object.get("status").and_then(Value::as_str).unwrap_or("");
    if matches!(status, "executionHalted" | "blocked" | "recoveryRequired" | "failed" | "interrupted") {
        return Some(
            object
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("Der Ablauf ist angehalten.")
                .to_string(),
        );
    }
    let Some(map) = object.get("operationStatus").and_then(Value::as_object) else {
        return None;
    };
    for (id, value) in map {
        let state = value.as_str().unwrap_or("");
        if matches!(state, "started" | "unverified") {
            return Some(
                "Eine frühere echte Ordneranlage ist nicht abgeschlossen. Keine automatische Wiederholung.".to_string(),
            );
        }
        if state == "failed" {
            return Some("Eine frühere echte Ordneranlage ist fehlgeschlagen. Ablauf angehalten.".to_string());
        }
        if id == operation_id && state == "executed" {
            return Some("Dieser Ordner wurde bereits angelegt. Keine automatische Wiederholung.".to_string());
        }
    }
    None
}

#[derive(Debug)]
enum MkdirBlock {
    Exists,
    ParentMissing,
    Reparse,
    OutsideRoot,
    InvalidName,
    Unverifiable,
    CreatedUnverified,
    Io,
}

impl MkdirBlock {
    fn message(&self) -> &'static str {
        match self {
            MkdirBlock::Exists => "Der Zielordner existiert bereits.",
            MkdirBlock::ParentMissing => "Der Elternordner des Ziels existiert nicht.",
            MkdirBlock::Reparse => "Symlink, Junction oder anderer Reparse-Point blockiert die Operation.",
            MkdirBlock::OutsideRoot => "Das Ziel liegt außerhalb der freigegebenen Scanwurzel.",
            MkdirBlock::InvalidName => "Der Zielordnername ist unzulässig.",
            MkdirBlock::Unverifiable => "Der Dateisystemzustand ist nicht sicher verifizierbar.",
            MkdirBlock::CreatedUnverified => "Die Ordneranlage konnte nach der Änderung nicht sicher bestätigt werden. Keine automatische Wiederholung.",
            MkdirBlock::Io => "Die Ordneranlage ist fehlgeschlagen.",
        }
    }
}

fn metadata_is_reparse(metadata: &fs::Metadata) -> bool {
    must_not_follow(metadata.file_type(), Some(metadata))
}

#[cfg(windows)]
mod win_mkdir {
    use super::{metadata_is_reparse, within_scan_root, MkdirBlock};
    use std::fs::{self, File, OpenOptions};
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, RawHandle};
    use std::path::Path;
    use std::ptr;

    const FILE_SHARE_READ: u32 = 0x1;
    const FILE_SHARE_WRITE: u32 = 0x2;
    const FILE_SHARE_DELETE: u32 = 0x4;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_LIST_DIRECTORY: u32 = 0x1;
    const FILE_READ_ATTRIBUTES: u32 = 0x80;
    const SYNCHRONIZE: u32 = 0x0010_0000;
    const FILE_ATTRIBUTE_NORMAL: u32 = 0x80;
    const FILE_DIRECTORY_FILE: u32 = 0x1;
    const FILE_SYNCHRONOUS_IO_NONALERT: u32 = 0x20;
    const FILE_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_OPEN_FOR_BACKUP_INTENT: u32 = 0x4000;
    const FILE_OPEN: u32 = 1;
    const FILE_CREATE: u32 = 2;
    const OBJ_CASE_INSENSITIVE: u32 = 0x40;
    const VOLUME_NAME_DOS: u32 = 0;
    const STATUS_OBJECT_NAME_COLLISION: i32 = -1073741771; // 0xC0000035
    const STATUS_OBJECT_NAME_NOT_FOUND: i32 = -1073741772; // 0xC0000034
    const STATUS_OBJECT_PATH_NOT_FOUND: i32 = -1073741766; // 0xC000003A

    #[repr(C)]
    struct UnicodeString {
        length: u16,
        maximum_length: u16,
        buffer: *mut u16,
    }

    #[repr(C)]
    struct ObjectAttributes {
        length: u32,
        root_directory: RawHandle,
        object_name: *mut UnicodeString,
        attributes: u32,
        security_descriptor: *mut std::ffi::c_void,
        security_quality_of_service: *mut std::ffi::c_void,
    }

    #[repr(C)]
    struct IoStatusBlock {
        status_or_pointer: isize,
        information: usize,
    }

    #[link(name = "ntdll")]
    extern "system" {
        fn NtCreateFile(
            file_handle: *mut RawHandle,
            desired_access: u32,
            object_attributes: *mut ObjectAttributes,
            io_status_block: *mut IoStatusBlock,
            allocation_size: *mut i64,
            file_attributes: u32,
            share_access: u32,
            create_disposition: u32,
            create_options: u32,
            ea_buffer: *mut std::ffi::c_void,
            ea_length: u32,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetFinalPathNameByHandleW(handle: RawHandle, buf: *mut u16, length: u32, flags: u32) -> u32;
    }

    fn strip_extended(path: &str) -> String {
        if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{rest}")
        } else if let Some(rest) = path.strip_prefix(r"\\?\") {
            rest.to_string()
        } else {
            path.to_string()
        }
    }

    fn final_path(file: &File) -> Result<String, MkdirBlock> {
        let mut buffer = vec![0u16; 32_768];
        let count = unsafe {
            GetFinalPathNameByHandleW(
                file.as_raw_handle(),
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                VOLUME_NAME_DOS,
            )
        };
        if count == 0 || (count as usize) >= buffer.len() {
            return Err(MkdirBlock::Unverifiable);
        }
        Ok(strip_extended(&String::from_utf16_lossy(&buffer[..count as usize])))
    }

    fn check_dir_handle(file: &File, scan_root: &str, must_be_within: bool) -> Result<(), MkdirBlock> {
        let metadata = file.metadata().map_err(|_| MkdirBlock::Unverifiable)?;
        if metadata_is_reparse(&metadata) {
            return Err(MkdirBlock::Reparse);
        }
        if !metadata.is_dir() {
            return Err(MkdirBlock::Unverifiable);
        }
        let resolved = final_path(file)?;
        if must_be_within && !within_scan_root(scan_root, &resolved) {
            return Err(MkdirBlock::OutsideRoot);
        }
        Ok(())
    }

    fn nt_relative(parent: &File, name: &str, disposition: u32) -> Result<File, MkdirBlock> {
        let mut wide: Vec<u16> = std::ffi::OsStr::new(name).encode_wide().collect();
        if wide.is_empty() {
            return Err(MkdirBlock::InvalidName);
        }
        let byte_len = (wide.len() * 2) as u16;
        let mut unicode = UnicodeString {
            length: byte_len,
            maximum_length: byte_len,
            buffer: wide.as_mut_ptr(),
        };
        let mut attrs = ObjectAttributes {
            length: std::mem::size_of::<ObjectAttributes>() as u32,
            root_directory: parent.as_raw_handle(),
            object_name: &mut unicode,
            attributes: OBJ_CASE_INSENSITIVE,
            security_descriptor: ptr::null_mut(),
            security_quality_of_service: ptr::null_mut(),
        };
        let mut iosb = IoStatusBlock {
            status_or_pointer: 0,
            information: 0,
        };
        let mut handle: RawHandle = ptr::null_mut();
        let status = unsafe {
            NtCreateFile(
                &mut handle,
                FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
                &mut attrs,
                &mut iosb,
                ptr::null_mut(),
                FILE_ATTRIBUTE_NORMAL,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                disposition,
                FILE_DIRECTORY_FILE
                    | FILE_SYNCHRONOUS_IO_NONALERT
                    | FILE_OPEN_REPARSE_POINT
                    | FILE_OPEN_FOR_BACKUP_INTENT,
                ptr::null_mut(),
                0,
            )
        };
        if status == STATUS_OBJECT_NAME_COLLISION {
            return Err(MkdirBlock::Exists);
        }
        if status == STATUS_OBJECT_NAME_NOT_FOUND || status == STATUS_OBJECT_PATH_NOT_FOUND {
            return Err(if disposition == FILE_OPEN {
                MkdirBlock::ParentMissing
            } else {
                MkdirBlock::ParentMissing
            });
        }
        if status < 0 {
            return Err(MkdirBlock::Io);
        }
        Ok(unsafe { File::from_raw_handle(handle) })
    }

    fn open_root(scan_root: &str) -> Result<File, MkdirBlock> {
        let win_root = scan_root.replace('/', "\\");
        let path = Path::new(&win_root);
        OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    MkdirBlock::ParentMissing
                } else {
                    MkdirBlock::Unverifiable
                }
            })
    }

    pub(crate) fn create_single_folder(scan_root: &str, components: &[String]) -> Result<(), MkdirBlock> {
        if components.is_empty() {
            return Err(MkdirBlock::InvalidName);
        }
        let (parents, name) = components.split_at(components.len() - 1);
        let name = &name[0];
        let mut current = open_root(scan_root)?;
        check_dir_handle(&current, scan_root, true)?;
        for parent in parents {
            current = nt_relative(&current, parent, FILE_OPEN)?;
            check_dir_handle(&current, scan_root, true)?;
        }
        let created = nt_relative(&current, name, FILE_CREATE)?;
        if check_dir_handle(&created, scan_root, true).is_err() {
            drop(created);
            return Err(MkdirBlock::CreatedUnverified);
        }
        drop(created);
        Ok(())
    }

    pub(crate) fn path_exists_reparse(path: &str) -> Result<bool, MkdirBlock> {
        match fs::symlink_metadata(path.replace('/', "\\")) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(_) => Err(MkdirBlock::Unverifiable),
            Ok(metadata) => Ok(metadata_is_reparse(&metadata)),
        }
    }
}

#[cfg(not(windows))]
mod win_mkdir {
    use super::MkdirBlock;
    pub(crate) fn create_single_folder(_scan_root: &str, _components: &[String]) -> Result<(), MkdirBlock> {
        Err(MkdirBlock::Unverifiable)
    }
    pub(crate) fn path_exists_reparse(_path: &str) -> Result<bool, MkdirBlock> {
        Ok(false)
    }
}

fn precheck_target(scan_root: &str, target: &str, components: &[String]) -> Result<(), MkdirBlock> {
    if components.len() != 1 {
        let parent = join_abs(scan_root, &components[..components.len() - 1].join("/"));
        match fs::symlink_metadata(parent.replace('/', "\\")) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Err(MkdirBlock::ParentMissing),
            Err(_) => return Err(MkdirBlock::Unverifiable),
            Ok(metadata) => {
                if metadata_is_reparse(&metadata) {
                    return Err(MkdirBlock::Reparse);
                }
                if !metadata.is_dir() {
                    return Err(MkdirBlock::ParentMissing);
                }
            }
        }
    }
    match fs::symlink_metadata(target.replace('/', "\\")) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(MkdirBlock::Unverifiable),
        Ok(metadata) => {
            if metadata_is_reparse(&metadata) {
                return Err(MkdirBlock::Reparse);
            }
            return Err(MkdirBlock::Exists);
        }
    }
    if win_mkdir::path_exists_reparse(scan_root)? {
        return Err(MkdirBlock::Reparse);
    }
    Ok(())
}

fn execute_create_folder_locked(
    app_data: &Path,
    scan_root: &str,
    owner: &str,
    journal_id: &str,
    expected_revision: u64,
    operation_id: &str,
    confirmed_kind: &str,
    confirmed_target_path: &str,
    explicit_confirm: bool,
) -> Result<CreateFolderResult, AppError> {
    if !explicit_confirm {
        return Ok(blocked_result(
            confirmed_target_path,
            "Die Einzelbestätigung für diese echte Ordneranlage fehlt.",
            empty_view(),
        ));
    }
    if confirmed_kind != "createFolder" {
        return Ok(blocked_result(
            confirmed_target_path,
            "Nur die Operation „Ordner anlegen“ ist in diesem Schritt zulässig.",
            empty_view(),
        ));
    }
    if let Err(error) = require_approved_test_root(app_data, scan_root) {
        return Ok(blocked_result(confirmed_target_path, error.message, empty_view()));
    }

    let journal_path = journal(&journal_store(app_data), journal_id)?;
    let existing = match load_at(&journal_path, journal_id) {
        Ok(Some(raw)) => raw,
        Ok(None) => {
            return Ok(blocked_result(
                confirmed_target_path,
                "Keine Reservierung vorhanden.",
                empty_view(),
            ));
        }
        Err(_) => {
            return Ok(blocked_result(
                confirmed_target_path,
                "Journal ist beschädigt und bleibt gesperrt.",
                empty_view(),
            ));
        }
    };
    let object = match parse_object(&existing) {
        Ok(value) => value,
        Err(error) => return Ok(blocked_result(confirmed_target_path, error.message, empty_view())),
    };
    if object.get("scanRoot").and_then(Value::as_str) != Some(scan_root) {
        return Ok(blocked_result(
            confirmed_target_path,
            "Journal- und Reservierungsidentität stimmen nicht überein.",
            empty_view(),
        ));
    }
    if let Some(reason) = halt_reason_from_ops(&object, operation_id) {
        return Ok(blocked_result(confirmed_target_path, reason, empty_view()));
    }
    let operation = match operation_at(&object, operation_id) {
        Ok(value) => value.clone(),
        Err(error) => return Ok(blocked_result(confirmed_target_path, error.message, empty_view())),
    };
    if operation.get("kind").and_then(Value::as_str) != Some("createVirtualFolder") {
        return Ok(blocked_result(
            confirmed_target_path,
            "Dateien verschieben, umbenennen oder löschen ist in diesem Schritt nicht zulässig.",
            empty_view(),
        ));
    }
    let relative = operation
        .get("targetPath")
        .and_then(Value::as_str)
        .unwrap_or("");
    let target = join_abs(scan_root, relative);
    if !same_path(&target, confirmed_target_path) {
        return Ok(blocked_result(
            confirmed_target_path,
            "Die bestätigte Aktion stimmt nicht mit dem geprüften Zielpfad überein.",
            empty_view(),
        ));
    }
    let current_status = op_status(&object, operation_id);
    if matches!(current_status.as_str(), "started" | "unverified" | "executed" | "failed") {
        return Ok(blocked_result(
            &target,
            "Keine automatische Wiederholung einer echten Ordneranlage.",
            empty_view(),
        ));
    }
    let components = match relative_components(scan_root, &target) {
        Ok(value) => value,
        Err(error) => return Ok(blocked_result(&target, error.message, empty_view())),
    };
    if let Err(block) = precheck_target(scan_root, &target, &components) {
        return Ok(blocked_result(&target, block.message(), empty_view()));
    }

    let intent = with_progress(
        &existing,
        expected_revision,
        operation_id,
        "started",
        "executing",
        "intent",
        &target,
        scan_root,
        None,
        "Dauerhafter Ausführungszustand vor echter Ordneranlage geschrieben.",
    )?;
    if let Err(error) = progress_bound_run_locked(
        app_data,
        scan_root,
        owner,
        journal_id,
        expected_revision,
        &intent,
    ) {
        return Ok(blocked_result(&target, error.message, empty_view()));
    }

    if injected_fault("after-intent") {
        return Ok(CreateFolderResult {
            outcome: "unverified".to_string(),
            target_path: target,
            message: "Unterbrechung vor der Dateisystemänderung. Keine automatische Wiederholung.".to_string(),
            created: false,
            halted: true,
            binding_status: String::new(),
            journal_json: None,
            reminder: REAL_CHANGE_NOTICE.to_string(),
        });
    }

    if injected_fault("mkdir-fail") {
        let failed = with_progress(
            &intent,
            expected_revision + 1,
            operation_id,
            "failed",
            "executionHalted",
            "failed",
            &target,
            scan_root,
            Some("Die Ordneranlage ist fehlgeschlagen."),
            "Echte Ordneranlage fehlgeschlagen. Ablauf angehalten.",
        )?;
        let _ = progress_bound_run_locked(app_data, scan_root, owner, journal_id, expected_revision + 1, &failed);
        return Ok(CreateFolderResult {
            outcome: "failed".to_string(),
            target_path: target,
            message: "Die Ordneranlage ist fehlgeschlagen. Ablauf angehalten.".to_string(),
            created: false,
            halted: true,
            binding_status: String::new(),
            journal_json: None,
            reminder: REAL_CHANGE_NOTICE.to_string(),
        });
    }

    let mkdir_result = win_mkdir::create_single_folder(scan_root, &components);
    if injected_fault("after-mkdir") {
        return Ok(CreateFolderResult {
            outcome: "unverified".to_string(),
            target_path: target,
            message: "Unterbrechung zwischen Dateisystemänderung und Journalabschluss. Keine automatische Wiederholung.".to_string(),
            created: false,
            halted: true,
            binding_status: String::new(),
            journal_json: None,
            reminder: REAL_CHANGE_NOTICE.to_string(),
        });
    }

    match mkdir_result {
        Err(MkdirBlock::CreatedUnverified) => {
            return Ok(CreateFolderResult {
                outcome: "unverified".to_string(),
                target_path: target,
                message: MkdirBlock::CreatedUnverified.message().to_string(),
                created: false,
                halted: true,
                binding_status: String::new(),
                journal_json: None,
                reminder: REAL_CHANGE_NOTICE.to_string(),
            });
        }
        Ok(()) => {
            let complete = with_progress(
                &intent,
                expected_revision + 1,
                operation_id,
                "executed",
                "executing",
                "verified",
                &target,
                scan_root,
                None,
                "Echte Ordneranlage geprüft und im Journal bestätigt.",
            )?;
            progress_bound_run_locked(
                app_data,
                scan_root,
                owner,
                journal_id,
                expected_revision + 1,
                &complete,
            )?;
            Ok(CreateFolderResult {
                outcome: "created".to_string(),
                target_path: target,
                message: "Der Ordner wurde angelegt. Der nächste Vorschlag wird angezeigt, aber nicht ausgeführt.".to_string(),
                created: true,
                halted: false,
                binding_status: String::new(),
                journal_json: None,
                reminder: REAL_CHANGE_NOTICE.to_string(),
            })
        }
        Err(block) => {
            let failed = with_progress(
                &intent,
                expected_revision + 1,
                operation_id,
                "failed",
                "executionHalted",
                "failed",
                &target,
                scan_root,
                Some(block.message()),
                &format!("Echte Ordneranlage blockiert: {}", block.message()),
            )?;
            let _ = progress_bound_run_locked(
                app_data,
                scan_root,
                owner,
                journal_id,
                expected_revision + 1,
                &failed,
            );
            Ok(CreateFolderResult {
                outcome: "failed".to_string(),
                target_path: target,
                message: format!("{} Ablauf angehalten.", block.message()),
                created: false,
                halted: true,
                binding_status: String::new(),
                journal_json: None,
                reminder: REAL_CHANGE_NOTICE.to_string(),
            })
        }
    }
}

pub(crate) fn execute_create_folder_at(
    app_data: &Path,
    scan_root: &str,
    owner: &str,
    journal_id: &str,
    expected_revision: u64,
    operation_id: &str,
    confirmed_kind: &str,
    confirmed_target_path: &str,
    explicit_confirm: bool,
) -> Result<CreateFolderResult, AppError> {
    let result = {
        let _guard = acquire_at(app_data, scan_root)?;
        execute_create_folder_locked(
            app_data,
            scan_root,
            owner,
            journal_id,
            expected_revision,
            operation_id,
            confirmed_kind,
            confirmed_target_path,
            explicit_confirm,
        )?
    };
    let view = inspect_scan_root_at(app_data, scan_root).unwrap_or_else(|_| empty_view());
    Ok(with_binding(result, view))
}

#[tauri::command]
pub fn execute_create_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    scan_root: String,
    owner_run_id: String,
    journal_id: String,
    expected_revision: u64,
    operation_id: String,
    confirmed_kind: String,
    confirmed_target_path: String,
    explicit_confirm: bool,
) -> Result<CreateFolderResult, AppError> {
    let _occupancy = state.try_begin_execution()?;
    execute_create_folder_at(
        &app_data(&app)?,
        &scan_root,
        &owner_run_id,
        &journal_id,
        expected_revision,
        &operation_id,
        &confirmed_kind,
        &confirmed_target_path,
        explicit_confirm,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::execution_binding::start_bound_run_at;
    use crate::commands::execution_test_root::approve_test_root_at;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "dotty-mkdir-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn journal_json(id: &str, rev: u64, root: &str, owner: &str, target: &str) -> String {
        format!(
            r#"{{"schemaVersion":1,"journalId":"{id}","revision":{rev},"operations":[{{"id":"op-folder","kind":"createVirtualFolder","objectId":"vf1","sourcePath":".","targetPath":"{target}","expectedSource":"s","preconditions":[],"expectedTarget":"t","collisionStatus":"mustCheckAtExecution","checkStatus":"mustCheckAtExecution","rationale":"r","recovery":"later"}}],"status":"prepared","operationStatus":{{"op-folder":"pending"}},"events":[],"reason":null,"scanRoot":"{root}","ownerRunId":"{owner}","bindingStatus":"reserved","binding":{{"sourceScanId":1,"normalizedRootPath":"{root}","scanConfig":{{"maxDepth":8,"excludeHidden":true,"extensions":[],"includeSize":true,"includeCreatedAt":false,"includeModifiedAt":true}},"snapshotFingerprint":"vp1-test","incomplete":false}}}}"#
        )
    }

    fn setup() -> (PathBuf, String) {
        let root = dir();
        let scan = root.to_string_lossy().replace('\\', "/");
        approve_test_root_at(&root, &scan, true).unwrap();
        start_bound_run_at(&root, &scan, "owner-a", "j1", 0, &journal_json("j1", 1, &scan, "owner-a", "neu")).unwrap();
        (root, scan)
    }

    fn execute(
        app: &Path,
        scan: &str,
        expected: u64,
        confirm: bool,
        kind: &str,
        target: &str,
    ) -> CreateFolderResult {
        execute_create_folder_at(app, scan, "owner-a", "j1", expected, "op-folder", kind, target, confirm).unwrap()
    }

    #[cfg(windows)]
    #[test]
    fn creates_single_new_folder() {
        let (root, scan) = setup();
        let target = format!("{scan}/neu");
        let result = execute(&root, &scan, 1, true, "createFolder", &target);
        assert_eq!(result.outcome, "created");
        assert!(result.created);
        assert!(root.join("neu").is_dir());
        assert!(!fs::symlink_metadata(root.join("neu")).unwrap().file_type().is_symlink());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn existing_target_is_blocked() {
        let (root, scan) = setup();
        fs::create_dir(root.join("neu")).unwrap();
        let result = execute(&root, &scan, 1, true, "createFolder", &format!("{scan}/neu"));
        assert_eq!(result.outcome, "blocked");
        assert!(!result.created);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn target_outside_scan_root_is_blocked() {
        let (root, scan) = setup();
        let outside = std::env::temp_dir().join(format!("dotty-outside-mkdir-{}", std::process::id()));
        let _ = fs::create_dir_all(&outside);
        let result = execute(
            &root,
            &scan,
            1,
            true,
            "createFolder",
            &outside.join("neu").to_string_lossy().replace('\\', "/"),
        );
        assert_eq!(result.outcome, "blocked");
        assert!(!outside.join("neu").exists());
        let _ = fs::remove_dir(outside);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn missing_parent_is_blocked() {
        let root = dir();
        let scan = root.to_string_lossy().replace('\\', "/");
        approve_test_root_at(&root, &scan, true).unwrap();
        start_bound_run_at(
            &root,
            &scan,
            "owner-a",
            "j1",
            0,
            &journal_json("j1", 1, &scan, "owner-a", "fehlt/neu"),
        )
        .unwrap();
        let result = execute(&root, &scan, 1, true, "createFolder", &format!("{scan}/fehlt/neu"));
        assert_eq!(result.outcome, "blocked");
        assert!(!root.join("fehlt").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn junction_in_target_path_is_blocked() {
        let root = dir();
        let scan = root.to_string_lossy().replace('\\', "/");
        let real = root.join("real");
        let junction = root.join("link");
        fs::create_dir_all(&real).unwrap();
        let output = std::process::Command::new("cmd")
            .arg("/c")
            .arg(format!("mklink /J {} {}", junction.display(), real.display()))
            .output()
            .unwrap();
        assert!(output.status.success(), "mklink /J failed");
        approve_test_root_at(&root, &scan, true).unwrap();
        start_bound_run_at(
            &root,
            &scan,
            "owner-a",
            "j1",
            0,
            &journal_json("j1", 1, &scan, "owner-a", "link/neu"),
        )
        .unwrap();
        let result = execute_create_folder_at(
            &root,
            &scan,
            "owner-a",
            "j1",
            1,
            "op-folder",
            "createFolder",
            &format!("{scan}/link/neu"),
            true,
        )
        .unwrap();
        assert_eq!(result.outcome, "blocked");
        assert!(!real.join("neu").exists());
        let _ = fs::remove_dir(junction);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn missing_confirmation_is_blocked() {
        let (root, scan) = setup();
        let result = execute(&root, &scan, 1, false, "createFolder", &format!("{scan}/neu"));
        assert_eq!(result.outcome, "blocked");
        assert!(result.message.contains("Einzelbestätigung"));
        assert!(!root.join("neu").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn missing_or_inconsistent_reservation_is_blocked() {
        let root = dir();
        let scan = root.to_string_lossy().replace('\\', "/");
        approve_test_root_at(&root, &scan, true).unwrap();
        let missing = execute_create_folder_at(
            &root,
            &scan,
            "owner-a",
            "j1",
            0,
            "op-folder",
            "createFolder",
            &format!("{scan}/neu"),
            true,
        )
        .unwrap();
        assert_eq!(missing.outcome, "blocked");
        start_bound_run_at(&root, &scan, "owner-a", "j1", 0, &journal_json("j1", 1, &scan, "owner-a", "neu")).unwrap();
        let foreign = execute_create_folder_at(
            &root,
            &scan,
            "owner-b",
            "j1",
            1,
            "op-folder",
            "createFolder",
            &format!("{scan}/neu"),
            true,
        )
        .unwrap();
        assert_eq!(foreign.outcome, "blocked");
        assert!(!root.join("neu").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn execution_error_halts_without_retry() {
        let (root, scan) = setup();
        set_mkdir_fault(Some("mkdir-fail"));
        let result = execute(&root, &scan, 1, true, "createFolder", &format!("{scan}/neu"));
        set_mkdir_fault(None);
        assert_eq!(result.outcome, "failed");
        assert!(!root.join("neu").exists());
        let retry = execute(&root, &scan, 3, true, "createFolder", &format!("{scan}/neu"));
        assert_eq!(retry.outcome, "blocked");
        assert!(retry.message.contains("Keine automatische Wiederholung") || retry.message.contains("fehlgeschlagen"));
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn crash_after_intent_does_not_create_or_retry() {
        let (root, scan) = setup();
        set_mkdir_fault(Some("after-intent"));
        let result = execute(&root, &scan, 1, true, "createFolder", &format!("{scan}/neu"));
        set_mkdir_fault(None);
        assert_eq!(result.outcome, "unverified");
        assert!(!root.join("neu").exists());
        let retry = execute(&root, &scan, 2, true, "createFolder", &format!("{scan}/neu"));
        assert_eq!(retry.outcome, "blocked");
        assert!(!root.join("neu").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn crash_between_mkdir_and_journal_does_not_retry() {
        let (root, scan) = setup();
        set_mkdir_fault(Some("after-mkdir"));
        let result = execute(&root, &scan, 1, true, "createFolder", &format!("{scan}/neu"));
        set_mkdir_fault(None);
        assert_eq!(result.outcome, "unverified");
        assert!(root.join("neu").is_dir());
        let retry = execute(&root, &scan, 2, true, "createFolder", &format!("{scan}/neu"));
        assert_eq!(retry.outcome, "blocked");
        assert!(retry.message.contains("Keine automatische Wiederholung") || retry.message.contains("nicht abgeschlossen"));
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn no_change_outside_test_directory() {
        let (root, scan) = setup();
        let outsider = std::env::temp_dir().join(format!("dotty-mkdir-sentinel-{}", std::process::id()));
        fs::write(&outsider, b"keep").unwrap();
        let before = fs::read(&outsider).unwrap();
        let result = execute(&root, &scan, 1, true, "createFolder", &format!("{scan}/neu"));
        assert_eq!(result.outcome, "created");
        assert_eq!(fs::read(&outsider).unwrap(), before);
        assert!(!Path::new(&outsider).join("neu").exists());
        let _ = fs::remove_file(outsider);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn test_name_without_approval_is_blocked() {
        let root = dir();
        let scan = root.to_string_lossy().replace('\\', "/");
        start_bound_run_at(&root, &scan, "owner-a", "j1", 0, &journal_json("j1", 1, &scan, "owner-a", "neu")).unwrap();
        let result = execute(&root, &scan, 1, true, "createFolder", &format!("{scan}/neu"));
        assert_eq!(result.outcome, "blocked");
        assert!(!root.join("neu").exists());
        let _ = fs::remove_dir_all(root);
    }
}
