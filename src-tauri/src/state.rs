use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::error::AppError;
use crate::model::ScanResult;

struct ActiveScan {
    id: u64,
    cancel: Arc<AtomicBool>,
}

enum Occupancy {
    Idle,
    Scanning(ActiveScan),
    Exporting,
}

struct Snapshot {
    scan_id: u64,
    result: Arc<ScanResult>,
}

/// Prozessweiter Scan-/Export-Zustand. Snapshot ist flüchtig und READ-ONLY.
pub struct AppState {
    occupancy: Mutex<Occupancy>,
    snapshot: Mutex<Option<Snapshot>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            occupancy: Mutex::new(Occupancy::Idle),
            snapshot: Mutex::new(None),
        }
    }

    pub fn is_exporting(&self) -> bool {
        matches!(*lock_occupancy(&self.occupancy), Occupancy::Exporting)
    }

    pub fn try_begin_scan(&self, scan_id: u64) -> Result<ScanGuard<'_>, AppError> {
        let mut occupancy = lock_occupancy(&self.occupancy);
        match &*occupancy {
            Occupancy::Scanning(_) => {
                return Err(AppError::invalid_config(
                    "Es läuft bereits eine Analyse. Bitte warten oder abbrechen.",
                ));
            }
            Occupancy::Exporting => {
                return Err(AppError::invalid_config(
                    "Es läuft gerade ein Export. Bitte warten.",
                ));
            }
            Occupancy::Idle => {}
        }

        *lock_snapshot(&self.snapshot) = None;

        let cancel = Arc::new(AtomicBool::new(false));
        *occupancy = Occupancy::Scanning(ActiveScan {
            id: scan_id,
            cancel: Arc::clone(&cancel),
        });

        Ok(ScanGuard {
            state: self,
            id: scan_id,
            cancel,
        })
    }

    pub fn request_cancel(&self, scan_id: u64) {
        let occupancy = lock_occupancy(&self.occupancy);
        if let Occupancy::Scanning(current) = &*occupancy {
            if current.id == scan_id {
                current.cancel.store(true, Ordering::SeqCst);
            }
        }
    }

    pub fn store_snapshot(&self, scan_id: u64, result: ScanResult) {
        *lock_snapshot(&self.snapshot) = Some(Snapshot {
            scan_id,
            result: Arc::new(result),
        });
    }

    pub fn snapshot_for(&self, scan_id: u64) -> Result<Arc<ScanResult>, AppError> {
        let snapshot = lock_snapshot(&self.snapshot);
        let Some(current) = snapshot.as_ref() else {
            return Err(AppError::export_failed(
                "Es liegt kein gültiges Analyseergebnis vor.",
            ));
        };
        if current.scan_id != scan_id {
            return Err(AppError::export_failed(
                "Das Analyseergebnis ist nicht mehr aktuell.",
            ));
        }
        Ok(Arc::clone(&current.result))
    }

    pub fn try_begin_export(&self, scan_id: u64) -> Result<ExportGuard<'_>, AppError> {
        let mut occupancy = lock_occupancy(&self.occupancy);
        match &*occupancy {
            Occupancy::Scanning(_) => {
                return Err(AppError::export_failed(
                    "Die Analyse läuft noch. Der Export ist erst nach Abschluss möglich.",
                ));
            }
            Occupancy::Exporting => {
                return Err(AppError::export_failed(
                    "Es läuft bereits ein Export. Bitte warten.",
                ));
            }
            Occupancy::Idle => {}
        }

        let snapshot = lock_snapshot(&self.snapshot);
        let Some(current) = snapshot.as_ref() else {
            return Err(AppError::export_failed(
                "Es liegt kein gültiges Analyseergebnis vor.",
            ));
        };
        if current.scan_id != scan_id {
            return Err(AppError::export_failed(
                "Das Analyseergebnis ist nicht mehr aktuell.",
            ));
        }

        let result = Arc::clone(&current.result);
        drop(snapshot);
        *occupancy = Occupancy::Exporting;

        Ok(ExportGuard {
            state: self,
            result,
        })
    }

    fn finish_occupancy(&self, expected: OccupancyFinish) {
        let mut occupancy = lock_occupancy(&self.occupancy);
        let matches = match (&*occupancy, expected) {
            (Occupancy::Scanning(active), OccupancyFinish::Scan(id)) => active.id == id,
            (Occupancy::Exporting, OccupancyFinish::Export) => true,
            _ => false,
        };
        if matches {
            *occupancy = Occupancy::Idle;
        }
    }
}

#[derive(Clone, Copy)]
enum OccupancyFinish {
    Scan(u64),
    Export,
}

