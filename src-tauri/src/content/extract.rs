use std::io;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;

use super::docx::extract_docx_text;
use super::format::content_format_from_name;
use super::{ContentEntry, ContentFormat, ContentStatus};

/// Dateien über dieser Größe werden nicht vollständig gelesen.
pub const MAX_PDF_FILE_BYTES: u64 = 50 * 1024 * 1024;

/// Gespeicherter Extrakt wird auf diese UTF-8-Bytezahl begrenzt.
pub const MAX_EXTRACTED_TEXT_BYTES: usize = 1024 * 1024;

pub fn file_exceeds_size_limit(len: u64) -> bool {
    len > MAX_PDF_FILE_BYTES
}

pub fn content_status_from_io(err: &io::Error) -> ContentStatus {
    match err.kind() {
        io::ErrorKind::NotFound => ContentStatus::Missing,
        io::ErrorKind::PermissionDenied => ContentStatus::AccessDenied,
        _ => ContentStatus::IoError,
    }
}

/// Liest den Pfad und liefert einen Cache-Eintrag. Niemals `unwrap` auf Dateiinhalt.
pub fn extract_path(path: &Path) -> ContentEntry {
    let path_str = path.to_string_lossy().into_owned();
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| path_str.clone());
    extract_named_path(path, path_str, name)
}

fn extract_named_path(path: &Path, path_str: String, name: String) -> ContentEntry {
    let format = content_format_from_name(&name);

    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(err) => {
            return status_entry(
                path_str,
                name,
                resolved_content_format(format),
                content_status_from_io(&err),
            );
        }
    };
    if metadata.is_dir() {
        return status_entry(
            path_str,
            name,
            resolved_content_format(format),
            ContentStatus::IoError,
        );
    }
    if file_exceeds_size_limit(metadata.len()) {
        return status_entry(
            path_str,
            name,
            resolved_content_format(format),
            ContentStatus::TooLarge,
        );
    }

    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(err) => {
            return status_entry(
                path_str,
                name,
                resolved_content_format(format),
                content_status_from_io(&err),
            );
        }
    };
    if file_exceeds_size_limit(bytes.len() as u64) {
        return status_entry(
            path_str,
            name,
            resolved_content_format(format),
            ContentStatus::TooLarge,
        );
    }

    match format {
        Some(ContentFormat::Pdf) => extract_pdf_bytes(path_str, name, &bytes),
        Some(ContentFormat::Docx) => match catch_parser_unwind(|| extract_docx_text(&bytes)) {
            Ok(raw) => entry_from_extracted_text(path_str, name, ContentFormat::Docx, raw),
            Err(status) => status_entry(path_str, name, ContentFormat::Docx, status),
        },
        Some(ContentFormat::Xlsx) => {
            status_entry(path_str, name, ContentFormat::Xlsx, ContentStatus::ParseError)
        }
        // Unbekannte Endungen werden nicht gesammelt. ContentEntry.format ist kein Option;
        // ohne neue Enum-Variante bleibt Pdf nur dieser direkte extract_path-Fallback.
        None => status_entry(path_str, name, ContentFormat::Pdf, ContentStatus::ParseError),
    }
}

fn extract_pdf_bytes(path: String, name: String, bytes: &[u8]) -> ContentEntry {
    match run_pdf_extract(bytes) {
        Ok(raw) => entry_from_extracted_text(path, name, ContentFormat::Pdf, raw),
        Err(status) => status_entry(path, name, ContentFormat::Pdf, status),
    }
}

fn run_pdf_extract(bytes: &[u8]) -> Result<String, ContentStatus> {
    catch_parser_unwind(|| extract_loaded_pdf(bytes))
}

fn catch_parser_unwind<F, T>(f: F) -> Result<T, ContentStatus>
where
    F: FnOnce() -> Result<T, ContentStatus>,
{
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(result) => result,
        Err(_) => Err(ContentStatus::ParseError),
    }
}

