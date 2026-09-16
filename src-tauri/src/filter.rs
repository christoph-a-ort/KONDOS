/// Normalisiert eine Dateiendung auf die Form `.ext` in Kleinbuchstaben.
pub fn normalize_extension(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with('.') {
        if lower.len() == 1 {
            return None;
        }
        Some(lower)
    } else {
        Some(format!(".{lower}"))
    }
}

pub fn normalize_extensions(values: &[String]) -> Vec<String> {
    let mut normalized = Vec::new();
    for value in values {
        if let Some(ext) = normalize_extension(value) {
            if !normalized.contains(&ext) {
                normalized.push(ext);
            }
        }
    }
    normalized
}

/// Ordner werden vom Aufrufer nicht gefiltert. Leere Liste = alle Dateien.
pub fn file_matches_extensions(file_name: &str, extensions: &[String]) -> bool {
    if extensions.is_empty() {
        return true;
    }
    let Some(dot) = file_name.rfind('.') else {
        return false;
    };
    if dot == 0 || dot == file_name.len() - 1 {
        return false;
    }
    let ext = format!(".{}", file_name[dot + 1..].to_ascii_lowercase());
    extensions.iter().any(|candidate| candidate == &ext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_adds_dot_and_lowercases() {
        assert_eq!(normalize_extension("PDF").as_deref(), Some(".pdf"));
        assert_eq!(normalize_extension(".PNG").as_deref(), Some(".png"));
        assert_eq!(normalize_extension("  .DocX ").as_deref(), Some(".docx"));
        assert_eq!(normalize_extension("").as_deref(), None);
        assert_eq!(normalize_extension(".").as_deref(), None);
    }

    #[test]
    fn empty_filter_accepts_all_files() {
        assert!(file_matches_extensions("notes.txt", &[]));
        assert!(file_matches_extensions("Makefile", &[]));
    }

    #[test]
    fn extension_filter_is_case_insensitive() {
        let filter = vec![".pdf".to_string()];
        assert!(file_matches_extensions("Report.PDF", &filter));
        assert!(!file_matches_extensions("photo.png", &filter));
        assert!(!file_matches_extensions("README", &filter));
    }

    #[test]
    fn multiple_extensions_match_any() {
        let filter = normalize_extensions(&["pdf".into(), ".TXT".into(), "Pdf".into()]);
        assert_eq!(filter, vec![".pdf", ".txt"]);
        assert!(file_matches_extensions("a.PDF", &filter));
        assert!(file_matches_extensions("b.txt", &filter));
        assert!(!file_matches_extensions("c.png", &filter));
        assert!(!file_matches_extensions(".gitignore", &filter));
    }
}
