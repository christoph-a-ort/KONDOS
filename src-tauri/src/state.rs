use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::content::{ContentCache, ContentEntry};
use crate::error::AppError;
use crate::model::ScanResult;

struct ActiveScan {
    id: u64,
    cancel: Arc<AtomicBool>,
}

struct ActivePrepare {
    id: u64,
    cancel: Arc<AtomicBool>,
}

enum Occupancy {
    Idle,
    Scanning(ActiveScan),
    Exporting,
    PreparingContent(ActivePrepare),
}

struct Snapshot {
    scan_id: u64,
    result: Arc<ScanResult>,
}

/// Prozessweiter Scan-/Export-/Inhaltszustand. Snapshot und ContentCache sind flüchtig.
pub struct AppState {
    occupancy: Mutex<Occupancy>,
    snapshot: Mutex<Option<Snapshot>>,
    content: Mutex<Option<ContentCache>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            occupancy: Mutex::new(Occupancy::Idle),
            snapshot: Mutex::new(None),
            content: Mutex::new(None),
        }
    }

    pub fn is_exporting(&self) -> bool {
        matches!(*lock_occupancy(&self.occupancy), Occupancy::Exporting)
    }

    pub fn is_preparing_content(&self) -> bool {
        matches!(
            *lock_occupancy(&self.occupancy),
            Occupancy::PreparingContent(_)
        )
    }

    pub fn is_close_blocked(&self) -> bool {
        self.is_exporting() || self.is_preparing_content()
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
            Occupancy::PreparingContent(_) => {
                return Err(AppError::invalid_config(
                    "Dateiinhalte werden gerade vorbereitet. Bitte warten oder abbrechen.",
                ));
            }
            Occupancy::Idle => {}
        }

        *lock_snapshot(&self.snapshot) = None;
        *lock_content(&self.content) = None;

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

    pub fn request_cancel_prepare(&self, scan_id: u64) {
        let occupancy = lock_occupancy(&self.occupancy);
        if let Occupancy::PreparingContent(current) = &*occupancy {
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
        *lock_content(&self.content) = Some(ContentCache::new(scan_id));
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
            Occupancy::PreparingContent(_) => {
                return Err(AppError::export_failed(
                    "Dateiinhalte werden gerade vorbereitet. Der Export ist erst danach möglich.",
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

    /// Occupancy lock for IST-Bericht XLSX export.
    ///
    /// - `Some(scan_id)`: same snapshot checks as [`Self::try_begin_export`].
    /// - `None`: Exporting when Idle, without requiring a snapshot (offline/synthetic report).
    pub fn try_begin_report_export(
        &self,
        scan_id: Option<u64>,
    ) -> Result<ReportExportGuard<'_>, AppError> {
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
            Occupancy::PreparingContent(_) => {
                return Err(AppError::export_failed(
                    "Dateiinhalte werden gerade vorbereitet. Der Export ist erst danach möglich.",
                ));
            }
            Occupancy::Idle => {}
        }

        if let Some(scan_id) = scan_id {
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
            drop(snapshot);
        }

        *occupancy = Occupancy::Exporting;
        Ok(ReportExportGuard { state: self })
    }

    pub fn try_begin_prepare(&self, scan_id: u64) -> Result<PrepareGuard<'_>, AppError> {
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
            Occupancy::PreparingContent(_) => {
                return Err(AppError::invalid_config(
                    "Dateiinhalte werden bereits vorbereitet.",
                ));
            }
            Occupancy::Idle => {}
        }

        let snapshot = lock_snapshot(&self.snapshot);
        let Some(current) = snapshot.as_ref() else {
            return Err(AppError::invalid_config(
                "Es liegt kein gültiges Analyseergebnis vor.",
            ));
        };
        if current.scan_id != scan_id {
            return Err(AppError::invalid_config(
                "Das Analyseergebnis ist nicht mehr aktuell.",
            ));
        }
        drop(snapshot);

        let content = lock_content(&self.content);
        let Some(cache) = content.as_ref() else {
            return Err(AppError::invalid_config(
                "Der Inhaltscache ist nicht mehr aktuell.",
            ));
        };
        if cache.scan_id != scan_id {
            return Err(AppError::invalid_config(
                "Der Inhaltscache ist nicht mehr aktuell.",
            ));
        }
        drop(content);

        let cancel = Arc::new(AtomicBool::new(false));
        *occupancy = Occupancy::PreparingContent(ActivePrepare {
            id: scan_id,
            cancel: Arc::clone(&cancel),
        });

        Ok(PrepareGuard {
            state: self,
            id: scan_id,
            cancel,
        })
    }

    pub fn ensure_content_search_allowed(&self) -> Result<(), AppError> {
        match &*lock_occupancy(&self.occupancy) {
            Occupancy::Idle => Ok(()),
            Occupancy::Scanning(_) => Err(AppError::invalid_config(
                "Es läuft bereits eine Analyse. Die Inhaltssuche ist erst danach möglich.",
            )),
            Occupancy::Exporting => Err(AppError::invalid_config(
                "Es läuft gerade ein Export. Die Inhaltssuche ist erst danach möglich.",
            )),
            Occupancy::PreparingContent(_) => Err(AppError::invalid_config(
                "Dateiinhalte werden gerade vorbereitet. Die Inhaltssuche ist erst danach möglich.",
            )),
        }
    }

    pub fn ensure_open_allowed(&self) -> Result<(), AppError> {
        match &*lock_occupancy(&self.occupancy) {
            Occupancy::Idle => Ok(()),
            Occupancy::Scanning(_) => Err(AppError::invalid_config(
                "Die Analyse läuft noch. Die Datei kann erst danach geöffnet werden.",
            )),
            Occupancy::Exporting => Err(AppError::invalid_config(
                "Es läuft gerade ein Export. Die Datei kann erst danach geöffnet werden.",
            )),
            Occupancy::PreparingContent(_) => Err(AppError::invalid_config(
                "Dateiinhalte werden gerade vorbereitet. Die Datei kann erst danach geöffnet werden.",
            )),
        }
    }

    pub fn snapshot_for_content(&self, scan_id: u64) -> Result<Arc<ScanResult>, AppError> {
        let snapshot = lock_snapshot(&self.snapshot);
        let Some(current) = snapshot.as_ref() else {
            return Err(AppError::invalid_config(
                "Es liegt kein gültiges Analyseergebnis vor.",
            ));
        };
        if current.scan_id != scan_id {
            return Err(AppError::invalid_config(
                "Das Analyseergebnis ist nicht mehr aktuell.",
            ));
        }
        Ok(Arc::clone(&current.result))
    }

    #[allow(dead_code)] // Tests
    pub fn content_cache_for(&self, scan_id: u64) -> Result<ContentCache, AppError> {
        self.with_content_cache(scan_id, ContentCache::clone)
    }

    pub fn with_content_cache<R>(
        &self,
        scan_id: u64,
        f: impl FnOnce(&ContentCache) -> R,
    ) -> Result<R, AppError> {
        let content = lock_content(&self.content);
        let Some(current) = content.as_ref() else {
            return Err(AppError::invalid_config("Es liegt kein Inhaltscache vor."));
        };
        if current.scan_id != scan_id {
            return Err(AppError::invalid_config(
                "Der Inhaltscache ist nicht mehr aktuell.",
            ));
        }
        Ok(f(current))
    }

    pub fn content_has_path(&self, scan_id: u64, path: &str) -> Result<bool, AppError> {
        self.with_content_cache(scan_id, |cache| cache.entries.contains_key(path))
    }

    pub fn insert_content_entry(&self, scan_id: u64, entry: ContentEntry) -> Result<(), AppError> {
        let mut content = lock_content(&self.content);
        let Some(current) = content.as_mut() else {
            return Err(AppError::invalid_config("Es liegt kein Inhaltscache vor."));
        };
        if current.scan_id != scan_id {
            return Err(AppError::invalid_config(
                "Der Inhaltscache ist nicht mehr aktuell.",
            ));
        }
        current.entries.insert(entry.path.clone(), entry);
        Ok(())
    }

    pub fn mark_content_complete(&self, scan_id: u64) -> Result<(), AppError> {
        let mut content = lock_content(&self.content);
        let Some(current) = content.as_mut() else {
            return Err(AppError::invalid_config("Es liegt kein Inhaltscache vor."));
        };
        if current.scan_id != scan_id {
            return Err(AppError::invalid_config(
                "Der Inhaltscache ist nicht mehr aktuell.",
            ));
        }
        current.complete = true;
        Ok(())
    }

    fn finish_occupancy(&self, expected: OccupancyFinish) {
        let mut occupancy = lock_occupancy(&self.occupancy);
        let matches = match (&*occupancy, expected) {
            (Occupancy::Scanning(active), OccupancyFinish::Scan(id)) => active.id == id,
            (Occupancy::Exporting, OccupancyFinish::Export) => true,
            (Occupancy::PreparingContent(active), OccupancyFinish::Prepare(id)) => active.id == id,
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
    Prepare(u64),
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

fn lock_content(
    content: &Mutex<Option<ContentCache>>,
) -> std::sync::MutexGuard<'_, Option<ContentCache>> {
    content
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

/// Holds Exporting occupancy for report XLSX without retaining a ScanResult Arc.
pub struct ReportExportGuard<'a> {
    state: &'a AppState,
}

impl Drop for ReportExportGuard<'_> {
    fn drop(&mut self) {
        self.state.finish_occupancy(OccupancyFinish::Export);
    }
}

pub struct PrepareGuard<'a> {
    state: &'a AppState,
    id: u64,
    cancel: Arc<AtomicBool>,
}

