//! Couples execution journals and durable reservations under ScanRootCoordination.
//! AppData only. Never touches scanned user paths.
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::error::AppError;

use super::execution_journal::{check, journal, journal_store, load_at, save_at};
use super::scan_root_coordination::acquire_at;
use super::simulation_lock::{
    read_reservation_at, release_reservation_at, reserve_bound_at, ReservationRecord,
};

#[cfg(test)]
thread_local! {
    static BIND_FAULT: std::cell::RefCell<Option<&'static str>> = const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
pub(crate) fn set_bind_fault(fault: Option<&'static str>) {
    BIND_FAULT.with(|current| *current.borrow_mut() = fault);
}

fn injected_fault(stage: &str) -> bool {
    #[cfg(test)]
    {
        return BIND_FAULT.with(|current| current.borrow().as_deref() == Some(stage));
    }
    #[cfg(not(test))]
    {
        let _ = stage;
        false
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BindingStatus {
    Unbound,
    Reserved,
    ReleasePrepared,
    Released,
    Inconsistent,
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BindingView {
    pub status: BindingStatus,
    pub journal_id: Option<String>,
    pub owner_run_id: Option<String>,
    pub journal_revision: Option<u64>,
}

#[derive(Debug, Clone)]
struct JournalBinding {
    revision: u64,
    status: String,
    owner_run_id: String,
    scan_root: String,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn parse_journal_binding(raw: &str, journal_id: &str) -> Result<JournalBinding, AppError> {
    check(raw, journal_id)?;
    let value: Value = serde_json::from_str(raw)
        .map_err(|_| AppError::invalid_config("Journal ist beschädigt und bleibt gesperrt."))?;
    let object = value
        .as_object()
        .ok_or_else(|| AppError::invalid_config("Journal ist beschädigt und bleibt gesperrt."))?;
    let status = object
        .get("bindingStatus")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::invalid_config("Journalbindung fehlt und bleibt gesperrt."))?;
    let owner = object
        .get("ownerRunId")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::invalid_config("Journalbindung fehlt und bleibt gesperrt."))?;
    let scan_root = object
        .get("scanRoot")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::invalid_config("Journalbindung fehlt und bleibt gesperrt."))?;
    let revision = object
        .get("revision")
        .and_then(Value::as_u64)
        .ok_or_else(|| AppError::invalid_config("Journalrevision fehlt."))?;
    Ok(JournalBinding {
        revision,
        status: status.to_string(),
        owner_run_id: owner.to_string(),
        scan_root: scan_root.to_string(),
    })
}

fn identities_match(
    reservation: &ReservationRecord,
    journal: &JournalBinding,
    scan_root: &str,
    journal_id: &str,
    owner: &str,
) -> bool {
    reservation.journal_id == journal_id
        && reservation.owner_run_id == owner
        && journal.owner_run_id == owner
        && journal.scan_root == scan_root
}

pub(crate) fn inspect_binding_at(
    app_data: &Path,
    scan_root: &str,
    journal_id: &str,
) -> Result<BindingView, AppError> {
    let _guard = acquire_at(app_data, scan_root)?;
    inspect_locked(app_data, scan_root, journal_id)
}

fn inspect_locked(app_data: &Path, scan_root: &str, journal_id: &str) -> Result<BindingView, AppError> {
    let reservation = match read_reservation_at(app_data, scan_root) {
        Ok(value) => value,
        Err(_) => {
            return Ok(BindingView {
                status: BindingStatus::Blocked,
                journal_id: Some(journal_id.to_string()),
                owner_run_id: None,
                journal_revision: None,
            });
        }
    };
    let journal_path = journal(&journal_store(app_data), journal_id)?;
    let journal = match load_at(&journal_path, journal_id) {
        Ok(Some(raw)) => match parse_journal_binding(&raw, journal_id) {
            Ok(binding) => Some(binding),
            Err(_) => {
                return Ok(BindingView {
                    status: BindingStatus::Blocked,
                    journal_id: Some(journal_id.to_string()),
                    owner_run_id: reservation.as_ref().map(|record| record.owner_run_id.clone()),
                    journal_revision: None,
                });
            }
        },
        Ok(None) => None,
        Err(_) => {
            return Ok(BindingView {
                status: BindingStatus::Blocked,
                journal_id: Some(journal_id.to_string()),
                owner_run_id: reservation.as_ref().map(|record| record.owner_run_id.clone()),
                journal_revision: None,
            });
        }
    };

    Ok(match (reservation, journal) {
        (None, None) => BindingView {
            status: BindingStatus::Unbound,
            journal_id: None,
            owner_run_id: None,
            journal_revision: None,
        },
        (None, Some(journal)) if journal.status == "released" && journal.scan_root == scan_root => {
            BindingView {
                status: BindingStatus::Released,
                journal_id: Some(journal_id.to_string()),
                owner_run_id: Some(journal.owner_run_id),
                journal_revision: Some(journal.revision),
            }
        }
        (Some(reservation), Some(journal))
            if identities_match(&reservation, &journal, scan_root, journal_id, &reservation.owner_run_id)
                && journal.status == "reserved" =>
        {
            BindingView {
                status: BindingStatus::Reserved,
                journal_id: Some(journal_id.to_string()),
                owner_run_id: Some(reservation.owner_run_id),
                journal_revision: Some(journal.revision),
            }
        }
        (Some(reservation), Some(journal))
            if identities_match(&reservation, &journal, scan_root, journal_id, &reservation.owner_run_id)
                && journal.status == "releasePrepared" =>
        {
            BindingView {
                status: BindingStatus::ReleasePrepared,
                journal_id: Some(journal_id.to_string()),
                owner_run_id: Some(reservation.owner_run_id),
                journal_revision: Some(journal.revision),
            }
        }
        (Some(reservation), _) => BindingView {
            status: BindingStatus::Inconsistent,
            journal_id: Some(reservation.journal_id),
            owner_run_id: Some(reservation.owner_run_id),
            journal_revision: Some(reservation.journal_revision),
        },
        (None, Some(journal)) => BindingView {
            status: BindingStatus::Inconsistent,
            journal_id: Some(journal_id.to_string()),
            owner_run_id: Some(journal.owner_run_id),
            journal_revision: Some(journal.revision),
        },
    })
}

pub(crate) fn start_bound_run_at(
    app_data: &Path,
    scan_root: &str,
    owner: &str,
    journal_id: &str,
    expected_revision: u64,
    journal_json: &str,
) -> Result<(), AppError> {
    let _guard = acquire_at(app_data, scan_root)?;
    let binding = parse_journal_binding(journal_json, journal_id)?;
    if binding.scan_root != scan_root
        || binding.owner_run_id != owner
        || binding.status != "reserved"
        || binding.revision != expected_revision + 1
    {
        return Err(AppError::invalid_config("Journalbindung ist unzulässig."));
    }
    match read_reservation_at(app_data, scan_root) {
        Ok(None) => {}
        Ok(Some(existing)) if existing.owner_run_id == owner && existing.journal_id == journal_id => {
            return Err(AppError::invalid_config("Dieser Lauf ist bereits reserviert."));
        }
        Ok(Some(_)) => {
            return Err(AppError::invalid_config("Scanwurzel ist durch einen anderen Lauf reserviert."));
        }
        Err(_) => return Err(AppError::invalid_config("Reservierung ist beschädigt und bleibt gesperrt.")),
    }
    let journal_path = journal(&journal_store(app_data), journal_id)?;
    match load_at(&journal_path, journal_id) {
        Ok(None) if expected_revision == 0 => {}
        Ok(None) => return Err(AppError::invalid_config("Ungültige Journalrevision.")),
        Ok(Some(existing)) => {
            let current = check(&existing, journal_id)?;
            if current != expected_revision {
                return Err(AppError::invalid_config("Ungültige Journalrevision."));
            }
        }
        Err(_) => return Err(AppError::invalid_config("Journal ist beschädigt und bleibt gesperrt.")),
    }
    reserve_bound_at(app_data, scan_root, owner, journal_id, now_ms(), binding.revision)?;
    if injected_fault("after-reserve") {
        return Err(AppError::invalid_config("Simulierter Abbruch nach Reservierung."));
    }
    save_at(
        &journal(&journal_store(app_data), journal_id)?,
        journal_id,
        expected_revision,
        journal_json,
    )
}

pub(crate) fn progress_bound_run_at(
    app_data: &Path,
    scan_root: &str,
    owner: &str,
    journal_id: &str,
    expected_revision: u64,
    journal_json: &str,
) -> Result<(), AppError> {
    let _guard = acquire_at(app_data, scan_root)?;
    let reservation = read_reservation_at(app_data, scan_root)?
        .ok_or_else(|| AppError::invalid_config("Keine Reservierung vorhanden."))?;
    let journal_path = journal(&journal_store(app_data), journal_id)?;
    let existing = load_at(&journal_path, journal_id)?
        .ok_or_else(|| AppError::invalid_config("Journal fehlt."))?;
    let current = parse_journal_binding(&existing, journal_id)?;
    let binding = parse_journal_binding(journal_json, journal_id)?;
    if reservation.owner_run_id != owner
        || reservation.journal_id != journal_id
        || !identities_match(&reservation, &current, scan_root, journal_id, owner)
        || !identities_match(&reservation, &binding, scan_root, journal_id, owner)
        || current.status != "reserved"
        || binding.status != "reserved"
    {
        return Err(AppError::invalid_config("Journal- und Reservierungsidentität stimmen nicht überein."));
    }
    save_at(
        &journal(&journal_store(app_data), journal_id)?,
        journal_id,
        expected_revision,
        journal_json,
    )
}

pub(crate) fn prepare_release_at(
    app_data: &Path,
    scan_root: &str,
    owner: &str,
    journal_id: &str,
    expected_revision: u64,
    journal_json: &str,
) -> Result<(), AppError> {
    let _guard = acquire_at(app_data, scan_root)?;
    let reservation = read_reservation_at(app_data, scan_root)?
        .ok_or_else(|| AppError::invalid_config("Keine Reservierung vorhanden."))?;
    let journal_path = journal(&journal_store(app_data), journal_id)?;
    let existing = load_at(&journal_path, journal_id)?
        .ok_or_else(|| AppError::invalid_config("Journal fehlt."))?;
    let current = parse_journal_binding(&existing, journal_id)?;
    let binding = parse_journal_binding(journal_json, journal_id)?;
    if reservation.owner_run_id != owner
        || reservation.journal_id != journal_id
        || !identities_match(&reservation, &current, scan_root, journal_id, owner)
        || !identities_match(&reservation, &binding, scan_root, journal_id, owner)
        || current.status != "reserved"
        || binding.status != "releasePrepared"
    {
        return Err(AppError::invalid_config("Freigabevorbereitung ist unzulässig."));
    }
    save_at(
        &journal(&journal_store(app_data), journal_id)?,
        journal_id,
        expected_revision,
        journal_json,
    )?;
    if injected_fault("after-release-prepare") {
        return Err(AppError::invalid_config("Simulierter Abbruch nach Freigabevorbereitung."));
    }
    Ok(())
}

pub(crate) fn release_bound_run_at(
    app_data: &Path,
    scan_root: &str,
    owner: &str,
    journal_id: &str,
    expected_revision: u64,
    released_journal_json: &str,
) -> Result<(), AppError> {
    let _guard = acquire_at(app_data, scan_root)?;
    let reservation = read_reservation_at(app_data, scan_root)?
        .ok_or_else(|| AppError::invalid_config("Keine Reservierung vorhanden."))?;
    if reservation.owner_run_id != owner || reservation.journal_id != journal_id {
        return Err(AppError::invalid_config("Fremde Reservierung darf nicht freigegeben werden."));
    }
    let released = parse_journal_binding(released_journal_json, journal_id)?;
    if released.status != "released"
        || released.owner_run_id != owner
        || released.scan_root != scan_root
        || released.revision != expected_revision + 1
    {
        return Err(AppError::invalid_config("Freigabebindung ist unzulässig."));
    }
    let view = inspect_locked(app_data, scan_root, journal_id)?;
    if view.status != BindingStatus::ReleasePrepared {
        return Err(AppError::invalid_config("Freigabe ist im aktuellen Zustand unzulässig."));
    }
    if view.journal_revision != Some(expected_revision) {
        return Err(AppError::invalid_config("Ungültige Journalrevision."));
    }
    release_reservation_at(app_data, scan_root, owner, journal_id)?;
    if injected_fault("after-reservation-delete") {
        return Err(AppError::invalid_config("Simulierter Abbruch nach Reservierungslöschung."));
    }
    save_at(
        &journal(&journal_store(app_data), journal_id)?,
        journal_id,
        expected_revision,
        released_journal_json,
    )
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BoundExecutionView {
    pub status: String,
    pub journal_id: Option<String>,
    pub owner_run_id: Option<String>,
    pub journal_revision: Option<u64>,
    pub journal_json: Option<String>,
    pub message: String,
}

fn app_data(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path().app_data_dir().map_err(|_| AppError::internal())
}

fn status_name(status: BindingStatus) -> &'static str {
    match status {
        BindingStatus::Unbound => "unbound",
        BindingStatus::Reserved => "reserved",
        BindingStatus::ReleasePrepared => "releasePrepared",
        BindingStatus::Released => "released",
        BindingStatus::Inconsistent => "inconsistent",
        BindingStatus::Blocked => "blocked",
    }
}

fn status_message(status: BindingStatus) -> &'static str {
    match status {
        BindingStatus::Unbound => "Kein gespeichertes Simulationsjournal.",
        BindingStatus::Reserved => "Aktive Reservierung. Kein automatischer Neustart.",
        BindingStatus::ReleasePrepared => "Freigabe ist vorbereitet.",
        BindingStatus::Released => "Simulation abgeschlossen und Reservierung freigegeben.",
        BindingStatus::Inconsistent => "Der gespeicherte Zustand ist unklar und bleibt gesperrt.",
        BindingStatus::Blocked => "Die gespeicherten Daten sind beschädigt und bleiben gesperrt.",
    }
}

fn load_journal_json(app_data: &Path, journal_id: &str) -> Option<String> {
    journal(&journal_store(app_data), journal_id)
        .ok()
        .and_then(|path| load_at(&path, journal_id).ok().flatten())
}

fn bound_view(app_data: &Path, inspect: BindingView) -> BoundExecutionView {
    let journal_json = inspect
        .journal_id
        .as_deref()
        .and_then(|journal_id| load_journal_json(app_data, journal_id));
    BoundExecutionView {
        status: status_name(inspect.status).to_string(),
        journal_id: inspect.journal_id,
        owner_run_id: inspect.owner_run_id,
        journal_revision: inspect.journal_revision,
        journal_json,
        message: status_message(inspect.status).to_string(),
    }
}

fn discover_journal_id(app_data: &Path, scan_root: &str) -> Option<String> {
    let entries = fs::read_dir(journal_store(app_data)).ok()?;
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().and_then(|value| value.to_str()).unwrap_or("");
        let Some(journal_id) = name.strip_suffix(".v1.json") else {
            continue;
        };
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(binding) = parse_journal_binding(&raw, journal_id) else {
            continue;
        };
        if binding.scan_root == scan_root {
            let rank = match binding.status.as_str() {
                "reserved" => 3,
                "releasePrepared" => 2,
                "released" => 1,
                _ => 0,
            };
            found.push((rank, binding.revision, journal_id.to_string()));
        }
    }
    found.sort_by(|left, right| right.0.cmp(&left.0).then(right.1.cmp(&left.1)));
    found.into_iter().next().map(|(_, _, journal_id)| journal_id)
}

