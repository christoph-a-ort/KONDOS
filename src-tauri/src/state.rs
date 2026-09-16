use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::error::AppError;

struct ActiveScan {
    id: u64,
    cancel: Arc<AtomicBool>,
}

/// Prozessweiter Scan-Zustand. Keine Dateiinhalte, nur Steuerflags eines Laufs.
pub struct AppState {
    scanning: AtomicBool,
    active: Mutex<Option<ActiveScan>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            scanning: AtomicBool::new(false),
            active: Mutex::new(None),
        }
    }

    pub fn try_begin_scan(&self, scan_id: u64) -> Result<ScanGuard<'_>, AppError> {
        self.scanning
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| {
                AppError::invalid_config(
                    "Es läuft bereits eine Analyse. Bitte warten oder abbrechen.",
                )
            })?;

        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut active = lock_active(&self.active);
            *active = Some(ActiveScan {
                id: scan_id,
                cancel: Arc::clone(&cancel),
            });
        }

        Ok(ScanGuard {
            state: self,
            id: scan_id,
            cancel,
        })
    }

    pub fn request_cancel(&self, scan_id: u64) {
        let active = lock_active(&self.active);
        if let Some(current) = active.as_ref() {
            if current.id == scan_id {
                current.cancel.store(true, Ordering::SeqCst);
            }
        }
    }

    fn finish_scan(&self, scan_id: u64) {
        {
            let mut active = lock_active(&self.active);
            if active.as_ref().is_some_and(|current| current.id == scan_id) {
                *active = None;
            }
        }
        self.scanning.store(false, Ordering::SeqCst);
    }
}

fn lock_active(active: &Mutex<Option<ActiveScan>>) -> std::sync::MutexGuard<'_, Option<ActiveScan>> {
    active.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
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
        self.state.finish_scan(self.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