impl PrepareGuard<'_> {
    #[allow(dead_code)] // Tests
    pub fn scan_id(&self) -> u64 {
        self.id
    }

    pub fn cancel_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.cancel)
    }
}

impl Drop for PrepareGuard<'_> {
    fn drop(&mut self) {
        self.state
            .finish_occupancy(OccupancyFinish::Prepare(self.id));
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
                listing: crate::model::DirectoryListing::Read,
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
    fn report_export_without_scan_id_when_idle() {
        let state = AppState::new();
        let guard = state.try_begin_report_export(None).expect("idle report export");
        assert!(state.is_exporting());
        assert!(state.try_begin_report_export(None).is_err());
        drop(guard);
        assert!(!state.is_exporting());
    }

    #[test]
    fn report_export_with_scan_id_requires_snapshot() {
        let state = AppState::new();
        assert!(state.try_begin_report_export(Some(9)).is_err());
        state.store_snapshot(3, empty_result());
        let _guard = state.try_begin_report_export(Some(3)).expect("matching id");
        assert!(state.is_exporting());
    }

    #[test]
    fn scan_during_export_is_rejected() {
        let state = AppState::new();
        state.store_snapshot(1, empty_result());
        let _export = state.try_begin_export(1).expect("export");
        assert!(state.try_begin_scan(2).is_err());
    }
}
