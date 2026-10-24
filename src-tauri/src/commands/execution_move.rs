//! P2-L.4b.2: single-file move inside an approved test scan root. No overwrite, no copy+delete.
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager, State};

use crate::error::AppError;
use crate::scan::must_not_follow;
use crate::state::AppState;

use super::execution_binding::{inspect_scan_root_at, progress_bound_run_locked, BoundExecutionView};
use super::execution_journal::{
    journal, journal_status_blocks_real_ops, journal_store, load_at, success_journal_status,
};
use super::execution_preflight::{path_has_parent_dir, within_scan_root};
use super::execution_test_root::require_approved_test_root;
use super::scan_root_coordination::acquire_at;

const REAL_CHANGE_NOTICE: &str =
    "Jetzt erfolgt eine echte Dateisystemänderung. Es wird ausschließlich diese eine Datei verschoben.";

#[cfg(test)]
thread_local! {
    static MOVE_FAULT: std::cell::RefCell<Option<&'static str>> = const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
pub(crate) fn set_move_fault(fault: Option<&'static str>) {
    MOVE_FAULT.with(|current| *current.borrow_mut() = fault);
}

fn injected_fault(stage: &str) -> bool {
    #[cfg(test)]
    {
        return MOVE_FAULT.with(|current| current.borrow().as_deref() == Some(stage));
    }
    #[cfg(not(test))]
    {
        let _ = stage;
        false
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MoveFileResult {
    pub outcome: String,
    pub source_path: String,
    pub target_path: String,
    pub message: String,
    pub moved: bool,
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

fn blocked_result(source: &str, target: &str, message: impl Into<String>, binding: BoundExecutionView) -> MoveFileResult {
    MoveFileResult {
        outcome: "blocked".to_string(),
        source_path: source.to_string(),
        target_path: target.to_string(),
        message: message.into(),
        moved: false,
        halted: true,
        binding_status: binding.status,
        journal_json: binding.journal_json,
        reminder: REAL_CHANGE_NOTICE.to_string(),
    }
}

fn with_binding(mut result: MoveFileResult, binding: BoundExecutionView) -> MoveFileResult {
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

fn invalid_name(name: &str) -> bool {
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

fn relative_components(scan_root: &str, path: &str) -> Result<Vec<String>, AppError> {
    if path_has_parent_dir(scan_root) || path_has_parent_dir(path) {
        return Err(AppError::invalid_config(
            "Quelle oder Ziel liegt außerhalb der Scanwurzel oder enthält einen unzulässigen Pfad.",
        ));
    }
    if !within_scan_root(scan_root, path) {
        return Err(AppError::invalid_config(
            "Quelle oder Ziel liegt außerhalb der freigegebenen Scanwurzel.",
        ));
    }
    let root = scan_root.replace('\\', "/").trim().trim_end_matches('/').to_lowercase();
    let value = path.replace('\\', "/").trim().trim_end_matches('/').to_lowercase();
    if value == root {
        return Err(AppError::invalid_config("Die Scanwurzel selbst darf nicht verschoben werden."));
    }
    let rel = value[root.len() + 1..].to_string();
    let parts: Vec<String> = rel.split('/').map(str::to_string).collect();
    if parts.is_empty() || parts.iter().any(|part| invalid_name(part)) {
        return Err(AppError::invalid_config("Der Dateiname ist unzulässig."));
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
    source_path: &str,
    target_path: &str,
    approved_root: &str,
    identity: Option<&FileIdentity>,
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
    let mut execution = json!({
        "kind": "moveFile",
        "phase": phase,
        "operationId": operation_id,
        "sourcePath": source_path,
        "targetPath": target_path,
        "approvedTestRoot": approved_root,
        "explicitConfirm": true,
    });
    if let (Some(identity), Some(map)) = (identity, execution.as_object_mut()) {
        map.insert(
            "sourceIdentity".into(),
            json!({
                "volumeSerial": format!("{:08x}", identity.volume_serial),
                "fileIndex": format!("{:08x}{:08x}", identity.index_high, identity.index_low),
                "sizeBytes": identity.size_bytes,
                "modifiedAtMs": identity.modified_at_ms,
            }),
        );
    }
    object.insert("execution".into(), execution);
    append_event(&mut object, message, operation_id);
    serde_json::to_string(&Value::Object(object))
        .map_err(|_| journal_error("Journalformat ist nicht zuverlässig interpretierbar und bleibt gesperrt."))
}

fn halt_reason_from_ops(object: &Map<String, Value>, operation_id: &str) -> Option<String> {
    let status = object.get("status").and_then(Value::as_str).unwrap_or("");
    if journal_status_blocks_real_ops(status) {
        if status == "completed" {
            return Some("Das Journal ist abgeschlossen. Keine weiteren Datei- oder Ordneroperationen.".to_string());
        }
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
                "Eine frühere echte Dateioperation ist nicht abgeschlossen. Keine automatische Wiederholung.".to_string(),
            );
        }
        if state == "failed" {
            return Some("Eine frühere echte Dateioperation ist fehlgeschlagen. Ablauf angehalten.".to_string());
        }
        if id == operation_id && state == "executed" {
            return Some("Diese Datei wurde bereits verschoben. Keine automatische Wiederholung.".to_string());
        }
    }
    None
}

#[derive(Debug, Clone, Copy)]
struct FileIdentity {
    volume_serial: u32,
    index_high: u32,
    index_low: u32,
    size_bytes: u64,
    modified_at_ms: u64,
}

#[derive(Debug)]
enum MoveBlock {
    Exists,
    SourceMissing,
    ParentMissing,
    NotFile,
    Reparse,
    OutsideRoot,
    InvalidName,
    Fingerprint,
    DifferentVolume,
    Unverifiable,
    MovedUnverified,
    Io,
}

impl MoveBlock {
    fn message(&self) -> &'static str {
        match self {
            MoveBlock::Exists => "Das Ziel ist bereits belegt. Vorhandene Dateien werden nicht überschrieben.",
            MoveBlock::SourceMissing => "Die erwartete Quelldatei fehlt.",
            MoveBlock::ParentMissing => "Der Zielordner existiert nicht.",
            MoveBlock::NotFile => "Die Quelle ist keine reguläre Datei. Ordner dürfen nicht verschoben werden.",
            MoveBlock::Reparse => "Symlink, Junction oder anderer Reparse-Point blockiert die Operation.",
            MoveBlock::OutsideRoot => "Quelle oder Ziel liegt außerhalb der freigegebenen Scanwurzel.",
            MoveBlock::InvalidName => "Der Dateiname ist unzulässig.",
            MoveBlock::Fingerprint => "Die Quelldatei hat sich seit der Planung verändert. Ablauf angehalten.",
            MoveBlock::DifferentVolume => "Quelle und Ziel liegen nicht auf demselben Volume.",
            MoveBlock::Unverifiable => "Der Dateisystemzustand ist nicht sicher verifizierbar.",
            MoveBlock::MovedUnverified => {
                "Die Verschiebung konnte nach der Änderung nicht sicher bestätigt werden. Keine automatische Wiederholung."
            }
            MoveBlock::Io => "Die Dateiverschiebung ist fehlgeschlagen.",
        }
    }
}

fn metadata_is_reparse(metadata: &fs::Metadata) -> bool {
    must_not_follow(metadata.file_type(), Some(metadata))
}

fn precheck_paths(scan_root: &str, source: &str, target: &str) -> Result<(), MoveBlock> {
    if win_move::path_is_reparse(scan_root)? || win_move::path_is_reparse(source)? || win_move::path_is_reparse(target)? {
        return Err(MoveBlock::Reparse);
    }
    if let Some(parent) = Path::new(&target.replace('/', "\\")).parent() {
        match fs::symlink_metadata(parent) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Err(MoveBlock::ParentMissing),
            Err(_) => return Err(MoveBlock::Unverifiable),
            Ok(metadata) => {
                if metadata_is_reparse(&metadata) {
                    return Err(MoveBlock::Reparse);
                }
                if !metadata.is_dir() {
                    return Err(MoveBlock::ParentMissing);
                }
            }
        }
    }
    match fs::symlink_metadata(source.replace('/', "\\")) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Err(MoveBlock::SourceMissing),
        Err(_) => return Err(MoveBlock::Unverifiable),
        Ok(metadata) => {
            if metadata_is_reparse(&metadata) {
                return Err(MoveBlock::Reparse);
            }
            if metadata.is_dir() || !metadata.is_file() {
                return Err(MoveBlock::NotFile);
            }
        }
    }
    match fs::symlink_metadata(target.replace('/', "\\")) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(MoveBlock::Unverifiable),
        Ok(metadata) => {
            if metadata_is_reparse(&metadata) {
                return Err(MoveBlock::Reparse);
            }
            return Err(MoveBlock::Exists);
        }
    }
    Ok(())
}

#[cfg(windows)]
mod win_move {
    use super::{metadata_is_reparse, within_scan_root, FileIdentity, MoveBlock};
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
    const FILE_ADD_FILE: u32 = 0x2;
    const FILE_TRAVERSE: u32 = 0x20;
    const FILE_READ_ATTRIBUTES: u32 = 0x80;
    const DELETE: u32 = 0x0001_0000;
    const SYNCHRONIZE: u32 = 0x0010_0000;
    const FILE_ATTRIBUTE_NORMAL: u32 = 0x80;
    const FILE_DIRECTORY_FILE: u32 = 0x1;
    const FILE_NON_DIRECTORY_FILE: u32 = 0x40;
    const FILE_SYNCHRONOUS_IO_NONALERT: u32 = 0x20;
    const FILE_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_OPEN_FOR_BACKUP_INTENT: u32 = 0x4000;
    const FILE_OPEN: u32 = 1;
    const OBJ_CASE_INSENSITIVE: u32 = 0x40;
    const VOLUME_NAME_DOS: u32 = 0;
    const FILE_RENAME_INFORMATION: u32 = 10;
    const STATUS_OBJECT_NAME_COLLISION: i32 = -1073741771;
    const STATUS_NOT_SAME_DEVICE: i32 = -1073741612;
    const STATUS_OBJECT_NAME_NOT_FOUND: i32 = -1073741772;
    const STATUS_OBJECT_PATH_NOT_FOUND: i32 = -1073741766;
    const STATUS_FILE_IS_A_DIRECTORY: i32 = -1073741638;

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

    #[repr(C)]
    struct ByHandleFileInformation {
        file_attributes: u32,
        creation_low: u32,
        creation_high: u32,
        access_low: u32,
        access_high: u32,
        write_low: u32,
        write_high: u32,
        volume_serial_number: u32,
        file_size_high: u32,
        file_size_low: u32,
        number_of_links: u32,
        file_index_high: u32,
        file_index_low: u32,
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
        fn NtSetInformationFile(
            file_handle: RawHandle,
            io_status_block: *mut IoStatusBlock,
            file_information: *mut u8,
            length: u32,
            file_information_class: u32,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetFinalPathNameByHandleW(handle: RawHandle, buf: *mut u16, length: u32, flags: u32) -> u32;
        fn GetFileInformationByHandle(handle: RawHandle, info: *mut ByHandleFileInformation) -> i32;
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

    fn final_path(file: &File) -> Result<String, MoveBlock> {
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
            return Err(MoveBlock::Unverifiable);
        }
        Ok(strip_extended(&String::from_utf16_lossy(&buffer[..count as usize])))
    }

    fn filetime_to_ms(filetime: u64) -> Result<u64, MoveBlock> {
        const FILETIME_UNIX_EPOCH: u64 = 116_444_736_000_000_000;
        if filetime == 0 || filetime < FILETIME_UNIX_EPOCH {
            return Err(MoveBlock::Unverifiable);
        }
        Ok((filetime - FILETIME_UNIX_EPOCH) / 10_000)
    }

    fn handle_info(file: &File) -> Result<ByHandleFileInformation, MoveBlock> {
        let mut info = ByHandleFileInformation {
            file_attributes: 0,
            creation_low: 0,
            creation_high: 0,
            access_low: 0,
            access_high: 0,
            write_low: 0,
            write_high: 0,
            volume_serial_number: 0,
            file_size_high: 0,
            file_size_low: 0,
            number_of_links: 0,
            file_index_high: 0,
            file_index_low: 0,
        };
        let ok = unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) };
        if ok == 0 {
            return Err(MoveBlock::Unverifiable);
        }
        Ok(info)
    }

    fn identity_from_handle(file: &File) -> Result<FileIdentity, MoveBlock> {
        let info = handle_info(file)?;
        if info.volume_serial_number == 0 {
            return Err(MoveBlock::Unverifiable);
        }
        Ok(FileIdentity {
            volume_serial: info.volume_serial_number,
            index_high: info.file_index_high,
            index_low: info.file_index_low,
            size_bytes: ((info.file_size_high as u64) << 32) | info.file_size_low as u64,
            modified_at_ms: filetime_to_ms(((info.write_high as u64) << 32) | info.write_low as u64)?,
        })
    }

    fn check_dir_handle(file: &File, scan_root: &str) -> Result<u32, MoveBlock> {
        let metadata = file.metadata().map_err(|_| MoveBlock::Unverifiable)?;
        if metadata_is_reparse(&metadata) {
            return Err(MoveBlock::Reparse);
        }
        if !metadata.is_dir() {
            return Err(MoveBlock::Unverifiable);
        }
        let resolved = final_path(file)?;
        if !within_scan_root(scan_root, &resolved) {
            return Err(MoveBlock::OutsideRoot);
        }
        let info = handle_info(file)?;
        if info.file_attributes & 0x400 != 0 {
            return Err(MoveBlock::Reparse);
        }
        if info.volume_serial_number == 0 {
            return Err(MoveBlock::Unverifiable);
        }
        Ok(info.volume_serial_number)
    }

    fn check_file_handle(
        file: &File,
        scan_root: &str,
        expected_size: u64,
        expected_modified_at_ms: u64,
    ) -> Result<FileIdentity, MoveBlock> {
        let metadata = file.metadata().map_err(|_| MoveBlock::Unverifiable)?;
        if metadata_is_reparse(&metadata) {
            return Err(MoveBlock::Reparse);
        }
        if metadata.is_dir() || !metadata.is_file() {
            return Err(MoveBlock::NotFile);
        }
        let resolved = final_path(file)?;
        if !within_scan_root(scan_root, &resolved) {
            return Err(MoveBlock::OutsideRoot);
        }
        let identity = identity_from_handle(file)?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .and_then(|duration| u64::try_from(duration.as_millis()).ok())
            .ok_or(MoveBlock::Unverifiable)?;
        if metadata.len() != expected_size || modified != expected_modified_at_ms {
            return Err(MoveBlock::Fingerprint);
        }
        Ok(identity)
    }

    fn nt_open(
        parent: &File,
        name: &str,
        desired_access: u32,
        directory: bool,
    ) -> Result<File, MoveBlock> {
        let mut wide: Vec<u16> = std::ffi::OsStr::new(name).encode_wide().collect();
        if wide.is_empty() {
            return Err(MoveBlock::InvalidName);
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
        let options = if directory {
            FILE_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT | FILE_OPEN_FOR_BACKUP_INTENT
        } else {
            FILE_NON_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT | FILE_OPEN_FOR_BACKUP_INTENT
        };
        let status = unsafe {
            NtCreateFile(
                &mut handle,
                desired_access,
                &mut attrs,
                &mut iosb,
                ptr::null_mut(),
                FILE_ATTRIBUTE_NORMAL,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                FILE_OPEN,
                options,
                ptr::null_mut(),
                0,
            )
        };
        if status == STATUS_OBJECT_NAME_NOT_FOUND || status == STATUS_OBJECT_PATH_NOT_FOUND {
            return Err(if directory {
                MoveBlock::ParentMissing
            } else {
                MoveBlock::SourceMissing
            });
        }
        if status == STATUS_OBJECT_NAME_COLLISION {
            return Err(MoveBlock::Exists);
        }
        if status == STATUS_FILE_IS_A_DIRECTORY {
            return Err(MoveBlock::NotFile);
        }
        if status < 0 {
            return Err(MoveBlock::Io);
        }
        Ok(unsafe { File::from_raw_handle(handle) })
    }

    fn open_root(scan_root: &str) -> Result<File, MoveBlock> {
        let win_root = scan_root.replace('/', "\\");
        let path = Path::new(&win_root);
        OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    MoveBlock::ParentMissing
                } else {
                    MoveBlock::Unverifiable
                }
            })
    }

    fn dest_exists(parent: &File, name: &str) -> Result<bool, MoveBlock> {
        match nt_open(parent, name, FILE_READ_ATTRIBUTES | SYNCHRONIZE, false) {
            Ok(found) => {
                drop(found);
                Ok(true)
            }
            Err(MoveBlock::SourceMissing) => Ok(false),
            Err(MoveBlock::NotFile) => Ok(true),
            Err(error) => Err(error),
        }
    }

    fn rename_on_handle(source: &File, dest_parent: &File, name: &str) -> Result<(), MoveBlock> {
        let mut wide: Vec<u16> = std::ffi::OsStr::new(name).encode_wide().collect();
        if wide.is_empty() {
            return Err(MoveBlock::InvalidName);
        }
        let name_bytes = (wide.len() * 2) as u32;
        wide.push(0);
        // Native FILE_RENAME_INFORMATION: BOOLEAN + 7 pad, HANDLE, ULONG, WCHAR[] at offset 20.
        let mut buf = vec![0u8; 20 + wide.len() * 2];
        let replace_if_exists: u32 = 0;
        buf[0..4].copy_from_slice(&replace_if_exists.to_le_bytes());
        let root = dest_parent.as_raw_handle() as u64;
        buf[8..16].copy_from_slice(&root.to_le_bytes());
        buf[16..20].copy_from_slice(&name_bytes.to_le_bytes());
        for (index, unit) in wide.iter().enumerate() {
            let offset = 20 + index * 2;
            buf[offset..offset + 2].copy_from_slice(&unit.to_le_bytes());
        }
        let mut iosb = IoStatusBlock {
            status_or_pointer: 0,
            information: 0,
        };
        let status = unsafe {
            NtSetInformationFile(
                source.as_raw_handle(),
                &mut iosb,
                buf.as_mut_ptr(),
                20 + name_bytes,
                FILE_RENAME_INFORMATION,
            )
        };
        if status == STATUS_OBJECT_NAME_COLLISION {
            return Err(MoveBlock::Exists);
        }
        if status == STATUS_NOT_SAME_DEVICE {
            return Err(MoveBlock::DifferentVolume);
        }
        if status < 0 {
            return Err(MoveBlock::Io);
        }
        Ok(())
    }

    pub(crate) fn path_is_reparse(path: &str) -> Result<bool, MoveBlock> {
        match fs::symlink_metadata(path.replace('/', "\\")) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(_) => Err(MoveBlock::Unverifiable),
            Ok(metadata) => Ok(metadata_is_reparse(&metadata)),
        }
    }

    pub(crate) fn prepare_and_move(
        scan_root: &str,
        source_components: &[String],
        dest_components: &[String],
        expected_size: u64,
        expected_modified_at_ms: u64,
        after_prepare: impl FnOnce(&FileIdentity) -> Result<(), MoveBlock>,
    ) -> Result<FileIdentity, MoveBlock> {
        if source_components.is_empty() || dest_components.is_empty() {
            return Err(MoveBlock::InvalidName);
        }
        let (source_parents, source_name) = source_components.split_at(source_components.len() - 1);
        let (dest_parents, dest_name) = dest_components.split_at(dest_components.len() - 1);
        let source_name = &source_name[0];
        let dest_name = &dest_name[0];

        let mut source_dir = open_root(scan_root)?;
        check_dir_handle(&source_dir, scan_root)?;
        for parent in source_parents {
            source_dir = nt_open(
                &source_dir,
                parent,
                FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
                true,
            )?;
            check_dir_handle(&source_dir, scan_root)?;
        }
        let source = nt_open(
            &source_dir,
            source_name,
            DELETE | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
            false,
        )?;
        let identity = check_file_handle(&source, scan_root, expected_size, expected_modified_at_ms)?;

        let mut dest_dir = open_root(scan_root)?;
        let mut dest_serial = check_dir_handle(&dest_dir, scan_root)?;
        for parent in dest_parents {
            dest_dir = nt_open(
                &dest_dir,
                parent,
                FILE_LIST_DIRECTORY | FILE_ADD_FILE | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
                true,
            )?;
            dest_serial = check_dir_handle(&dest_dir, scan_root)?;
        }
        if dest_parents.is_empty() {
            drop(dest_dir);
            dest_dir = OpenOptions::new()
                .read(true)
                .access_mode(FILE_LIST_DIRECTORY | FILE_ADD_FILE | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | SYNCHRONIZE)
                .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
                .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
                .open(scan_root.replace('/', "\\"))
                .map_err(|_| MoveBlock::Unverifiable)?;
            dest_serial = check_dir_handle(&dest_dir, scan_root)?;
        }
        if dest_serial != identity.volume_serial {
            return Err(MoveBlock::DifferentVolume);
        }
        if dest_exists(&dest_dir, dest_name)? {
            return Err(MoveBlock::Exists);
        }

        after_prepare(&identity)?;
        rename_on_handle(&source, &dest_dir, dest_name)?;
        Ok(identity)
    }

}