pub(crate) fn inspect_scan_root_at(
    app_data: &Path,
    scan_root: &str,
) -> Result<BoundExecutionView, AppError> {
    let _guard = acquire_at(app_data, scan_root)?;
    let reservation = match read_reservation_at(app_data, scan_root) {
        Ok(value) => value,
        Err(_) => {
            return Ok(BoundExecutionView {
                status: status_name(BindingStatus::Blocked).to_string(),
                journal_id: None,
                owner_run_id: None,
                journal_revision: None,
                journal_json: None,
                message: status_message(BindingStatus::Blocked).to_string(),
            });
        }
    };
    let journal_id = match reservation.as_ref() {
        Some(record) => Some(record.journal_id.clone()),
        None => discover_journal_id(app_data, scan_root),
    };
    match journal_id {
        None => Ok(BoundExecutionView {
            status: status_name(BindingStatus::Unbound).to_string(),
            journal_id: None,
            owner_run_id: None,
            journal_revision: None,
            journal_json: None,
            message: status_message(BindingStatus::Unbound).to_string(),
        }),
        Some(journal_id) => Ok(bound_view(
            app_data,
            inspect_locked(app_data, scan_root, &journal_id)?,
        )),
    }
}

#[tauri::command]
pub fn inspect_bound_execution(app: AppHandle, scan_root: String) -> Result<BoundExecutionView, AppError> {
    inspect_scan_root_at(&app_data(&app)?, &scan_root)
}

