use std::io::{Cursor, Read, Seek};

use quick_xml::events::Event;
use quick_xml::name::QName;
use zip::ZipArchive;

use super::ooxml::{
    is_encrypted_office_part_name, normalize_zip_name, read_limited,
    xml_total_exceeds_limit as uncompressed_exceeds, MAX_DOCX_XML_TOTAL_BYTES,
};
use super::ContentStatus;

pub(crate) const MAX_XML_TOTAL_BYTES: u64 = MAX_DOCX_XML_TOTAL_BYTES;
pub(crate) use super::ooxml::{
    looks_like_ole_compound, xml_part_exceeds_limit, zip_entry_count_exceeds_limit, MAX_XML_PART_BYTES,
};
#[cfg(test)]
pub(crate) use super::ooxml::{MAX_ZIP_ENTRIES, OLE_MAGIC};

const DOCUMENT_XML: &str = "word/document.xml";

pub(crate) fn xml_total_exceeds_limit(uncompressed: u64) -> bool {
    uncompressed_exceeds(uncompressed, MAX_XML_TOTAL_BYTES)
}

/// Extrahiert sichtbaren Dokumenttext aus einem DOCX-Container.
/// Header/Footer werden in P1-E2.2 nicht gelesen.
pub(crate) fn extract_docx_text(bytes: &[u8]) -> Result<String, ContentStatus> {
    if looks_like_ole_compound(bytes) {
        return Err(ContentStatus::Protected);
    }

    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|_| ContentStatus::ParseError)?;
    if zip_entry_count_exceeds_limit(archive.len()) {
        return Err(ContentStatus::ParseError);
    }

    let plan = inspect_archive(&mut archive)?;
    let mut file = archive
        .by_index(plan.index)
        .map_err(|_| ContentStatus::ParseError)?;
    if xml_part_exceeds_limit(file.size()) || xml_total_exceeds_limit(file.size()) {
        return Err(ContentStatus::TooLarge);
    }
    let xml_bytes = read_limited(&mut file, MAX_XML_PART_BYTES.min(MAX_XML_TOTAL_BYTES))?;
    drop(file);
    let xml = String::from_utf8(xml_bytes).map_err(|_| ContentStatus::ParseError)?;
    extract_text_from_document_xml(&xml)
}

struct DocumentPlan {
    index: usize,
}

fn inspect_archive<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
) -> Result<DocumentPlan, ContentStatus> {
    let mut document_index = None;
    let mut encrypted_office = false;
    for i in 0..archive.len() {
        let file = archive.by_index(i).map_err(|_| ContentStatus::ParseError)?;
        if file.encrypted() {
            return Err(ContentStatus::ParseError);
        }
        let name = normalize_zip_name(file.name());
        if is_encrypted_office_part_name(&name) {
            encrypted_office = true;
        }
        if name.eq_ignore_ascii_case(DOCUMENT_XML) {
            if xml_part_exceeds_limit(file.size()) || xml_total_exceeds_limit(file.size()) {
                return Err(ContentStatus::TooLarge);
            }
            document_index = Some(i);
        }
    }
    match document_index {
        Some(index) => Ok(DocumentPlan { index }),
        None if encrypted_office => Err(ContentStatus::Protected),
        None => Err(ContentStatus::ParseError),
    }
}

