//! Single-file text inspect for name suggestions. Reuses `extract_path` and the session cache.
//! Read-only. Does not write files, does not run the bulk prepare pipeline, and does not guess dates.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::format::content_format_from_name;
use super::ocr::{ocr_file, should_try_ocr, text_layer_is_usable, OcrError, OcrProgress};
use super::{extract_path, ContentEntry, ContentFormat, ContentStatus};
use crate::error::AppError;
use crate::model::FsNode;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTextView {
    pub scan_id: u64,
    pub path: String,
    pub name: String,
    pub format: Option<String>,
    pub status: String,
    pub text: Option<String>,
    pub source: String,
    pub ocr_attempted: bool,
    pub message: Option<String>,
}

pub fn inspect_document_text(
    state: &AppState,
    scan_id: u64,
    node_id: &str,
) -> Result<DocumentTextView, AppError> {
    inspect_document_text_with_progress(state, scan_id, node_id, |_| {})
}

pub fn inspect_document_text_with_progress(
    state: &AppState,
    scan_id: u64,
    node_id: &str,
    mut on_progress: impl FnMut(OcrProgress),
) -> Result<DocumentTextView, AppError> {
    state.ensure_content_search_allowed()?;
    let snapshot = state.snapshot_for_content(scan_id)?;
    let Some(node) = find_snapshot_node(&snapshot.root, node_id) else {
        return Err(AppError::invalid_config(
            "Die ausgewählte Datei ist im aktuellen Ergebnis nicht enthalten.",
        ));
    };
    let (path, name) = match node {
        FsNode::File { path, name, .. } => (path.clone(), name.clone()),
        FsNode::Directory { .. } => {
            return Err(AppError::invalid_config(
                "Namensvorschläge gibt es nur für einzelne Dateien.",
            ));
        }
    };

    let Some(format) = content_format_from_name(&name) else {
        return Ok(empty_view(
            scan_id,
            path,
            name,
            None,
            "unsupported",
            "none",
            false,
            Some("Dieser Dateityp kann aktuell nicht zuverlässig ausgelesen werden.".into()),
        ));
    };

    let cached = state
        .with_content_cache(scan_id, |cache| cache.entries.get(&path).cloned())
        .ok()
        .flatten();
    if let Some(entry) = cached.as_ref() {
        if entry.status == ContentStatus::Searchable && text_layer_is_usable(entry.text.as_deref().unwrap_or("")) {
            return Ok(view_from_entry(scan_id, entry.clone(), "cache", false, None));
        }
        if !should_try_ocr(format, entry.status, entry.text.as_deref()) {
            return Ok(view_from_entry(scan_id, entry.clone(), "cache", false, None));
        }
    }

    if matches!(format, ContentFormat::Docx | ContentFormat::Xlsx) {
        if let Some(entry) = cached {
            return Ok(view_from_entry(scan_id, entry, "cache", false, None));
        }
        let entry = extract_path(Path::new(&path));
        return Ok(view_from_entry(scan_id, entry, "extract", false, None));
    }

    if matches!(format, ContentFormat::Pdf) {
        let entry = match cached {
            Some(entry) if entry.status == ContentStatus::Searchable => entry,
            Some(entry) if matches!(entry.status, ContentStatus::NoExtractableText | ContentStatus::ParseError) => {
                entry
            }
            Some(_) | None => extract_path(Path::new(&path)),
        };
        if entry.status == ContentStatus::Searchable
            && text_layer_is_usable(entry.text.as_deref().unwrap_or(""))
        {
            return Ok(view_from_entry(scan_id, entry, "extract", false, None));
        }
        if !should_try_ocr(format, entry.status, entry.text.as_deref()) {
            return Ok(view_from_entry(scan_id, entry, "extract", false, None));
        }
        return Ok(run_ocr(state, scan_id, entry, &mut on_progress));
    }

    let seed = cached.unwrap_or_else(|| ContentEntry {
        path: path.clone(),
        name: name.clone(),
        format,
        status: ContentStatus::NoExtractableText,
        text: None,
        extracted_chars: 0,
        truncated: false,
    });
    Ok(run_ocr(state, scan_id, seed, &mut on_progress))
}

