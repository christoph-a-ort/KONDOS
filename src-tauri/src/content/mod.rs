use std::collections::HashMap;

mod extract;
mod format;
mod prepare;
mod search;

pub use extract::extract_path;
pub use prepare::{
    run_prepare_content, ContentPrepareStatus, ContentProgress, CONTENT_PROGRESS_EVENT,
};
pub use search::{search_file_content, ContentSearchResult};

/// Dateiformat für späteren Inhaltsextrakt. P1-E1.2 extrahiert nur PDF.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ContentFormat {
    Pdf,
    Docx,
    Xlsx,
}

/// Verarbeitungsergebnis einer Datei.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentStatus {
    Searchable,
    NoExtractableText,
    Protected,
    ParseError,
    Missing,
    AccessDenied,
    IoError,
    TooLarge,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContentEntry {
    pub path: String,
    pub name: String,
    pub format: ContentFormat,
    pub status: ContentStatus,
    pub text: Option<String>,
    /// Zeichenzahl des rohen Parser-Textes vor der 1-MiB-Kappung.
    pub extracted_chars: usize,
    pub truncated: bool,
}

impl ContentEntry {
    #[allow(dead_code)] // Tests und spätere Cache-Hilfskonstruktoren
    pub fn new(
        path: impl Into<String>,
        name: impl Into<String>,
        format: ContentFormat,
        status: ContentStatus,
    ) -> Self {
        Self {
            path: path.into(),
            name: name.into(),
            format,
            status,
            text: None,
            extracted_chars: 0,
            truncated: false,
        }
    }
}

/// Sitzungsbezogener Inhaltscache, gebunden an genau eine `scan_id`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContentCache {
    pub scan_id: u64,
    pub entries: HashMap<String, ContentEntry>,
    pub complete: bool,
}

