//! FV2-02e.3b – Pure classification of already extracted Windows stream names.
//! No filesystem access and no Windows API calls.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamDisposition {
    AllowNoExtraStreams,
    AllowOnlyZoneIdentifier,
    DenyForeignStreams,
    Unverifiable,
}

/// One stream name already taken from a Windows enumeration.
///
/// `byte_length` is the explicit UTF-16 byte length. Bytes past that length are not part of the
/// name, so a terminator outside the length is ignored. `stream_size` is never a reason to allow
/// a stream.
pub struct ReportedStream<'a> {
    pub byte_length: usize,
    pub bytes: &'a [u8],
    pub stream_size: u64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RecordClass {
    Default,
    ZoneIdentifier,
    Foreign,
    Unverifiable,
}

#[must_use]
pub fn classify_reported_streams(streams: &[ReportedStream<'_>]) -> StreamDisposition {
    if streams.is_empty() {
        return StreamDisposition::Unverifiable;
    }
    let mut defaults = 0u32;
    let mut zones = 0u32;
    let mut foreign = false;
    for stream in streams {
        match classify_record(stream) {
            RecordClass::Unverifiable => return StreamDisposition::Unverifiable,
            RecordClass::Default => defaults = defaults.saturating_add(1),
            RecordClass::ZoneIdentifier => zones = zones.saturating_add(1),
            RecordClass::Foreign => foreign = true,
        }
    }
    if foreign {
        return StreamDisposition::DenyForeignStreams;
    }
    match (defaults, zones) {
        (1, 0) => StreamDisposition::AllowNoExtraStreams,
        (1, 1) => StreamDisposition::AllowOnlyZoneIdentifier,
        _ => StreamDisposition::Unverifiable,
    }
}

fn classify_record(stream: &ReportedStream<'_>) -> RecordClass {
    // The reported payload length is intentionally not part of the allow decision.
    let _ = stream.stream_size;
    let Some(text) = decode_stream_name(stream.byte_length, stream.bytes) else {
        return RecordClass::Unverifiable;
    };
    let Some((name, stream_type)) = split_stream_name(&text) else {
        return RecordClass::Unverifiable;
    };
    if stream_type.is_empty() {
        return RecordClass::Unverifiable;
    }
    if !ascii_eq_ignore_case(stream_type, "$DATA") {
        return RecordClass::Foreign;
    }
    if name.is_empty() {
        return RecordClass::Default;
    }
    if ascii_eq_ignore_case(name, "Zone.Identifier") {
        return RecordClass::ZoneIdentifier;
    }
    RecordClass::Foreign
}

fn decode_stream_name(byte_length: usize, bytes: &[u8]) -> Option<String> {
    if byte_length > bytes.len() || byte_length % 2 != 0 {
        return None;
    }
    let mut units = Vec::with_capacity(byte_length / 2);
    let mut index = 0;
    while index < byte_length {
        let low = bytes.get(index).copied()?;
        let high = bytes.get(index + 1).copied()?;
        let unit = u16::from_le_bytes([low, high]);
        if unit == 0 {
            return None;
        }
        units.push(unit);
        index += 2;
    }
    String::from_utf16(&units).ok()
}

fn split_stream_name(text: &str) -> Option<(&str, &str)> {
    let mut chars = text.chars();
    if chars.next() != Some(':') {
        return None;
    }
    let rest = chars.as_str();
    let separator = rest.find(':')?;
    let name = rest.get(..separator)?;
    let stream_type = rest.get(separator + 1..)?;
    if stream_type.contains(':') {
        return None;
    }
    Some((name, stream_type))
}

fn ascii_eq_ignore_case(left: &str, right: &str) -> bool {
    let left = left.as_bytes();
    let right = right.as_bytes();
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right.iter())
        .all(|(left_byte, right_byte)| {
            left_byte.to_ascii_lowercase() == right_byte.to_ascii_lowercase()
        })
}

#[cfg(test)]
mod tests {
    use super::{classify_reported_streams, ReportedStream, StreamDisposition};

    fn utf16_bytes(text: &str) -> Vec<u8> {
        text.encode_utf16()
            .flat_map(|unit| unit.to_le_bytes())
            .collect()
    }

    fn classify_owned(items: &[(&[u8], usize, u64)]) -> StreamDisposition {
        let records: Vec<ReportedStream<'_>> = items
            .iter()
            .map(|(bytes, byte_length, stream_size)| ReportedStream {
                byte_length: *byte_length,
                bytes,
                stream_size: *stream_size,
            })
            .collect();
        classify_reported_streams(&records)
    }

