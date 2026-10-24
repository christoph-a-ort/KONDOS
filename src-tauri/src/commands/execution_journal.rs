//! P2-L.3 simulation journals. AppData only; never touches scanned paths.
use std::{fs, path::{Path, PathBuf}, sync::{Mutex, OnceLock}};
use tauri::{AppHandle, Manager};
use serde_json::{Map, Value};
use crate::error::AppError;
use super::workbench_prefs::{read_workbench_prefs_file, write_workbench_prefs_file};

const DIR:&str="execution-journals"; const VERSION:u64=1;
static LOCK:OnceLock<Mutex<()>>=OnceLock::new();
fn valid(id:&str)->bool{!id.is_empty()&&id.len()<=128&&id.bytes().all(|c|c.is_ascii_alphanumeric()||c==b'-'||c==b'_')}
fn base(app:&AppHandle)->Result<PathBuf,AppError>{Ok(app.path().app_data_dir().map_err(|_|AppError::internal())?.join(DIR))}
pub(crate) fn journal_store(app_data:&Path)->PathBuf{app_data.join(DIR)}
pub(crate) fn journal(base:&Path,id:&str)->Result<PathBuf,AppError>{if !valid(id){return Err(AppError::invalid_config("Ungültige Journalkennung."))}Ok(base.join(format!("{id}.v1.json")))}
fn blocked(p:&Path)->PathBuf{p.with_extension("v1.json.blocked")}
pub(crate) fn check(raw:&str,id:&str)->Result<u64,AppError>{let v:Value=serde_json::from_str(raw).map_err(|_|AppError::invalid_config("Journal ist beschädigt und bleibt gesperrt."))?;let o=v.as_object().ok_or_else(||AppError::invalid_config("Journal ist beschädigt und bleibt gesperrt."))?;if o.get("schemaVersion").and_then(Value::as_u64)!=Some(VERSION)||o.get("journalId").and_then(Value::as_str)!=Some(id)||!o.get("operations").map(Value::is_array).unwrap_or(false){return Err(AppError::invalid_config("Journalformat ist nicht zuverlässig interpretierbar und bleibt gesperrt."))}o.get("revision").and_then(Value::as_u64).ok_or_else(||AppError::invalid_config("Journalrevision fehlt."))}
pub(crate) fn save_at(p:&Path,id:&str,expected:u64,raw:&str)->Result<(),AppError>{let _g=LOCK.get_or_init(||Mutex::new(())).lock().map_err(|_|AppError::internal())?;if blocked(p).exists(){return Err(AppError::invalid_config("Journal ist gesperrt und darf nicht überschrieben werden."))}let next=check(raw,id)?;if next!=expected+1{return Err(AppError::invalid_config("Ungültige Journalrevision."))}match read_workbench_prefs_file(p){Ok(None)if expected==0=>write_workbench_prefs_file(p,raw),Ok(Some(old))=>match check(&old,id){Ok(r)if r==expected=>write_workbench_prefs_file(p,raw),Ok(_)=>Err(AppError::invalid_config("Journal wurde zwischenzeitlich geändert.")),Err(e)=>{let _=fs::write(blocked(p),b"blocked");Err(e)}},Ok(None)=>Err(AppError::invalid_config("Journal wurde zwischenzeitlich entfernt.")),Err(e)=>{let _=fs::write(blocked(p),b"blocked");Err(e)}}}
pub(crate) fn load_at(p:&Path,id:&str)->Result<Option<String>,AppError>{if blocked(p).exists(){return Err(AppError::invalid_config("Journal ist gesperrt."))}match read_workbench_prefs_file(p){Ok(Some(raw))=>{check(&raw,id)?;Ok(Some(raw))},other=>other}}
fn bound_fields(raw:&str)->bool{serde_json::from_str::<Value>(raw).ok().and_then(|v|v.as_object().cloned()).map(|o|["scanRoot","ownerRunId","bindingStatus"].iter().any(|k|o.get(*k).and_then(Value::as_str).is_some())).unwrap_or(false)}
fn refuse_unbound()->AppError{AppError::invalid_config("Dieses Journal darf nur über die gebundene Simulationsverwaltung gelesen oder geändert werden.")}
pub(crate) fn load_unbound_at(p:&Path,id:&str)->Result<Option<String>,AppError>{match load_at(p,id)?{Some(raw)if bound_fields(&raw)=>Err(refuse_unbound()),other=>Ok(other)}}
pub(crate) fn save_unbound_at(_p:&Path,_id:&str,_expected:u64,_raw:&str)->Result<(),AppError>{Err(refuse_unbound())}
pub(crate) fn journal_status_blocks_real_ops(status: &str) -> bool {
    matches!(
        status,
        "executionHalted" | "blocked" | "recoveryRequired" | "failed" | "interrupted" | "completed"
    )
}