fn run_ocr(
    state: &AppState,
    scan_id: u64,
    seed: ContentEntry,
    on_progress: &mut dyn FnMut(OcrProgress),
) -> DocumentTextView {
    match ocr_file(Path::new(&seed.path), seed.format, scan_id, on_progress) {
        Ok(ocr) => {
            let mut entry = seed;
            entry.status = ContentStatus::Searchable;
            entry.text = Some(ocr.text.clone());
            entry.extracted_chars = ocr.text.chars().count();
            let _ = state.insert_content_entry(scan_id, entry.clone());
            view_from_entry(
                scan_id,
                entry,
                "ocr",
                true,
                Some("Text stammt aus lokaler Texterkennung und wurde nicht als zweifelsfrei übernommen.".into()),
            )
        }
        Err(OcrError::Empty) => view_from_entry(
            scan_id,
            seed,
            "ocr",
            true,
            Some("Die Texterkennung hat keinen Text gefunden.".into()),
        ),
        Err(err) => {
            let message = err.user_message();
            let status = match err {
                OcrError::Unavailable(_) => "ocrUnavailable",
                _ => "ocrFailed",
            };
            DocumentTextView {
                scan_id,
                format: Some(format_label(seed.format).into()),
                path: seed.path,
                name: seed.name,
                status: status.into(),
                text: None,
                source: "ocr".into(),
                ocr_attempted: true,
                message: Some(message),
            }
        }
    }
}

fn find_snapshot_node<'a>(node: &'a FsNode, node_id: &str) -> Option<&'a FsNode> {
    match node {
        FsNode::File { id, .. } if id == node_id => Some(node),
        FsNode::Directory { id, children, .. } => {
            if id == node_id {
                return Some(node);
            }
            children.iter().find_map(|child| find_snapshot_node(child, node_id))
        }
        FsNode::File { .. } => None,
    }
}

fn format_label(format: ContentFormat) -> &'static str {
    match format {
        ContentFormat::Pdf => "pdf",
        ContentFormat::Docx => "docx",
        ContentFormat::Xlsx => "xlsx",
        ContentFormat::Png => "png",
        ContentFormat::Jpeg => "jpeg",
    }
}

fn empty_view(
    scan_id: u64,
    path: String,
    name: String,
    format: Option<String>,
    status: &str,
    source: &str,
    ocr_attempted: bool,
    message: Option<String>,
) -> DocumentTextView {
    DocumentTextView {
        scan_id,
        path,
        name,
        format,
        status: status.into(),
        text: None,
        source: source.into(),
        ocr_attempted,
        message,
    }
}

fn view_from_entry(
    scan_id: u64,
    entry: ContentEntry,
    source: &str,
    ocr_attempted: bool,
    message: Option<String>,
) -> DocumentTextView {
    let status = match entry.status {
        ContentStatus::Searchable => "searchable",
        ContentStatus::NoExtractableText => "noExtractableText",
        ContentStatus::Protected => "protected",
        ContentStatus::ParseError => "parseError",
        ContentStatus::Missing => "missing",
        ContentStatus::AccessDenied => "accessDenied",
        ContentStatus::IoError => "ioError",
        ContentStatus::TooLarge => "tooLarge",
    };
    let text = if entry.status == ContentStatus::Searchable {
        entry.text
    } else {
        None
    };
    DocumentTextView {
        scan_id,
        path: entry.path,
        name: entry.name,
        format: Some(format_label(entry.format).into()),
        status: status.into(),
        text,
        source: source.into(),
        ocr_attempted,
        message,
    }
}

#[cfg(test)]
mod tests {
    use super::inspect_document_text;
    use crate::content::{ContentEntry, ContentFormat, ContentStatus};
    use crate::error::AppErrorKind;
    use crate::model::{DirectoryListing, FsNode, ScanResult, ScanStats};
    use crate::state::AppState;

    fn file_result(id: &str, name: &str, path: &str) -> ScanResult {
        ScanResult {
            root: FsNode::Directory {
                id: "C:\\root".into(),
                name: "root".into(),
                path: "C:\\root".into(),
                depth: 0,
                listing: DirectoryListing::Read,
                children: vec![FsNode::File {
                    id: id.into(),
                    name: name.into(),
                    path: path.into(),
                    depth: 1,
                    size_bytes: Some(12),
                    created_at_ms: None,
                    modified_at_ms: None,
                }],
                size_bytes: None,
                created_at_ms: None,
                modified_at_ms: None,
            },
            warnings: Vec::new(),
            stats: ScanStats::default(),
        }
    }

    #[test]
    fn unsupported_extension_is_not_extracted() {
        let state = AppState::new();
        state.store_snapshot(1, file_result("C:\\root\\notiz.txt", "notiz.txt", "C:\\root\\notiz.txt"));
        let view = inspect_document_text(&state, 1, "C:\\root\\notiz.txt").expect("txt");
        assert_eq!(view.status, "unsupported");
        assert_eq!(view.source, "none");
        assert_eq!(view.format, None);
        assert_eq!(view.text, None);
        assert!(!view.ocr_attempted);
    }