#[tauri::command]
pub fn start_bound_execution(
    app: AppHandle,
    scan_root: String,
    owner_run_id: String,
    journal_id: String,
    expected_revision: u64,
    journal_json: String,
) -> Result<BoundExecutionView, AppError> {
    let data = app_data(&app)?;
    start_bound_run_at(
        &data,
        &scan_root,
        &owner_run_id,
        &journal_id,
        expected_revision,
        &journal_json,
    )?;
    inspect_scan_root_at(&data, &scan_root)
}

#[tauri::command]
pub fn progress_bound_execution(
    app: AppHandle,
    scan_root: String,
    owner_run_id: String,
    journal_id: String,
    expected_revision: u64,
    journal_json: String,
) -> Result<BoundExecutionView, AppError> {
    let data = app_data(&app)?;
    progress_bound_run_at(
        &data,
        &scan_root,
        &owner_run_id,
        &journal_id,
        expected_revision,
        &journal_json,
    )?;
    inspect_scan_root_at(&data, &scan_root)
}

#[tauri::command]
pub fn prepare_bound_release(
    app: AppHandle,
    scan_root: String,
    owner_run_id: String,
    journal_id: String,
    expected_revision: u64,
    journal_json: String,
) -> Result<BoundExecutionView, AppError> {
    let data = app_data(&app)?;
    prepare_release_at(
        &data,
        &scan_root,
        &owner_run_id,
        &journal_id,
        expected_revision,
        &journal_json,
    )?;
    inspect_scan_root_at(&data, &scan_root)
}