fn lock_occupancy(occupancy: &Mutex<Occupancy>) -> std::sync::MutexGuard<'_, Occupancy> {
    occupancy
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn lock_snapshot(snapshot: &Mutex<Option<Snapshot>>) -> std::sync::MutexGuard<'_, Option<Snapshot>> {
    snapshot
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Setzt den aktiven Scan zurück, sobald der Command endet (inkl. Fehlerpfad).
pub struct ScanGuard<'a> {
    state: &'a AppState,
    id: u64,
    cancel: Arc<AtomicBool>,
}

impl ScanGuard<'_> {
    pub fn scan_id(&self) -> u64 {
        self.id
    }

    pub fn cancel_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.cancel)
    }
}

impl Drop for ScanGuard<'_> {
    fn drop(&mut self) {
        self.state.finish_occupancy(OccupancyFinish::Scan(self.id));
    }
}

pub struct ExportGuard<'a> {
    state: &'a AppState,
    result: Arc<ScanResult>,
}

impl ExportGuard<'_> {
    pub fn result(&self) -> Arc<ScanResult> {
        Arc::clone(&self.result)
    }
}

impl Drop for ExportGuard<'_> {
    fn drop(&mut self) {
        self.state.finish_occupancy(OccupancyFinish::Export);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{FsNode, ScanStats};

    fn empty_result() -> ScanResult {
        ScanResult {
            root: FsNode::Directory {
                id: "/tmp/root".into(),
                name: "root".into(),
                path: "/tmp/root".into(),
                depth: 0,
                children: Vec::new(),
                size_bytes: None,
                created_at_ms: None,
                modified_at_ms: None,
            },
            warnings: Vec::new(),
            stats: ScanStats::default(),
        }
    }

    #[test]
    fn begin_after_finished_scan_is_allowed() {
        let state = AppState::new();
        {
            let _guard = state.try_begin_scan(1).expect("first");
        }
        let _guard = state.try_begin_scan(2).expect("second after drop");
    }

    #[test]
    fn begin_after_cancel_is_allowed() {
        let state = AppState::new();
        {
            let guard = state.try_begin_scan(1).expect("first");
            state.request_cancel(1);
            assert!(guard.cancel_flag().load(Ordering::SeqCst));
        }
        let guard = state.try_begin_scan(2).expect("after cancel");
        assert!(!guard.cancel_flag().load(Ordering::SeqCst));
    }

    #[test]
    fn overlapping_scans_are_rejected() {
        let state = AppState::new();
        let _guard = state.try_begin_scan(1).expect("first");
        assert!(state.try_begin_scan(2).is_err());
    }

    #[test]
    fn cancel_with_wrong_id_does_not_stop_active_scan() {
        let state = AppState::new();
        let guard = state.try_begin_scan(7).expect("active");
        state.request_cancel(6);
        assert!(!guard.cancel_flag().load(Ordering::SeqCst));
        state.request_cancel(7);
        assert!(guard.cancel_flag().load(Ordering::SeqCst));
    }

    #[test]
    fn cancel_without_active_scan_is_ignored() {
        let state = AppState::new();
        state.request_cancel(1);
        let guard = state.try_begin_scan(1).expect("later");
        assert!(!guard.cancel_flag().load(Ordering::SeqCst));
    }

    #[test]
    fn rejected_scan_keeps_snapshot() {
        let state = AppState::new();
        state.store_snapshot(3, empty_result());
        let _export = state.try_begin_export(3).expect("export lock");
        assert!(state.try_begin_scan(4).is_err());
        drop(_export);
        state.try_begin_export(3).expect("snapshot still present");
    }

    #[test]
    fn accepted_scan_clears_snapshot() {
        let state = AppState::new();
        state.store_snapshot(3, empty_result());
        let _scan = state.try_begin_scan(4).expect("new scan");
        drop(_scan);
        assert!(state.try_begin_export(3).is_err());
    }

    #[test]
    fn stale_scan_id_is_rejected_without_occupying_export() {
        let state = AppState::new();
        state.store_snapshot(3, empty_result());
        assert!(state.try_begin_export(9).is_err());
        assert!(!state.is_exporting());
        state.try_begin_export(3).expect("current id still works");
    }

    #[test]
    fn overlapping_exports_are_rejected() {
        let state = AppState::new();
        state.store_snapshot(1, empty_result());
        let _first = state.try_begin_export(1).expect("first export");
        assert!(state.try_begin_export(1).is_err());
    }

    #[test]
    fn scan_during_export_is_rejected() {
        let state = AppState::new();
        state.store_snapshot(1, empty_result());
        let _export = state.try_begin_export(1).expect("export");
        assert!(state.try_begin_scan(2).is_err());
    }
}
