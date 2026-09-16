use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::error::AppError;

/// Prozessweiter Scan-Zustand. Keine Dateiinhalte, nur Steuerflags.
pub struct AppState {
    scanning: AtomicBool,
    cancel: Arc<AtomicBool>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            scanning: AtomicBool::new(false),
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn try_begin_scan(&self) -> Result<ScanGuard<'_>, AppError> {
        self.scanning
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| {
                AppError::invalid_config(
                    "Es läuft bereits eine Analyse. Bitte warten oder abbrechen.",
                )
            })?;
        self.cancel.store(false, Ordering::SeqCst);
        Ok(ScanGuard { state: self })
    }

    pub fn request_cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    pub fn cancel_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.cancel)
    }

    fn finish_scan(&self) {
        self.scanning.store(false, Ordering::SeqCst);
    }
}

/// Setzt `scanning` zurück, sobald der Command endet (inkl. Fehlerpfad).
pub struct ScanGuard<'a> {
    state: &'a AppState,
}

impl Drop for ScanGuard<'_> {
    fn drop(&mut self) {
        self.state.finish_scan();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn begin_after_finished_scan_is_allowed() {
        let state = AppState::new();
        {
            let _guard = state.try_begin_scan().expect("first");
        }
        let _guard = state.try_begin_scan().expect("second after drop");
    }

    #[test]
    fn begin_after_cancel_is_allowed() {
        let state = AppState::new();
        {
            let _guard = state.try_begin_scan().expect("first");
            state.request_cancel();
            assert!(state.cancel_flag().load(Ordering::SeqCst));
        }
        let _guard = state.try_begin_scan().expect("after cancel");
        assert!(!state.cancel_flag().load(Ordering::SeqCst));
    }

    #[test]
    fn overlapping_scans_are_rejected() {
        let state = AppState::new();
        let _guard = state.try_begin_scan().expect("first");
        assert!(state.try_begin_scan().is_err());
    }
}