/// Kein eigenes Passwort, kein `extract_text_from_mem` (das versucht intern `""`).
fn extract_loaded_pdf(bytes: &[u8]) -> Result<String, ContentStatus> {
    let doc = match pdf_extract::Document::load_mem(bytes) {
        Ok(doc) => doc,
        Err(err) => return Err(content_status_from_lopdf_error(&err)),
    };
    if doc.is_encrypted() {
        return Err(ContentStatus::Protected);
    }

    let mut text = String::new();
    {
        let mut output = pdf_extract::PlainTextOutput::new(&mut text);
        if let Err(err) = pdf_extract::output_doc(&doc, &mut output) {
            return Err(content_status_from_pdf_error(&err));
        }
    }
    Ok(text)
}

fn content_status_from_lopdf_error(err: &pdf_extract::Error) -> ContentStatus {
    if looks_protected_message(&err.to_string()) {
        ContentStatus::Protected
    } else {
        ContentStatus::ParseError
    }
}

fn content_status_from_pdf_error(err: &pdf_extract::OutputError) -> ContentStatus {
    if pdf_error_indicates_protection(err) {
        ContentStatus::Protected
    } else {
        ContentStatus::ParseError
    }
}

/// Nur enge, bekannte lopdf-/pdf-extract-Formulierungen. Kein allgemeines Raten.
fn pdf_error_indicates_protection(err: &pdf_extract::OutputError) -> bool {
    if looks_protected_message(&err.to_string()) {
        return true;
    }
    let mut source = std::error::Error::source(err);
    while let Some(inner) = source {
        if looks_protected_message(&inner.to_string()) {
            return true;
        }
        source = inner.source();
    }
    false
}

fn looks_protected_message(msg: &str) -> bool {
    let msg = msg.to_ascii_lowercase();
    msg.contains("invalid password")
        || msg.contains("already encrypted")
        || msg.contains("unsupported security handler")
        || msg.contains("decryption")
        || (msg.contains("encrypted") && !msg.contains("not encrypted"))
}

/// `extracted_chars` ist die Zeichenzahl des rohen Parser-Textes vor der Byte-Kappung.
fn entry_from_extracted_text(
    path: String,
    name: String,
    format: ContentFormat,
    raw: String,
) -> ContentEntry {
    let body = finalize_extracted_text(raw);
    ContentEntry {
        path,
        name,
        format,
        status: body.status,
        text: body.text,
        extracted_chars: body.extracted_chars,
        truncated: body.truncated,
    }
}

fn resolved_content_format(format: Option<ContentFormat>) -> ContentFormat {
    format.unwrap_or(ContentFormat::Pdf)
}

struct FinalizedText {
    status: ContentStatus,
    text: Option<String>,
    extracted_chars: usize,
    truncated: bool,
}

fn finalize_extracted_text(raw: String) -> FinalizedText {
    if !has_extractable_text(&raw) {
        return FinalizedText {
            status: ContentStatus::NoExtractableText,
            text: None,
            extracted_chars: 0,
            truncated: false,
        };
    }

    let extracted_chars = raw.chars().count();
    let (text, truncated) = truncate_utf8_bytes(raw, MAX_EXTRACTED_TEXT_BYTES);
    FinalizedText {
        status: ContentStatus::Searchable,
        text: Some(text),
        extracted_chars,
        truncated,
    }
}

fn has_extractable_text(raw: &str) -> bool {
    raw.chars().any(|ch| !ch.is_whitespace() && ch != '\0')
}

fn truncate_utf8_bytes(raw: String, max_bytes: usize) -> (String, bool) {
    if raw.len() <= max_bytes {
        return (raw, false);
    }
    let mut end = max_bytes;
    while end > 0 && !raw.is_char_boundary(end) {
        end -= 1;
    }
    (raw[..end].to_string(), true)
}

