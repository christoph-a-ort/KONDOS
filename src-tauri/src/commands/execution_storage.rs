//! FV2-02d.2 – read-only storage-kind inspection. Never mutates scan objects.
use serde::Serialize;

use crate::error::AppError;
use crate::paths::windows_storage::{classify_opened_path, StorageKind};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StorageKindView {
    pub path: String,
    pub kind: String,
    pub message: Option<String>,
}

pub(crate) fn storage_kind_name(kind: StorageKind) -> &'static str {
    match kind {
        StorageKind::Local => "local",
        StorageKind::Remote => "remote",
        StorageKind::Unsupported => "unsupported",
        StorageKind::Unverifiable => "unverifiable",
    }
}

pub(crate) fn fold_storage_kind(left: StorageKind, right: StorageKind) -> StorageKind {
    use StorageKind::{Local, Remote, Unsupported, Unverifiable};
    match (left, right) {
        (Remote, _) | (_, Remote) => Remote,
        (Unsupported, _) | (_, Unsupported) => Unsupported,
        (Unverifiable, _) | (_, Unverifiable) => Unverifiable,
        (Local, Local) => Local,
    }
}

pub(crate) fn inspect_path_kind(path: &str) -> StorageKind {
    if path.trim().is_empty() || path.contains('\0') {
        return StorageKind::Unverifiable;
    }
    classify_opened_path(path)
}

pub(crate) fn inspect_existing_path_kind(path: &str) -> Option<StorageKind> {
    if path.trim().is_empty() || path.contains('\0') {
        return Some(StorageKind::Unverifiable);
    }
    match std::fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => Some(StorageKind::Unverifiable),
        Ok(_) => Some(inspect_path_kind(path)),
    }
}

pub(crate) fn worst_existing_storage_kind<'a>(
    paths: impl IntoIterator<Item = &'a str>,
) -> StorageKind {
    let mut acc: Option<StorageKind> = None;
    for path in paths {
        let Some(kind) = inspect_existing_path_kind(path) else {
            continue;
        };
        acc = Some(match acc {
            None => kind,
            Some(previous) => fold_storage_kind(previous, kind),
        });
    }
    acc.unwrap_or(StorageKind::Unverifiable)
}

pub(crate) fn storage_kind_view(path: &str) -> StorageKindView {
    let kind = inspect_path_kind(path);
    StorageKindView {
        path: path.to_string(),
        kind: storage_kind_name(kind).to_string(),
        message: kind.real_operation_message().map(str::to_string),
    }
}

pub(crate) fn require_local_storage_for_journal_payload(
    scan_root: &str,
    journal_json: &str,
) -> Result<(), AppError> {
    match classify_journal_storage(scan_root, journal_json) {
        StorageKind::Local => Ok(()),
        kind => Err(AppError::invalid_config(
            kind.real_operation_message()
                .unwrap_or("Der Speicherort konnte nicht zuverlässig überprüft werden."),
        )),
    }
}

fn join_abs(scan_root: &str, relative: &str) -> String {
    let root = scan_root
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string();
    let relative = relative.replace('\\', "/");
    let rel = relative.trim_start_matches('/');
    if rel.is_empty() || rel == "." {
        root
    } else {
        format!("{root}/{rel}")
    }
}

fn field_looks_absolute(path: &str) -> bool {
    if crate::paths::windows_rules::is_windows_device_path(path) {
        return true;
    }
    let trimmed = path.trim();
    let bytes = trimmed.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return bytes.len() == 2 || bytes[2] == b'\\' || bytes[2] == b'/';
    }
    trimmed.replace('/', "\\").starts_with("\\\\")
}

fn path_has_dotdot(path: &str) -> bool {
    path.split(['/', '\\']).any(|part| part == "..")
}

fn field_is_unusable(path: &str) -> bool {
    path.contains('\0') || path_has_dotdot(path)
}