#[cfg(not(windows))]
mod win_move {
    use super::{FileIdentity, MoveBlock};
    pub(crate) fn path_is_reparse(_path: &str) -> Result<bool, MoveBlock> {
        Ok(false)
    }
    pub(crate) fn prepare_and_move(
        _scan_root: &str,
        _source_components: &[String],
        _dest_components: &[String],
        _expected_size: u64,
        _expected_modified_at_ms: u64,
        _after_prepare: impl FnOnce(&FileIdentity) -> Result<(), MoveBlock>,
    ) -> Result<FileIdentity, MoveBlock> {
        Err(MoveBlock::Unverifiable)
    }
}

fn execute_move_file_locked(
    app_data: &Path,
    scan_root: &str,
    owner: &str,
    journal_id: &str,
    expected_revision: u64,
    operation_id: &str,
    confirmed_kind: &str,
    confirmed_source_path: &str,
    confirmed_target_path: &str,
    expected_size_bytes: u64,
    expected_modified_at_ms: u64,
    explicit_confirm: bool,
) -> Result<MoveFileResult, AppError> {
    if !explicit_confirm {
        return Ok(blocked_result(
            confirmed_source_path,
            confirmed_target_path,
            "Die Einzelbestätigung für diese echte Dateiverschiebung fehlt.",
            empty_view(),
        ));
    }
    if confirmed_kind != "moveFile" {
        return Ok(blocked_result(
            confirmed_source_path,
            confirmed_target_path,
            "Nur die Operation „Datei verschieben“ ist in diesem Schritt zulässig.",
            empty_view(),
        ));
    }
    if let Err(error) = require_approved_test_root(app_data, scan_root) {
        return Ok(blocked_result(confirmed_source_path, confirmed_target_path, error.message, empty_view()));
    }

    let journal_path = journal(&journal_store(app_data), journal_id)?;
    let existing = match load_at(&journal_path, journal_id) {
        Ok(Some(raw)) => raw,
        Ok(None) => {
            return Ok(blocked_result(
                confirmed_source_path,
                confirmed_target_path,
                "Keine Reservierung vorhanden.",
                empty_view(),
            ));
        }
        Err(_) => {
            return Ok(blocked_result(
                confirmed_source_path,
                confirmed_target_path,
                "Journal ist beschädigt und bleibt gesperrt.",
                empty_view(),
            ));
        }
    };
    let object = match parse_object(&existing) {
        Ok(value) => value,
        Err(error) => {
            return Ok(blocked_result(
                confirmed_source_path,
                confirmed_target_path,
                error.message,
                empty_view(),
            ))
        }
    };
    if object.get("scanRoot").and_then(Value::as_str) != Some(scan_root) {
        return Ok(blocked_result(
            confirmed_source_path,
            confirmed_target_path,
            "Journal- und Reservierungsidentität stimmen nicht überein.",
            empty_view(),
        ));
    }
    if let Some(reason) = halt_reason_from_ops(&object, operation_id) {
        return Ok(blocked_result(confirmed_source_path, confirmed_target_path, reason, empty_view()));
    }
    let operation = match operation_at(&object, operation_id) {
        Ok(value) => value.clone(),
        Err(error) => {
            return Ok(blocked_result(
                confirmed_source_path,
                confirmed_target_path,
                error.message,
                empty_view(),
            ))
        }
    };
    if operation.get("kind").and_then(Value::as_str) != Some("moveFile") {
        return Ok(blocked_result(
            confirmed_source_path,
            confirmed_target_path,
            "Nur die Operation „Datei verschieben“ ist in diesem Schritt zulässig.",
            empty_view(),
        ));
    }
    let source_rel = operation.get("sourcePath").and_then(Value::as_str).unwrap_or("");
    let target_rel = operation.get("targetPath").and_then(Value::as_str).unwrap_or("");
    let source = join_abs(scan_root, source_rel);
    let target = join_abs(scan_root, target_rel);
    if !same_path(&source, confirmed_source_path) || !same_path(&target, confirmed_target_path) {
        return Ok(blocked_result(
            confirmed_source_path,
            confirmed_target_path,
            "Die bestätigte Aktion stimmt nicht mit dem geprüften Quell- oder Zielpfad überein.",
            empty_view(),
        ));
    }
    let current_status = op_status(&object, operation_id);
    if matches!(current_status.as_str(), "started" | "unverified" | "executed" | "failed") {
        return Ok(blocked_result(
            &source,
            &target,
            "Keine automatische Wiederholung einer echten Dateiverschiebung.",
            empty_view(),
        ));
    }
    let source_components = match relative_components(scan_root, &source) {
        Ok(value) => value,
        Err(error) => return Ok(blocked_result(&source, &target, error.message, empty_view())),
    };
    let dest_components = match relative_components(scan_root, &target) {
        Ok(value) => value,
        Err(error) => return Ok(blocked_result(&source, &target, error.message, empty_view())),
    };
    if source_components.len() == dest_components.len()
        && source_components[..source_components.len() - 1] == dest_components[..dest_components.len() - 1]
    {
        return Ok(blocked_result(
            &source,
            &target,
            "Umbenennen im selben Ordner ist in diesem Schritt nicht zulässig.",
            empty_view(),
        ));
    }
    if let Err(block) = precheck_paths(scan_root, &source, &target) {
        return Ok(blocked_result(&source, &target, block.message(), empty_view()));
    }

    let intent_json = std::cell::RefCell::new(existing.clone());
    let intent_written = std::cell::Cell::new(false);
    let move_result = win_move::prepare_and_move(
        scan_root,
        &source_components,
        &dest_components,
        expected_size_bytes,
        expected_modified_at_ms,
        |identity| {
            let intent = with_progress(
                &intent_json.borrow(),
                expected_revision,
                operation_id,
                "started",
                "executing",
                "intent",
                &source,
                &target,
                scan_root,
                Some(identity),
                None,
                "Dauerhafter Ausführungszustand vor echter Dateiverschiebung geschrieben.",
            )
            .map_err(|_| MoveBlock::Unverifiable)?;
            progress_bound_run_locked(app_data, scan_root, owner, journal_id, expected_revision, &intent)
                .map_err(|_| MoveBlock::Unverifiable)?;
            *intent_json.borrow_mut() = intent;
            intent_written.set(true);
            if injected_fault("after-intent") {
                return Err(MoveBlock::MovedUnverified);
            }
            if injected_fault("move-fail") {
                return Err(MoveBlock::Io);
            }
            Ok(())
        },
    );

    if injected_fault("after-move") && matches!(&move_result, Ok(_)) {
        return Ok(MoveFileResult {
            outcome: "unverified".to_string(),
            source_path: source,
            target_path: target,
            message: "Unterbrechung zwischen Dateisystemänderung und Journalabschluss. Keine automatische Wiederholung."
                .to_string(),
            moved: false,
            halted: true,
            binding_status: String::new(),
            journal_json: None,
            reminder: REAL_CHANGE_NOTICE.to_string(),
        });
    }

    match move_result {
        Err(MoveBlock::MovedUnverified) => Ok(MoveFileResult {
            outcome: "unverified".to_string(),
            source_path: source,
            target_path: target,
            message: if injected_fault("after-intent") {
                "Unterbrechung vor der Dateisystemänderung. Keine automatische Wiederholung.".to_string()
            } else {
                MoveBlock::MovedUnverified.message().to_string()
            },
            moved: false,
            halted: true,
            binding_status: String::new(),
            journal_json: None,
            reminder: REAL_CHANGE_NOTICE.to_string(),
        }),
        Ok(_identity) => {
            let source_gone = match fs::symlink_metadata(source.replace('/', "\\")) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
                _ => false,
            };
            let dest_ok = match fs::symlink_metadata(target.replace('/', "\\")) {
                Ok(metadata) => metadata.is_file() && !metadata_is_reparse(&metadata),
                Err(_) => false,
            };
            if !source_gone || !dest_ok {
                return Ok(MoveFileResult {
                    outcome: "unverified".to_string(),
                    source_path: source,
                    target_path: target,
                    message: MoveBlock::MovedUnverified.message().to_string(),
                    moved: false,
                    halted: true,
                    binding_status: String::new(),
                    journal_json: None,
                    reminder: REAL_CHANGE_NOTICE.to_string(),
                });
            }
            let complete = with_progress(
                &intent_json.borrow(),
                expected_revision + 1,
                operation_id,
                "executed",
                success_journal_status(&parse_object(&intent_json.borrow())?, operation_id),
                "verified",
                &source,
                &target,
                scan_root,
                None,
                None,
                "Echte Dateiverschiebung geprüft und im Journal bestätigt.",
            )?;
            progress_bound_run_locked(
                app_data,
                scan_root,
                owner,
                journal_id,
                expected_revision + 1,
                &complete,
            )?;
            Ok(MoveFileResult {
                outcome: "moved".to_string(),
                source_path: source,
                target_path: target,
                message: "Die Datei wurde verschoben. Der nächste Vorschlag wird angezeigt, aber nicht ausgeführt."
                    .to_string(),
                moved: true,
                halted: false,
                binding_status: String::new(),
                journal_json: None,
                reminder: REAL_CHANGE_NOTICE.to_string(),
            })
        }
        Err(block) => {
            if intent_written.get() {
                let failed = with_progress(
                    &intent_json.borrow(),
                    expected_revision + 1,
                    operation_id,
                    "failed",
                    "executionHalted",
                    "failed",
                    &source,
                    &target,
                    scan_root,
                    None,
                    Some(block.message()),
                    &format!("Echte Dateiverschiebung fehlgeschlagen: {}", block.message()),
                )?;
                let _ = progress_bound_run_locked(
                    app_data,
                    scan_root,
                    owner,
                    journal_id,
                    expected_revision + 1,
                    &failed,
                );
                Ok(MoveFileResult {
                    outcome: "failed".to_string(),
                    source_path: source,
                    target_path: target,
                    message: format!("{} Ablauf angehalten.", block.message()),
                    moved: false,
                    halted: true,
                    binding_status: String::new(),
                    journal_json: None,
                    reminder: REAL_CHANGE_NOTICE.to_string(),
                })
            } else {
                Ok(blocked_result(&source, &target, block.message(), empty_view()))
            }
        }
    }
}