fn status_entry(
    path: String,
    name: String,
    format: ContentFormat,
    status: ContentStatus,
) -> ContentEntry {
    ContentEntry {
        path,
        name,
        format,
        status,
        text: None,
        extracted_chars: 0,
        truncated: false,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        content_status_from_io, extract_path, file_exceeds_size_limit, finalize_extracted_text,
        looks_protected_message, run_pdf_extract, truncate_utf8_bytes, MAX_EXTRACTED_TEXT_BYTES,
        MAX_PDF_FILE_BYTES,
    };
    use crate::content::ContentStatus;
    use std::fs;
    use std::io::{self, ErrorKind};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempPdf {
        path: PathBuf,
    }

    impl TempPdf {
        fn write(label: &str, bytes: &[u8]) -> Self {
            let path = std::env::temp_dir().join(format!(
                "kondos-e12-{}-{}-{}.pdf",
                label,
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .expect("clock")
                    .as_nanos()
            ));
            fs::write(&path, bytes).expect("write pdf fixture");
            Self { path }
        }
    }

    impl Drop for TempPdf {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.path);
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

    fn text_pdf(visible: &str) -> Vec<u8> {
        let content = format!(
            "BT /F1 12 Tf 72 720 Td ({}) Tj ET\n",
            escape_pdf_literal(visible)
        );
        assemble_pdf(&content)
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

    fn extract_temp(bytes: &[u8]) -> crate::content::ContentEntry {
        let pdf = TempPdf::write("case", bytes);
        extract_path(&pdf.path)
    }

    #[test]
    fn parser_unwind_boundary_maps_panic_to_parse_error() {
        let status = match super::catch_parser_unwind(|| -> Result<(), ContentStatus> {
            panic!("kondos test-only parser panic");
        }) {
            Ok(()) => panic!("catch_unwind did not intercept"),
            Err(status) => status,
        };
        assert_eq!(status, ContentStatus::ParseError);
    }

    #[test]
    fn german_text_pdf_is_searchable() {
        let entry = extract_temp(&text_pdf("Die Brandschutzklappe ist frei."));
        assert_eq!(entry.status, ContentStatus::Searchable);
        let text = entry.text.expect("text");
        assert!(text.contains("Brandschutzklappe"), "{text:?}");
        assert!(text.contains("frei"), "{text:?}");
        assert!(!entry.truncated);
        assert_eq!(entry.extracted_chars, text.chars().count());
        assert_eq!(entry.format, crate::content::ContentFormat::Pdf);
    }

    #[test]
    fn original_letter_case_is_kept() {
        let entry = extract_temp(&text_pdf("PDF-Protokoll"));
        let text = entry.text.expect("text");
        assert!(text.contains("PDF-Protokoll"), "{text:?}");
    }

    #[test]
    fn umlauts_remain_valid_utf8() {
        let entry = extract_temp(&text_pdf("Änderung für Prüfung"));
        assert_eq!(entry.status, ContentStatus::Searchable);
        let text = entry.text.expect("text");
        assert!(text.is_ascii() || std::str::from_utf8(text.as_bytes()).is_ok());
        assert!(
            text.contains("Änderung") && text.contains("für") && text.contains("Prüfung"),
            "{text:?}"
        );
    }

    #[test]
    fn empty_content_stream_is_no_extractable_text() {
        let entry = extract_temp(&assemble_pdf("BT ET\n"));
        assert_eq!(entry.status, ContentStatus::NoExtractableText);
        assert_eq!(entry.text, None);
        assert_eq!(entry.extracted_chars, 0);
        assert!(!entry.truncated);
    }

    #[test]
    fn whitespace_only_text_is_no_extractable_text() {
        let body = finalize_extracted_text(" \n\t  ".to_string());
        assert_eq!(body.status, ContentStatus::NoExtractableText);
        assert_eq!(body.text, None);

        let entry = extract_temp(&text_pdf(" \n\t  "));
        assert_eq!(entry.status, ContentStatus::NoExtractableText);
        assert_eq!(entry.text, None);
    }

    #[test]
    fn short_real_word_stays_searchable() {
        let entry = extract_temp(&text_pdf("Freigabe"));
        assert_eq!(entry.status, ContentStatus::Searchable);
        let text = entry.text.expect("text");
        assert!(text.contains("Freigabe"), "{text:?}");
    }

    #[test]
    fn damaged_pdf_is_parse_error_without_escaping_panic() {
        let entry = extract_temp(b"%PDF-1.4\n1 0 obj\n<< /Broken");
        assert_eq!(entry.status, ContentStatus::ParseError);
        assert_eq!(entry.text, None);
    }

    #[test]
    fn missing_path_is_missing() {
        let path = std::env::temp_dir().join(format!(
            "kondos-e12-missing-{}-{}.pdf",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let entry = extract_path(&path);
        assert_eq!(entry.status, ContentStatus::Missing);
        assert_eq!(entry.text, None);
    }

    #[test]
    fn size_limit_rejects_before_parser_without_large_fixture() {
        assert!(!file_exceeds_size_limit(MAX_PDF_FILE_BYTES));
        assert!(file_exceeds_size_limit(MAX_PDF_FILE_BYTES + 1));
        let raw = run_pdf_extract(&text_pdf("klein"));
        assert!(raw.is_ok(), "parser must still run for small files");
    }

    #[test]
    fn text_limit_keeps_utf8_and_original_char_count() {
        let mut raw = "a".repeat(MAX_EXTRACTED_TEXT_BYTES - 1);
        raw.push('ä');
        raw.push('Z');
        let original_chars = raw.chars().count();
        let body = finalize_extracted_text(raw);
        assert_eq!(body.status, ContentStatus::Searchable);
        assert!(body.truncated);
        assert_eq!(body.extracted_chars, original_chars);
        let stored = body.text.expect("stored");
        assert!(stored.is_char_boundary(stored.len()));
        assert!(stored.len() <= MAX_EXTRACTED_TEXT_BYTES);
        assert!(stored.ends_with('a') || stored.ends_with('ä'));
        assert!(!stored.contains('Z'));
    }

    #[test]
    fn truncate_does_not_split_multibyte_char() {
        let (kept, truncated) = truncate_utf8_bytes("abäc".to_string(), 4);
        assert!(truncated);
        assert_eq!(kept, "abä");
        assert!(kept.is_char_boundary(kept.len()));
    }

    #[test]
    fn io_kinds_map_to_content_status() {
        assert_eq!(
            content_status_from_io(&io::Error::from(ErrorKind::NotFound)),
            ContentStatus::Missing
        );
        assert_eq!(
            content_status_from_io(&io::Error::from(ErrorKind::PermissionDenied)),
            ContentStatus::AccessDenied
        );
        assert_eq!(
            content_status_from_io(&io::Error::from(ErrorKind::InvalidData)),
            ContentStatus::IoError
        );
    }

    #[test]
    fn unimplemented_docx_is_not_parsed_as_pdf() {
        let path = std::env::temp_dir().join(format!(
            "kondos-e12-{}-{}.docx",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::write(&path, text_pdf("soll nicht als PDF gelesen werden")).expect("docx bytes");
        let entry = extract_path(&path);
        let _ = fs::remove_file(&path);
        assert_eq!(entry.status, ContentStatus::ParseError);
        assert_eq!(entry.format, crate::content::ContentFormat::Docx);
        assert_eq!(entry.text, None);
    }

    #[test]
    fn unimplemented_xlsx_keeps_xlsx_format() {
        let path = std::env::temp_dir().join(format!(
            "kondos-e21-{}-{}.xlsx",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::write(&path, text_pdf("soll nicht als PDF gelesen werden")).expect("xlsx bytes");
        let entry = extract_path(&path);
        let _ = fs::remove_file(&path);
        assert_eq!(entry.status, ContentStatus::ParseError);
        assert_eq!(entry.format, crate::content::ContentFormat::Xlsx);
        assert_eq!(entry.text, None);
    }

    #[test]
    fn encrypted_looking_error_text_is_protected() {
        assert!(looks_protected_message("Decryption error: invalid password"));
        assert!(looks_protected_message("File is encrypted"));
        assert!(!looks_protected_message("File is not encrypted"));
        assert!(!looks_protected_message("unexpected end of file"));
    }

    #[test]
    fn encrypted_pdf_is_protected_without_password_prompt() {
        let bytes = encrypted_test_pdf();
        let entry = extract_temp(&bytes);
        assert_eq!(entry.status, ContentStatus::Protected);
        assert_eq!(entry.text, None);
    }

    fn encrypted_test_pdf() -> Vec<u8> {
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
}
