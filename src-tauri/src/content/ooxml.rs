use std::io::{Cursor, Read, Seek};

use zip::ZipArchive;

use super::ContentStatus;

/// Unkomprimierte Größe eines gelesenen XML-Parts.
pub(crate) const MAX_XML_PART_BYTES: u64 = 32 * 1024 * 1024;
/// Summe unkomprimierter gelesener XML-Parts für DOCX (nur document.xml).
pub(crate) const MAX_DOCX_XML_TOTAL_BYTES: u64 = 48 * 1024 * 1024;
/// Laufende Summe gelesener unkomprimierter XML-Parts für XLSX.
pub(crate) const MAX_XLSX_XML_TOTAL_BYTES: u64 = 64 * 1024 * 1024;
pub(crate) const MAX_ZIP_ENTRIES: usize = 4096;

pub(crate) const OLE_MAGIC: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

pub(crate) fn looks_like_ole_compound(bytes: &[u8]) -> bool {
    bytes.len() >= OLE_MAGIC.len() && bytes[..OLE_MAGIC.len()] == OLE_MAGIC
}

pub(crate) fn xml_part_exceeds_limit(uncompressed: u64) -> bool {
    uncompressed > MAX_XML_PART_BYTES
}

pub(crate) fn xml_total_exceeds_limit(uncompressed: u64, max_total: u64) -> bool {
    uncompressed > max_total
}

pub(crate) fn zip_entry_count_exceeds_limit(count: usize) -> bool {
    count > MAX_ZIP_ENTRIES
}

pub(crate) fn normalize_zip_name(name: &str) -> String {
    name.replace('\\', "/")
        .trim_start_matches("./")
        .to_string()
}

pub(crate) fn is_encrypted_office_part_name(name: &str) -> bool {
    let name = normalize_zip_name(name);
    name.eq_ignore_ascii_case("encryptedpackage") || name.eq_ignore_ascii_case("encryptioninfo")
}

pub(crate) fn open_office_zip(bytes: &[u8]) -> Result<ZipArchive<Cursor<&[u8]>>, ContentStatus> {
    if looks_like_ole_compound(bytes) {
        return Err(ContentStatus::Protected);
    }
    let archive = ZipArchive::new(Cursor::new(bytes)).map_err(|_| ContentStatus::ParseError)?;
    if zip_entry_count_exceeds_limit(archive.len()) {
        return Err(ContentStatus::ParseError);
    }
    Ok(archive)
}

pub(crate) fn read_limited<R: Read>(reader: &mut R, max_bytes: u64) -> Result<Vec<u8>, ContentStatus> {
    let mut limited = reader.take(max_bytes.saturating_add(1));
    let mut buf = Vec::new();
    limited
        .read_to_end(&mut buf)
        .map_err(|_| ContentStatus::ParseError)?;
    if buf.len() as u64 > max_bytes {
        return Err(ContentStatus::TooLarge);
    }
    Ok(buf)
}

pub(crate) fn read_zip_part<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    index: usize,
    budget: &mut u64,
    max_total: u64,
) -> Result<String, ContentStatus> {
    let mut file = archive
        .by_index(index)
        .map_err(|_| ContentStatus::ParseError)?;
    if file.encrypted() {
        return Err(ContentStatus::ParseError);
    }
    let size = file.size();
    if xml_part_exceeds_limit(size) {
        return Err(ContentStatus::TooLarge);
    }
    let next_total = budget.saturating_add(size);
    if xml_total_exceeds_limit(next_total, max_total) {
        return Err(ContentStatus::TooLarge);
    }
    let xml_bytes = read_limited(&mut file, MAX_XML_PART_BYTES.min(max_total.saturating_sub(*budget)))?;
    drop(file);
    *budget = budget.saturating_add(xml_bytes.len() as u64);
    if xml_total_exceeds_limit(*budget, max_total) {
        return Err(ContentStatus::TooLarge);
    }
    String::from_utf8(xml_bytes).map_err(|_| ContentStatus::ParseError)
}

pub(crate) fn scan_zip_names<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
) -> Result<(Vec<(String, usize)>, bool), ContentStatus> {
    let mut names = Vec::with_capacity(archive.len());
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
        names.push((name, i));
    }
    Ok((names, encrypted_office))
}

pub(crate) fn find_part_index(names: &[(String, usize)], wanted: &str) -> Option<usize> {
    names
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(wanted))
        .map(|(_, index)| *index)
}

pub(crate) fn append_xml_text(text: &mut String, value: &quick_xml::events::BytesText<'_>) {
    text.push_str(value.as_ref());
}

pub(crate) fn append_general_ref(text: &mut String, value: &quick_xml::events::BytesRef<'_>) {
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
