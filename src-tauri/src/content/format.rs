use super::ContentFormat;

/// Erkennt das Inhaltsformat nur anhand der Dateinamens-Erweiterung.
pub fn content_format_from_name(name: &str) -> Option<ContentFormat> {
    let ext = name.rsplit_once('.')?.1;
    if ext.is_empty() {
        return None;
    }
    match ext.to_ascii_lowercase().as_str() {
        "pdf" => Some(ContentFormat::Pdf),
        "docx" => Some(ContentFormat::Docx),
        "xlsx" => Some(ContentFormat::Xlsx),
        _ => None,
    }
}

/// Inhaltsdokumente, die die Prepare-Pipeline sammelt.
pub fn is_supported_content_document(format: ContentFormat) -> bool {
    matches!(
        format,
        ContentFormat::Pdf | ContentFormat::Docx | ContentFormat::Xlsx
    )
}

#[cfg(test)]
mod tests {
    use super::content_format_from_name;
    use crate::content::ContentFormat;

    #[test]
    fn pdf_extension_is_case_insensitive() {
        assert_eq!(content_format_from_name("Protokoll.PDF"), Some(ContentFormat::Pdf));
        assert_eq!(content_format_from_name("a.Pdf"), Some(ContentFormat::Pdf));
    }

    #[test]
    fn later_formats_are_recognized_but_not_extracted_here() {
        assert_eq!(content_format_from_name("Brief.docx"), Some(ContentFormat::Docx));
        assert_eq!(content_format_from_name("Liste.xlsx"), Some(ContentFormat::Xlsx));
        assert_eq!(content_format_from_name("notiz.txt"), None);
        assert_eq!(content_format_from_name("alt.doc"), None);
        assert_eq!(content_format_from_name("brief.rtf"), None);
    }

    #[test]
    fn prepare_collects_pdf_docx_and_xlsx() {
        use super::is_supported_content_document;
        assert!(is_supported_content_document(ContentFormat::Pdf));
        assert!(is_supported_content_document(ContentFormat::Docx));
        assert!(is_supported_content_document(ContentFormat::Xlsx));
    }
}