fn classify_absolute_field(path: &str) -> StorageKind {
    if crate::paths::windows_rules::is_windows_device_path(path) {
        return inspect_path_kind(path);
    }
    let normalized = path.replace('/', "\\");
    if normalized.starts_with("\\\\") {
        return inspect_path_kind(path);
    }
    StorageKind::Unverifiable
}

fn fold_nearest_existing_parent(acc: StorageKind, path: &str) -> StorageKind {
    let mut current = std::path::Path::new(path);
    while let Some(parent) = current.parent() {
        let text = parent.to_string_lossy();
        if text.is_empty() {
            break;
        }
        if let Some(kind) = inspect_existing_path_kind(text.as_ref()) {
            return fold_storage_kind(acc, kind);
        }
        current = parent;
    }
    acc
}

fn operation_status_of<'a>(
    statuses: Option<&'a serde_json::Map<String, serde_json::Value>>,
    operation_id: &str,
) -> &'a str {
    statuses
        .and_then(|map| map.get(operation_id))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("pending")
}

fn classify_journal_storage(scan_root: &str, journal_json: &str) -> StorageKind {
    let mut acc = inspect_path_kind(scan_root);
    if acc != StorageKind::Local && acc != StorageKind::Remote {
        return acc;
    }
    if acc == StorageKind::Remote {
        return StorageKind::Remote;
    }
    let parsed: serde_json::Value = match serde_json::from_str(journal_json) {
        Ok(value) => value,
        Err(_) => return StorageKind::Unverifiable,
    };
    let Some(operations) = parsed
        .get("operations")
        .and_then(serde_json::Value::as_array)
    else {
        return StorageKind::Unverifiable;
    };
    let statuses = parsed
        .get("operationStatus")
        .and_then(serde_json::Value::as_object);
    for operation in operations {
        let Some(object) = operation.as_object() else {
            return StorageKind::Unverifiable;
        };
        let Some(kind) = object.get("kind").and_then(serde_json::Value::as_str) else {
            return StorageKind::Unverifiable;
        };
        if kind != "createVirtualFolder" && kind != "moveFile" && kind != "renameFile" {
            return StorageKind::Unverifiable;
        }
        let Some(source_field) = object.get("sourcePath").and_then(serde_json::Value::as_str)
        else {
            return StorageKind::Unverifiable;
        };
        let Some(target_field) = object.get("targetPath").and_then(serde_json::Value::as_str)
        else {
            return StorageKind::Unverifiable;
        };
        if field_is_unusable(source_field) || field_is_unusable(target_field) {
            return StorageKind::Unverifiable;
        }
        if kind != "createVirtualFolder" && source_field.trim().is_empty() {
            return StorageKind::Unverifiable;
        }
        if target_field.trim().is_empty() {
            return StorageKind::Unverifiable;
        }
        if field_looks_absolute(source_field) {
            acc = fold_storage_kind(acc, classify_absolute_field(source_field));
        }
        if field_looks_absolute(target_field) {
            acc = fold_storage_kind(acc, classify_absolute_field(target_field));
        }
        if acc == StorageKind::Remote {
            return StorageKind::Remote;
        }
        if acc != StorageKind::Local {
            return acc;
        }
        let op_id = object
            .get("id")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        let op_status = operation_status_of(statuses, op_id);
        let source = join_abs(scan_root, source_field);
        let target = join_abs(scan_root, target_field);
        if path_has_dotdot(&source) || path_has_dotdot(&target) {
            return StorageKind::Unverifiable;
        }
        let source_existing = inspect_existing_path_kind(&source);
        let target_existing = inspect_existing_path_kind(&target);
        match kind {
            "moveFile" | "renameFile" => match op_status {
                "executed" => {
                    if let Some(kind) = source_existing {
                        acc = fold_storage_kind(acc, kind);
                    }
                    match target_existing {
                        Some(kind) => acc = fold_storage_kind(acc, kind),
                        None => return StorageKind::Unverifiable,
                    }
                    acc = fold_nearest_existing_parent(acc, &target);
                }
                "started" | "unverified" => {
                    if source_existing.is_none() && target_existing.is_none() {
                        return StorageKind::Unverifiable;
                    }
                    if let Some(kind) = source_existing {
                        acc = fold_storage_kind(acc, kind);
                    }
                    if let Some(kind) = target_existing {
                        acc = fold_storage_kind(acc, kind);
                    }
                    acc = fold_nearest_existing_parent(acc, &target);
                }
                _ => {
                    match source_existing {
                        Some(kind) => acc = fold_storage_kind(acc, kind),
                        None => return StorageKind::Unverifiable,
                    }
                    if let Some(kind) = target_existing {
                        acc = fold_storage_kind(acc, kind);
                    } else {
                        acc = fold_nearest_existing_parent(acc, &target);
                    }
                }
            },
            _ => match op_status {
                "executed" => match target_existing {
                    Some(kind) => acc = fold_storage_kind(acc, kind),
                    None => return StorageKind::Unverifiable,
                },
                "started" | "unverified" => {
                    if let Some(kind) = target_existing {
                        acc = fold_storage_kind(acc, kind);
                    } else {
                        acc = fold_nearest_existing_parent(acc, &target);
                    }
                }
                _ => {
                    if let Some(kind) = target_existing {
                        acc = fold_storage_kind(acc, kind);
                    } else {
                        acc = fold_nearest_existing_parent(acc, &target);
                    }
                }
            },
        }
        if acc != StorageKind::Local {
            return acc;
        }
    }
    acc
}