pub(crate) fn success_journal_status(
    object: &Map<String, Value>,
    completing_operation_id: &str,
) -> &'static str {
    if planned_operations_all_executed(object, Some(completing_operation_id)) {
        "completed"
    } else {
        "executing"
    }
}

fn planned_operations_all_executed(
    object: &Map<String, Value>,
    treat_as_executed: Option<&str>,
) -> bool {
    let Some(operations) = object.get("operations").and_then(Value::as_array) else {
        return false;
    };
    let Some(status_map) = object.get("operationStatus").and_then(Value::as_object) else {
        return false;
    };
    if operations.is_empty() {
        return false;
    }
    let mut seen = std::collections::BTreeSet::new();
    for operation in operations {
        let Some(id) = operation.get("id").and_then(Value::as_str) else {
            return false;
        };
        if !seen.insert(id) {
            return false;
        }
        let status = if treat_as_executed == Some(id) {
            "executed"
        } else {
            status_map.get(id).and_then(Value::as_str).unwrap_or("")
        };
        if status != "executed" {
            return false;
        }
    }
    status_map.len() == seen.len() && status_map.keys().all(|id| seen.contains(id.as_str()))
}

#[tauri::command] pub fn load_execution_journal(app:AppHandle,journal_id:String)->Result<Option<String>,AppError>{load_unbound_at(&journal(&base(&app)?,&journal_id)?,&journal_id)}
#[tauri::command] pub fn save_execution_journal(app:AppHandle,journal_id:String,expected_revision:u64,journal_json:String)->Result<(),AppError>{save_unbound_at(&journal(&base(&app)?,&journal_id)?,&journal_id,expected_revision,&journal_json)}
#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    fn dir()->PathBuf{let p=std::env::temp_dir().join(format!("dotty-journal-unbound-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));fs::create_dir_all(&p).unwrap();p}
    fn bound()->&'static str{r#"{"schemaVersion":1,"journalId":"j1","revision":1,"operations":[],"scanRoot":"C:/x","ownerRunId":"o","bindingStatus":"reserved"}"#}
    #[test] fn unbound_save_cannot_bypass_binding(){
        let d=dir(); let p=journal(&d,"j1").unwrap();
        assert!(save_unbound_at(&p,"j1",0,bound()).is_err());
        assert!(save_unbound_at(&p,"j1",0,r#"{"schemaVersion":1,"journalId":"j1","revision":1,"operations":[]}"#).is_err());
        assert!(!p.exists());
        let _=fs::remove_dir_all(d);
    }
    #[test] fn unbound_load_rejects_bound_journal_without_changing_it(){
        let d=dir(); let p=journal(&d,"j1").unwrap();
        save_at(&p,"j1",0,bound()).unwrap();
        assert!(load_unbound_at(&p,"j1").is_err());
        assert_eq!(load_at(&p,"j1").unwrap().unwrap(), bound());
        let _=fs::remove_dir_all(d);
    }
    fn object(raw: &str) -> Map<String, Value> {
        serde_json::from_str::<Value>(raw).unwrap().as_object().unwrap().clone()
    }
    #[test] fn last_executed_operation_completes_journal() {
        let raw = r#"{"operations":[{"id":"op-a"},{"id":"op-b"}],"operationStatus":{"op-a":"executed","op-b":"started"}}"#;
        assert_eq!(success_journal_status(&object(raw), "op-b"), "completed");
    }
    #[test] fn pending_operation_keeps_executing() {
        let raw = r#"{"operations":[{"id":"op-a"},{"id":"op-b"}],"operationStatus":{"op-a":"executed","op-b":"pending"}}"#;
        assert_eq!(success_journal_status(&object(raw), "op-a"), "executing");
    }
    #[test] fn zero_pending_without_per_op_proof_does_not_complete() {
        let raw = r#"{"operations":[{"id":"op-a"},{"id":"op-b"}],"operationStatus":{"op-a":"simulatedComplete","op-b":"simulatedComplete"}}"#;
        assert_eq!(success_journal_status(&object(raw), "op-a"), "executing");
    }
    #[test] fn completed_status_blocks_real_ops() {
        assert!(journal_status_blocks_real_ops("completed"));
        assert!(!journal_status_blocks_real_ops("executing"));
    }
}