impl ContentCache {
    pub fn new(scan_id: u64) -> Self {
        Self {
            scan_id,
            entries: HashMap::new(),
            complete: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ContentEntry, ContentFormat, ContentStatus};
    use crate::error::AppErrorKind;
    use crate::model::{DirectoryListing, FsNode, ScanResult, ScanStats};
    use crate::state::AppState;
    use std::sync::atomic::Ordering;

    fn empty_result() -> ScanResult {
        ScanResult {
            root: FsNode::Directory {
                id: "/tmp/root".into(),
                name: "root".into(),
                path: "/tmp/root".into(),
                depth: 0,
                listing: DirectoryListing::Read,
                children: Vec::new(),
                size_bytes: None,
                created_at_ms: None,
                modified_at_ms: None,
            },
            warnings: Vec::new(),
            stats: ScanStats::default(),
        }
    }

    fn sample_entry(path: &str) -> ContentEntry {
        ContentEntry::new(path, "doc.pdf", ContentFormat::Pdf, ContentStatus::Searchable)
    }

    #[test]
    fn later_formats_are_reserved() {
        let _ = [ContentFormat::Pdf, ContentFormat::Docx, ContentFormat::Xlsx];
        let _ = [
            ContentStatus::Searchable,
            ContentStatus::NoExtractableText,
            ContentStatus::Protected,
            ContentStatus::ParseError,
            ContentStatus::Missing,
            ContentStatus::AccessDenied,
            ContentStatus::IoError,
            ContentStatus::TooLarge,
        ];
    }

    #[test]
    fn preparing_content_starts_from_idle_with_snapshot() {
        let state = AppState::new();
        assert!(state.try_begin_prepare(1).is_err());
        state.store_snapshot(1, empty_result());
        let guard = state.try_begin_prepare(1).expect("idle + snapshot");
        assert!(state.is_preparing_content());
        assert!(state.is_close_blocked());
        assert_eq!(guard.scan_id(), 1);
        assert!(!guard.cancel_flag().load(Ordering::SeqCst));
    }

    #[test]
    fn preparing_content_blocks_scan() {
        let state = AppState::new();
        state.store_snapshot(1, empty_result());
        let _prepare = state.try_begin_prepare(1).expect("prepare");
        match state.try_begin_scan(2) {
            Ok(_) => panic!("scan should be blocked"),
            Err(err) => assert_eq!(err.kind, AppErrorKind::InvalidConfig),
        }
        state
            .content_cache_for(1)
            .expect("rejected scan must keep cache");
    }

    #[test]
    fn preparing_content_blocks_export() {
        let state = AppState::new();
        state.store_snapshot(1, empty_result());
        let _prepare = state.try_begin_prepare(1).expect("prepare");
        match state.try_begin_export(1) {
            Ok(_) => panic!("export should be blocked"),
            Err(err) => assert_eq!(err.kind, AppErrorKind::ExportFailed),
        }
        assert!(!state.is_exporting());
    }

    #[test]
    fn scanning_blocks_preparing_content() {
        let state = AppState::new();
        state.store_snapshot(1, empty_result());
        let _scan = state.try_begin_scan(2).expect("scan");
        assert!(state.try_begin_prepare(1).is_err());
        assert!(state.try_begin_prepare(2).is_err());
        assert!(!state.is_preparing_content());
    }

    #[test]
    fn exporting_blocks_preparing_content() {
        let state = AppState::new();
        state.store_snapshot(1, empty_result());
        let _export = state.try_begin_export(1).expect("export");
        assert!(state.try_begin_prepare(1).is_err());
        assert!(!state.is_preparing_content());
        assert!(state.is_close_blocked());
    }

    #[test]
    fn second_preparing_content_is_rejected() {
        let state = AppState::new();
        state.store_snapshot(1, empty_result());
        let _first = state.try_begin_prepare(1).expect("first");
        assert!(state.try_begin_prepare(1).is_err());
    }

    #[test]
    fn prepare_guard_drop_returns_to_idle() {
        let state = AppState::new();
        state.store_snapshot(1, empty_result());
        {
            let _guard = state.try_begin_prepare(1).expect("prepare");
            assert!(state.is_preparing_content());
        }
        assert!(!state.is_preparing_content());
        assert!(!state.is_close_blocked());
        state.try_begin_export(1).expect("idle again");
    }

    #[test]
    fn prepare_cancel_belongs_to_active_run() {
        let state = AppState::new();
        state.store_snapshot(7, empty_result());
        let guard = state.try_begin_prepare(7).expect("prepare");
        state.request_cancel_prepare(6);
        assert!(!guard.cancel_flag().load(Ordering::SeqCst));
        state.request_cancel_prepare(7);
        assert!(guard.cancel_flag().load(Ordering::SeqCst));
    }

    #[test]
    fn stale_prepare_cancel_does_not_affect_new_run() {
        let state = AppState::new();
        state.store_snapshot(1, empty_result());
        {
            let guard = state.try_begin_prepare(1).expect("first");
            state.request_cancel_prepare(1);
            assert!(guard.cancel_flag().load(Ordering::SeqCst));
        }
        state.request_cancel_prepare(1);
        let guard = state.try_begin_prepare(1).expect("second");
        assert!(!guard.cancel_flag().load(Ordering::SeqCst));
        state.request_cancel_prepare(9);
        assert!(!guard.cancel_flag().load(Ordering::SeqCst));
    }

    #[test]
    fn content_cache_is_bound_to_scan_id() {
        let state = AppState::new();
        assert!(state.content_cache_for(1).is_err());
        state.store_snapshot(1, empty_result());
        state
            .insert_content_entry(1, sample_entry("C:\\a.pdf"))
            .expect("insert current");
        assert!(state.insert_content_entry(2, sample_entry("C:\\b.pdf")).is_err());
        let cache = state.content_cache_for(1).expect("cache A");
        assert_eq!(cache.scan_id, 1);
        assert!(cache.entries.contains_key("C:\\a.pdf"));
        assert!(!cache.entries.contains_key("C:\\b.pdf"));
        assert!(state.content_cache_for(2).is_err());
    }

    #[test]
    fn new_scan_clears_content_cache() {
        let state = AppState::new();
        state.store_snapshot(3, empty_result());
        state
            .insert_content_entry(3, sample_entry("C:\\old.pdf"))
            .expect("seed");
        let _scan = state.try_begin_scan(4).expect("new scan");
        assert!(state.content_cache_for(3).is_err());
        assert!(state.content_cache_for(4).is_err());
        assert!(state.insert_content_entry(3, sample_entry("C:\\old.pdf")).is_err());
    }

    #[test]
    fn new_scan_id_does_not_reuse_old_cache() {
        let state = AppState::new();
        state.store_snapshot(1, empty_result());
        state
            .insert_content_entry(1, sample_entry("C:\\old.pdf"))
            .expect("seed A");
        state.mark_content_complete(1).expect("complete A");
        state.store_snapshot(2, empty_result());
        assert!(state.content_cache_for(1).is_err());
        let cache = state.content_cache_for(2).expect("fresh B");
        assert_eq!(cache.scan_id, 2);
        assert!(cache.entries.is_empty());
        assert!(!cache.complete);
        state
            .insert_content_entry(2, sample_entry("C:\\new.pdf"))
            .expect("seed B");
        let cache = state.content_cache_for(2).expect("B after insert");
        assert!(!cache.entries.contains_key("C:\\old.pdf"));
        assert!(cache.entries.contains_key("C:\\new.pdf"));
    }

    #[test]
    fn stale_content_run_cannot_overwrite_newer_cache() {
        let state = AppState::new();
        state.store_snapshot(1, empty_result());
        state
            .insert_content_entry(1, sample_entry("C:\\a.pdf"))
            .expect("A");
        state.store_snapshot(2, empty_result());
        state
            .insert_content_entry(2, sample_entry("C:\\b.pdf"))
            .expect("B");
        assert!(state.insert_content_entry(1, sample_entry("C:\\stale.pdf")).is_err());
        assert!(state.mark_content_complete(1).is_err());
        let cache = state.content_cache_for(2).expect("B intact");
        assert!(!cache.complete);
        assert!(!cache.entries.contains_key("C:\\stale.pdf"));
        assert!(!cache.entries.contains_key("C:\\a.pdf"));
        assert!(cache.entries.contains_key("C:\\b.pdf"));
    }

    #[test]
    fn prepare_rejects_stale_scan_id_without_occupying() {
        let state = AppState::new();
        state.store_snapshot(3, empty_result());
        assert!(state.try_begin_prepare(9).is_err());
        assert!(!state.is_preparing_content());
        state.try_begin_prepare(3).expect("current id still works");
    }
}
