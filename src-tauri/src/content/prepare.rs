use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};

use super::format::content_format_from_name;
use super::{extract_path, ContentCache, ContentFormat, ContentStatus};
use crate::error::AppError;
use crate::model::FsNode;
use crate::state::AppState;

pub const CONTENT_PROGRESS_EVENT: &str = "content://progress";

/// PDF aus dem Snapshot, in Traversierungsreihenfolge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SnapshotPdf {
    pub id: String,
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ContentPrepareStatus {
    Running,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContentProgress {
    pub scan_id: u64,
    pub total_pdf_count: u64,
    pub processed_pdf_count: u64,
    pub searchable_count: u64,
    pub no_text_count: u64,
    pub problem_count: u64,
    pub current_file_name: String,
    pub status: ContentPrepareStatus,
}

#[derive(Debug, Clone, Copy, Default)]
struct PrepareCounts {
    processed: u64,
    searchable: u64,
    no_text: u64,
    problem: u64,
}

impl PrepareCounts {
    fn add(&mut self, status: ContentStatus) {
        self.processed += 1;
        match status {
            ContentStatus::Searchable => self.searchable += 1,
            ContentStatus::NoExtractableText => self.no_text += 1,
            ContentStatus::Protected
            | ContentStatus::ParseError
            | ContentStatus::Missing
            | ContentStatus::AccessDenied
            | ContentStatus::IoError
            | ContentStatus::TooLarge => self.problem += 1,
        }
    }
}

/// Sammelt alle PDF-Dateien des Snapshots.
///
/// Reihenfolge: Tiefensuche in der vorhandenen `children`-Reihenfolge
/// des Scanners (Ordner vor Dateien, Natural-Sort innerhalb der Gruppen).
/// Keine neue Sortierung, unabhängig vom UI-Filter.
pub(crate) fn collect_snapshot_pdfs(root: &FsNode) -> Vec<SnapshotPdf> {
    let mut out = Vec::new();
    collect_from_node(root, &mut out);
    out
}

fn collect_from_node(node: &FsNode, out: &mut Vec<SnapshotPdf>) {
    match node {
        FsNode::File { id, name, path, .. } => {
            if content_format_from_name(name) == Some(ContentFormat::Pdf) {
                out.push(SnapshotPdf {
                    id: id.clone(),
                    path: path.clone(),
                    name: name.clone(),
                });
            }
        }
        FsNode::Directory { children, .. } => {
            for child in children {
                collect_from_node(child, out);
            }
        }
    }
}

/// Command-naher Einstieg: Occupancy-Guard plus sequentieller Prepare-Lauf.
#[cfg(test)]
pub(crate) fn run_prepare_content_guarded(
    state: &AppState,
    scan_id: u64,
    on_progress: impl FnMut(ContentProgress),
) -> Result<ContentProgress, AppError> {
    let guard = state.try_begin_prepare(scan_id)?;
    let cancel = guard.cancel_flag();
    run_prepare_content(state, scan_id, &cancel, on_progress)
}

/// Sequentieller PDF-Prepare-Lauf für genau eine `scan_id`.
///
/// Die aktuelle Datei darf zu Ende extrahiert werden; Cancel wirkt vor
/// dem Start der nächsten fehlenden PDF. Bereits vorhandene Cache-Pfade
/// werden unabhängig vom Status übersprungen.
pub fn run_prepare_content(
    state: &AppState,
    scan_id: u64,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(ContentProgress),
) -> Result<ContentProgress, AppError> {
    let snapshot = match state.snapshot_for(scan_id) {
        Ok(snapshot) => snapshot,
        Err(err) => {
            on_progress(failed_progress(scan_id, PrepareCounts::default(), 0, ""));
            return Err(err);
        }
    };
    let pdfs = collect_snapshot_pdfs(&snapshot.root);
    let total = pdfs.len() as u64;
    let mut counts = match counts_from_cache(state, scan_id, &pdfs) {
        Ok(counts) => counts,
        Err(err) => {
            on_progress(failed_progress(scan_id, PrepareCounts::default(), total, ""));
            return Err(err);
        }
    };

    let first_pending = first_pending_name(state, scan_id, &pdfs);
    on_progress(progress_payload(
        scan_id,
        total,
        counts,
        first_pending.as_deref().unwrap_or(""),
        ContentPrepareStatus::Running,
    ));

    for pdf in &pdfs {
        let already = match state.content_has_path(scan_id, &pdf.path) {
            Ok(already) => already,
            Err(err) => {
                on_progress(failed_progress(scan_id, counts, total, &pdf.name));
                return Err(err);
            }
        };
        if already {
            continue;
        }
        if cancel.load(Ordering::SeqCst) {
            let payload = progress_payload(
                scan_id,
                total,
                counts,
                &pdf.name,
                ContentPrepareStatus::Cancelled,
            );
            on_progress(payload.clone());
            return Ok(payload);
        }

        let entry = extract_path(Path::new(&pdf.path));
        if let Err(err) = state.insert_content_entry(scan_id, entry.clone()) {
            on_progress(failed_progress(scan_id, counts, total, &pdf.name));
            return Err(err);
        }
        counts.add(entry.status);
        on_progress(progress_payload(
            scan_id,
            total,
            counts,
            &pdf.name,
            ContentPrepareStatus::Running,
        ));
    }

    if let Err(err) = state.mark_content_complete(scan_id) {
        on_progress(failed_progress(scan_id, counts, total, ""));
        return Err(err);
    }

    let payload = progress_payload(
        scan_id,
        total,
        counts,
        "",
        ContentPrepareStatus::Completed,
    );
    on_progress(payload.clone());
    Ok(payload)
}

fn counts_from_cache(
    state: &AppState,
    scan_id: u64,
    pdfs: &[SnapshotPdf],
) -> Result<PrepareCounts, AppError> {
    state.with_content_cache(scan_id, |cache| count_cached(cache, pdfs))
}

fn count_cached(cache: &ContentCache, pdfs: &[SnapshotPdf]) -> PrepareCounts {
    let mut counts = PrepareCounts::default();
    for pdf in pdfs {
        if let Some(entry) = cache.entries.get(&pdf.path) {
            counts.add(entry.status);
        }
    }
    counts
}

fn first_pending_name(state: &AppState, scan_id: u64, pdfs: &[SnapshotPdf]) -> Option<String> {
    for pdf in pdfs {
        match state.content_has_path(scan_id, &pdf.path) {
            Ok(true) => continue,
            Ok(false) => return Some(pdf.name.clone()),
            Err(_) => return None,
        }
    }
    None
}

fn progress_payload(
    scan_id: u64,
    total: u64,
    counts: PrepareCounts,
    current_file_name: &str,
    status: ContentPrepareStatus,
) -> ContentProgress {
    ContentProgress {
        scan_id,
        total_pdf_count: total,
        processed_pdf_count: counts.processed,
        searchable_count: counts.searchable,
        no_text_count: counts.no_text,
        problem_count: counts.problem,
        current_file_name: current_file_name.to_string(),
        status,
    }
}

fn failed_progress(
    scan_id: u64,
    counts: PrepareCounts,
    total: u64,
    current_file_name: &str,
) -> ContentProgress {
    progress_payload(
        scan_id,
        total,
        counts,
        current_file_name,
        ContentPrepareStatus::Failed,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        collect_snapshot_pdfs, run_prepare_content, run_prepare_content_guarded, ContentPrepareStatus,
        SnapshotPdf,
    };
    use crate::content::{ContentEntry, ContentFormat, ContentStatus};
    use crate::error::AppErrorKind;
    use crate::model::{DirectoryListing, FsNode, ScanResult, ScanStats};
    use crate::state::AppState;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "kondos-e13-{}-{}-{}",
                label,
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .expect("clock")
                    .as_nanos()
            ));
            fs::create_dir_all(&path).expect("temp dir");
            Self { path }
        }

        fn write(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.path.join(name);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).expect("nested dir");
            }
            fs::write(&path, bytes).expect("write fixture");
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn dir(name: &str, path: &str, depth: u8, children: Vec<FsNode>) -> FsNode {
        FsNode::Directory {
            id: path.to_string(),
            name: name.to_string(),
            path: path.to_string(),
            depth,
            listing: DirectoryListing::Read,
            children,
            size_bytes: None,
            created_at_ms: None,
            modified_at_ms: None,
        }
    }

    fn file(name: &str, path: &Path, depth: u8) -> FsNode {
        let path = path.to_string_lossy().into_owned();
        FsNode::File {
            id: path.clone(),
            name: name.to_string(),
            path,
            depth,
            size_bytes: None,
            created_at_ms: None,
            modified_at_ms: None,
        }
    }

    fn empty_result() -> ScanResult {
        ScanResult {
            root: dir("/tmp/root", "/tmp/root", 0, Vec::new()),
            warnings: Vec::new(),
            stats: ScanStats::default(),
        }
    }

    fn result_from_root(root: FsNode) -> ScanResult {
        ScanResult {
            root,
            warnings: Vec::new(),
            stats: ScanStats::default(),
        }
    }

    fn escape_pdf_literal(text: &str) -> String {
        let mut out = String::new();
        for ch in text.chars() {
            match ch {
                '\\' => out.push_str("\\\\"),
                '(' => out.push_str("\\("),
                ')' => out.push_str("\\)"),
                '\n' => out.push_str("\\n"),
                '\r' => out.push_str("\\r"),
                '\t' => out.push_str("\\t"),
                c if c.is_ascii() && !c.is_ascii_control() => out.push(c),
                c => {
                    let code = c as u32;
                    assert!(code <= 0xFF, "test fixture only uses WinAnsi characters");
                    out.push_str(&format!("\\{code:03o}"));
                }
            }
        }
        out
    }

    fn assemble_pdf(content_stream: &str) -> Vec<u8> {
        let stream_bytes = content_stream.as_bytes();
        let objects = [
            "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n".to_string(),
            "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n".to_string(),
            "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n".to_string(),
            format!(
                "4 0 obj\n<< /Length {} >>\nstream\n{}endstream\nendobj\n",
                stream_bytes.len(),
                content_stream
            ),
            "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n"
                .to_string(),
        ];

        let header = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
        let mut body = Vec::from(*header);
        let mut offsets = vec![0_u32];
        for object in &objects {
            offsets.push(body.len() as u32);
            body.extend_from_slice(object.as_bytes());
        }
        let xref_at = body.len();
        let mut xref = format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len());
        for offset in offsets.iter().skip(1) {
            xref.push_str(&format!("{offset:010} 00000 n \n"));
        }
        xref.push_str(&format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n",
            offsets.len()
        ));
        body.extend_from_slice(xref.as_bytes());
        body
    }

    fn text_pdf(visible: &str) -> Vec<u8> {
        let content = format!(
            "BT /F1 12 Tf 72 720 Td ({}) Tj ET\n",
            escape_pdf_literal(visible)
        );
        assemble_pdf(&content)
    }

    fn empty_text_pdf() -> Vec<u8> {
        assemble_pdf("BT /F1 12 Tf 72 720 Td () Tj ET\n")
    }

    fn encrypted_pdf() -> Vec<u8> {
        let plain = text_pdf("Geheimtext");
        let mut doc = pdf_extract::Document::load_mem(&plain).expect("plain pdf");
        doc.trailer.set(
            b"ID",
            pdf_extract::Object::Array(vec![
                pdf_extract::Object::string_literal([0x11u8; 16]),
                pdf_extract::Object::string_literal([0x22u8; 16]),
            ]),
        );
        let state = pdf_extract::EncryptionState::try_from(pdf_extract::EncryptionVersion::V1 {
            document: &doc,
            owner_password: "owner-test",
            user_password: "user-test",
            permissions: pdf_extract::Permissions::empty(),
        })
        .expect("encryption state");
        doc.encrypt(&state).expect("encrypt");
        let mut out = Vec::new();
        doc.save_to(&mut out).expect("save encrypted");
        out
    }

    fn status_of(state: &AppState, scan_id: u64, path: &Path) -> ContentStatus {
        let path = path.to_string_lossy().into_owned();
        state
            .content_cache_for(scan_id)
            .expect("cache")
            .entries
            .get(&path)
            .expect("entry")
            .status
    }

    fn record_progress() -> (
        Arc<Mutex<Vec<crate::content::ContentProgress>>>,
        impl FnMut(crate::content::ContentProgress),
    ) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        (
            Arc::clone(&events),
            move |progress: crate::content::ContentProgress| {
                sink.lock().expect("progress lock").push(progress);
            },
        )
    }

    #[test]
    fn collect_uses_snapshot_child_order_and_skips_non_pdf() {
        let root = dir(
            "root",
            "C:\\root",
            0,
            vec![
                file("z.pdf", Path::new("C:\\root\\z.pdf"), 1),
                dir(
                    "sub",
                    "C:\\root\\sub",
                    1,
                    vec![file("a.PDF", Path::new("C:\\root\\sub\\a.PDF"), 2)],
                ),
                file("notes.txt", Path::new("C:\\root\\notes.txt"), 1),
                file("m.pdf", Path::new("C:\\root\\m.pdf"), 1),
                file("table.xlsx", Path::new("C:\\root\\table.xlsx"), 1),
            ],
        );
        let pdfs = collect_snapshot_pdfs(&root);
        assert_eq!(
            pdfs.iter().map(|pdf| pdf.name.as_str()).collect::<Vec<_>>(),
            vec!["z.pdf", "a.PDF", "m.pdf"]
        );
    }

    #[test]
    fn snapshot_without_pdfs_completes() {
        let state = AppState::new();
        state.store_snapshot(1, empty_result());
        let (events, on_progress) = record_progress();
        let progress = run_prepare_content_guarded(&state, 1, on_progress).expect("empty prepare");
        assert_eq!(progress.status, ContentPrepareStatus::Completed);
        assert_eq!(progress.total_pdf_count, 0);
        assert_eq!(progress.processed_pdf_count, 0);
        assert!(state.content_cache_for(1).expect("cache").complete);
        assert!(!state.is_preparing_content());
        assert!(!state.is_close_blocked());
        let events = events.lock().expect("events");
        assert_eq!(events.first().map(|e| e.status), Some(ContentPrepareStatus::Running));
        assert_eq!(events.last().map(|e| e.status), Some(ContentPrepareStatus::Completed));
    }

    #[test]
    fn prepares_all_pdfs_case_insensitive_and_ignores_other_files() {
        let tmp = TempDir::new("all");
        let searchable = tmp.write("a.pdf", &text_pdf("Alpha"));
        let upper = tmp.write("B.PDF", &text_pdf("Beta"));
        let notes = tmp.write("notes.txt", b"not a pdf");
        let xlsx = tmp.write("sheet.xlsx", b"xlsx");
        let root = dir(
            "root",
            &tmp.path.to_string_lossy(),
            0,
            vec![
                file("a.pdf", &searchable, 1),
                file("B.PDF", &upper, 1),
                file("notes.txt", &notes, 1),
                file("sheet.xlsx", &xlsx, 1),
            ],
        );
        let state = AppState::new();
        state.store_snapshot(4, result_from_root(root));
        let progress = run_prepare_content_guarded(&state, 4, |_| {}).expect("prepare");
        assert_eq!(progress.status, ContentPrepareStatus::Completed);
        assert_eq!(progress.total_pdf_count, 2);
        assert_eq!(progress.processed_pdf_count, 2);
        assert_eq!(progress.searchable_count, 2);
        let cache = state.content_cache_for(4).expect("cache");
        assert!(cache.complete);
        assert_eq!(cache.entries.len(), 2);
        assert!(!cache.entries.contains_key(&notes.to_string_lossy().into_owned()));
        assert_eq!(status_of(&state, 4, &searchable), ContentStatus::Searchable);
        assert_eq!(status_of(&state, 4, &upper), ContentStatus::Searchable);
        assert!(!state.is_close_blocked());
    }

    #[test]
    fn skips_existing_cache_entries_and_resumes_missing() {
        let tmp = TempDir::new("resume");
        let first = tmp.write("one.pdf", &text_pdf("one"));
        let second = tmp.write("two.pdf", &text_pdf("two"));
        let third = tmp.write("three.pdf", &text_pdf("three"));
        let root = dir(
            "root",
            &tmp.path.to_string_lossy(),
            0,
            vec![
                file("one.pdf", &first, 1),
                file("two.pdf", &second, 1),
                file("three.pdf", &third, 1),
            ],
        );
        let state = AppState::new();
        state.store_snapshot(2, result_from_root(root));
        let seeded = ContentEntry {
            path: first.to_string_lossy().into_owned(),
            name: "one.pdf".into(),
            format: ContentFormat::Pdf,
            status: ContentStatus::Searchable,
            text: Some("SEEDED".into()),
            extracted_chars: 6,
            truncated: false,
        };
        state.insert_content_entry(2, seeded).expect("seed");

        let (events, on_progress) = record_progress();
        let progress = run_prepare_content_guarded(&state, 2, on_progress).expect("resume");
        assert_eq!(progress.status, ContentPrepareStatus::Completed);
        assert_eq!(progress.total_pdf_count, 3);
        assert_eq!(progress.processed_pdf_count, 3);
        assert_eq!(progress.searchable_count, 3);
        let cache = state.content_cache_for(2).expect("cache");
        assert_eq!(
            cache
                .entries
                .get(&first.to_string_lossy().into_owned())
                .expect("seeded")
                .text
                .as_deref(),
            Some("SEEDED")
        );
        assert!(cache
            .entries
            .get(&second.to_string_lossy().into_owned())
            .is_some());
        assert!(cache
            .entries
            .get(&third.to_string_lossy().into_owned())
            .is_some());
        let start = events.lock().expect("events")[0].clone();
        assert_eq!(start.processed_pdf_count, 1);
        assert_eq!(start.total_pdf_count, 3);
        assert_eq!(start.status, ContentPrepareStatus::Running);
    }

    #[test]
    fn counters_group_searchable_no_text_and_problems_and_continue() {
        let tmp = TempDir::new("counts");
        let searchable = tmp.write("ok.pdf", &text_pdf("Inhalt"));
        let empty = tmp.write("empty.pdf", &empty_text_pdf());
        let broken = tmp.write("bad.pdf", b"%PDF-1.4\nnot a real document");
        let protected = tmp.write("secret.pdf", &encrypted_pdf());
        let missing = tmp.path.join("gone.pdf");
        let too_large_path = tmp.write("huge.pdf", &text_pdf("tiny stand-in"));
        let root = dir(
            "root",
            &tmp.path.to_string_lossy(),
            0,
            vec![
                file("ok.pdf", &searchable, 1),
                file("empty.pdf", &empty, 1),
                file("bad.pdf", &broken, 1),
                file("secret.pdf", &protected, 1),
                file("gone.pdf", &missing, 1),
                file("huge.pdf", &too_large_path, 1),
            ],
        );
        let state = AppState::new();
        state.store_snapshot(8, result_from_root(root));
        state
            .insert_content_entry(
                8,
                ContentEntry::new(
                    too_large_path.to_string_lossy(),
                    "huge.pdf",
                    ContentFormat::Pdf,
                    ContentStatus::TooLarge,
                ),
            )
            .expect("seed too large");

        let progress = run_prepare_content_guarded(&state, 8, |_| {}).expect("mixed");
        assert_eq!(progress.status, ContentPrepareStatus::Completed);
        assert_eq!(progress.total_pdf_count, 6);
        assert_eq!(progress.processed_pdf_count, 6);
        assert_eq!(progress.searchable_count, 1);
        assert_eq!(progress.no_text_count, 1);
        assert_eq!(progress.problem_count, 4);
        assert_eq!(status_of(&state, 8, &searchable), ContentStatus::Searchable);
        assert_eq!(status_of(&state, 8, &empty), ContentStatus::NoExtractableText);
        assert_eq!(status_of(&state, 8, &broken), ContentStatus::ParseError);
        assert_eq!(status_of(&state, 8, &protected), ContentStatus::Protected);
        assert_eq!(status_of(&state, 8, &missing), ContentStatus::Missing);
        assert_eq!(status_of(&state, 8, &too_large_path), ContentStatus::TooLarge);
        assert!(state.content_cache_for(8).expect("cache").complete);
    }

    #[test]
    fn cancel_finishes_current_pdf_and_keeps_partial_cache() {
        let tmp = TempDir::new("cancel");
        let first = tmp.write("one.pdf", &text_pdf("one"));
        let second = tmp.write("two.pdf", &text_pdf("two"));
        let third = tmp.write("three.pdf", &text_pdf("three"));
        let root = dir(
            "root",
            &tmp.path.to_string_lossy(),
            0,
            vec![
                file("one.pdf", &first, 1),
                file("two.pdf", &second, 1),
                file("three.pdf", &third, 1),
            ],
        );
        let state = AppState::new();
        state.store_snapshot(5, result_from_root(root));
        let guard = state.try_begin_prepare(5).expect("prepare");
        assert!(state.is_close_blocked());
        let cancel = guard.cancel_flag();
        let progress = run_prepare_content(&state, 5, &cancel, |progress| {
            if progress.status == ContentPrepareStatus::Running && progress.processed_pdf_count >= 1
            {
                state.request_cancel_prepare(5);
            }
        })
        .expect("cancelled run");
        drop(guard);

        assert_eq!(progress.status, ContentPrepareStatus::Cancelled);
        assert!(progress.processed_pdf_count >= 1);
        assert!(progress.processed_pdf_count < 3);
        let cache = state.content_cache_for(5).expect("partial");
        assert!(!cache.complete);
        assert!(cache
            .entries
            .contains_key(&first.to_string_lossy().into_owned()));
        assert!(!cache
            .entries
            .contains_key(&third.to_string_lossy().into_owned()));
        assert!(!state.is_preparing_content());
        assert!(!state.is_close_blocked());
    }

    #[test]
    fn resume_after_cancel_skips_done_and_completes() {
        let tmp = TempDir::new("resume-cancel");
        let first = tmp.write("one.pdf", &text_pdf("one"));
        let second = tmp.write("two.pdf", &text_pdf("two"));
        let third = tmp.write("three.pdf", &text_pdf("three"));
        let root = dir(
            "root",
            &tmp.path.to_string_lossy(),
            0,
            vec![
                file("one.pdf", &first, 1),
                file("two.pdf", &second, 1),
                file("three.pdf", &third, 1),
            ],
        );
        let state = AppState::new();
        state.store_snapshot(6, result_from_root(root));
        {
            let guard = state.try_begin_prepare(6).expect("first");
            let cancel = guard.cancel_flag();
            let _ = run_prepare_content(&state, 6, &cancel, |progress| {
                if progress.processed_pdf_count >= 1 {
                    state.request_cancel_prepare(6);
                }
            })
            .expect("cancel");
        }
        let before = state.content_cache_for(6).expect("partial");
        assert!(!before.complete);
        let done_before = before.entries.len();
        assert!(done_before >= 1);

        let (events, on_progress) = record_progress();
        let progress = run_prepare_content_guarded(&state, 6, on_progress).expect("resume");
        assert_eq!(progress.status, ContentPrepareStatus::Completed);
        assert_eq!(progress.processed_pdf_count, 3);
        assert!(state.content_cache_for(6).expect("done").complete);
        let start = events.lock().expect("events")[0].clone();
        assert_eq!(start.processed_pdf_count, done_before as u64);
        assert_eq!(start.total_pdf_count, 3);
    }

    #[test]
    fn stale_cancel_does_not_hit_new_run() {
        let tmp = TempDir::new("stale-cancel");
        let only = tmp.write("only.pdf", &text_pdf("only"));
        let root = dir(
            "root",
            &tmp.path.to_string_lossy(),
            0,
            vec![file("only.pdf", &only, 1)],
        );
        let state = AppState::new();
        state.store_snapshot(7, result_from_root(root));
        {
            let guard = state.try_begin_prepare(7).expect("old");
            state.request_cancel_prepare(7);
            assert!(guard.cancel_flag().load(Ordering::SeqCst));
        }
        state.request_cancel_prepare(7);
        let guard = state.try_begin_prepare(7).expect("new");
        assert!(!guard.cancel_flag().load(Ordering::SeqCst));
        state.request_cancel_prepare(99);
        assert!(!guard.cancel_flag().load(Ordering::SeqCst));
        let progress = run_prepare_content(&state, 7, &guard.cancel_flag(), |_| {}).expect("run");
        drop(guard);
        assert_eq!(progress.status, ContentPrepareStatus::Completed);
        assert!(state.content_cache_for(7).expect("cache").complete);
    }

    #[test]
    fn wrong_scan_id_fails_closed() {
        let state = AppState::new();
        state.store_snapshot(3, empty_result());
        match run_prepare_content_guarded(&state, 9, |_| {}) {
            Ok(_) => panic!("stale scanId must fail"),
            Err(err) => assert_eq!(err.kind, AppErrorKind::InvalidConfig),
        }
        assert!(!state.is_preparing_content());
        assert!(!state.content_cache_for(3).expect("untouched").complete);
    }

    #[test]
    fn preparing_blocks_scan_and_export_scan_and_export_block_prepare() {
        let tmp = TempDir::new("occ");
        let pdf = tmp.write("a.pdf", &text_pdf("a"));
        let root = dir(
            "root",
            &tmp.path.to_string_lossy(),
            0,
            vec![file("a.pdf", &pdf, 1)],
        );
        let state = AppState::new();
        state.store_snapshot(11, result_from_root(root));

        let _ = run_prepare_content_guarded(&state, 11, |progress| {
            if progress.status == ContentPrepareStatus::Running {
                assert!(state.is_close_blocked());
                assert!(state.try_begin_scan(12).is_err());
                assert!(state.try_begin_export(11).is_err());
            }
        })
        .expect("prepare");
        assert!(!state.is_close_blocked());

        let _scan = state.try_begin_scan(12).expect("scan");
        assert!(state.try_begin_prepare(12).is_err());
        drop(_scan);

        state.store_snapshot(13, empty_result());
        let _export = state.try_begin_export(13).expect("export");
        assert!(state.try_begin_prepare(13).is_err());
    }

    #[test]
    fn stale_run_cannot_write_newer_cache_or_complete() {
        let tmp = TempDir::new("stale-write");
        let first = tmp.write("one.pdf", &text_pdf("one"));
        let second = tmp.write("two.pdf", &text_pdf("two"));
        let root = dir(
            "root",
            &tmp.path.to_string_lossy(),
            0,
            vec![
                file("one.pdf", &first, 1),
                file("two.pdf", &second, 1),
            ],
        );
        let state = AppState::new();
        state.store_snapshot(1, result_from_root(root));
        let guard = state.try_begin_prepare(1).expect("A");
        let result = run_prepare_content(&state, 1, &guard.cancel_flag(), |progress| {
            if progress.processed_pdf_count >= 1 {
                state.store_snapshot(2, empty_result());
            }
        });
        drop(guard);
        assert!(result.is_err());
        assert!(!state.is_preparing_content());
        let cache_b = state.content_cache_for(2).expect("cache B");
        assert!(!cache_b.complete);
        assert!(cache_b.entries.is_empty());
        assert!(state.content_cache_for(1).is_err());
    }

    #[test]
    fn guard_releases_occupancy_on_command_error() {
        let state = AppState::new();
        state.store_snapshot(1, empty_result());
        let result = {
            let guard = state.try_begin_prepare(1).expect("occupy");
            assert!(state.is_close_blocked());
            state.store_snapshot(2, empty_result());
            let outcome = run_prepare_content(&state, 1, &guard.cancel_flag(), |_| {});
            assert!(outcome.is_err());
            outcome
        };
        assert!(result.is_err());
        assert!(!state.is_preparing_content());
        assert!(!state.is_close_blocked());
    }

    #[test]
    fn command_near_blocking_thread_completes_and_releases_occupancy() {
        let tmp = TempDir::new("thread");
        let pdf = tmp.write("a.pdf", &text_pdf("thread"));
        let root = dir(
            "root",
            &tmp.path.to_string_lossy(),
            0,
            vec![file("a.pdf", &pdf, 1)],
        );
        let state = AppState::new();
        state.store_snapshot(21, result_from_root(root));
        let guard = state.try_begin_prepare(21).expect("occupy");
        let cancel = guard.cancel_flag();
        let outcome = std::thread::scope(|scope| {
            scope
                .spawn(|| run_prepare_content(&state, 21, &cancel, |_| {}))
                .join()
                .expect("join")
        });
        drop(guard);
        let progress = outcome.expect("prepare");
        assert_eq!(progress.status, ContentPrepareStatus::Completed);
        assert!(state.content_cache_for(21).expect("cache").complete);
        assert!(!state.is_preparing_content());
        assert!(!state.is_close_blocked());
    }

    #[test]
    fn collect_snapshot_pdf_struct_matches_paths() {
        let pdfs = collect_snapshot_pdfs(&dir(
            "root",
            "R",
            0,
            vec![file("doc.pdf", Path::new("R\\doc.pdf"), 1)],
        ));
        assert_eq!(
            pdfs,
            vec![SnapshotPdf {
                id: "R\\doc.pdf".into(),
                path: "R\\doc.pdf".into(),
                name: "doc.pdf".into(),
            }]
        );
    }

    #[test]
    fn never_started_cancel_flag_does_not_extract() {
        let tmp = TempDir::new("pre-cancel");
        let first = tmp.write("one.pdf", &text_pdf("one"));
        let second = tmp.write("two.pdf", &text_pdf("two"));
        let root = dir(
            "root",
            &tmp.path.to_string_lossy(),
            0,
            vec![
                file("one.pdf", &first, 1),
                file("two.pdf", &second, 1),
            ],
        );
        let state = AppState::new();
        state.store_snapshot(30, result_from_root(root));
        let cancel = AtomicBool::new(true);
        let progress = run_prepare_content(&state, 30, &cancel, |_| {}).expect("pre-cancelled");
        assert_eq!(progress.status, ContentPrepareStatus::Cancelled);
        assert_eq!(progress.processed_pdf_count, 0);
        assert!(!state.content_cache_for(30).expect("empty").complete);
        assert!(state.content_cache_for(30).expect("empty").entries.is_empty());
    }
}
