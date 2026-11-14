//! Single-file text inspect for name suggestions. Reuses `extract_path` and the session cache.
//! Read-only. Does not write files, does not run the bulk prepare pipeline, and does not guess dates.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::format::content_format_from_name;
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
}

pub fn inspect_document_text(
    state: &AppState,
    scan_id: u64,
    node_id: &str,
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

    if content_format_from_name(&name).is_none() {
        return Ok(DocumentTextView {
            scan_id,
            path,
            name,
            format: None,
            status: "unsupported".into(),
            text: None,
            source: "none".into(),
        });
    }

    let cached = state
        .with_content_cache(scan_id, |cache| cache.entries.get(&path).cloned())
        .ok()
        .flatten();
    if let Some(entry) = cached {
        return Ok(view_from_entry(scan_id, entry, "cache"));
    }

    let entry = extract_path(Path::new(&path));
    Ok(view_from_entry(scan_id, entry, "extract"))
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

fn view_from_entry(scan_id: u64, entry: ContentEntry, source: &str) -> DocumentTextView {
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
    let format = match entry.format {
        ContentFormat::Pdf => "pdf",
        ContentFormat::Docx => "docx",
        ContentFormat::Xlsx => "xlsx",
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
        format: Some(format.into()),
        status: status.into(),
        text,
        source: source.into(),
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
    }
}