    fn classify_texts(items: &[(&str, u64)]) -> StreamDisposition {
        let encoded: Vec<Vec<u8>> = items.iter().map(|(text, _)| utf16_bytes(text)).collect();
        let borrowed: Vec<(&[u8], usize, u64)> = encoded
            .iter()
            .zip(items.iter())
            .map(|(bytes, (_, stream_size))| (bytes.as_slice(), bytes.len(), *stream_size))
            .collect();
        classify_owned(&borrowed)
    }

    #[test]
    fn default_stream_alone_is_allowed() {
        assert_eq!(
            classify_texts(&[("::$DATA", 12)]),
            StreamDisposition::AllowNoExtraStreams
        );
    }

    #[test]
    fn default_plus_zone_identifier_is_allowed() {
        assert_eq!(
            classify_texts(&[("::$DATA", 12), (":Zone.Identifier:$DATA", 24)]),
            StreamDisposition::AllowOnlyZoneIdentifier
        );
    }

    #[test]
    fn zone_identifier_ascii_case_is_ignored() {
        for name in [
            ":zone.identifier:$DATA",
            ":ZONE.IDENTIFIER:$data",
            ":Zone.IDENTIFIER:$Data",
        ] {
            assert_eq!(
                classify_texts(&[("::$DATA", 4), (name, 0)]),
                StreamDisposition::AllowOnlyZoneIdentifier,
                "{name}"
            );
        }
    }

    #[test]
    fn foreign_named_stream_is_denied() {
        assert_eq!(
            classify_texts(&[(":Zusatzdaten:$DATA", 8)]),
            StreamDisposition::DenyForeignStreams
        );
    }

    #[test]
    fn default_plus_foreign_stream_is_denied() {
        assert_eq!(
            classify_texts(&[("::$DATA", 4), (":Zusatzdaten:$DATA", 8)]),
            StreamDisposition::DenyForeignStreams
        );
    }

    #[test]
    fn zone_identifier_plus_foreign_stream_is_denied() {
        assert_eq!(
            classify_texts(&[
                ("::$DATA", 4),
                (":Zone.Identifier:$DATA", 24),
                (":Zusatzdaten:$DATA", 1),
            ]),
            StreamDisposition::DenyForeignStreams
        );
    }

    #[test]
    fn zone_identifier_backup_is_denied() {
        assert_eq!(
            classify_texts(&[("::$DATA", 4), (":Zone.Identifier.Backup:$DATA", 0)]),
            StreamDisposition::DenyForeignStreams
        );
    }

    #[test]
    fn zone_identifier_txt_is_denied() {
        assert_eq!(
            classify_texts(&[("::$DATA", 4), (":Zone.Identifier.txt:$DATA", 0)]),
            StreamDisposition::DenyForeignStreams
        );
    }

    #[test]
    fn spaced_zone_identifier_is_denied() {
        assert_eq!(
            classify_texts(&[("::$DATA", 4), (": Zone.Identifier:$DATA", 3)]),
            StreamDisposition::DenyForeignStreams
        );
        assert_eq!(
            classify_texts(&[("::$DATA", 4), (":Zone.Identifier :$DATA", 3)]),
            StreamDisposition::DenyForeignStreams
        );
        assert_eq!(
            classify_texts(&[("::$DATA", 4), (":Zone.Identifier:$DATA ", 3)]),
            StreamDisposition::DenyForeignStreams
        );
    }

    #[test]
    fn unicode_stream_name_is_denied() {
        assert_eq!(
            classify_texts(&[("::$DATA", 4), (":Zusatzdaten_ä:$DATA", 6)]),
            StreamDisposition::DenyForeignStreams
        );
        assert_eq!(
            classify_texts(&[("::$DATA", 4), (":データ:$DATA", 6)]),
            StreamDisposition::DenyForeignStreams
        );
        assert_eq!(
            classify_texts(&[("::$DATA", 4), (&format!(":{}\u{1F512}:$DATA", "Zone"), 6)]),
            StreamDisposition::DenyForeignStreams
        );
    }

    #[test]
    fn invalid_utf16_is_unverifiable() {
        let lone_surrogate = 0xD800u16.to_le_bytes();
        assert_eq!(
            classify_owned(&[(lone_surrogate.as_slice(), lone_surrogate.len(), 4)]),
            StreamDisposition::Unverifiable
        );
        let mut bytes = utf16_bytes("::$DATA");
        bytes.splice(2..2, 0xD800u16.to_le_bytes());
        assert_eq!(
            classify_owned(&[(&bytes, bytes.len(), 4)]),
            StreamDisposition::Unverifiable
        );
    }

    #[test]
    fn embedded_nul_is_unverifiable() {
        let mut bytes = utf16_bytes(":Foo");
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes.extend_from_slice(&utf16_bytes(":$DATA"));
        assert_eq!(
            classify_owned(&[(&bytes, bytes.len(), 4)]),
            StreamDisposition::Unverifiable
        );
    }