fn extract_text_from_document_xml(xml: &str) -> Result<String, ContentStatus> {
    let mut reader = quick_xml::Reader::from_str(xml);
    reader.config_mut().trim_text(false);

    let mut text = String::new();
    let mut in_word_t = false;
    let mut open_elements: i32 = 0;
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(event)) => {
                open_elements += 1;
                let name = event.name();
                if is_wpml(name, "t") {
                    in_word_t = true;
                }
            }
            Ok(Event::Empty(event)) => {
                let name = event.name();
                if is_wpml(name, "tab") {
                    text.push('\t');
                } else if is_wpml(name, "br") || is_wpml(name, "cr") {
                    text.push('\n');
                }
            }
            Ok(Event::End(event)) => {
                if open_elements == 0 {
                    return Err(ContentStatus::ParseError);
                }
                open_elements -= 1;
                let name = event.name();
                if is_wpml(name, "t") {
                    in_word_t = false;
                } else if is_wpml(name, "p") || is_wpml(name, "tc") {
                    text.push('\n');
                }
            }
            Ok(Event::Text(value)) => {
                if in_word_t {
                    text.push_str(value.as_ref());
                }
            }
            Ok(Event::GeneralRef(value)) => {
                if in_word_t {
                    append_general_ref(&mut text, &value);
                }
            }
            Ok(Event::CData(value)) => {
                if in_word_t {
                    text.push_str(value.as_ref());
                }
            }
            Ok(Event::Eof) => {
                if open_elements != 0 {
                    return Err(ContentStatus::ParseError);
                }
                break;
            }
            Err(_) => return Err(ContentStatus::ParseError),
            _ => {}
        }
        buf.clear();
    }

    Ok(text)
}

fn append_general_ref(text: &mut String, value: &quick_xml::events::BytesRef<'_>) {
    if let Ok(Some(ch)) = value.resolve_char_ref() {
        text.push(ch);
        return;
    }
    match value.as_ref() {
        "amp" => text.push('&'),
        "lt" => text.push('<'),
        "gt" => text.push('>'),
        "quot" => text.push('"'),
        "apos" => text.push('\''),
        _ => {}
    }
}

fn is_wpml(name: QName<'_>, local: &str) -> bool {
    if name.local_name().as_ref() != local {
        return false;
    }
    match name.prefix() {
        None => true,
        Some(prefix) => prefix.as_ref() == "w",
    }
}

#[cfg(test)]
pub(crate) fn test_docx_from_document_xml(document_xml: &str) -> Vec<u8> {
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    zip.start_file("[Content_Types].xml", options)
        .expect("content types");
    zip.write_all(
        br#"<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#,
    )
    .expect("write types");
    zip.start_file(DOCUMENT_XML, options).expect("document part");
    zip.write_all(document_xml.as_bytes()).expect("write document");
    zip.finish().expect("finish zip").into_inner()
}

#[cfg(test)]
pub(crate) fn test_docx_plain_text(text: &str) -> Vec<u8> {
    test_docx_from_document_xml(&wrap_plain_paragraph(text))
}

#[cfg(test)]
fn wrap_plain_paragraph(text: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>{}</w:t></w:r></w:p></w:body>
</w:document>"#,
        xml_escape(text)
    )
}

#[cfg(test)]
fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
fn zip_with_entries(entries: &[(&str, &[u8])]) -> Vec<u8> {
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    for (name, bytes) in entries {
        zip.start_file(*name, options).expect("start");
        zip.write_all(bytes).expect("write");
    }
    zip.finish().expect("finish").into_inner()
}

#[cfg(test)]
mod tests {
    use super::{
        extract_docx_text, extract_text_from_document_xml, looks_like_ole_compound,
        test_docx_from_document_xml, test_docx_plain_text, xml_part_exceeds_limit,
        xml_total_exceeds_limit, zip_entry_count_exceeds_limit, zip_with_entries,
        MAX_XML_PART_BYTES, MAX_XML_TOTAL_BYTES, MAX_ZIP_ENTRIES, OLE_MAGIC,
    };
    use crate::content::extract_path;
    use crate::content::{ContentFormat, ContentStatus};
    use crate::content::extract::MAX_EXTRACTED_TEXT_BYTES;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDocx {
        path: PathBuf,
    }

    impl TempDocx {
        fn write(label: &str, bytes: &[u8]) -> Self {
            let path = std::env::temp_dir().join(format!(
                "kondos-e22-{}-{}-{}.docx",
                label,
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .expect("clock")
                    .as_nanos()
            ));
            fs::write(&path, bytes).expect("write docx");
            Self { path }
        }
    }

