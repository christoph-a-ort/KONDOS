//! P2-K.2 app-data persistence only. Never accesses scanned user directories.
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};
use serde::Serialize;
use serde_json::Value;
use crate::error::AppError;
use super::workbench_prefs::{read_workbench_prefs_file, write_workbench_prefs_file};

const DIR: &str = "virtual-plans";
const PREFERENCES_FILE: &str = "virtual-plan-preferences.v1.json";
const VERSION: u64 = 1;
const FILE_SUFFIX: &str = ".v1.json";
static DRAFT_STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
#[cfg(test)]
thread_local! { static BLOCK_FAULT: std::cell::RefCell<bool> = const { std::cell::RefCell::new(false) }; }

fn valid_id(id: &str) -> bool { !id.is_empty() && id.len() <= 128 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') }
fn path(app: &AppHandle, id: &str) -> Result<PathBuf, AppError> {
  if !valid_id(id) { return Err(AppError::invalid_config("Ungültige Entwurfskennung.")); }
  app.path().app_data_dir().map(|p| p.join(DIR).join(format!("{id}{FILE_SUFFIX}"))).map_err(|_| AppError::internal())
}
fn draft_path(base: &Path, id: &str) -> Result<PathBuf, AppError> {
  if !valid_id(id) { return Err(AppError::invalid_config("Ungültige Entwurfskennung.")); }
  Ok(base.join(format!("{id}{FILE_SUFFIX}")))
}
fn blocked(path: &Path) -> PathBuf { path.with_extension("v1.json.blocked") }
fn revision(raw: &str, id: &str) -> Result<u64, AppError> {
  let value: Value = serde_json::from_str(raw).map_err(|_| AppError::invalid_config("Entwurf ist beschädigt und bleibt gesperrt."))?;
  let object = value.as_object().ok_or_else(|| AppError::invalid_config("Entwurf ist beschädigt und bleibt gesperrt."))?;
  if object.get("schemaVersion").and_then(Value::as_u64) != Some(VERSION) || object.get("planId").and_then(Value::as_str) != Some(id) {
    return Err(AppError::invalid_config("Entwurfsversion oder Kennung ist nicht zuverlässig interpretierbar und bleibt gesperrt."));
  }
  object.get("revision").and_then(Value::as_u64).ok_or_else(|| AppError::invalid_config("Entwurfsrevision fehlt und bleibt gesperrt."))
}
fn block(path: &Path) -> Result<(), AppError> {
  #[cfg(test)]
  if BLOCK_FAULT.with(|fault| *fault.borrow()) {
    return Err(AppError::invalid_config("Entwurf ist beschädigt; Sperre konnte nicht sicher gespeichert werden."));
  }
  fs::write(blocked(path), b"blocked").map_err(|_| AppError::invalid_config("Entwurf ist beschädigt; Sperre konnte nicht sicher gespeichert werden."))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VirtualPlanDraftListEntry {
  pub plan_id: String,
  pub draft_json: Option<String>,
  pub modified_at_ms: Option<u64>,
  pub blocked: bool,
}

fn modified_at_ms(path: &Path) -> Option<u64> {
  path.metadata().ok()?.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok().map(|time| time.as_millis() as u64)
}

fn id_from_filename(name: &str) -> Option<&str> {
  name.strip_suffix(FILE_SUFFIX).filter(|id| valid_id(id))
}
fn preferences_path(app: &AppHandle) -> Result<PathBuf, AppError> {
  app.path().app_data_dir().map(|p| p.join(DIR).join(PREFERENCES_FILE)).map_err(|_| AppError::internal())
}
fn preferences_revision(raw: &str) -> Result<u64, AppError> {
  let value: Value = serde_json::from_str(raw).map_err(|_| AppError::invalid_config("Präferenzen sind beschädigt."))?;
  let object = value.as_object().ok_or_else(|| AppError::invalid_config("Präferenzen sind beschädigt."))?;
  if object.get("schemaVersion").and_then(Value::as_u64) != Some(VERSION) || !object.get("preferences").map(Value::is_array).unwrap_or(false) {
    return Err(AppError::invalid_config("Präferenzversion ist nicht interpretierbar."));
  }
  object.get("revision").and_then(Value::as_u64).ok_or_else(|| AppError::invalid_config("Präferenzrevision fehlt."))
}

#[tauri::command]
pub fn load_virtual_plan_draft(app: AppHandle, plan_id: String) -> Result<Option<String>, AppError> {
  let file = path(&app, &plan_id)?; load_at(&file, &plan_id)
}
#[tauri::command]
pub fn load_virtual_plan_preferences(app: AppHandle) -> Result<Option<String>, AppError> {
  let file = preferences_path(&app)?;
  let _guard = DRAFT_STORE_LOCK.get_or_init(|| Mutex::new(())).lock().map_err(|_| AppError::internal())?;
  match read_workbench_prefs_file(&file) {
    Ok(None) => Ok(None),
    Ok(Some(raw)) => { preferences_revision(&raw)?; Ok(Some(raw)) },
    Err(error) => Err(error),
  }
}
#[tauri::command]
pub fn save_virtual_plan_preferences(app: AppHandle, expected_revision: u64, preferences_json: String) -> Result<(), AppError> {
  let file = preferences_path(&app)?;
  let _guard = DRAFT_STORE_LOCK.get_or_init(|| Mutex::new(())).lock().map_err(|_| AppError::internal())?;
  let next = preferences_revision(&preferences_json)?;
  if next != expected_revision + 1 { return Err(AppError::invalid_config("Ungültige Präferenzrevision.")); }
  match read_workbench_prefs_file(&file) {
    Ok(None) if expected_revision == 0 => write_workbench_prefs_file(&file, &preferences_json),
    Ok(None) => Err(AppError::invalid_config("Präferenzen wurden zwischenzeitlich entfernt.")),
    Ok(Some(raw)) if preferences_revision(&raw)? == expected_revision => write_workbench_prefs_file(&file, &preferences_json),
    Ok(Some(_)) => Err(AppError::invalid_config("Präferenzen wurden zwischenzeitlich geändert.")),
    Err(error) => Err(error),
  }
}
#[tauri::command]
pub fn list_virtual_plan_drafts(app: AppHandle) -> Result<Vec<VirtualPlanDraftListEntry>, AppError> {
  let base = app.path().app_data_dir().map_err(|_| AppError::internal())?.join(DIR);
  list_at(&base)
}
fn list_at(base: &Path) -> Result<Vec<VirtualPlanDraftListEntry>, AppError> {
  let _guard = DRAFT_STORE_LOCK.get_or_init(|| Mutex::new(())).lock().map_err(|_| AppError::internal())?;
  let entries = match fs::read_dir(base) {
    Ok(entries) => entries,
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
    Err(_) => return Err(AppError::internal()),
  };
  let mut result = Vec::new();
  for entry in entries {
    let entry = entry.map_err(|_| AppError::internal())?;
    let file_type = entry.file_type().map_err(|_| AppError::internal())?;
    if !file_type.is_file() { continue; }
    let name = entry.file_name();
    let Some(name) = name.to_str() else { continue; };
    let Some(plan_id) = id_from_filename(name) else { continue; };
    let file = entry.path();
    let modified_at_ms = modified_at_ms(&file);
    if blocked(&file).exists() {
      result.push(VirtualPlanDraftListEntry { plan_id: plan_id.to_string(), draft_json: None, modified_at_ms, blocked: true });
      continue;
    }
    match read_workbench_prefs_file(&file) {
      Ok(Some(raw)) if revision(&raw, plan_id).is_ok() => {
        result.push(VirtualPlanDraftListEntry { plan_id: plan_id.to_string(), draft_json: Some(raw), modified_at_ms, blocked: false });
      }
      Ok(Some(_)) | Err(_) => {
        block(&file)?;
        result.push(VirtualPlanDraftListEntry { plan_id: plan_id.to_string(), draft_json: None, modified_at_ms, blocked: true });
      }
      Ok(None) => {}
    }
  }
  result.sort_by(|left, right| left.plan_id.cmp(&right.plan_id));
  Ok(result)
}
fn load_at(file: &Path, plan_id: &str) -> Result<Option<String>, AppError> {
  let _guard = DRAFT_STORE_LOCK.get_or_init(|| Mutex::new(())).lock().map_err(|_| AppError::internal())?;
  if blocked(&file).exists() { return Err(AppError::invalid_config("Dieser Entwurf ist gesperrt, weil er beschädigt oder unbekannt ist.")); }
  match read_workbench_prefs_file(&file) {
    Ok(None) => Ok(None),
    Ok(Some(raw)) => match revision(&raw, &plan_id) { Ok(_) => Ok(Some(raw)), Err(error) => { block(&file)?; Err(error) } },
    Err(error) => { block(&file)?; Err(error) }
  }
}
#[tauri::command]
pub fn save_virtual_plan_draft(app: AppHandle, plan_id: String, expected_revision: u64, draft_json: String) -> Result<(), AppError> {
  let file = path(&app, &plan_id)?; save_at(&file, &plan_id, expected_revision, &draft_json)
}
fn save_at(file: &Path, plan_id: &str, expected_revision: u64, draft_json: &str) -> Result<(), AppError> {
  let _guard = DRAFT_STORE_LOCK.get_or_init(|| Mutex::new(())).lock().map_err(|_| AppError::internal())?;
  if blocked(&file).exists() { return Err(AppError::invalid_config("Dieser Entwurf ist gesperrt und darf nicht automatisch überschrieben werden.")); }
  let next = revision(&draft_json, &plan_id)?;
  if next != expected_revision + 1 { return Err(AppError::invalid_config("Ungültige Entwurfsrevision.")); }
  match read_workbench_prefs_file(&file) {
    Ok(None) if expected_revision == 0 => write_workbench_prefs_file(&file, &draft_json),
    Ok(None) => Err(AppError::invalid_config("Der Entwurf wurde zwischenzeitlich entfernt.")),
    Ok(Some(raw)) => match revision(&raw, plan_id) {
      Ok(current) if current == expected_revision => write_workbench_prefs_file(file, draft_json),
      Ok(_) => Err(AppError::invalid_config("Der Entwurf wurde zwischenzeitlich geändert.")),
      Err(error) => { block(file)?; Err(error) }
    },
    Err(error) => { block(&file)?; Err(error) }
  }
}
/// Explicit discard is the only route that removes a durable corruption lock.
#[tauri::command]
pub fn discard_virtual_plan_draft(app: AppHandle, plan_id: String) -> Result<(), AppError> {
  let file = path(&app, &plan_id)?; discard_at(&file)
}
fn discard_at(file: &Path) -> Result<(), AppError> {
  let _guard = DRAFT_STORE_LOCK.get_or_init(|| Mutex::new(())).lock().map_err(|_| AppError::internal())?;
  let marker = blocked(file);
  for item in [file, marker.as_path()] { match fs::remove_file(item) { Ok(()) => {}, Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}, Err(_) => return Err(AppError::internal()) } }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*; use std::time::{SystemTime, UNIX_EPOCH}; use std::sync::{Arc, Barrier}; use std::thread;
  use super::super::workbench_prefs::set_atomic_write_fault;
  fn dir() -> PathBuf { let p=std::env::temp_dir().join(format!("dotty-vplan-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos())); fs::create_dir_all(&p).unwrap(); p }
  fn json(id:&str, rev:u64)->String { format!(r#"{{"schemaVersion":1,"planId":"{id}","revision":{rev},"items":[],"openCases":[],"decisions":[],"preferences":[]}}"#) }
  #[test] fn save_load_revision_and_stale_rejected() { let d=dir(); let p=draft_path(&d,"a").unwrap(); save_at(&p,"a",0,&json("a",1)).unwrap(); assert_eq!(load_at(&p,"a").unwrap().unwrap(),json("a",1)); save_at(&p,"a",1,&json("a",2)).unwrap(); assert!(save_at(&p,"a",1,&json("a",2)).is_err()); let _=fs::remove_dir_all(d); }
  #[test] fn corrupt_direct_save_preserves_and_blocks() { let d=dir(); let p=draft_path(&d,"a").unwrap(); fs::write(&p,"{bad").unwrap(); assert!(save_at(&p,"a",0,&json("a",1)).is_err()); assert_eq!(fs::read_to_string(&p).unwrap(),"{bad"); assert!(blocked(&p).exists()); assert!(load_at(&p,"a").is_err()); let _=fs::remove_dir_all(d); }
  #[test] fn marker_contents_do_not_unlock_and_other_draft_works() { let d=dir(); let a=draft_path(&d,"a").unwrap(); let b=draft_path(&d,"b").unwrap(); fs::write(&a,"bad").unwrap(); assert!(load_at(&a,"a").is_err()); fs::write(blocked(&a),"garbage").unwrap(); assert!(save_at(&a,"a",0,&json("a",1)).is_err()); save_at(&b,"b",0,&json("b",1)).unwrap(); discard_at(&a).unwrap(); assert!(load_at(&b,"b").unwrap().is_some()); let _=fs::remove_dir_all(d); }
  #[test] fn concurrent_same_revision_has_one_winner() { let d=dir(); let p=Arc::new(draft_path(&d,"a").unwrap()); save_at(&p,"a",0,&json("a",1)).unwrap(); let mut joins=Vec::new(); for _ in 0..2 { let p=Arc::clone(&p); joins.push(thread::spawn(move||save_at(&p,"a",1,&json("a",2)).is_ok())); } assert_eq!(joins.into_iter().map(|j|j.join().unwrap()).filter(|ok|*ok).count(),1); let _=fs::remove_dir_all(d); }
  #[test] fn unknown_schema_and_missing_fields_never_overwrite() { let d=dir(); let p=draft_path(&d,"a").unwrap(); fs::write(&p,r#"{"schemaVersion":99}"#).unwrap(); assert!(save_at(&p,"a",0,&json("a",1)).is_err()); assert!(blocked(&p).exists()); let _=fs::remove_dir_all(d); }
  #[test] fn block_failure_preserves_corrupt_original_and_denies_save() { let d=dir(); let p=draft_path(&d,"a").unwrap(); fs::write(&p,"bad").unwrap(); BLOCK_FAULT.with(|fault| *fault.borrow_mut()=true); assert!(save_at(&p,"a",0,&json("a",1)).is_err()); BLOCK_FAULT.with(|fault| *fault.borrow_mut()=false); assert_eq!(fs::read_to_string(&p).unwrap(),"bad"); assert!(save_at(&p,"a",0,&json("a",1)).is_err()); assert_eq!(fs::read_to_string(&p).unwrap(),"bad"); let _=fs::remove_dir_all(d); }
  #[test] fn atomic_failures_preserve_previous_and_cleanup_temp() { let d=dir(); let p=draft_path(&d,"a").unwrap(); save_at(&p,"a",0,&json("a",1)).unwrap(); for fault in ["temp","replace"] { set_atomic_write_fault(Some(fault)); assert!(save_at(&p,"a",1,&json("a",2)).is_err()); set_atomic_write_fault(None); assert_eq!(fs::read_to_string(&p).unwrap(),json("a",1)); assert_eq!(fs::read_dir(&d).unwrap().count(),1); } let _=fs::remove_dir_all(d); }
  #[test] fn concurrent_save_and_discard_has_no_resurrection() { let d=dir(); let p=Arc::new(draft_path(&d,"a").unwrap()); save_at(&p,"a",0,&json("a",1)).unwrap(); let gate=Arc::new(Barrier::new(3)); let s=Arc::clone(&p); let g=Arc::clone(&gate); let save=thread::spawn(move|| { g.wait(); save_at(&s,"a",1,&json("a",2)) }); let q=Arc::clone(&p); let g=Arc::clone(&gate); let discard=thread::spawn(move|| { g.wait(); discard_at(&q) }); gate.wait(); let _=save.join(); let _=discard.join().unwrap(); assert!(!p.exists()); assert!(!blocked(&p).exists()); let _=fs::remove_dir_all(d); }
  #[test] fn list_keeps_multiple_drafts_distinct_and_marks_corruption() { let d=dir(); save_at(&draft_path(&d,"a").unwrap(),"a",0,&json("a",1)).unwrap(); save_at(&draft_path(&d,"b").unwrap(),"b",0,&json("b",1)).unwrap(); fs::write(draft_path(&d,"c").unwrap(),"bad").unwrap(); let listed=list_at(&d).unwrap(); assert_eq!(listed.len(),3); assert_eq!(listed.iter().filter(|entry|entry.draft_json.is_some()).count(),2); assert!(listed.iter().any(|entry|entry.plan_id=="c" && entry.blocked)); assert!(blocked(&draft_path(&d,"c").unwrap()).exists()); let _=fs::remove_dir_all(d); }
}