#[tauri::command]
pub fn inspect_storage_kind(path: String) -> Result<StorageKindView, AppError> {
    Ok(storage_kind_view(&path))
}

#[tauri::command]
pub fn inspect_storage_kinds(paths: Vec<String>) -> Result<Vec<StorageKindView>, AppError> {
    Ok(paths.iter().map(|path| storage_kind_view(path)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::windows_storage::{ForcedStorageKind, StorageKind};

    #[test]
    fn empty_or_invalid_path_is_unverifiable_not_local() {
        let empty = inspect_storage_kind(String::new()).unwrap();
        assert_eq!(empty.kind, "unverifiable");
        assert_ne!(empty.kind, "local");
        let nul = inspect_storage_kind("C:\\a\0b".to_string()).unwrap();
        assert_eq!(nul.kind, "unverifiable");
    }

    #[test]
    fn textual_unc_is_remote_without_opening() {
        let view = inspect_storage_kind(r"\\server\share\Ordner".to_string()).unwrap();
        assert_eq!(view.kind, "remote");
        assert!(view.message.as_deref().unwrap_or("").contains("Netzwerk"));
    }

    #[test]
    fn unknown_kind_string_is_never_emitted_as_local() {
        let _force = ForcedStorageKind::new(StorageKind::Unverifiable);
        let view = inspect_storage_kind(r"Z:\Dokumente".to_string()).unwrap();
        assert_eq!(view.kind, "unverifiable");
        assert_ne!(view.kind, "local");
    }

    #[test]
    fn mapped_drive_force_remote_is_remote() {
        let _force = ForcedStorageKind::new(StorageKind::Remote);
        let views = inspect_storage_kinds(vec![r"Z:\Dokumente\Rechnung.pdf".to_string()]).unwrap();
        assert_eq!(views[0].kind, "remote");
    }

    #[test]
    fn worst_kind_prefers_remote_over_local() {
        assert_eq!(
            fold_storage_kind(StorageKind::Local, StorageKind::Remote),
            StorageKind::Remote
        );
        assert_eq!(
            fold_storage_kind(StorageKind::Unsupported, StorageKind::Unverifiable),
            StorageKind::Unsupported
        );
    }

    #[cfg(windows)]
    #[test]
    fn local_temp_path_is_local() {
        let path = std::env::temp_dir().join(format!(
            "dotty-inspect-storage-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&path).unwrap();
        let view = inspect_storage_kind(path.to_string_lossy().into_owned()).unwrap();
        let _ = std::fs::remove_dir_all(&path);
        assert_eq!(view.kind, "local", "{}", view.path);
        assert_eq!(view.message, None);
    }
}