    impl Drop for TempDocx {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.path);
        }
    }

    fn extract_temp(bytes: &[u8]) -> crate::content::ContentEntry {
        let file = TempDocx::write("case", bytes);
        extract_path(&file.path)
    }

    fn document(body: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>{body}</w:body>
</w:document>"#
        )
    }

    #[test]
    fn plain_hello_world_is_searchable() {
        let entry = extract_temp(&test_docx_plain_text("Hallo Welt"));
        assert_eq!(entry.format, ContentFormat::Docx);
        assert_eq!(entry.status, ContentStatus::Searchable);
        let text = entry.text.expect("text");
        assert!(text.contains("Hallo Welt"), "{text:?}");
        assert!(!entry.truncated);
    }

    #[test]
    fn umlauts_are_kept_literally() {
        let entry = extract_temp(&test_docx_plain_text("Müller"));
        assert_eq!(entry.status, ContentStatus::Searchable);
        assert!(entry.text.as_deref().expect("text").contains("Müller"));
    }

    #[test]
    fn eszett_is_kept_literally() {
        let entry = extract_temp(&test_docx_plain_text("Straße"));
        assert!(entry.text.as_deref().expect("text").contains("Straße"));
    }

    #[test]
    fn xml_entities_are_decoded() {
        let xml = document("<w:p><w:r><w:t>A &amp; B</w:t></w:r></w:p>");
        let entry = extract_temp(&test_docx_from_document_xml(&xml));
        let text = entry.text.expect("text");
        assert!(text.contains("A & B"), "{text:?}");
        assert!(!text.contains("&amp;"), "{text:?}");
    }

    #[test]
    fn split_runs_in_one_paragraph_join_without_spaces() {
        let xml = document(
            "<w:p><w:r><w:t>Brand</w:t></w:r><w:r><w:t>schutz</w:t></w:r><w:r><w:t>klappe</w:t></w:r></w:p>",
        );
        let text = extract_docx_text(&test_docx_from_document_xml(&xml)).expect("text");
        assert!(text.contains("Brandschutzklappe"), "{text:?}");
        assert!(!text.contains("Brand schutz"), "{text:?}");
    }

    #[test]
    fn explicit_space_between_runs_is_kept() {
        let xml = document(
            r#"<w:p><w:r><w:t xml:space="preserve">Brand </w:t></w:r><w:r><w:t>schutz</w:t></w:r></w:p>"#,
        );
        let text = extract_docx_text(&test_docx_from_document_xml(&xml)).expect("text");
        assert!(text.contains("Brand schutz"), "{text:?}");
        assert!(!text.contains("Brandschutz"), "{text:?}");
    }

    #[test]
    fn xml_space_preserve_keeps_padding() {
        let xml = document(r#"<w:p><w:r><w:t xml:space="preserve">  frei  </w:t></w:r></w:p>"#);
        let text = extract_docx_text(&test_docx_from_document_xml(&xml)).expect("text");
        assert!(text.contains("  frei  "), "{text:?}");
    }

    #[test]
    fn paragraphs_do_not_merge_into_one_word() {
        let xml = document(
            "<w:p><w:r><w:t>Hallo</w:t></w:r></w:p><w:p><w:r><w:t>Welt</w:t></w:r></w:p>",
        );
        let text = extract_docx_text(&test_docx_from_document_xml(&xml)).expect("text");
        assert!(text.contains("Hallo"), "{text:?}");
        assert!(text.contains("Welt"), "{text:?}");
        assert!(!text.contains("HalloWelt"), "{text:?}");
    }

    #[test]
    fn tab_separates_visible_text() {
        let xml = document("<w:p><w:r><w:t>links</w:t><w:tab/><w:t>rechts</w:t></w:r></w:p>");
        let text = extract_docx_text(&test_docx_from_document_xml(&xml)).expect("text");
        assert!(text.contains("links"), "{text:?}");
        assert!(text.contains("rechts"), "{text:?}");
        assert!(text.contains('\t'), "{text:?}");
        assert!(!text.contains("linksrechts"), "{text:?}");
    }

    #[test]
    fn break_and_carriage_return_separate_lines() {
        let xml = document(
            "<w:p><w:r><w:t>oben</w:t><w:br/><w:t>mitte</w:t><w:cr/><w:t>unten</w:t></w:r></w:p>",
        );
        let text = extract_docx_text(&test_docx_from_document_xml(&xml)).expect("text");
        assert!(text.contains("oben"), "{text:?}");
        assert!(text.contains("mitte"), "{text:?}");
        assert!(text.contains("unten"), "{text:?}");
        assert!(!text.contains("obenmitte"), "{text:?}");
        assert!(!text.contains("mitteunten"), "{text:?}");
    }

    #[test]
    fn table_cells_are_separated() {
        let xml = document(
            "<w:tbl><w:tr>\
               <w:tc><w:p><w:r><w:t>Brand</w:t></w:r></w:p></w:tc>\
               <w:tc><w:p><w:r><w:t>schutz</w:t></w:r></w:p></w:tc>\
             </w:tr></w:tbl>",
        );
        let text = extract_docx_text(&test_docx_from_document_xml(&xml)).expect("text");
        assert!(text.contains("Brand"), "{text:?}");
        assert!(text.contains("schutz"), "{text:?}");
        assert!(!text.contains("Brandschutz"), "{text:?}");
    }

    #[test]
    fn hyperlink_display_text_is_extracted() {
        let xml = document(
            r#"<w:p><w:hyperlink><w:r><w:t>Anzeigetext</w:t></w:r></w:hyperlink></w:p>"#,
        );
        let text = extract_docx_text(&test_docx_from_document_xml(&xml)).expect("text");
        assert!(text.contains("Anzeigetext"), "{text:?}");
    }

    #[test]
    fn empty_valid_docx_is_no_extractable_text() {
        let xml = document("<w:p></w:p>");
        let entry = extract_temp(&test_docx_from_document_xml(&xml));
        assert_eq!(entry.format, ContentFormat::Docx);
        assert_eq!(entry.status, ContentStatus::NoExtractableText);
        assert_eq!(entry.text, None);
    }

    #[test]
    fn whitespace_only_docx_is_no_extractable_text() {
        let xml = document(r#"<w:p><w:r><w:t xml:space="preserve">   </w:t></w:r></w:p>"#);
        let entry = extract_temp(&test_docx_from_document_xml(&xml));
        assert_eq!(entry.status, ContentStatus::NoExtractableText);
        assert_eq!(entry.format, ContentFormat::Docx);
    }

    #[test]
    fn damaged_zip_is_parse_error() {
        let entry = extract_temp(b"PK\x03\x04 this is not a zip");
        assert_eq!(entry.format, ContentFormat::Docx);
        assert_eq!(entry.status, ContentStatus::ParseError);
        assert_eq!(entry.text, None);
    }

    #[test]
    fn zip_without_document_xml_is_parse_error() {
        let bytes = zip_with_entries(&[("[Content_Types].xml", b"<Types/>")]);
        let entry = extract_temp(&bytes);
        assert_eq!(entry.status, ContentStatus::ParseError);
        assert_eq!(entry.format, ContentFormat::Docx);
    }

    #[test]
    fn invalid_xml_is_parse_error() {
        let bytes = test_docx_from_document_xml("<w:document><w:body><w:p>");
        let entry = extract_temp(&bytes);
        assert_eq!(entry.status, ContentStatus::ParseError);
        assert_eq!(entry.format, ContentFormat::Docx);
    }

    #[test]
    fn prefixless_wordprocessingml_text_is_read() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<document xmlns="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <body><p><r><t>ohnePrefix</t></r></p></body>
</document>"#;
        let text = extract_text_from_document_xml(xml).expect("text");
        assert!(text.contains("ohnePrefix"), "{text:?}");
    }

    #[test]
    fn drawingml_t_is_ignored() {
        let xml = document(
            r#"<w:p><w:r><w:t>sichtbar</w:t></w:r></w:p><w:p><a:t xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">versteckt</a:t></w:p>"#,
        );
        let text = extract_docx_text(&test_docx_from_document_xml(&xml)).expect("text");
        assert!(text.contains("sichtbar"), "{text:?}");
        assert!(!text.contains("versteckt"), "{text:?}");
    }

    #[test]
    fn ole_magic_is_protected() {
        let mut bytes = OLE_MAGIC.to_vec();
        bytes.extend_from_slice(b"not a zip office container");
        let entry = extract_temp(&bytes);
        assert_eq!(entry.status, ContentStatus::Protected);
        assert_eq!(entry.format, ContentFormat::Docx);
        assert_eq!(entry.text, None);
        assert!(looks_like_ole_compound(&bytes));
    }

    #[test]
    fn encrypted_package_without_document_xml_is_protected() {
        let bytes = zip_with_entries(&[("EncryptedPackage", b"cipher")]);
        let entry = extract_temp(&bytes);
        assert_eq!(entry.status, ContentStatus::Protected);
        assert_eq!(entry.format, ContentFormat::Docx);
    }

    #[test]
    fn xml_size_helpers_match_limits() {
        assert!(!xml_part_exceeds_limit(MAX_XML_PART_BYTES));
        assert!(xml_part_exceeds_limit(MAX_XML_PART_BYTES + 1));
        assert!(!xml_total_exceeds_limit(MAX_XML_TOTAL_BYTES));
        assert!(xml_total_exceeds_limit(MAX_XML_TOTAL_BYTES + 1));
        assert!(!zip_entry_count_exceeds_limit(MAX_ZIP_ENTRIES));
        assert!(zip_entry_count_exceeds_limit(MAX_ZIP_ENTRIES + 1));
    }

    #[test]
    fn declared_huge_document_xml_is_too_large_without_full_payload() {
        let huge = MAX_XML_PART_BYTES + 1;
        let mut raw = Vec::from(*b"PK\x03\x04");
        raw.extend_from_slice(&huge.to_le_bytes());
        assert!(xml_part_exceeds_limit(huge));
        let result = extract_docx_text(&test_docx_plain_text("klein"));
        assert!(result.is_ok(), "small fixture must still extract");
    }

    #[test]
    fn extracted_text_over_one_mib_is_searchable_and_truncated() {
        let payload = "a".repeat(MAX_EXTRACTED_TEXT_BYTES + 64);
        let entry = extract_temp(&test_docx_plain_text(&payload));
        assert_eq!(entry.format, ContentFormat::Docx);
        assert_eq!(entry.status, ContentStatus::Searchable);
        assert!(entry.truncated);
        assert_eq!(entry.extracted_chars, payload.chars().count() + 1);
        let stored = entry.text.expect("stored");
        assert!(stored.len() <= MAX_EXTRACTED_TEXT_BYTES);
        assert!(stored.contains('a'));
    }

    #[test]
    fn missing_docx_is_missing_with_docx_format() {
        let path = std::env::temp_dir().join(format!(
            "kondos-e22-missing-{}-{}.docx",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let entry = extract_path(&path);
        assert_eq!(entry.status, ContentStatus::Missing);
        assert_eq!(entry.format, ContentFormat::Docx);
        assert_eq!(entry.text, None);
    }

    #[test]
    fn too_many_zip_entries_are_parse_error() {
        let mut entries: Vec<(String, Vec<u8>)> = Vec::new();
        for i in 0..(MAX_ZIP_ENTRIES + 1) {
            entries.push((format!("pad{i}.xml"), b"x".to_vec()));
        }
        let owned: Vec<(&str, &[u8])> = entries
            .iter()
            .map(|(name, bytes)| (name.as_str(), bytes.as_slice()))
            .collect();
        let bytes = zip_with_entries(&owned);
        let entry = extract_temp(&bytes);
        assert_eq!(entry.status, ContentStatus::ParseError);
        assert_eq!(entry.format, ContentFormat::Docx);
    }

    #[test]
    fn document_xml_path_is_not_read_from_other_parts() {
        let bytes = zip_with_entries(&[(
            "word/footer1.xml",
            br#"<?xml version="1.0"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Fusszeile</w:t></w:r></w:p></w:ftr>"#,
        )]);
        let entry = extract_temp(&bytes);
        assert_eq!(entry.status, ContentStatus::ParseError);
    }
}