    #[test]
    fn terminator_outside_declared_length_is_ignored() {
        let mut bytes = utf16_bytes("::$DATA");
        let declared = bytes.len();
        bytes.extend_from_slice(&0u16.to_le_bytes());
        assert_eq!(
            classify_owned(&[(&bytes, declared, 4)]),
            StreamDisposition::AllowNoExtraStreams
        );
    }

    #[test]
    fn missing_colon_is_unverifiable() {
        assert_eq!(
            classify_texts(&[("Zone.Identifier:$DATA", 4)]),
            StreamDisposition::Unverifiable
        );
        assert_eq!(
            classify_texts(&[("$DATA", 4)]),
            StreamDisposition::Unverifiable
        );
        assert_eq!(
            classify_texts(&[(":Zone.Identifier", 4)]),
            StreamDisposition::Unverifiable
        );
    }

    #[test]
    fn additional_colon_is_unverifiable() {
        assert_eq!(
            classify_texts(&[(":Zone.Identifier:$DATA:$EXTRA", 4)]),
            StreamDisposition::Unverifiable
        );
        assert_eq!(
            classify_texts(&[("::$DATA", 4), (":Foo:Bar:$DATA", 4)]),
            StreamDisposition::Unverifiable
        );
    }

    #[test]
    fn empty_stream_type_is_unverifiable() {
        assert_eq!(
            classify_texts(&[(":Zone.Identifier:", 0)]),
            StreamDisposition::Unverifiable
        );
        assert_eq!(
            classify_texts(&[("::", 0)]),
            StreamDisposition::Unverifiable
        );
    }

    #[test]
    fn unknown_stream_type_is_denied() {
        assert_eq!(
            classify_texts(&[("::$DATA", 4), (":Zone.Identifier:$INDEX_ALLOCATION", 9)]),
            StreamDisposition::DenyForeignStreams
        );
        assert_eq!(
            classify_texts(&[(":Zusatzdaten:$BITMAP", 2)]),
            StreamDisposition::DenyForeignStreams
        );
    }

    #[test]
    fn empty_stream_list_is_unverifiable() {
        assert_eq!(classify_texts(&[]), StreamDisposition::Unverifiable);
    }

    #[test]
    fn stream_order_does_not_change_decision() {
        assert_eq!(
            classify_texts(&[(":Zone.Identifier:$DATA", 1), ("::$DATA", 1)]),
            StreamDisposition::AllowOnlyZoneIdentifier
        );
        assert_eq!(
            classify_texts(&[
                (":Zusatzdaten:$DATA", 1),
                ("::$DATA", 1),
                (":Zone.Identifier:$DATA", 1)
            ]),
            StreamDisposition::DenyForeignStreams
        );
    }

    #[test]
    fn unexpected_duplicates_are_unverifiable() {
        assert_eq!(
            classify_texts(&[("::$DATA", 4), ("::$data", 4)]),
            StreamDisposition::Unverifiable
        );
        assert_eq!(
            classify_texts(&[
                ("::$DATA", 4),
                (":Zone.Identifier:$DATA", 4),
                (":zone.identifier:$DATA", 0),
            ]),
            StreamDisposition::Unverifiable
        );
        assert_eq!(
            classify_texts(&[(":Zone.Identifier:$DATA", 4)]),
            StreamDisposition::Unverifiable
        );
    }

    #[test]
    fn duplicate_foreign_streams_stay_denied() {
        assert_eq!(
            classify_texts(&[(":Zusatzdaten:$DATA", 0), (":Zusatzdaten:$DATA", 5)]),
            StreamDisposition::DenyForeignStreams
        );
    }

    #[test]
    fn zero_stream_size_does_not_grant_an_exception() {
        assert_eq!(
            classify_texts(&[("::$DATA", 0), (":Zusatzdaten:$DATA", 0)]),
            StreamDisposition::DenyForeignStreams
        );
        assert_eq!(
            classify_texts(&[("::$DATA", 0), (":Zone.Identifier:$DATA", 0)]),
            StreamDisposition::AllowOnlyZoneIdentifier
        );
        assert_eq!(
            classify_owned(&[(&[], 0, 0)]),
            StreamDisposition::Unverifiable
        );
    }

    #[test]
    fn declared_length_past_buffer_or_odd_length_is_unverifiable() {
        let bytes = utf16_bytes("::$DATA");
        assert_eq!(
            classify_owned(&[(&bytes, bytes.len() + 2, 4)]),
            StreamDisposition::Unverifiable
        );
        assert_eq!(
            classify_owned(&[(&bytes, bytes.len() - 1, 4)]),
            StreamDisposition::Unverifiable
        );
    }
}
