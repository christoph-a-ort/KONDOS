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
    }
}
