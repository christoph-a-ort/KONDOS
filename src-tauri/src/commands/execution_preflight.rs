//! P2-L.4a: read-only planned-path inspection. Never mutates scan objects.
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::AppError;
use crate::scan::must_not_follow;

use super::execution_binding::inspect_scan_root_at;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PathObservation {
    pub exists: bool,
    pub is_file: bool,
    pub is_dir: bool,
    pub is_reparse: bool,
    pub readable: bool,
    pub within_root: bool,
    pub size_bytes: Option<u64>,
    pub modified_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlannedOperationFacts {
    pub kind: String,
    pub binding_status: String,
    pub binding_message: String,
    pub source: PathObservation,
    pub target: PathObservation,
    pub target_parent_exists: bool,
    pub target_parent_is_dir: bool,
    pub target_parent_is_reparse: bool,
    pub reminder: String,
}

fn app_data(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path().app_data_dir().map_err(|_| AppError::internal())
}

fn normalize_cmp(path: &str) -> String {
    path.replace('\\', "/")
        .trim()
        .trim_end_matches('/')
        .to_lowercase()
}

pub(crate) fn path_has_parent_dir(path: &str) -> bool {
    Path::new(path).components().any(|component| {
        matches!(component, std::path::Component::ParentDir)
    })
}

pub(crate) fn within_scan_root(scan_root: &str, candidate: &str) -> bool {
    if scan_root.trim().is_empty() || candidate.trim().is_empty() || path_has_parent_dir(candidate) {
        return false;
    }
    let root = normalize_cmp(scan_root);
    let path = normalize_cmp(candidate);
    path == root || path.starts_with(&format!("{root}/"))
}

fn modified_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
}

fn observe(scan_root: &str, path: &str) -> PathObservation {
    let within_root = within_scan_root(scan_root, path);
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => PathObservation {
            exists: false,
            is_file: false,
            is_dir: false,
            is_reparse: false,
            readable: true,
            within_root,
            size_bytes: None,
            modified_at_ms: None,
        },
        Err(_) => PathObservation {
            exists: false,
            is_file: false,
            is_dir: false,
            is_reparse: false,
            readable: false,
            within_root,
            size_bytes: None,
            modified_at_ms: None,
        },
        Ok(metadata) => {
            let file_type = metadata.file_type();
            PathObservation {
                exists: true,
                is_file: metadata.is_file(),
                is_dir: metadata.is_dir(),
                is_reparse: must_not_follow(file_type, Some(&metadata)),
                readable: true,
                within_root,
                size_bytes: metadata.is_file().then_some(metadata.len()),
                modified_at_ms: modified_ms(&metadata),
            }
        }
    }
}

fn observe_parent(scan_root: &str, target: &str) -> (bool, bool, bool) {
    match Path::new(target).parent() {
        None => (false, false, false),
        Some(parent) => {
            let facts = observe(scan_root, &parent.to_string_lossy());
            (facts.exists, facts.is_dir, facts.is_reparse)
        }
    }
}

pub(crate) fn collect_planned_operation_facts(
    app_data: &Path,
    scan_root: &str,
    kind: &str,
    source_path: &str,
    target_path: &str,
) -> Result<PlannedOperationFacts, AppError> {
    let binding = inspect_scan_root_at(app_data, scan_root)?;
    let source = observe(scan_root, source_path);
    let target = observe(scan_root, target_path);
    let (target_parent_exists, target_parent_is_dir, target_parent_is_reparse) =
        observe_parent(scan_root, target_path);
    Ok(PlannedOperationFacts {
        kind: kind.to_string(),
        binding_status: binding.status,
        binding_message: binding.message,
        source,
        target,
        target_parent_exists,
        target_parent_is_dir,
        target_parent_is_reparse,
        reminder: "Ein erfolgreiches Prüfungsergebnis ist keine Ausführungsfreigabe. Unmittelbar vor einer späteren echten Operation muss erneut geprüft werden.".to_string(),
    })
}