    #[test]
    fn directory_is_rejected() {
        let state = AppState::new();
        state.store_snapshot(2, file_result("C:\\root\\a.pdf", "a.pdf", "C:\\root\\a.pdf"));
        match inspect_document_text(&state, 2, "C:\\root") {
            Ok(_) => panic!("directory must fail"),
            Err(err) => assert_eq!(err.kind, AppErrorKind::InvalidConfig),
        }
    }

    #[test]
    fn cache_text_is_reused_without_inventing_a_date() {
        let state = AppState::new();
        let path = "C:\\root\\Rechnung.pdf";
        state.store_snapshot(3, file_result(path, "Rechnung.pdf", path));
        let mut entry = ContentEntry::new(path, "Rechnung.pdf", ContentFormat::Pdf, ContentStatus::Searchable);
        entry.text = Some("Rechnungsdatum 28.10.2026\nZahlungsziel 11.11.2026".into());
        state.insert_content_entry(3, entry).expect("cache");
        let view = inspect_document_text(&state, 3, path).expect("cached");
        assert_eq!(view.source, "cache");
        assert_eq!(view.status, "searchable");
        assert_eq!(view.format.as_deref(), Some("pdf"));
        assert!(!view.ocr_attempted, "usable cached text does not start OCR");
        assert!(view.text.as_ref().is_some_and(|text| text.contains("Rechnungsdatum 28.10.2026")));
    }

    #[test]
    fn occupancy_blocks_inspect() {
        let state = AppState::new();
        state.store_snapshot(4, file_result("C:\\root\\a.pdf", "a.pdf", "C:\\root\\a.pdf"));
        let _export = state.try_begin_export(4).expect("export");
        match inspect_document_text(&state, 4, "C:\\root\\a.pdf") {
            Ok(_) => panic!("busy occupancy must block"),
            Err(err) => assert_eq!(err.kind, AppErrorKind::InvalidConfig),
        }
    }

    #[test]
    fn missing_pdf_does_not_invent_text() {
        let state = AppState::new();
        let path = "C:\\root\\fehlt.pdf";
        state.store_snapshot(5, file_result(path, "fehlt.pdf", path));
        let view = inspect_document_text(&state, 5, path).expect("missing file");
        assert_eq!(view.source, "extract");
        assert_eq!(view.status, "missing");
        assert_eq!(view.text, None);
        assert!(!view.ocr_attempted);
    }

    #[test]
    fn png_is_not_treated_as_unsupported() {
        let state = AppState::new();
        let path = "C:\\root\\scan.png";
        state.store_snapshot(6, file_result(path, "scan.png", path));
        let view = inspect_document_text(&state, 6, path).expect("png");
        assert_eq!(view.format.as_deref(), Some("png"));
        assert_ne!(view.status, "unsupported");
        assert!(view.ocr_attempted);
    }

    fn original_word_jpeg_fixture() -> String {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("testdata")
            .join("ocr")
            .join("original-word-jpg-771x320.jpg")
            .to_string_lossy()
            .into_owned()
    }

    #[test]
    fn live_inspect_original_word_jpeg_then_cache() {
        let path = original_word_jpeg_fixture();
        assert!(std::path::Path::new(&path).is_file(), "original jpeg fixture missing: {path}");
        let name = "original-word-jpg-771x320.jpg";
        let state = AppState::new();
        state.store_snapshot(9, file_result(&path, name, &path));
        let first = inspect_document_text(&state, 9, &path).expect("first inspect");
        eprintln!(
            "P2-L.9a INSPECT1 source={} status={} ocr_attempted={} format={:?} text={:?}",
            first.source, first.status, first.ocr_attempted, first.format, first.text
        );
        let second = inspect_document_text(&state, 9, &path).expect("second inspect");
        eprintln!(
            "P2-L.9a INSPECT2 source={} status={} ocr_attempted={} format={:?} text={:?}",
            second.source, second.status, second.ocr_attempted, second.format, second.text
        );
        assert_eq!(first.source, "ocr");
        assert_eq!(first.status, "searchable");
        assert!(first.ocr_attempted);
        assert_eq!(second.source, "cache");
        assert_eq!(second.status, "searchable");
        assert!(!second.ocr_attempted, "usable OCR cache must skip a second OCR");
        assert_eq!(first.text, second.text);
    }
}
