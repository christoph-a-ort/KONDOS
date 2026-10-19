//! P2-L.3a.1: AppData-only, fail-closed reservation marker. No scan filesystem access.
use std::{fs::{self, OpenOptions}, io::Write, path::{Path,PathBuf}};
use serde_json::json;
use crate::error::AppError;

const VERSION:u64=1;
fn key(root:&str)->Option<String>{if root.is_empty()||root.contains('\0'){return None}let mut h: u64=14695981039346656037;for b in root.as_bytes(){h^=*b as u64;h=h.wrapping_mul(1099511628211)}Some(format!("{h:016x}"))}
pub(crate) fn reserve_at(base:&Path,scan_root:&str,owner:&str,journal:&str,created:u64)->Result<PathBuf,AppError>{
  if owner.is_empty()||journal.is_empty(){return Err(AppError::invalid_config("Ungültige Sperrkennung."))}
  let id=key(scan_root).ok_or_else(||AppError::invalid_config("Ungültige Scanwurzel."))?;
  let dir=base.join("simulation-locks");fs::create_dir_all(&dir).map_err(|_|AppError::internal())?;
  let path=dir.join(format!("{id}.v1.lock"));
  let mut file=OpenOptions::new().write(true).create_new(true).open(&path).map_err(|_|AppError::invalid_config("Scanwurzel ist bereits oder unklar gesperrt."))?;
  let raw=json!({"schemaVersion":VERSION,"scanRootIdentity":id,"ownerRunId":owner,"journalId":journal,"createdAtMs":created}).to_string();
  if file.write_all(raw.as_bytes()).and_then(|_|file.flush()).and_then(|_|file.sync_all()).is_err(){let _=fs::remove_file(&path);return Err(AppError::internal())}
  Ok(path)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReservationRecord {
  pub scan_root_identity: String,
  pub owner_run_id: String,
  pub journal_id: String,
  pub journal_revision: u64,
}

pub(crate) fn reservation_file(base: &Path, scan_root: &str) -> Result<PathBuf, AppError> {
  let id = key(scan_root).ok_or_else(|| AppError::invalid_config("Ungültige Scanwurzel."))?;
  Ok(base.join("simulation-locks").join(format!("{id}.v1.lock")))
}

fn parse_reservation(raw: &str, expected_identity: &str) -> Result<ReservationRecord, AppError> {
  let value: serde_json::Value = serde_json::from_str(raw)
    .map_err(|_| AppError::invalid_config("Reservierung ist beschädigt und bleibt gesperrt."))?;
  let object = value.as_object()
    .ok_or_else(|| AppError::invalid_config("Reservierung ist beschädigt und bleibt gesperrt."))?;
  let identity = object.get("scanRootIdentity").and_then(|value| value.as_str()).unwrap_or_default();
  let owner = object.get("ownerRunId").and_then(|value| value.as_str()).unwrap_or_default();
  let journal = object.get("journalId").and_then(|value| value.as_str()).unwrap_or_default();
  let revision = object.get("journalRevision").and_then(|value| value.as_u64());
  if object.get("schemaVersion").and_then(|value| value.as_u64()) != Some(VERSION)
    || identity != expected_identity
    || owner.is_empty()
    || journal.is_empty()
    || revision.is_none()
  {
    return Err(AppError::invalid_config("Reservierung ist beschädigt und bleibt gesperrt."));
  }
  Ok(ReservationRecord {
    scan_root_identity: identity.to_string(),
    owner_run_id: owner.to_string(),
    journal_id: journal.to_string(),
    journal_revision: revision.unwrap(),
  })
}

pub(crate) fn read_reservation_at(base: &Path, scan_root: &str) -> Result<Option<ReservationRecord>, AppError> {
  let identity = key(scan_root).ok_or_else(|| AppError::invalid_config("Ungültige Scanwurzel."))?;
  match fs::read_to_string(reservation_file(base, scan_root)?) {
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
    Err(_) => Err(AppError::invalid_config("Reservierung ist beschädigt und bleibt gesperrt.")),
    Ok(raw) => parse_reservation(&raw, &identity).map(Some),
  }
}

pub(crate) fn reserve_bound_at(
  base: &Path,
  scan_root: &str,
  owner: &str,
  journal: &str,
  created: u64,
  journal_revision: u64,
) -> Result<PathBuf, AppError> {
  if owner.is_empty() || journal.is_empty() {
    return Err(AppError::invalid_config("Ungültige Sperrkennung."));
  }
  let identity = key(scan_root).ok_or_else(|| AppError::invalid_config("Ungültige Scanwurzel."))?;
  let dir = base.join("simulation-locks");
  fs::create_dir_all(&dir).map_err(|_| AppError::internal())?;
  let path = dir.join(format!("{identity}.v1.lock"));
  let mut file = OpenOptions::new()
    .write(true)
    .create_new(true)
    .open(&path)
    .map_err(|_| AppError::invalid_config("Scanwurzel ist bereits oder unklar gesperrt."))?;
  let raw = json!({
    "schemaVersion": VERSION,
    "scanRootIdentity": identity,
    "ownerRunId": owner,
    "journalId": journal,
    "createdAtMs": created,
    "journalRevision": journal_revision
  }).to_string();
  if file.write_all(raw.as_bytes()).and_then(|_| file.flush()).and_then(|_| file.sync_all()).is_err() {
    let _ = fs::remove_file(&path);
    return Err(AppError::internal());
  }
  Ok(path)
}

pub(crate) fn release_reservation_at(base: &Path, scan_root: &str, owner: &str, journal: &str) -> Result<(), AppError> {
  let expected = key(scan_root).ok_or_else(|| AppError::invalid_config("Ungültige Scanwurzel."))?;
  let path = reservation_file(base, scan_root)?;
  let record = read_reservation_at(base, scan_root)?
    .ok_or_else(|| AppError::invalid_config("Keine Reservierung vorhanden."))?;
  if record.scan_root_identity != expected || record.owner_run_id != owner || record.journal_id != journal {
    return Err(AppError::invalid_config("Fremde Reservierung darf nicht freigegeben werden."));
  }
  fs::remove_file(&path).map_err(|_| AppError::internal())
}
#[cfg(test)] mod tests{use super::*;use std::{time::{SystemTime,UNIX_EPOCH},sync::{Arc,Barrier},thread,process::{Command,Stdio},io::Write};fn d()->PathBuf{let p=std::env::temp_dir().join(format!("dotty-lock-{}",SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));fs::create_dir_all(&p).unwrap();p}
#[test]fn first_and_second(){let d=d();assert!(reserve_at(&d,"C:/x","a","j",1).is_ok());assert!(reserve_at(&d,"C:/x","b","j",2).is_err());let _=fs::remove_dir_all(d);}
#[test]fn concurrent_one_winner(){let d=Arc::new(d());let b=Arc::new(Barrier::new(3));let mut v=vec![];for owner in ["a","b"]{let d=d.clone();let b=b.clone();v.push(thread::spawn(move||{b.wait();reserve_at(&d,"C:/x",owner,"j",1).is_ok()}));}b.wait();assert_eq!(v.into_iter().map(|x|x.join().unwrap()).filter(|ok|*ok).count(),1);let _=fs::remove_dir_all(&*d);}
#[test]fn invalid_root(){let d=d();assert!(reserve_at(&d,"","a","j",1).is_err());assert!(!d.join("simulation-locks").exists());}
#[test]fn process_helper(){if std::env::var("DOTTY_LOCK_HELPER").is_err(){return}let mut gate=String::new();std::io::stdin().read_line(&mut gate).unwrap();let base=PathBuf::from(std::env::var("DOTTY_LOCK_DIR").unwrap());let owner=std::env::var("DOTTY_LOCK_OWNER").unwrap();let result=match reserve_at(&base,"C:/same",&owner,"journal",1){Ok(_)=>"RESERVED",Err(e)if e.message.contains("gesperrt")=>"ALREADY_LOCKED",Err(_)=>"ERROR"};println!("DOTTY_LOCK_RESULT:{owner}:{result}");}
#[test]fn independent_processes_have_one_winner(){let base=d();let exe=std::env::current_exe().unwrap();let mut children=vec![];for owner in ["one","two"]{children.push((owner,Command::new(&exe).args(["--exact","commands::simulation_lock::tests::process_helper","--nocapture"]).env("DOTTY_LOCK_HELPER","1").env("DOTTY_LOCK_DIR",&base).env("DOTTY_LOCK_OWNER",owner).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap()));}for(_,child)in &mut children{child.stdin.as_mut().unwrap().write_all(b"go\n").unwrap();}let results:Vec<_>=children.into_iter().map(|(owner,child)|{let out=child.wait_with_output().unwrap();assert!(out.status.success());let line=String::from_utf8(out.stdout).unwrap();(owner,line)}).collect();assert_eq!(results.iter().filter(|(_,x)|x.contains(":RESERVED")).count(),1);assert_eq!(results.iter().filter(|(_,x)|x.contains(":ALREADY_LOCKED")).count(),1);assert_eq!(results.iter().filter(|(_,x)|x.contains(":ERROR")).count(),0);let winner=results.iter().find(|(_,x)|x.contains(":RESERVED")).unwrap().0;let lock=fs::read_to_string(base.join("simulation-locks").join(format!("{}.v1.lock",key("C:/same").unwrap()))).unwrap();assert!(lock.contains(&format!("\"ownerRunId\":\"{winner}\"")));let _=fs::remove_dir_all(base);}
}