#[tauri::command]
pub fn inspect_planned_operation(
    app: AppHandle,
    scan_root: String,
    kind: String,
    source_path: String,
    target_path: String,
) -> Result<PlannedOperationFacts, AppError> {
    collect_planned_operation_facts(
        &app_data(&app)?,
        &scan_root,
        &kind,
        &source_path,
        &target_path,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::execution_binding::start_bound_run_at;
    use std::time::SystemTime;

    fn dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "dotty-preflight-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn journal_json(id: &str, rev: u64, root: &str, owner: &str) -> String {
        format!(
            r#"{{"schemaVersion":1,"journalId":"{id}","revision":{rev},"operations":[],"scanRoot":"{root}","ownerRunId":"{owner}","bindingStatus":"reserved"}}"#
        )
    }

    #[test]
    fn valid_file_move_is_observed_without_mutation() {
        let root = dir();
        let source = root.join("a.txt");
        let target = root.join("b.txt");
        fs::write(&source, b"hello").unwrap();
        let before = fs::read(&source).unwrap();
        let facts = collect_planned_operation_facts(
            &root,
            &root.to_string_lossy(),
            "moveFile",
            &source.to_string_lossy(),
            &target.to_string_lossy(),
        )
        .unwrap();
        assert!(facts.source.exists && facts.source.is_file && !facts.source.is_reparse);
        assert!(!facts.target.exists);
        assert!(facts.target_parent_exists && facts.target_parent_is_dir);
        assert_eq!(facts.source.size_bytes, Some(5));
        assert!(!target.exists());
        assert_eq!(fs::read(&source).unwrap(), before);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn missing_source_and_existing_target_are_reported() {
        let root = dir();
        let source = root.join("missing.txt");
        let target = root.join("taken.txt");
        fs::write(&target, b"x").unwrap();
        let missing = collect_planned_operation_facts(
            &root,
            &root.to_string_lossy(),
            "renameFile",
            &source.to_string_lossy(),
            &root.join("out.txt").to_string_lossy(),
        )
        .unwrap();
        assert!(!missing.source.exists);
        let occupied = collect_planned_operation_facts(
            &root,
            &root.to_string_lossy(),
            "renameFile",
            &root.join("other.txt").to_string_lossy(),
            &target.to_string_lossy(),
        )
        .unwrap();
        assert!(occupied.target.exists);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn changed_source_metadata_is_visible() {
        let root = dir();
        let source = root.join("a.txt");
        fs::write(&source, b"one").unwrap();
        let first = collect_planned_operation_facts(
            &root,
            &root.to_string_lossy(),
            "moveFile",
            &source.to_string_lossy(),
            &root.join("b.txt").to_string_lossy(),
        )
        .unwrap();
        fs::write(&source, b"changed-bytes").unwrap();
        let second = collect_planned_operation_facts(
            &root,
            &root.to_string_lossy(),
            "moveFile",
            &source.to_string_lossy(),
            &root.join("b.txt").to_string_lossy(),
        )
        .unwrap();
        assert_ne!(first.source.size_bytes, second.source.size_bytes);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn path_outside_scan_root_is_not_within_root() {
        let root = dir();
        let outside = std::env::temp_dir().join(format!("dotty-outside-{}", std::process::id()));
        fs::write(&outside, b"x").unwrap();
        let facts = collect_planned_operation_facts(
            &root,
            &root.to_string_lossy(),
            "moveFile",
            &outside.to_string_lossy(),
            &root.join("b.txt").to_string_lossy(),
        )
        .unwrap();
        assert!(!facts.source.within_root);
        assert!(path_has_parent_dir(&format!("{}\\..\\Windows", root.display())));
        assert!(!within_scan_root(&root.to_string_lossy(), &format!("{}\\..\\Windows\\notepad.exe", root.display())));
        let _ = fs::remove_file(outside);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn junction_is_reported_as_reparse() {
        let root = dir();
        let target_dir = root.join("real");
        let junction = root.join("link");
        fs::create_dir_all(&target_dir).unwrap();
        let output = std::process::Command::new("cmd")
            .arg("/c")
            .arg(format!("mklink /J {} {}", junction.display(), target_dir.display()))
            .output()
            .unwrap();
        assert!(output.status.success(), "mklink /J failed");
        let facts = collect_planned_operation_facts(
            &root,
            &root.to_string_lossy(),
            "moveFile",
            &junction.join("x.txt").to_string_lossy(),
            &root.join("out.txt").to_string_lossy(),
        )
        .unwrap();
        let link_obs = observe(&root.to_string_lossy(), &junction.to_string_lossy());
        assert!(link_obs.is_reparse || facts.source.is_reparse || !facts.source.readable);
        assert!(link_obs.is_reparse);
        let _ = fs::remove_dir(junction);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn unreadable_or_unknown_binding_is_surfaced() {
        let root = dir();
        let scan = root.to_string_lossy().replace('\\', "/");
        start_bound_run_at(
            &root,
            &scan,
            "owner-a",
            "j1",
            0,
            &journal_json("j1", 1, &scan, "owner-a"),
        )
        .unwrap();
        let facts = collect_planned_operation_facts(
            &root,
            &scan,
            "createVirtualFolder",
            &root.to_string_lossy(),
            &root.join("new-folder").to_string_lossy(),
        )
        .unwrap();
        assert_eq!(facts.binding_status, "reserved");
        assert!(facts.reminder.contains("keine Ausführungsfreigabe"));
        let _ = fs::remove_dir_all(root);
    }
}
