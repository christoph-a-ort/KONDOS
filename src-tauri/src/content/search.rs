use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use super::prepare::collect_snapshot_content_files;
use super::{ContentCache, ContentEntry, ContentFormat, ContentStatus};
use crate::error::AppError;
use crate::scan::cmp_name_then_path;
use crate::state::AppState;

/// Maximale Anzahl Dokumenttreffer über IPC.
pub const MAX_CONTENT_SEARCH_HITS: usize = 200;

/// Zielgröße des Anzeige-Snippets in Unicode-Skalarwerten, ohne Ellipsen.
const SNIPPET_TARGET_CHARS: usize = 160;
/// Ursprungsfenster um den Anker-Treffer, bevor Whitespace normalisiert wird.
const SNIPPET_WINDOW_CHARS: usize = 200;
const WORD_BOUNDARY_SLACK: usize = 24;

/// Inclusive `start`, exclusive `end`, gemessen in UTF-16-Code-Units von `snippet`.
/// Entspricht `String.prototype.substring` in JavaScript/React.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HighlightRange {
    pub start: u32,
    pub end: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchHit {
    pub node_id: String,
    pub path: String,
    pub name: String,
    pub format: ContentFormat,
    /// Summe nicht überlappender Teilstring-Vorkommen aller deduplizierten
    /// Suchbegriffe. Keine Phrasenanzahl.
    pub match_count: u64,
    pub snippet: String,
    pub highlights: Vec<HighlightRange>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchResult {
    pub scan_id: u64,
    pub query: String,
    pub cache_complete: bool,
    pub processed_document_count: u64,
    pub total_document_count: u64,
    pub total_hit_count: u64,
    pub returned_hit_count: u64,
    pub hits: Vec<ContentSearchHit>,
}

/// Inhaltssuche ausschließlich über den sitzungsbezogenen ContentCache.
/// Öffnet keine Dokumentdateien.
pub fn search_file_content(
    state: &AppState,
    scan_id: u64,
    query: &str,
) -> Result<ContentSearchResult, AppError> {
    state.ensure_content_search_allowed()?;
    let snapshot = state.snapshot_for_content(scan_id)?;
    let documents = collect_snapshot_content_files(&snapshot.root);
    let total_document_count = documents.len() as u64;
    let terms = parse_query_terms(query);

    state.with_content_cache(scan_id, |cache| {
        let processed_document_count = documents
            .iter()
            .filter(|document| cache.entries.contains_key(&document.path))
            .count() as u64;
        let mut result = ContentSearchResult {
            scan_id,
            query: query.to_string(),
            cache_complete: cache.complete,
            processed_document_count,
            total_document_count,
            total_hit_count: 0,
            returned_hit_count: 0,
            hits: Vec::new(),
        };
        if terms.is_empty() {
            return result;
        }
        let node_id_by_path: HashMap<&str, &str> = documents
            .iter()
            .map(|document| (document.path.as_str(), document.id.as_str()))
            .collect();
        result.hits = collect_hits(cache, &terms, &node_id_by_path);
        result.total_hit_count = result.hits.len() as u64;
        if result.hits.len() > MAX_CONTENT_SEARCH_HITS {
            result.hits.truncate(MAX_CONTENT_SEARCH_HITS);
        }
        result.returned_hit_count = result.hits.len() as u64;
        result
    })
}

fn parse_query_terms(query: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let mut seen = HashSet::new();
    for part in query.split_whitespace() {
        let folded = fold_case(part);
        if folded.is_empty() {
            continue;
        }
        if seen.insert(folded.clone()) {
            terms.push(folded);
        }
    }
    terms
}

fn fold_case(text: &str) -> String {
    text.chars().flat_map(char::to_lowercase).collect()
}

fn collect_hits(
    cache: &ContentCache,
    terms: &[String],
    node_id_by_path: &HashMap<&str, &str>,
) -> Vec<ContentSearchHit> {
    let mut hits = Vec::new();
    for entry in cache.entries.values() {
        if let Some(hit) = hit_from_entry(entry, terms, node_id_by_path) {
            hits.push(hit);
        }
    }
    hits.sort_by(|left, right| {
        cmp_name_then_path(&left.name, &left.path, &right.name, &right.path)
    });
    hits
}

fn hit_from_entry(
    entry: &ContentEntry,
    terms: &[String],
    node_id_by_path: &HashMap<&str, &str>,
) -> Option<ContentSearchHit> {
    if entry.status != ContentStatus::Searchable {
        return None;
    }
    let text = entry.text.as_deref()?;
    let (folded, orig_of_folded) = fold_with_map(text);
    if !terms.iter().all(|term| term_occurs(&folded, term)) {
        return None;
    }
    let match_count = terms
        .iter()
        .map(|term| count_nonoverlapping(&folded, term))
        .sum();
    let anchor = leftmost_term_range(&folded, &orig_of_folded, terms)?;
    let (snippet, highlights) = build_snippet(text, &anchor, terms);
    let node_id = node_id_by_path
        .get(entry.path.as_str())
        .copied()
        .unwrap_or(entry.path.as_str())
        .to_string();
    Some(ContentSearchHit {
        node_id,
        path: entry.path.clone(),
        name: entry.name.clone(),
        format: entry.format,
        match_count,
        snippet,
        highlights,
    })
}

fn fold_with_map(original: &str) -> (String, Vec<usize>) {
    let mut folded = String::new();
    let mut orig_of_folded = Vec::new();
    for (orig_index, ch) in original.chars().enumerate() {
        for lower in ch.to_lowercase() {
            folded.push(lower);
            orig_of_folded.push(orig_index);
        }
    }
    (folded, orig_of_folded)
}

fn is_ascii_digit_term(term: &str) -> bool {
    !term.is_empty() && term.bytes().all(|byte| byte.is_ascii_digit())
}

fn has_ascii_digit_before(text: &str, byte_index: usize) -> bool {
    if byte_index == 0 {
        return false;
    }
    text.get(..byte_index)
        .and_then(|prefix| prefix.chars().next_back())
        .is_some_and(|ch| ch.is_ascii_digit())
}

fn has_ascii_digit_at(text: &str, byte_index: usize) -> bool {
    text.get(byte_index..)
        .and_then(|rest| rest.chars().next())
        .is_some_and(|ch| ch.is_ascii_digit())
}

fn term_match_allowed(haystack: &str, start: usize, end: usize, term: &str) -> bool {
    if !is_ascii_digit_term(term) {
        return true;
    }
    !has_ascii_digit_before(haystack, start) && !has_ascii_digit_at(haystack, end)
}

fn find_term_from(haystack: &str, term: &str, from: usize) -> Option<usize> {
    if term.is_empty() || from > haystack.len() {
        return None;
    }
    let mut cursor = from;
    while let Some(found) = haystack.get(cursor..)?.find(term) {
        let start = cursor + found;
        let end = start + term.len();
        if term_match_allowed(haystack, start, end, term) {
            return Some(start);
        }
        cursor = start.saturating_add(1);
        if cursor <= start {
            break;
        }
    }
    None
}

fn term_occurs(haystack: &str, term: &str) -> bool {
    find_term_from(haystack, term, 0).is_some()
}

fn count_nonoverlapping(haystack: &str, needle: &str) -> u64 {
    if needle.is_empty() {
        return 0;
    }
    let mut count = 0;
    let mut from = 0;
    while let Some(start) = find_term_from(haystack, needle, from) {
        count += 1;
        from = start + needle.len();
    }
    count
}

struct OrigRange {
    start: usize,
    end: usize,
}

fn leftmost_term_range(
    folded: &str,
    orig_of_folded: &[usize],
    terms: &[String],
) -> Option<OrigRange> {
    let mut best: Option<OrigRange> = None;
    for term in terms {
        let Some(byte) = find_term_from(folded, term, 0) else {
            continue;
        };
        let start_folded = folded[..byte].chars().count();
        let end_folded = folded[..byte + term.len()].chars().count();
        if end_folded == 0 || end_folded > orig_of_folded.len() {
            continue;
        }
        let orig = OrigRange {
            start: orig_of_folded[start_folded],
            end: orig_of_folded[end_folded - 1] + 1,
        };
        match &best {
            Some(current) if current.start <= orig.start => {}
            _ => best = Some(orig),
        }
    }
    best
}

fn build_snippet(text: &str, anchor: &OrigRange, terms: &[String]) -> (String, Vec<HighlightRange>) {
    let total = text.chars().count();
    let (mut start, mut end) = window_around(total, anchor.start, anchor.end);
    (start, end) = expand_word_bounds(text, start, end, total);
    let raw = slice_chars(text, start, end);
    let mut body = normalize_display_whitespace(raw);
    let mut cut_end = false;
    if body.chars().count() > SNIPPET_TARGET_CHARS {
        body = truncate_display(&body, SNIPPET_TARGET_CHARS);
        cut_end = true;
    }
    let mut snippet = String::new();
    if start > 0 {
        snippet.push('…');
    }
    snippet.push_str(&body);
    if end < total || cut_end {
        snippet.push('…');
    }
    let highlights = highlight_ranges(&snippet, terms);
    (snippet, highlights)
}

fn window_around(total: usize, match_start: usize, match_end: usize) -> (usize, usize) {
    let match_end = match_end.min(total);
    let match_start = match_start.min(match_end);
    let match_len = match_end - match_start;
    if total <= SNIPPET_WINDOW_CHARS {
        return (0, total);
    }
    if match_len >= SNIPPET_WINDOW_CHARS {
        return (match_start, (match_start + SNIPPET_WINDOW_CHARS).min(total));
    }
    let extra = SNIPPET_WINDOW_CHARS - match_len;
    let left = extra / 2;
    let mut start = match_start.saturating_sub(left);
    let mut end = match_end + extra.saturating_sub(match_start - start);
    if end > total {
        let overflow = end - total;
        end = total;
        start = start.saturating_sub(overflow);
    }
    (start, end)
}

fn expand_word_bounds(text: &str, start: usize, end: usize, total: usize) -> (usize, usize) {
    let neigh_start = start.saturating_sub(WORD_BOUNDARY_SLACK);
    let neigh_end = (end + WORD_BOUNDARY_SLACK).min(total);
    let neigh: Vec<char> = slice_chars(text, neigh_start, neigh_end).chars().collect();
    let local_start = start - neigh_start;
    let local_end = (end - neigh_start).min(neigh.len());
    let mut local_start = local_start;
    let mut local_end = local_end;
    if local_start > 0 {
        if let Some(rel) = neigh[..local_start]
            .iter()
            .rposition(|ch| ch.is_whitespace())
        {
            local_start = rel + 1;
        }
    }
    if local_end < neigh.len() {
        if let Some(rel) = neigh[local_end..]
            .iter()
            .position(|ch| ch.is_whitespace())
        {
            local_end += rel;
        } else {
            local_end = neigh.len();
        }
    }
    (neigh_start + local_start, neigh_start + local_end)
}

fn slice_chars(text: &str, start: usize, end: usize) -> &str {
    let start = start.min(end);
    let Some((start_byte, _)) = text.char_indices().nth(start) else {
        return "";
    };
    let rest = &text[start_byte..];
    let take = end - start;
    match rest.char_indices().nth(take) {
        Some((end_byte, _)) => &rest[..end_byte],
        None => rest,
    }
}

fn normalize_display_whitespace(text: &str) -> String {
    let mut out = String::new();
    let mut pending_space = false;
    for ch in text.chars() {
        if ch.is_whitespace() {
            pending_space = true;
            continue;
        }
        if pending_space && !out.is_empty() {
            out.push(' ');
        }
        pending_space = false;
        out.push(ch);
    }
    out
}

fn truncate_display(text: &str, max_chars: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= max_chars {
        return text.to_string();
    }
    let mut cut = max_chars;
    while cut > max_chars / 2 && !chars[cut].is_whitespace() {
        cut -= 1;
    }
    if chars[cut].is_whitespace() {
        chars[..cut].iter().collect()
    } else {
        chars[..max_chars].iter().collect()
    }
}

fn highlight_ranges(snippet: &str, terms: &[String]) -> Vec<HighlightRange> {
    let folded = fold_case(snippet);
    let mut orig_of_folded = Vec::new();
    for (orig_index, ch) in snippet.chars().enumerate() {
        for _ in ch.to_lowercase() {
            orig_of_folded.push(orig_index);
        }
    }
    let orig_char_bytes = char_byte_offsets(snippet);
    let mut ranges = Vec::new();
    for term in terms {
        let mut from = 0;
        while let Some(start_byte_folded) = find_term_from(&folded, term, from) {
            let end_byte_folded = start_byte_folded + term.len();
            let start_fchar = folded[..start_byte_folded].chars().count();
            let end_fchar = folded[..end_byte_folded].chars().count();
            if end_fchar == 0 || end_fchar > orig_of_folded.len() {
                break;
            }
            let orig_start = orig_of_folded[start_fchar];
            let orig_end = orig_of_folded[end_fchar - 1] + 1;
            let utf16_start = utf16_units(&snippet[..orig_char_bytes[orig_start]]);
            let utf16_end = if orig_end >= orig_char_bytes.len() - 1 {
                utf16_units(snippet)
            } else {
                utf16_units(&snippet[..orig_char_bytes[orig_end]])
            };
            if utf16_end > utf16_start {
                ranges.push(HighlightRange {
                    start: utf16_start as u32,
                    end: utf16_end as u32,
                });
            }
            from = end_byte_folded;
        }
    }
    ranges.sort_by_key(|range| (range.start, range.end));
    ranges.dedup();
    ranges
}

fn char_byte_offsets(text: &str) -> Vec<usize> {
    let mut offsets: Vec<usize> = text.char_indices().map(|(byte, _)| byte).collect();
    offsets.push(text.len());
    offsets
}

fn utf16_units(text: &str) -> usize {
    text.encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use super::{
        count_nonoverlapping, fold_case, parse_query_terms, search_file_content, HighlightRange,
        MAX_CONTENT_SEARCH_HITS, SNIPPET_TARGET_CHARS,
    };
    use crate::content::{ContentEntry, ContentFormat, ContentStatus};
    use crate::error::AppErrorKind;
    use crate::model::{DirectoryListing, FsNode, ScanResult, ScanStats};
    use crate::state::AppState;

    fn slice_utf16(text: &str, start: u32, end: u32) -> String {
        let units: Vec<u16> = text.encode_utf16().collect();
        String::from_utf16(&units[start as usize..end as usize]).expect("utf16 range")
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

    fn file(name: &str, path: &str) -> FsNode {
        FsNode::File {
            id: path.to_string(),
            name: name.to_string(),
            path: path.to_string(),
            depth: 1,
            size_bytes: None,
            created_at_ms: None,
            modified_at_ms: None,
        }
    }

    fn snapshot(children: Vec<FsNode>) -> ScanResult {
        ScanResult {
            root: dir("root", "C:\\root", 0, children),
            warnings: Vec::new(),
            stats: ScanStats::default(),
        }
    }

    fn searchable(path: &str, name: &str, text: &str) -> ContentEntry {
        searchable_with(path, name, text, ContentFormat::Pdf)
    }

    fn searchable_with(
        path: &str,
        name: &str,
        text: &str,
        format: ContentFormat,
    ) -> ContentEntry {
        ContentEntry {
            path: path.into(),
            name: name.into(),
            format,
            status: ContentStatus::Searchable,
            text: Some(text.into()),
            extracted_chars: text.chars().count(),
            truncated: false,
        }
    }

    fn status_entry(path: &str, name: &str, status: ContentStatus) -> ContentEntry {
        ContentEntry::new(path, name, ContentFormat::Pdf, status)
    }

    fn ready_state(scan_id: u64, files: Vec<(&str, &str, ContentEntry)>) -> AppState {
        let children = files
            .iter()
            .map(|(name, path, _)| file(name, path))
            .collect();
        let state = AppState::new();
        state.store_snapshot(scan_id, snapshot(children));
        for (_, _, entry) in files {
            state.insert_content_entry(scan_id, entry).expect("insert");
        }
        state
    }

    fn search_ok(state: &AppState, scan_id: u64, query: &str) -> crate::content::ContentSearchResult {
        search_file_content(state, scan_id, query).expect("search")
    }

    #[test]
    fn empty_and_whitespace_query_return_empty_without_hits() {
        let state = ready_state(
            1,
            vec![(
                "a.pdf",
                "C:\\root\\a.pdf",
                searchable("C:\\root\\a.pdf", "a.pdf", "Brandschutz"),
            )],
        );
        for query in ["", "   ", "\t\n  "] {
            let result = search_ok(&state, 1, query);
            assert!(result.hits.is_empty(), "{query:?}");
            assert_eq!(result.total_hit_count, 0);
            assert_eq!(result.returned_hit_count, 0);
            assert_eq!(result.total_document_count, 1);
            assert_eq!(result.processed_document_count, 1);
        }
    }

    #[test]
    fn ascii_and_umlauts_are_case_insensitive_without_ae_folding() {
        let state = ready_state(
            2,
            vec![
                (
                    "a.pdf",
                    "C:\\root\\a.pdf",
                    searchable("C:\\root\\a.pdf", "a.pdf", "BRANDSCHUTZ Änderung für Müller"),
                ),
                (
                    "b.pdf",
                    "C:\\root\\b.pdf",
                    searchable("C:\\root\\b.pdf", "b.pdf", "Nur Mueller ohne Umlaut"),
                ),
            ],
        );
        assert_eq!(search_ok(&state, 2, "Brandschutz").total_hit_count, 1);
        assert_eq!(search_ok(&state, 2, "änderung").hits[0].name, "a.pdf");
        assert_eq!(search_ok(&state, 2, "FÜR").total_hit_count, 1);
        assert_eq!(search_ok(&state, 2, "Müller").hits[0].name, "a.pdf");
        let ae = search_ok(&state, 2, "Mueller");
        assert_eq!(ae.total_hit_count, 1);
        assert_eq!(ae.hits[0].name, "b.pdf");
    }

    #[test]
    fn substring_and_conjunction_rules() {
        let state = ready_state(
            3,
            vec![(
                "doc.pdf",
                "C:\\root\\doc.pdf",
                searchable(
                    "C:\\root\\doc.pdf",
                    "doc.pdf",
                    "Die Brandschutzklappe sitzt vorne.\n\nSpäter kommt der Nachtrag zum Protokoll.",
                ),
            )],
        );
        assert_eq!(search_ok(&state, 3, "klappe").total_hit_count, 1);
        let both = search_ok(&state, 3, "Brandschutzklappe Nachtrag");
        assert_eq!(both.total_hit_count, 1);
        assert!(both.hits[0].snippet.contains("Brandschutzklappe"));
        assert!(both.hits[0].snippet.contains("Nachtrag"));
        assert!(both.hits[0].highlights.len() >= 2);
        assert_eq!(
            search_ok(&state, 3, "Brandschutzklappe fehlt").total_hit_count,
            0
        );
        let far = search_ok(&state, 3, "Nachtrag Brandschutzklappe");
        assert_eq!(far.total_hit_count, 1);
        assert_eq!(far.hits.len(), 1);
        assert!(
            far.hits[0].snippet.contains("Brandschutzklappe")
                || far.hits[0].snippet.contains("Nachtrag")
        );
    }

    #[test]
    fn ascii_digit_terms_match_at_digit_boundaries_only() {
        assert_eq!(count_nonoverlapping("720", "720"), 1);
        assert_eq!(count_nonoverlapping("720,00", "720"), 1);
        assert_eq!(count_nonoverlapping("720.00", "720"), 1);
        assert_eq!(count_nonoverlapping("720 €", "720"), 1);
        assert_eq!(count_nonoverlapping("EUR 720", "720"), 1);
        assert_eq!(count_nonoverlapping("Betrag 720", "720"), 1);
        assert_eq!(count_nonoverlapping("41720", "720"), 0);
        assert_eq!(count_nonoverlapping("17205", "720"), 0);
        assert_eq!(count_nonoverlapping("7200", "720"), 0);
        assert_eq!(count_nonoverlapping("1720", "720"), 0);
        assert_eq!(count_nonoverlapping("41720 720 720,00", "720"), 2);

        for (text, scan_id) in [
            ("720", 81_u64),
            ("720,00", 82),
            ("720.00", 83),
            ("720 €", 84),
            ("EUR 720", 85),
            ("Betrag 720", 86),
        ] {
            let state = ready_state(
                scan_id,
                vec![(
                    "doc.pdf",
                    "C:\\root\\doc.pdf",
                    searchable("C:\\root\\doc.pdf", "doc.pdf", text),
                )],
            );
            let result = search_ok(&state, scan_id, "720");
            assert_eq!(result.total_hit_count, 1, "{text}");
            assert!(result.hits[0].snippet.contains("720"), "{text}");
        }

        for (text, scan_id) in [("41720", 87_u64), ("17205", 88), ("7200", 89), ("1720", 90)] {
            let state = ready_state(
                scan_id,
                vec![(
                    "doc.pdf",
                    "C:\\root\\doc.pdf",
                    searchable("C:\\root\\doc.pdf", "doc.pdf", text),
                )],
            );
            assert_eq!(search_ok(&state, scan_id, "720").total_hit_count, 0, "{text}");
        }
    }

    #[test]
    fn numeric_snippet_anchor_skips_earlier_embedded_digits() {
        let text = format!(
            "Blatt 2014 enthält 41720. {} Betrag 720,00 € auf Blatt 2023. {}",
            "zwischen ".repeat(40),
            "danach ".repeat(40),
        );
        let state = ready_state(
            91,
            vec![(
                "liste.xlsx",
                "C:\\root\\liste.xlsx",
                searchable_with("C:\\root\\liste.xlsx", "liste.xlsx", &text, ContentFormat::Xlsx),
            )],
        );
        let result = search_ok(&state, 91, "720");
        assert_eq!(result.total_hit_count, 1);
        assert_eq!(result.hits[0].match_count, 1);
        assert!(result.hits[0].snippet.contains("720"), "{:?}", result.hits[0].snippet);
        assert!(
            result.hits[0].snippet.contains("2023") || result.hits[0].snippet.contains("Betrag"),
            "{:?}",
            result.hits[0].snippet
        );
        assert!(!result.hits[0].snippet.contains("41720"), "{:?}", result.hits[0].snippet);
        let marked: Vec<String> = result.hits[0]
            .highlights
            .iter()
            .map(|range| slice_utf16(&result.hits[0].snippet, range.start, range.end))
            .collect();
        assert!(marked.iter().any(|part| part.contains("720")), "{marked:?}");
        assert!(marked.iter().all(|part| !part.contains("41720")), "{marked:?}");
    }

    #[test]
    fn numeric_highlights_do_not_mark_embedded_digits_nearby() {
        let state = ready_state(
            92,
            vec![(
                "mix.pdf",
                "C:\\root\\mix.pdf",
                searchable("C:\\root\\mix.pdf", "mix.pdf", "41720 und 720 und 7200"),
            )],
        );
        let result = search_ok(&state, 92, "720");
        assert_eq!(result.hits[0].match_count, 1);
        let marked: Vec<String> = result.hits[0]
            .highlights
            .iter()
            .map(|range| slice_utf16(&result.hits[0].snippet, range.start, range.end))
            .collect();
        assert_eq!(marked, vec!["720".to_string()]);
    }

    #[test]
    fn mixed_text_substring_and_numeric_digit_boundary_and() {
        let text = "Rechnungsliste 41720 später Betrag 720,00";
        let state = ready_state(
            93,
            vec![(
                "brief.docx",
                "C:\\root\\brief.docx",
                searchable_with("C:\\root\\brief.docx", "brief.docx", text, ContentFormat::Docx),
            )],
        );
        let result = search_ok(&state, 93, "Rechnung 720");
        assert_eq!(result.total_hit_count, 1);
        assert!(result.hits[0].snippet.contains("Rechnungsliste") || result.hits[0].snippet.contains("720"));
        assert_eq!(search_ok(&state, 93, "Rechnung 41720").total_hit_count, 1);
        assert_eq!(search_ok(&state, 93, "Rechnung 7200").total_hit_count, 0);
        assert_eq!(search_ok(&state, 93, "klappe").total_hit_count, 0);
    }

    #[test]
    fn numeric_digit_boundary_is_shared_across_pdf_docx_xlsx() {
        let state = ready_state(
            94,
            vec![
                (
                    "a.pdf",
                    "C:\\root\\a.pdf",
                    searchable("C:\\root\\a.pdf", "a.pdf", "nur 41720 im PDF"),
                ),
                (
                    "brief.docx",
                    "C:\\root\\brief.docx",
                    searchable_with(
                        "C:\\root\\brief.docx",
                        "brief.docx",
                        "Betrag 720,00 in Word",
                        ContentFormat::Docx,
                    ),
                ),
                (
                    "tabelle.xlsx",
                    "C:\\root\\tabelle.xlsx",
                    searchable_with(
                        "C:\\root\\tabelle.xlsx",
                        "tabelle.xlsx",
                        "7200 in Excel",
                        ContentFormat::Xlsx,
                    ),
                ),
            ],
        );
        let result = search_ok(&state, 94, "720");
        assert_eq!(result.total_hit_count, 1);
        assert_eq!(result.hits[0].name, "brief.docx");
        assert_eq!(result.hits[0].format, ContentFormat::Docx);

        let all_valid = ready_state(
            95,
            vec![
                (
                    "a.pdf",
                    "C:\\root\\a.pdf",
                    searchable("C:\\root\\a.pdf", "a.pdf", "720"),
                ),
                (
                    "brief.docx",
                    "C:\\root\\brief.docx",
                    searchable_with("C:\\root\\brief.docx", "brief.docx", "EUR 720", ContentFormat::Docx),
                ),
                (
                    "tabelle.xlsx",
                    "C:\\root\\tabelle.xlsx",
                    searchable_with("C:\\root\\tabelle.xlsx", "tabelle.xlsx", "720.00", ContentFormat::Xlsx),
                ),
            ],
        );
        let hits = search_ok(&all_valid, 95, "720");
        assert_eq!(hits.total_hit_count, 3);
        assert_eq!(hits.returned_hit_count, 3);
        assert!(hits.hits.iter().any(|hit| hit.format == ContentFormat::Pdf));
        assert!(hits.hits.iter().any(|hit| hit.format == ContentFormat::Docx));
        assert!(hits.hits.iter().any(|hit| hit.format == ContentFormat::Xlsx));
    }

    #[test]
    fn xlsx_styled_date_text_is_found_by_german_and_iso() {
        let state = ready_state(
            96,
            vec![(
                "datum.xlsx",
                "C:\\root\\datum.xlsx",
                searchable_with(
                    "C:\\root\\datum.xlsx",
                    "datum.xlsx",
                    "Blatt\n17.05.2025 2025-05-17 45794",
                    ContentFormat::Xlsx,
                ),
            )],
        );
        assert_eq!(search_ok(&state, 96, "17.05.2025").total_hit_count, 1);
        assert_eq!(search_ok(&state, 96, "2025-05-17").total_hit_count, 1);
    }

    #[test]
    fn xlsx_unstyled_41720_is_not_found_as_date() {
        let state = ready_state(
            97,
            vec![(
                "zahl.xlsx",
                "C:\\root\\zahl.xlsx",
                searchable_with(
                    "C:\\root\\zahl.xlsx",
                    "zahl.xlsx",
                    "Blatt\n41720",
                    ContentFormat::Xlsx,
                ),
            )],
        );
        assert_eq!(search_ok(&state, 97, "22.03.2014").total_hit_count, 0);
        assert_eq!(search_ok(&state, 97, "720").total_hit_count, 0);
        assert_eq!(search_ok(&state, 97, "41720").total_hit_count, 1);
    }

    #[test]
    fn xlsx_styled_41720_is_found_as_date_and_720_does_not_match() {
        let state = ready_state(
            98,
            vec![(
                "datum.xlsx",
                "C:\\root\\datum.xlsx",
                searchable_with(
                    "C:\\root\\datum.xlsx",
                    "datum.xlsx",
                    "Blatt\n22.03.2014 2014-03-22 41720",
                    ContentFormat::Xlsx,
                ),
            )],
        );
        assert_eq!(search_ok(&state, 98, "22.03.2014").total_hit_count, 1);
        assert_eq!(search_ok(&state, 98, "720").total_hit_count, 0);
        assert_eq!(search_ok(&state, 98, "41720").total_hit_count, 1);
    }

    #[test]
    fn duplicate_terms_are_deduped_and_match_count_sums_nonoverlapping() {
        assert_eq!(parse_query_terms("Nachtrag  Nachtrag"), vec!["nachtrag"]);
        let state = ready_state(
            4,
            vec![(
                "z.pdf",
                "C:\\root\\z.pdf",
                searchable(
                    "C:\\root\\z.pdf",
                    "z.pdf",
                    "Brandschutz eins Brandschutz zwei Brandschutz. Nachtrag und Nachtrag.",
                ),
            )],
        );
        let result = search_ok(&state, 4, "Brandschutz Nachtrag Nachtrag");
        assert_eq!(result.hits[0].match_count, 5);
        assert_eq!(count_nonoverlapping(&fold_case("aaa"), "aa"), 1);
    }

    #[test]
    fn non_searchable_statuses_are_not_hits() {
        let state = ready_state(
            5,
            vec![
                (
                    "ok.pdf",
                    "C:\\root\\ok.pdf",
                    searchable("C:\\root\\ok.pdf", "ok.pdf", "sichtbarer Inhalt"),
                ),
                (
                    "empty.pdf",
                    "C:\\root\\empty.pdf",
                    status_entry(
                        "C:\\root\\empty.pdf",
                        "empty.pdf",
                        ContentStatus::NoExtractableText,
                    ),
                ),
                (
                    "prot.pdf",
                    "C:\\root\\prot.pdf",
                    status_entry("C:\\root\\prot.pdf", "prot.pdf", ContentStatus::Protected),
                ),
                (
                    "bad.pdf",
                    "C:\\root\\bad.pdf",
                    status_entry("C:\\root\\bad.pdf", "bad.pdf", ContentStatus::ParseError),
                ),
            ],
        );
        let result = search_ok(&state, 5, "Inhalt");
        assert_eq!(result.total_hit_count, 1);
        assert_eq!(result.hits[0].name, "ok.pdf");
        assert_eq!(result.processed_document_count, 4);
    }

    #[test]
    fn snippet_normalizes_whitespace_and_uses_ellipsis() {
        let prefix = "Anfang ".repeat(40);
        let suffix = " Ende".repeat(40);
        let text = format!("{prefix}Brandschutzklappe\n\t  Nachtrag{suffix}");
        let state = ready_state(
            6,
            vec![(
                "long.pdf",
                "C:\\root\\long.pdf",
                searchable("C:\\root\\long.pdf", "long.pdf", &text),
            )],
        );
        let result = search_ok(&state, 6, "Brandschutzklappe Nachtrag");
        let snippet = &result.hits[0].snippet;
        assert!(!snippet.contains('\n'), "{snippet}");
        assert!(!snippet.contains('\t'), "{snippet}");
        assert!(!snippet.contains("  "), "{snippet}");
        assert!(snippet.starts_with('…'), "{snippet}");
        assert!(snippet.ends_with('…'), "{snippet}");
        assert!(snippet.contains("Brandschutzklappe"));
        assert!(snippet.chars().count() <= SNIPPET_TARGET_CHARS + 2);
        assert!(!snippet.contains("BrandschutzklappeNachtrag"));
    }

    #[test]
    fn highlights_cover_terms_including_umlauts_eszett_and_emoji() {
        let text = "Vortext Änderung Straße 😀 Probe";
        let state = ready_state(
            7,
            vec![(
                "u.pdf",
                "C:\\root\\u.pdf",
                searchable("C:\\root\\u.pdf", "u.pdf", text),
            )],
        );
        let result = search_ok(&state, 7, "Änderung Straße 😀");
        let hit = &result.hits[0];
        assert!(hit.highlights.len() >= 3, "{hit:?}");
        let marked: Vec<String> = hit
            .highlights
            .iter()
            .map(|range| slice_utf16(&hit.snippet, range.start, range.end))
            .collect();
        assert!(marked
            .iter()
            .any(|part| fold_case(part) == fold_case("Änderung")));
        assert!(marked
            .iter()
            .any(|part| fold_case(part) == fold_case("Straße")));
        assert!(marked.iter().any(|part| part.contains('😀')));
        let emoji = marked
            .into_iter()
            .find(|part| part.contains('😀'))
            .expect("emoji highlight");
        assert_eq!(emoji.encode_utf16().count(), 2);
        for HighlightRange { start, end } in &hit.highlights {
            assert!(end > start);
        }
    }

    #[test]
    fn far_apart_terms_yield_one_snippet_around_earliest_match() {
        let text = format!(
            "Nachtrag ganz vorne. {} Brandschutzklappe ganz hinten.",
            "zwischen ".repeat(80)
        );
        let state = ready_state(
            8,
            vec![(
                "far.pdf",
                "C:\\root\\far.pdf",
                searchable("C:\\root\\far.pdf", "far.pdf", &text),
            )],
        );
        let result = search_ok(&state, 8, "Brandschutzklappe Nachtrag");
        assert_eq!(result.total_hit_count, 1);
        assert_eq!(result.hits.len(), 1);
        assert!(result.hits[0].snippet.contains("Nachtrag"));
        assert!(!result.hits[0].snippet.contains("Brandschutzklappe"));
    }

    #[test]
    fn more_than_200_hits_are_capped_with_true_total() {
        let mut files = Vec::new();
        for i in 0..MAX_CONTENT_SEARCH_HITS + 7 {
            let name = format!("hit {i:03}.pdf");
            let path = format!("C:\\root\\{name}");
            files.push((
                name.clone(),
                path.clone(),
                searchable(&path, &name, "gemeinsamer Treffer"),
            ));
        }
        let children = files.iter().map(|(name, path, _)| file(name, path)).collect();
        let state = AppState::new();
        state.store_snapshot(9, snapshot(children));
        for (_, _, entry) in files {
            state.insert_content_entry(9, entry).expect("insert");
        }
        let result = search_ok(&state, 9, "Treffer");
        assert_eq!(result.total_hit_count, (MAX_CONTENT_SEARCH_HITS + 7) as u64);
        assert_eq!(result.returned_hit_count, MAX_CONTENT_SEARCH_HITS as u64);
        assert_eq!(result.hits.len(), MAX_CONTENT_SEARCH_HITS);
    }

    #[test]
    fn hit_order_uses_existing_natural_sort_then_path() {
        let state = ready_state(
            10,
            vec![
                (
                    "Datei 10.pdf",
                    "C:\\root\\b\\Datei 10.pdf",
                    searchable("C:\\root\\b\\Datei 10.pdf", "Datei 10.pdf", "Inhalt"),
                ),
                (
                    "Datei 2.pdf",
                    "C:\\root\\a\\Datei 2.pdf",
                    searchable("C:\\root\\a\\Datei 2.pdf", "Datei 2.pdf", "Inhalt"),
                ),
                (
                    "Datei 2.pdf",
                    "C:\\root\\c\\Datei 2.pdf",
                    searchable("C:\\root\\c\\Datei 2.pdf", "Datei 2.pdf", "Inhalt"),
                ),
            ],
        );
        let result = search_ok(&state, 10, "Inhalt");
        let names_paths: Vec<_> = result
            .hits
            .iter()
            .map(|hit| (hit.name.as_str(), hit.path.as_str()))
            .collect();
        assert_eq!(
            names_paths,
            vec![
                ("Datei 2.pdf", "C:\\root\\a\\Datei 2.pdf"),
                ("Datei 2.pdf", "C:\\root\\c\\Datei 2.pdf"),
                ("Datei 10.pdf", "C:\\root\\b\\Datei 10.pdf"),
            ]
        );
        assert_eq!(result.hits[0].node_id, "C:\\root\\a\\Datei 2.pdf");
    }

    #[test]
    fn partial_cache_stays_searchable_and_reports_counts() {
        let mut children = Vec::new();
        for i in 0..800 {
            let name = format!("n{i:03}.pdf");
            children.push(file(&name, &format!("C:\\root\\{name}")));
        }
        let state = AppState::new();
        state.store_snapshot(11, snapshot(children));
        for i in 0..142 {
            let name = format!("n{i:03}.pdf");
            let path = format!("C:\\root\\{name}");
            let text = if i == 7 {
                "seltener Trefferwert"
            } else {
                "ohne Fund"
            };
            state
                .insert_content_entry(11, searchable(&path, &name, text))
                .expect("seed");
        }
        let result = search_ok(&state, 11, "Trefferwert");
        assert!(!result.cache_complete);
        assert_eq!(result.processed_document_count, 142);
        assert_eq!(result.total_document_count, 800);
        assert_eq!(result.total_hit_count, 1);
        assert_eq!(result.hits[0].name, "n007.pdf");
    }

    #[test]
    fn wrong_scan_id_and_missing_cache_fail_closed() {
        let state = AppState::new();
        match search_file_content(&state, 1, "x") {
            Ok(_) => panic!("empty state must fail"),
            Err(err) => assert_eq!(err.kind, AppErrorKind::InvalidConfig),
        }
        state.store_snapshot(3, snapshot(vec![file("a.pdf", "C:\\root\\a.pdf")]));
        match search_file_content(&state, 9, "x") {
            Ok(_) => panic!("stale scanId must fail"),
            Err(err) => assert_eq!(err.kind, AppErrorKind::InvalidConfig),
        }
    }

    #[test]
    fn occupancy_blocks_search() {
        let state = ready_state(
            12,
            vec![(
                "a.pdf",
                "C:\\root\\a.pdf",
                searchable("C:\\root\\a.pdf", "a.pdf", "Inhalt"),
            )],
        );
        let prepare = state.try_begin_prepare(12).expect("prepare");
        match search_file_content(&state, 12, "Inhalt") {
            Ok(_) => panic!("prepare must block search"),
            Err(err) => assert_eq!(err.kind, AppErrorKind::InvalidConfig),
        }
        drop(prepare);

        let scan = state.try_begin_scan(99).expect("scan");
        match search_file_content(&state, 12, "Inhalt") {
            Ok(_) => panic!("scan must block search"),
            Err(err) => assert_eq!(err.kind, AppErrorKind::InvalidConfig),
        }
        drop(scan);

        state.store_snapshot(13, snapshot(vec![file("a.pdf", "C:\\root\\a.pdf")]));
        state
            .insert_content_entry(13, searchable("C:\\root\\a.pdf", "a.pdf", "Inhalt"))
            .expect("seed");
        let export = state.try_begin_export(13).expect("export");
        match search_file_content(&state, 13, "Inhalt") {
            Ok(_) => panic!("export must block search"),
            Err(err) => assert_eq!(err.kind, AppErrorKind::InvalidConfig),
        }
        drop(export);
    }

    #[test]
    fn search_does_not_open_pdf_files() {
        let missing = "C:\\root\\gibt-es-nicht.pdf";
        let state = ready_state(
            14,
            vec![(
                "gibt-es-nicht.pdf",
                missing,
                searchable(missing, "gibt-es-nicht.pdf", "nur Cache Text"),
            )],
        );
        let result = search_ok(&state, 14, "Cache");
        assert_eq!(result.total_hit_count, 1);
        assert!(!std::path::Path::new(missing).exists());
        state.mark_content_complete(14).expect("complete");
        assert!(search_ok(&state, 14, "Cache").cache_complete);
    }

    #[test]
    fn command_near_search_returns_compact_dto() {
        let state = ready_state(
            21,
            vec![(
                "protokoll.pdf",
                "C:\\root\\protokoll.pdf",
                searchable(
                    "C:\\root\\protokoll.pdf",
                    "protokoll.pdf",
                    "Brandschutzklappe im Nachtrag",
                ),
            )],
        );
        state.mark_content_complete(21).expect("complete");
        let result = search_file_content(&state, 21, "Brandschutzklappe Nachtrag").expect("command");
        assert_eq!(result.scan_id, 21);
        assert!(result.cache_complete);
        assert_eq!(result.total_hit_count, 1);
        assert_eq!(result.returned_hit_count, 1);
        assert_eq!(result.hits[0].node_id, "C:\\root\\protokoll.pdf");
        assert_eq!(result.hits[0].format, ContentFormat::Pdf);
        assert!(result.hits[0].match_count >= 2);
        assert!(result.hits[0].snippet.contains("Brandschutzklappe"));
        assert!(result.hits[0].highlights.len() >= 2);
    }

    #[test]
    fn search_counts_pdf_docx_and_xlsx_and_still_finds_pdf() {
        let state = AppState::new();
        state.store_snapshot(
            44,
            snapshot(vec![
                file("a.pdf", "C:\\root\\a.pdf"),
                file("brief.docx", "C:\\root\\brief.docx"),
                file("tabelle.xlsx", "C:\\root\\tabelle.xlsx"),
                file("notes.txt", "C:\\root\\notes.txt"),
            ]),
        );
        state
            .insert_content_entry(
                44,
                searchable("C:\\root\\a.pdf", "a.pdf", "Brandschutzklappe Nachtrag"),
            )
            .expect("pdf");
        state
            .insert_content_entry(
                44,
                ContentEntry {
                    path: "C:\\root\\brief.docx".into(),
                    name: "brief.docx".into(),
                    format: ContentFormat::Docx,
                    status: ContentStatus::ParseError,
                    text: None,
                    extracted_chars: 0,
                    truncated: false,
                },
            )
            .expect("docx stub");
        state
            .insert_content_entry(
                44,
                searchable_with(
                    "C:\\root\\tabelle.xlsx",
                    "tabelle.xlsx",
                    "andere Tabelle",
                    ContentFormat::Xlsx,
                ),
            )
            .expect("xlsx");
        state.mark_content_complete(44).expect("complete");
        let result = search_ok(&state, 44, "Brandschutzklappe Nachtrag");
        assert_eq!(result.total_document_count, 3);
        assert_eq!(result.processed_document_count, 3);
        assert_eq!(result.total_hit_count, 1);
        assert_eq!(result.hits[0].name, "a.pdf");
        assert_eq!(result.hits[0].format, ContentFormat::Pdf);
        assert!(result.cache_complete);
    }

    #[test]
    fn mixed_pdf_docx_and_xlsx_hits_share_one_200_cap() {
        let mut files = Vec::new();
        let total = MAX_CONTENT_SEARCH_HITS + 7;
        for i in 0..total {
            let (name, format) = match i % 3 {
                0 => (format!("hit {i:03}.pdf"), ContentFormat::Pdf),
                1 => (format!("hit {i:03}.docx"), ContentFormat::Docx),
                _ => (format!("hit {i:03}.xlsx"), ContentFormat::Xlsx),
            };
            let path = format!("C:\\root\\{name}");
            files.push((
                name.clone(),
                path.clone(),
                searchable_with(&path, &name, "gemeinsamer Treffer", format),
            ));
        }
        let children = files.iter().map(|(name, path, _)| file(name, path)).collect();
        let state = AppState::new();
        state.store_snapshot(61, snapshot(children));
        for (_, _, entry) in files {
            state.insert_content_entry(61, entry).expect("insert");
        }
        let result = search_ok(&state, 61, "Treffer");
        assert_eq!(result.total_hit_count, total as u64);
        assert_eq!(result.returned_hit_count, MAX_CONTENT_SEARCH_HITS as u64);
        assert_eq!(result.hits.len(), MAX_CONTENT_SEARCH_HITS);
        assert!(result.hits.iter().any(|hit| hit.format == ContentFormat::Pdf));
        assert!(result.hits.iter().any(|hit| hit.format == ContentFormat::Docx));
        assert!(result.hits.iter().any(|hit| hit.format == ContentFormat::Xlsx));
    }

    #[test]
    fn mixed_pdf_docx_and_xlsx_hit_order_ignores_format() {
        let state = ready_state(
            62,
            vec![
                (
                    "Datei 10.docx",
                    "C:\\root\\c\\Datei 10.docx",
                    searchable_with(
                        "C:\\root\\c\\Datei 10.docx",
                        "Datei 10.docx",
                        "Inhalt",
                        ContentFormat::Docx,
                    ),
                ),
                (
                    "Datei 2.xlsx",
                    "C:\\root\\d\\Datei 2.xlsx",
                    searchable_with(
                        "C:\\root\\d\\Datei 2.xlsx",
                        "Datei 2.xlsx",
                        "Inhalt",
                        ContentFormat::Xlsx,
                    ),
                ),
                (
                    "Datei 2.pdf",
                    "C:\\root\\b\\Datei 2.pdf",
                    searchable("C:\\root\\b\\Datei 2.pdf", "Datei 2.pdf", "Inhalt"),
                ),
                (
                    "Datei 2.docx",
                    "C:\\root\\a\\Datei 2.docx",
                    searchable_with(
                        "C:\\root\\a\\Datei 2.docx",
                        "Datei 2.docx",
                        "Inhalt",
                        ContentFormat::Docx,
                    ),
                ),
            ],
        );
        let result = search_ok(&state, 62, "Inhalt");
        let names_paths: Vec<_> = result
            .hits
            .iter()
            .map(|hit| (hit.name.as_str(), hit.path.as_str(), hit.format))
            .collect();
        assert_eq!(
            names_paths,
            vec![
                ("Datei 2.docx", "C:\\root\\a\\Datei 2.docx", ContentFormat::Docx),
                ("Datei 2.pdf", "C:\\root\\b\\Datei 2.pdf", ContentFormat::Pdf),
                ("Datei 2.xlsx", "C:\\root\\d\\Datei 2.xlsx", ContentFormat::Xlsx),
                ("Datei 10.docx", "C:\\root\\c\\Datei 10.docx", ContentFormat::Docx),
            ]
        );
    }

    #[test]
    fn docx_umlauts_eszett_and_emoji_use_existing_search_rules() {
        let text = "Vortext Änderung Straße 😀 für Müller Probe";
        let state = ready_state(
            63,
            vec![
                (
                    "brief.docx",
                    "C:\\root\\brief.docx",
                    searchable_with(
                        "C:\\root\\brief.docx",
                        "brief.docx",
                        text,
                        ContentFormat::Docx,
                    ),
                ),
                (
                    "ascii.pdf",
                    "C:\\root\\ascii.pdf",
                    searchable("C:\\root\\ascii.pdf", "ascii.pdf", "Nur Mueller ohne Umlaut"),
                ),
            ],
        );
        assert_eq!(search_ok(&state, 63, "Müller").hits[0].name, "brief.docx");
        assert_eq!(search_ok(&state, 63, "müller").total_hit_count, 1);
        let ae = search_ok(&state, 63, "Mueller");
        assert_eq!(ae.total_hit_count, 1);
        assert_eq!(ae.hits[0].name, "ascii.pdf");
        assert_eq!(search_ok(&state, 63, "Straße").hits[0].format, ContentFormat::Docx);
        assert_eq!(search_ok(&state, 63, "Strasse").total_hit_count, 0);

        let result = search_ok(&state, 63, "Änderung Straße 😀");
        let hit = &result.hits[0];
        assert_eq!(hit.format, ContentFormat::Docx);
        assert!(hit.highlights.len() >= 3, "{hit:?}");
        let marked: Vec<String> = hit
            .highlights
            .iter()
            .map(|range| slice_utf16(&hit.snippet, range.start, range.end))
            .collect();
        assert!(marked
            .iter()
            .any(|part| fold_case(part) == fold_case("Änderung")));
        let emoji = marked
            .iter()
            .find(|part| part.contains('😀'))
            .expect("emoji highlight");
        assert_eq!(emoji.encode_utf16().count(), 2);
    }
}