#[tauri::command]
pub fn release_bound_execution(
    app: AppHandle,
    scan_root: String,
    owner_run_id: String,
    journal_id: String,
    expected_revision: u64,
    journal_json: String,
) -> Result<BoundExecutionView, AppError> {
    let data = app_data(&app)?;
    release_bound_run_at(
        &data,
        &scan_root,
        &owner_run_id,
        &journal_id,
        expected_revision,
        &journal_json,
    )?;
    inspect_scan_root_at(&data, &scan_root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Read;
    use std::path::PathBuf;
    use std::process::{Child, Command, Output, Stdio};
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    fn wait_child(mut child: Child, timeout: Duration) -> Output {
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let stdout_thread = thread::spawn(move || {
            let mut buffer = Vec::new();
            if let Some(mut stream) = stdout {
                let _ = stream.read_to_end(&mut buffer);
            }
            buffer
        });
        let stderr_thread = thread::spawn(move || {
            let mut buffer = Vec::new();
            if let Some(mut stream) = stderr {
                let _ = stream.read_to_end(&mut buffer);
            }
            buffer
        });
        let deadline = Instant::now() + timeout;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    panic!("Kindprozess hat das Zeitlimit überschritten.");
                }
                Err(_) => {
                    let _ = child.kill();
                    panic!("Kindprozess konnte nicht abgefragt werden.");
                }
            }
        };
        Output {
            status,
            stdout: stdout_thread.join().unwrap_or_default(),
            stderr: stderr_thread.join().unwrap_or_default(),
        }
    }

    fn dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "dotty-bind-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn journal_json(id: &str, rev: u64, root: &str, owner: &str, status: &str) -> String {
        format!(
            r#"{{"schemaVersion":1,"journalId":"{id}","revision":{rev},"operations":[],"scanRoot":"{root}","ownerRunId":"{owner}","bindingStatus":"{status}"}}"#
        )
    }

    #[test]
    fn start_progress_and_release_succeed() {
        let app = dir();
        let root = "C:/bind";
        start_bound_run_at(&app, root, "owner-a", "j1", 0, &journal_json("j1", 1, root, "owner-a", "reserved")).unwrap();
        let view = inspect_binding_at(&app, root, "j1").unwrap();
        assert_eq!(view.status, BindingStatus::Reserved);
        progress_bound_run_at(&app, root, "owner-a", "j1", 1, &journal_json("j1", 2, root, "owner-a", "reserved")).unwrap();
        prepare_release_at(&app, root, "owner-a", "j1", 2, &journal_json("j1", 3, root, "owner-a", "releasePrepared")).unwrap();
        assert_eq!(inspect_binding_at(&app, root, "j1").unwrap().status, BindingStatus::ReleasePrepared);
        release_bound_run_at(&app, root, "owner-a", "j1", 3, &journal_json("j1", 4, root, "owner-a", "released")).unwrap();
        assert_eq!(inspect_binding_at(&app, root, "j1").unwrap().status, BindingStatus::Released);
        let _ = fs::remove_dir_all(app);
    }

    #[test]
    fn wrong_owner_journal_and_revision_are_rejected() {
        let app = dir();
        let root = "C:/bind";
        start_bound_run_at(&app, root, "owner-a", "j1", 0, &journal_json("j1", 1, root, "owner-a", "reserved")).unwrap();
        assert!(progress_bound_run_at(&app, root, "owner-b", "j1", 1, &journal_json("j1", 2, root, "owner-b", "reserved")).is_err());
        assert!(progress_bound_run_at(&app, root, "owner-a", "j2", 1, &journal_json("j2", 2, root, "owner-a", "reserved")).is_err());
        assert!(progress_bound_run_at(&app, root, "owner-a", "j1", 0, &journal_json("j1", 1, root, "owner-a", "reserved")).is_err());
        assert!(release_bound_run_at(&app, root, "owner-b", "j1", 1, &journal_json("j1", 2, root, "owner-b", "released")).is_err());
        assert_eq!(inspect_binding_at(&app, root, "j1").unwrap().status, BindingStatus::Reserved);
        let _ = fs::remove_dir_all(app);
    }

    #[test]
    fn foreign_or_corrupt_reservation_blocks() {
        let app = dir();
        let root = "C:/bind";
        start_bound_run_at(&app, root, "owner-a", "j1", 0, &journal_json("j1", 1, root, "owner-a", "reserved")).unwrap();
        assert!(start_bound_run_at(&app, root, "owner-b", "j2", 0, &journal_json("j2", 1, root, "owner-b", "reserved")).is_err());
        fs::write(super::super::simulation_lock::reservation_file(&app, root).unwrap(), "{bad").unwrap();
        assert!(start_bound_run_at(&app, root, "owner-c", "j3", 0, &journal_json("j3", 1, root, "owner-c", "reserved")).is_err());
        assert_eq!(inspect_binding_at(&app, root, "j1").unwrap().status, BindingStatus::Blocked);
        assert_eq!(fs::read_to_string(super::super::simulation_lock::reservation_file(&app, root).unwrap()).unwrap(), "{bad");
        let _ = fs::remove_dir_all(app);
    }

    #[test]
    fn corrupt_journal_does_not_release_reservation() {
        let app = dir();
        let root = "C:/bind";
        start_bound_run_at(&app, root, "owner-a", "j1", 0, &journal_json("j1", 1, root, "owner-a", "reserved")).unwrap();
        let journal_path = journal(&journal_store(&app), "j1").unwrap();
        fs::write(&journal_path, "{bad").unwrap();
        assert!(progress_bound_run_at(&app, root, "owner-a", "j1", 1, &journal_json("j1", 2, root, "owner-a", "reserved")).is_err());
        assert!(super::super::simulation_lock::read_reservation_at(&app, root).unwrap().is_some());
        let _ = fs::remove_dir_all(app);
    }

    #[test]
    fn crash_between_writes_stays_fail_closed() {
        let app = dir();
        let root = "C:/bind";
        set_bind_fault(Some("after-reserve"));
        assert!(start_bound_run_at(&app, root, "owner-a", "j1", 0, &journal_json("j1", 1, root, "owner-a", "reserved")).is_err());
        set_bind_fault(None);
        assert_eq!(inspect_binding_at(&app, root, "j1").unwrap().status, BindingStatus::Inconsistent);
        assert!(start_bound_run_at(&app, root, "owner-b", "j2", 0, &journal_json("j2", 1, root, "owner-b", "reserved")).is_err());

        let app2 = dir();
        start_bound_run_at(&app2, root, "owner-a", "j1", 0, &journal_json("j1", 1, root, "owner-a", "reserved")).unwrap();
        set_bind_fault(Some("after-release-prepare"));
        assert!(prepare_release_at(&app2, root, "owner-a", "j1", 1, &journal_json("j1", 2, root, "owner-a", "releasePrepared")).is_err());
        set_bind_fault(None);
        assert_eq!(inspect_binding_at(&app2, root, "j1").unwrap().status, BindingStatus::ReleasePrepared);
        set_bind_fault(Some("after-reservation-delete"));
        assert!(release_bound_run_at(&app2, root, "owner-a", "j1", 2, &journal_json("j1", 3, root, "owner-a", "released")).is_err());
        set_bind_fault(None);
        assert_eq!(inspect_binding_at(&app2, root, "j1").unwrap().status, BindingStatus::Inconsistent);
        let _ = fs::remove_dir_all(app);
        let _ = fs::remove_dir_all(app2);
    }

    #[test]
    fn restart_sees_reserved_state_without_auto_resume() {
        let app = dir();
        let root = "C:/bind";
        start_bound_run_at(&app, root, "owner-a", "j1", 0, &journal_json("j1", 1, root, "owner-a", "reserved")).unwrap();
        let view = inspect_binding_at(&app, root, "j1").unwrap();
        assert_eq!(view.status, BindingStatus::Reserved);
        assert!(start_bound_run_at(&app, root, "owner-a", "j1", 1, &journal_json("j1", 2, root, "owner-a", "reserved")).is_err());
        progress_bound_run_at(&app, root, "owner-a", "j1", 1, &journal_json("j1", 2, root, "owner-a", "reserved")).unwrap();
        assert_eq!(inspect_binding_at(&app, root, "j1").unwrap().journal_revision, Some(2));
        let _ = fs::remove_dir_all(app);
    }

    #[test]
    fn binding_process_helper() {
        if std::env::var("DOTTY_BIND_HELPER").is_err() {
            return;
        }
        let app = PathBuf::from(std::env::var("DOTTY_BIND_DIR").unwrap());
        let root = std::env::var("DOTTY_BIND_ROOT").unwrap();
        let owner = std::env::var("DOTTY_BIND_OWNER").unwrap();
        let result = match start_bound_run_at(
            &app,
            &root,
            &owner,
            "journal",
            0,
            &journal_json("journal", 1, &root, &owner, "reserved"),
        ) {
            Ok(()) => "OK",
            Err(_) => "DENIED",
        };
        println!("DOTTY_BIND_RESULT:{owner}:{result}");
    }

    #[test]
    fn independent_processes_have_one_bound_winner() {
        let app = dir();
        let exe = std::env::current_exe().unwrap();
        let mut children = Vec::new();
        for owner in ["one", "two"] {
            children.push((
                owner,
                Command::new(&exe)
                    .args([
                        "--exact",
                        "commands::execution_binding::tests::binding_process_helper",
                        "--nocapture",
                    ])
                    .env("DOTTY_BIND_HELPER", "1")
                    .env("DOTTY_BIND_DIR", &app)
                    .env("DOTTY_BIND_ROOT", "C:/same")
                    .env("DOTTY_BIND_OWNER", owner)
                    .stdout(Stdio::piped())
                    .spawn()
                    .unwrap(),
            ));
        }
        let results: Vec<_> = children
            .into_iter()
            .map(|(owner, child)| {
                let output = wait_child(child, Duration::from_secs(20));
                assert!(output.status.success());
                (owner, String::from_utf8(output.stdout).unwrap())
            })
            .collect();
        assert_eq!(results.iter().filter(|(_, line)| line.contains(":OK")).count(), 1);
        assert_eq!(results.iter().filter(|(_, line)| line.contains(":DENIED")).count(), 1);
        assert_eq!(inspect_binding_at(&app, "C:/same", "journal").unwrap().status, BindingStatus::Reserved);
        let _ = fs::remove_dir_all(app);
    }

    #[test]
    fn inspect_scan_root_loads_reserved_journal_after_restart() {
        let app = dir();
        let root = "C:/ui-root";
        start_bound_run_at(&app, root, "owner-a", "j1", 0, &journal_json("j1", 1, root, "owner-a", "reserved")).unwrap();
        let view = inspect_scan_root_at(&app, root).unwrap();
        assert_eq!(view.status, "reserved");
        assert_eq!(view.journal_id.as_deref(), Some("j1"));
        assert!(view.journal_json.as_ref().unwrap().contains("\"bindingStatus\":\"reserved\""));
        assert!(view.message.contains("Kein automatischer Neustart"));
        let _ = fs::remove_dir_all(app);
    }

    #[test]
    fn inspect_scan_root_progress_conflict_and_release() {
        let app = dir();
        let root = "C:/ui-root";
        start_bound_run_at(&app, root, "owner-a", "j1", 0, &journal_json("j1", 1, root, "owner-a", "reserved")).unwrap();
        progress_bound_run_at(&app, root, "owner-a", "j1", 1, &journal_json("j1", 2, root, "owner-a", "reserved")).unwrap();
        assert!(progress_bound_run_at(&app, root, "owner-a", "j1", 1, &journal_json("j1", 2, root, "owner-a", "reserved")).is_err());
        assert_eq!(inspect_scan_root_at(&app, root).unwrap().journal_revision, Some(2));
        prepare_release_at(&app, root, "owner-a", "j1", 2, &journal_json("j1", 3, root, "owner-a", "releasePrepared")).unwrap();
        assert_eq!(inspect_scan_root_at(&app, root).unwrap().status, "releasePrepared");
        release_bound_run_at(&app, root, "owner-a", "j1", 3, &journal_json("j1", 4, root, "owner-a", "released")).unwrap();
        let released = inspect_scan_root_at(&app, root).unwrap();
        assert_eq!(released.status, "released");
        assert!(released.journal_json.as_ref().unwrap().contains("\"bindingStatus\":\"released\""));
        let _ = fs::remove_dir_all(app);
    }

    #[test]
    fn inspect_scan_root_blocks_foreign_corrupt_and_inconsistent() {
        let app = dir();
        let root = "C:/ui-root";
        start_bound_run_at(&app, root, "owner-a", "j1", 0, &journal_json("j1", 1, root, "owner-a", "reserved")).unwrap();
        assert!(start_bound_run_at(&app, root, "owner-b", "j2", 0, &journal_json("j2", 1, root, "owner-b", "reserved")).is_err());
        let reserved = inspect_scan_root_at(&app, root).unwrap();
        assert_eq!(reserved.status, "reserved");
        assert_eq!(reserved.owner_run_id.as_deref(), Some("owner-a"));

        set_bind_fault(Some("after-reserve"));
        let crash = dir();
        assert!(start_bound_run_at(&crash, root, "owner-c", "j3", 0, &journal_json("j3", 1, root, "owner-c", "reserved")).is_err());
        set_bind_fault(None);
        let inconsistent = inspect_scan_root_at(&crash, root).unwrap();
        assert_eq!(inconsistent.status, "inconsistent");
        assert!(start_bound_run_at(&crash, root, "owner-d", "j4", 0, &journal_json("j4", 1, root, "owner-d", "reserved")).is_err());

        fs::write(super::super::simulation_lock::reservation_file(&app, root).unwrap(), "{bad").unwrap();
        let blocked = inspect_scan_root_at(&app, root).unwrap();
        assert_eq!(blocked.status, "blocked");
        assert!(blocked.journal_json.is_none());
        let _ = fs::remove_dir_all(app);
        let _ = fs::remove_dir_all(crash);
    }
}