pub(crate) fn execute_move_file_at(
    app_data: &Path,
    scan_root: &str,
    owner: &str,
    journal_id: &str,
    expected_revision: u64,
    operation_id: &str,
    confirmed_kind: &str,
    confirmed_source_path: &str,
    confirmed_target_path: &str,
    expected_size_bytes: u64,
    expected_modified_at_ms: u64,
    explicit_confirm: bool,
) -> Result<MoveFileResult, AppError> {
    let result = {
        let _guard = acquire_at(app_data, scan_root)?;
        execute_move_file_locked(
            app_data,
            scan_root,
            owner,
            journal_id,
            expected_revision,
            operation_id,
            confirmed_kind,
            confirmed_source_path,
            confirmed_target_path,
            expected_size_bytes,
            expected_modified_at_ms,
            explicit_confirm,
        )?
    };
    let view = inspect_scan_root_at(app_data, scan_root).unwrap_or_else(|_| empty_view());
    Ok(with_binding(result, view))
}

#[tauri::command]
pub fn execute_move_file(
    app: AppHandle,
    state: State<'_, AppState>,
    scan_root: String,
    owner_run_id: String,
    journal_id: String,
    expected_revision: u64,
    operation_id: String,
    confirmed_kind: String,
    confirmed_source_path: String,
    confirmed_target_path: String,
    expected_size_bytes: u64,
    expected_modified_at_ms: u64,
    explicit_confirm: bool,
) -> Result<MoveFileResult, AppError> {
    let _occupancy = state.try_begin_execution()?;
    execute_move_file_at(
        &app_data(&app)?,
        &scan_root,
        &owner_run_id,
        &journal_id,
        expected_revision,
        &operation_id,
        &confirmed_kind,
        &confirmed_source_path,
        &confirmed_target_path,
        expected_size_bytes,
        expected_modified_at_ms,
        explicit_confirm,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::execution_binding::start_bound_run_at;
    use crate::commands::execution_test_root::approve_test_root_at;
    use crate::state::AppState;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "dotty-move-{}-{:?}-{}",
            std::process::id(),
            std::thread::current().id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn journal_json(id: &str, rev: u64, root: &str, owner: &str, source: &str, target: &str, kind: &str) -> String {
        format!(
            r#"{{"schemaVersion":1,"journalId":"{id}","revision":{rev},"operations":[{{"id":"op-file","kind":"{kind}","objectId":"n1","sourcePath":"{source}","targetPath":"{target}","expectedSource":"s","preconditions":[],"expectedTarget":"t","collisionStatus":"mustCheckAtExecution","checkStatus":"mustCheckAtExecution","rationale":"r","recovery":"later"}}],"status":"prepared","operationStatus":{{"op-file":"pending"}},"events":[],"reason":null,"scanRoot":"{root}","ownerRunId":"{owner}","bindingStatus":"reserved","binding":{{"sourceScanId":1,"normalizedRootPath":"{root}","scanConfig":{{"maxDepth":8,"excludeHidden":true,"extensions":[],"includeSize":true,"includeCreatedAt":false,"includeModifiedAt":true}},"snapshotFingerprint":"vp1-test","incomplete":false}}}}"#
        )
    }

    fn fingerprint(path: &Path) -> (u64, u64) {
        let metadata = fs::symlink_metadata(path).unwrap();
        let modified = metadata
            .modified()
            .unwrap()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        (metadata.len(), modified)
    }

    fn setup() -> (PathBuf, String) {
        let root = dir();
        fs::create_dir(root.join("dest")).unwrap();
        fs::write(root.join("a.txt"), b"hello").unwrap();
        fs::write(root.join("keep.txt"), b"keep").unwrap();
        let scan = root.to_string_lossy().replace('\\', "/");
        approve_test_root_at(&root, &scan, true).unwrap();
        start_bound_run_at(
            &root,
            &scan,
            "owner-a",
            "j1",
            0,
            &journal_json("j1", 1, &scan, "owner-a", "a.txt", "dest/a.txt", "moveFile"),
        )
        .unwrap();
        (root, scan)
    }

    fn execute(
        app: &Path,
        scan: &str,
        expected: u64,
        confirm: bool,
        kind: &str,
        source: &str,
        target: &str,
        size: u64,
        modified: u64,
    ) -> MoveFileResult {
        execute_move_file_at(
            app, scan, "owner-a", "j1", expected, "op-file", kind, source, target, size, modified, confirm,
        )
        .unwrap()
    }

    #[test]
    fn missing_confirmation_is_blocked() {
        let (root, scan) = setup();
        let source = format!("{scan}/a.txt");
        let target = format!("{scan}/dest/a.txt");
        let (size, modified) = fingerprint(&root.join("a.txt"));
        let result = execute(&root, &scan, 1, false, "moveFile", &source, &target, size, modified);
        assert_eq!(result.outcome, "blocked");
        assert!(root.join("a.txt").is_file());
        assert!(!root.join("dest").join("a.txt").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rename_kind_is_blocked() {
        let root = dir();
        fs::create_dir(root.join("dest")).unwrap();
        fs::write(root.join("a.txt"), b"hello").unwrap();
        let scan = root.to_string_lossy().replace('\\', "/");
        approve_test_root_at(&root, &scan, true).unwrap();
        start_bound_run_at(
            &root,
            &scan,
            "owner-a",
            "j1",
            0,
            &journal_json("j1", 1, &scan, "owner-a", "a.txt", "dest/a.txt", "renameFile"),
        )
        .unwrap();
        let (size, modified) = fingerprint(&root.join("a.txt"));
        let result = execute(
            &root,
            &scan,
            1,
            true,
            "renameFile",
            &format!("{scan}/a.txt"),
            &format!("{scan}/dest/a.txt"),
            size,
            modified,
        );
        assert_eq!(result.outcome, "blocked");
        assert!(root.join("a.txt").is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn occupancy_blocks_scan_and_second_execution() {
        let state = AppState::new();
        let guard = state.try_begin_execution().unwrap();
        assert!(state.try_begin_scan(2).is_err());
        assert!(state.try_begin_execution().is_err());
        drop(guard);
        let _scan = state.try_begin_scan(3).unwrap();
        assert!(state.try_begin_execution().is_err());
    }

    #[cfg(windows)]
    #[test]
    fn moves_single_file_and_leaves_neighbor() {
        let (root, scan) = setup();
        let source = format!("{scan}/a.txt");
        let target = format!("{scan}/dest/a.txt");
        let (size, modified) = fingerprint(&root.join("a.txt"));
        let keep = fs::read(root.join("keep.txt")).unwrap();
        let result = execute(&root, &scan, 1, true, "moveFile", &source, &target, size, modified);
        assert_eq!(result.outcome, "moved", "{}", result.message);
        assert!(result.moved);
        assert!(!root.join("a.txt").exists());
        assert!(root.join("dest").join("a.txt").is_file());
        assert_eq!(fs::read(root.join("dest").join("a.txt")).unwrap(), b"hello");
        assert_eq!(fs::read(root.join("keep.txt")).unwrap(), keep);
        let stored = load_at(&journal(&journal_store(&root), "j1").unwrap(), "j1").unwrap().unwrap();
        assert!(stored.contains("\"status\":\"completed\""), "{stored}");
        assert!(stored.contains("\"op-file\":\"executed\""));
        assert!(stored.contains("\"bindingStatus\":\"reserved\""));
        let retry = execute(&root, &scan, 3, true, "moveFile", &source, &target, size, modified);
        assert_eq!(retry.outcome, "blocked");
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn existing_target_is_blocked() {
        let (root, scan) = setup();
        fs::write(root.join("dest").join("a.txt"), b"other").unwrap();
        let (size, modified) = fingerprint(&root.join("a.txt"));
        let result = execute(
            &root,
            &scan,
            1,
            true,
            "moveFile",
            &format!("{scan}/a.txt"),
            &format!("{scan}/dest/a.txt"),
            size,
            modified,
        );
        assert_eq!(result.outcome, "blocked");
        assert_eq!(fs::read(root.join("a.txt")).unwrap(), b"hello");
        assert_eq!(fs::read(root.join("dest").join("a.txt")).unwrap(), b"other");
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn directory_source_is_blocked() {
        let root = dir();
        fs::create_dir(root.join("srcfolder")).unwrap();
        fs::create_dir(root.join("dest")).unwrap();
        let scan = root.to_string_lossy().replace('\\', "/");
        approve_test_root_at(&root, &scan, true).unwrap();
        start_bound_run_at(
            &root,
            &scan,
            "owner-a",
            "j1",
            0,
            &journal_json("j1", 1, &scan, "owner-a", "srcfolder", "dest/srcfolder", "moveFile"),
        )
        .unwrap();
        let result = execute(
            &root,
            &scan,
            1,
            true,
            "moveFile",
            &format!("{scan}/srcfolder"),
            &format!("{scan}/dest/srcfolder"),
            0,
            0,
        );
        assert_eq!(result.outcome, "blocked");
        assert!(root.join("srcfolder").is_dir());
        assert!(!root.join("dest").join("srcfolder").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn missing_source_is_blocked() {
        let (root, scan) = setup();
        let (size, modified) = fingerprint(&root.join("a.txt"));
        fs::remove_file(root.join("a.txt")).unwrap();
        let result = execute(
            &root,
            &scan,
            1,
            true,
            "moveFile",
            &format!("{scan}/a.txt"),
            &format!("{scan}/dest/a.txt"),
            size,
            modified,
        );
        assert_eq!(result.outcome, "blocked");
        assert!(!root.join("dest").join("a.txt").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn changed_fingerprint_is_blocked() {
        let (root, scan) = setup();
        let (size, modified) = fingerprint(&root.join("a.txt"));
        fs::write(root.join("a.txt"), b"hello!").unwrap();
        let result = execute(
            &root,
            &scan,
            1,
            true,
            "moveFile",
            &format!("{scan}/a.txt"),
            &format!("{scan}/dest/a.txt"),
            size,
            modified,
        );
        assert_eq!(result.outcome, "blocked");
        assert!(result.message.contains("verändert") || result.message.contains("nicht sicher"));
        assert!(root.join("a.txt").is_file());
        assert!(!root.join("dest").join("a.txt").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn target_outside_scan_root_is_blocked() {
        let (root, scan) = setup();
        let (size, modified) = fingerprint(&root.join("a.txt"));
        let outside = std::env::temp_dir().join(format!("dotty-move-outside-{}", std::process::id()));
        let _ = fs::create_dir_all(&outside);
        let result = execute(
            &root,
            &scan,
            1,
            true,
            "moveFile",
            &format!("{scan}/a.txt"),
            &outside.join("a.txt").to_string_lossy().replace('\\', "/"),
            size,
            modified,
        );
        assert_eq!(result.outcome, "blocked");
        assert!(root.join("a.txt").is_file());
        assert!(!outside.join("a.txt").exists());
        let _ = fs::remove_dir(outside);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn missing_destination_directory_is_blocked() {
        let root = dir();
        fs::write(root.join("a.txt"), b"hello").unwrap();
        let scan = root.to_string_lossy().replace('\\', "/");
        approve_test_root_at(&root, &scan, true).unwrap();
        start_bound_run_at(
            &root,
            &scan,
            "owner-a",
            "j1",
            0,
            &journal_json("j1", 1, &scan, "owner-a", "a.txt", "fehlt/a.txt", "moveFile"),
        )
        .unwrap();
        let (size, modified) = fingerprint(&root.join("a.txt"));
        let result = execute(
            &root,
            &scan,
            1,
            true,
            "moveFile",
            &format!("{scan}/a.txt"),
            &format!("{scan}/fehlt/a.txt"),
            size,
            modified,
        );
        assert_eq!(result.outcome, "blocked");
        assert!(root.join("a.txt").is_file());
        assert!(!root.join("fehlt").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn junction_destination_is_blocked() {
        let root = dir();
        fs::write(root.join("a.txt"), b"hello").unwrap();
        let real = root.join("real");
        let junction = root.join("link");
        fs::create_dir_all(&real).unwrap();
        let output = std::process::Command::new("cmd")
            .arg("/c")
            .arg(format!("mklink /J {} {}", junction.display(), real.display()))
            .output()
            .unwrap();
        assert!(output.status.success(), "mklink /J failed");
        let scan = root.to_string_lossy().replace('\\', "/");
        approve_test_root_at(&root, &scan, true).unwrap();
        start_bound_run_at(
            &root,
            &scan,
            "owner-a",
            "j1",
            0,
            &journal_json("j1", 1, &scan, "owner-a", "a.txt", "link/a.txt", "moveFile"),
        )
        .unwrap();
        let (size, modified) = fingerprint(&root.join("a.txt"));
        let result = execute(
            &root,
            &scan,
            1,
            true,
            "moveFile",
            &format!("{scan}/a.txt"),
            &format!("{scan}/link/a.txt"),
            size,
            modified,
        );
        assert_eq!(result.outcome, "blocked");
        assert!(root.join("a.txt").is_file());
        assert!(!real.join("a.txt").exists());
        let _ = fs::remove_dir(junction);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn crash_after_intent_does_not_move_or_retry() {
        let (root, scan) = setup();
        let source = format!("{scan}/a.txt");
        let target = format!("{scan}/dest/a.txt");
        let (size, modified) = fingerprint(&root.join("a.txt"));
        set_move_fault(Some("after-intent"));
        let result = execute(&root, &scan, 1, true, "moveFile", &source, &target, size, modified);
        set_move_fault(None);
        assert_eq!(result.outcome, "unverified");
        assert!(root.join("a.txt").is_file());
        assert!(!root.join("dest").join("a.txt").exists());
        let retry = execute(&root, &scan, 2, true, "moveFile", &source, &target, size, modified);
        assert_eq!(retry.outcome, "blocked");
        assert!(root.join("a.txt").is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn execution_error_halts_without_retry() {
        let (root, scan) = setup();
        let source = format!("{scan}/a.txt");
        let target = format!("{scan}/dest/a.txt");
        let (size, modified) = fingerprint(&root.join("a.txt"));
        set_move_fault(Some("move-fail"));
        let result = execute(&root, &scan, 1, true, "moveFile", &source, &target, size, modified);
        set_move_fault(None);
        assert_eq!(result.outcome, "failed");
        assert!(root.join("a.txt").is_file());
        let retry = execute(&root, &scan, 3, true, "moveFile", &source, &target, size, modified);
        assert_eq!(retry.outcome, "blocked");
        let _ = fs::remove_dir_all(root);
    }
}
