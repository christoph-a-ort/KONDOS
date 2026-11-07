//! FV2-02e.3b/3c – Stream-name classification and handle-based FILE_STREAM_INFO query.
//!
//! Name classification does not touch the filesystem. The handle query reads stream metadata
//! from an already open file and does not open, replace, or close that handle.

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

/// `FILE_STREAM_INFO` header before the variable UTF-16 name.
/// NextEntryOffset u32, StreamNameLength u32, StreamSize i64, StreamAllocationSize i64.
const FILE_STREAM_HEADER_LEN: usize = 24;
const STREAM_BUFFER_START: usize = 16 * 1024;
const STREAM_BUFFER_MAX: usize = 1024 * 1024;
#[cfg(windows)]
const FILE_STREAM_INFO_CLASS: i32 = 7;
#[cfg(windows)]
const ERROR_MORE_DATA: u32 = 234;

enum StreamQuery {
    Complete(Vec<u8>),
    TooSmall,
    Failed,
}

/// Byte buffer whose start is aligned for `FILE_STREAM_INFO` / `LARGE_INTEGER` (8 bytes).
///
/// Windows requires the `GetFileInformationByHandleEx` output pointer to keep `StreamSize` and
/// `StreamAllocationSize` 8-byte aligned. `Vec<u8>` does not guarantee that. `Vec<u64>` does,
/// because `align_of::<u64>() == 8`. Capacity is rounded up to a whole number of `u64` words.
struct AlignedStreamBuffer {
    words: Vec<u64>,
}

impl AlignedStreamBuffer {
    fn with_byte_capacity(capacity: usize) -> Option<Self> {
        if capacity == 0 {
            return None;
        }
        let words = capacity.div_ceil(8);
        if words == 0 {
            return None;
        }
        Some(Self {
            words: vec![0u64; words],
        })
    }

    fn byte_len(&self) -> usize {
        self.words.len().saturating_mul(8)
    }

    fn as_mut_ptr(&mut self) -> *mut u8 {
        self.words.as_mut_ptr().cast::<u8>()
    }

    fn as_bytes(&self) -> &[u8] {
        let len = self.byte_len();
        if len == 0 {
            return &[];
        }
        // SAFETY: `words` is a live `Vec<u64>` of initialized zeroes. Its allocation is aligned
        // to 8 bytes. `byte_len` is exactly `words.len() * size_of::<u64>()` and does not extend
        // past the allocation. The `u8` view is only used to copy bytes after Windows has written
        // `FILE_STREAM_INFO`; it is not used to construct a `FILE_STREAM_INFO` reference.
        unsafe { std::slice::from_raw_parts(self.words.as_ptr().cast::<u8>(), len) }
    }
}

#[cfg(test)]
thread_local! {
    static FORCE_KIND: std::cell::Cell<Option<StreamDisposition>> =
        const { std::cell::Cell::new(None) };
    static FORCE_QUERY_FAIL: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static LAST_QUERY_HANDLE: std::cell::Cell<isize> = const { std::cell::Cell::new(0) };
    static QUERY_COUNT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
fn force_stream_kind(kind: Option<StreamDisposition>) {
    FORCE_KIND.with(|cell| cell.set(kind));
}

#[cfg(test)]
pub struct ForcedStreamDisposition {
    _private: (),
}

#[cfg(test)]
impl ForcedStreamDisposition {
    pub fn new(kind: StreamDisposition) -> Self {
        force_stream_kind(Some(kind));
        Self { _private: () }
    }
}

#[cfg(test)]
impl Drop for ForcedStreamDisposition {
    fn drop(&mut self) {
        force_stream_kind(None);
    }
}

#[cfg(test)]
fn force_stream_query_fail(fail: bool) {
    FORCE_QUERY_FAIL.with(|cell| cell.set(fail));
}

/// Test hook: treat the next open-file query as an API failure (`StreamQuery::Failed`).
#[cfg(test)]
pub struct ForcedStreamQueryFailed {
    _private: (),
}

#[cfg(test)]
impl ForcedStreamQueryFailed {
    pub fn new() -> Self {
        force_stream_query_fail(true);
        Self { _private: () }
    }
}

#[cfg(test)]
impl Drop for ForcedStreamQueryFailed {
    fn drop(&mut self) {
        force_stream_query_fail(false);
    }
}

#[cfg(test)]
pub fn last_stream_query_handle() -> isize {
    LAST_QUERY_HANDLE.with(|cell| cell.get())
}

#[cfg(test)]
pub fn stream_query_count() -> usize {
    QUERY_COUNT.with(|cell| cell.get())
}

#[cfg(test)]
pub fn reset_stream_query_probe() {
    LAST_QUERY_HANDLE.with(|cell| cell.set(0));
    QUERY_COUNT.with(|cell| cell.set(0));
}

fn test_stream_override(file: &std::fs::File) -> Option<StreamDisposition> {
    #[cfg(test)]
    {
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            LAST_QUERY_HANDLE.with(|cell| cell.set(file.as_raw_handle() as isize));
        }
        QUERY_COUNT.with(|cell| cell.set(cell.get().saturating_add(1)));
        if FORCE_QUERY_FAIL.with(|cell| cell.get()) {
            return Some(classify_stream_query_loop(|_| StreamQuery::Failed));
        }
        return FORCE_KIND.with(|cell| cell.get());
    }
    #[cfg(not(test))]
    {
        let _ = file;
        None
    }
}

struct StreamSpan {
    name_at: usize,
    name_len: usize,
    stream_size: u64,
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

fn read_u32(buffer: &[u8], offset: usize) -> Option<u32> {
    let end = offset.checked_add(4)?;
    let bytes: [u8; 4] = buffer.get(offset..end)?.try_into().ok()?;
    Some(u32::from_le_bytes(bytes))
}

fn read_u64(buffer: &[u8], offset: usize) -> Option<u64> {
    let end = offset.checked_add(8)?;
    let bytes: [u8; 8] = buffer.get(offset..end)?.try_into().ok()?;
    Some(u64::from_le_bytes(bytes))
}

/// Walk a `FILE_STREAM_INFO` chain. `NextEntryOffset` is relative to the current entry.
/// A zero offset ends the chain. Bytes after that entry are unused buffer tail, not more entries.
/// Entries must move forward, stay inside the buffer, and keep an 8-byte stride so the next
/// `LARGE_INTEGER` fields stay aligned. Name bytes are sliced with `StreamNameLength` only.
fn parse_stream_spans(buffer: &[u8]) -> Option<Vec<StreamSpan>> {
    if buffer.is_empty() {
        return Some(Vec::new());
    }
    let mut offset = 0usize;
    let mut spans = Vec::new();
    let mut steps = 0usize;
    while steps < buffer.len() {
        steps = steps.saturating_add(1);
        let next_rel = read_u32(buffer, offset)?;
        let name_len = usize::try_from(read_u32(buffer, offset.checked_add(4)?)?).ok()?;
        let stream_size = read_u64(buffer, offset.checked_add(8)?)?;
        let _allocation_size = read_u64(buffer, offset.checked_add(16)?)?;
        let name_at = offset.checked_add(FILE_STREAM_HEADER_LEN)?;
        let name_end = name_at.checked_add(name_len)?;
        if name_end > buffer.len() {
            return None;
        }
        spans.push(StreamSpan {
            name_at,
            name_len,
            stream_size,
        });
        if next_rel == 0 {
            return Some(spans);
        }
        let next_rel = usize::try_from(next_rel).ok()?;
        if next_rel % 8 != 0 {
            return None;
        }
        let next = offset.checked_add(next_rel)?;
        if next <= offset || next < name_end || next >= buffer.len() {
            return None;
        }
        offset = next;
    }
    None
}

fn classify_file_stream_info_buffer(buffer: &[u8]) -> StreamDisposition {
    let Some(spans) = parse_stream_spans(buffer) else {
        return StreamDisposition::Unverifiable;
    };
    let mut reported = Vec::with_capacity(spans.len());
    for span in spans {
        let Some(bytes) = buffer
            .get(span.name_at..)
            .and_then(|rest| rest.get(..span.name_len))
        else {
            return StreamDisposition::Unverifiable;
        };
        reported.push(ReportedStream {
            byte_length: span.name_len,
            bytes,
            stream_size: span.stream_size,
        });
    }
    classify_reported_streams(&reported)
}

fn classify_stream_query_loop(mut query: impl FnMut(usize) -> StreamQuery) -> StreamDisposition {
    let mut capacity = STREAM_BUFFER_START;
    loop {
        match query(capacity) {
            StreamQuery::Failed => return StreamDisposition::Unverifiable,
            StreamQuery::TooSmall => {
                if capacity >= STREAM_BUFFER_MAX {
                    return StreamDisposition::Unverifiable;
                }
                let grown = capacity.saturating_mul(2);
                capacity = if grown > STREAM_BUFFER_MAX {
                    STREAM_BUFFER_MAX
                } else {
                    grown
                };
            }
            StreamQuery::Complete(buffer) => return classify_file_stream_info_buffer(&buffer),
        }
    }
}

/// Classify streams of an already open file.
///
/// The handle is only borrowed. This function does not close it, replace it, reopen a path,
/// or write stream data. `execution_move.rs` opens the source with
/// `DELETE | FILE_READ_ATTRIBUTES | SYNCHRONIZE`. Whether that mask is enough for
/// `FileStreamInfo` is checked by a temporary-file test on Windows; it is not changed here.
/// A failed call is `Unverifiable` and is not treated as proof that the file has no named streams.
#[must_use]
pub fn classify_open_file_streams(file: &std::fs::File) -> StreamDisposition {
    if let Some(kind) = test_stream_override(file) {
        return kind;
    }
    #[cfg(windows)]
    {
        classify_stream_query_loop(|capacity| query_stream_buffer(file, capacity))
    }
    #[cfg(not(windows))]
    {
        let _ = file;
        StreamDisposition::Unverifiable
    }
}

#[cfg(windows)]
fn query_stream_buffer(file: &std::fs::File, capacity: usize) -> StreamQuery {
    use std::os::windows::io::AsRawHandle;

    let Some(mut buffer) = AlignedStreamBuffer::with_byte_capacity(capacity) else {
        return StreamQuery::Failed;
    };
    let Ok(capacity_u32) = u32::try_from(buffer.byte_len()) else {
        return StreamQuery::Failed;
    };
    // SAFETY: `buffer` is an 8-byte-aligned, zeroed allocation of `byte_len` bytes owned by
    // `AlignedStreamBuffer` for this call. `file.as_raw_handle()` is valid for this borrow and is
    // not closed, stored, or written. The pointer is derived from `Vec<u64>` (`align_of::<u64>()
    // == 8`), which satisfies `FILE_STREAM_INFO` / `LARGE_INTEGER` alignment. FileStreamInfo asks
    // for stream metadata only. The bytes written by Windows are copied into a `[u8]` slice and
    // parsed with bounds checks; they are not trusted as a terminated string or as a typed
    // `FILE_STREAM_INFO` reference.
    let ok = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FILE_STREAM_INFO_CLASS,
            buffer.as_mut_ptr(),
            capacity_u32,
        )
    };
    if ok != 0 {
        return StreamQuery::Complete(buffer.as_bytes().to_vec());
    }
    // SAFETY: GetLastError reads this thread's last-error slot and takes no pointers.
    // It is called immediately after the failed query, before any other Windows call.
    let error = unsafe { GetLastError() };
    if error == ERROR_MORE_DATA {
        StreamQuery::TooSmall
    } else {
        StreamQuery::Failed
    }
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetFileInformationByHandleEx(
        file: std::os::windows::io::RawHandle,
        file_information_class: i32,
        file_information: *mut u8,
        buffer_size: u32,
    ) -> i32;
    fn GetLastError() -> u32;
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

    fn le_name(text: &str) -> Vec<u8> {
        text.encode_utf16()
            .flat_map(|unit| unit.to_le_bytes())
            .collect()
    }

    fn align8(value: usize) -> usize {
        value.saturating_add(7) & !7
    }

    fn stream_chain(names: &[&str]) -> Vec<u8> {
        let mut buffer = Vec::new();
        for (index, name) in names.iter().enumerate() {
            let name_bytes = le_name(name);
            let raw_len = 24usize.saturating_add(name_bytes.len());
            let next = if index + 1 == names.len() {
                0u32
            } else {
                align8(raw_len) as u32
            };
            buffer.extend_from_slice(&next.to_le_bytes());
            buffer.extend_from_slice(&(name_bytes.len() as u32).to_le_bytes());
            buffer.extend_from_slice(&0u64.to_le_bytes());
            buffer.extend_from_slice(&0u64.to_le_bytes());
            buffer.extend_from_slice(&name_bytes);
            if next != 0 {
                buffer.resize(buffer.len() - name_bytes.len() - 24 + next as usize, 0xAB);
            }
        }
        buffer
    }

    #[test]
    fn parsed_default_stream_is_allowed() {
        assert_eq!(
            super::classify_file_stream_info_buffer(&stream_chain(&[r"::$DATA"])),
            StreamDisposition::AllowNoExtraStreams
        );
    }

    #[test]
    fn parsed_default_and_zone_identifier_are_allowed() {
        assert_eq!(
            super::classify_file_stream_info_buffer(&stream_chain(&[
                r"::$DATA",
                ":Zone.Identifier:$DATA"
            ])),
            StreamDisposition::AllowOnlyZoneIdentifier
        );
    }

    #[test]
    fn parsed_foreign_stream_is_denied() {
        assert_eq!(
            super::classify_file_stream_info_buffer(&stream_chain(&[
                r"::$DATA",
                ":Zusatzdaten:$DATA"
            ])),
            StreamDisposition::DenyForeignStreams
        );
    }

    #[test]
    fn parsed_zone_and_foreign_stream_are_denied() {
        assert_eq!(
            super::classify_file_stream_info_buffer(&stream_chain(&[
                r"::$DATA",
                ":Zone.Identifier:$DATA",
                ":Zusatzdaten:$DATA"
            ])),
            StreamDisposition::DenyForeignStreams
        );
    }

    #[test]
    fn unaligned_next_offset_is_unverifiable() {
        let mut buffer = stream_chain(&[r"::$DATA", ":Zone.Identifier:$DATA"]);
        buffer[..4].copy_from_slice(&4u32.to_le_bytes());
        assert_eq!(
            super::classify_file_stream_info_buffer(&buffer),
            StreamDisposition::Unverifiable
        );
    }

    #[test]
    fn next_offset_outside_buffer_is_unverifiable() {
        let mut buffer = stream_chain(&[r"::$DATA"]);
        buffer[..4].copy_from_slice(&4_096u32.to_le_bytes());
        assert_eq!(
            super::classify_file_stream_info_buffer(&buffer),
            StreamDisposition::Unverifiable
        );
    }

    #[test]
    fn next_offset_without_progress_is_unverifiable() {
        let mut buffer = stream_chain(&[r"::$DATA"]);
        buffer[..4].copy_from_slice(&8u32.to_le_bytes());
        assert_eq!(
            super::classify_file_stream_info_buffer(&buffer),
            StreamDisposition::Unverifiable
        );
    }

    #[test]
    fn short_entry_is_unverifiable() {
        assert_eq!(
            super::classify_file_stream_info_buffer(&[0u8; 20]),
            StreamDisposition::Unverifiable
        );
    }

    #[test]
    fn oversized_stream_name_length_is_unverifiable() {
        let mut buffer = stream_chain(&[r"::$DATA"]);
        buffer[4..8].copy_from_slice(&1_000u32.to_le_bytes());
        assert_eq!(
            super::classify_file_stream_info_buffer(&buffer),
            StreamDisposition::Unverifiable
        );
    }

    #[test]
    fn odd_stream_name_length_is_unverifiable() {
        let mut buffer = stream_chain(&[r"::$DATA"]);
        buffer[4..8].copy_from_slice(&1u32.to_le_bytes());
        assert_eq!(
            super::classify_file_stream_info_buffer(&buffer),
            StreamDisposition::Unverifiable
        );
    }

    #[test]
    fn malformed_utf16_in_stream_info_is_unverifiable() {
        let mut buffer = vec![0u8; 24 + 2];
        buffer[4..8].copy_from_slice(&2u32.to_le_bytes());
        buffer[24..26].copy_from_slice(&0xD800u16.to_le_bytes());
        assert_eq!(
            super::classify_file_stream_info_buffer(&buffer),
            StreamDisposition::Unverifiable
        );
    }

    #[test]
    fn empty_stream_info_success_is_unverifiable() {
        assert_eq!(
            super::classify_file_stream_info_buffer(&[]),
            StreamDisposition::Unverifiable
        );
    }

    #[test]
    fn bytes_after_final_entry_are_not_another_stream() {
        let mut buffer = stream_chain(&[r"::$DATA"]);
        buffer.extend_from_slice(&le_name(":Zusatzdaten:$DATA"));
        buffer.extend_from_slice(&[0xFF; 32]);
        assert_eq!(
            super::classify_file_stream_info_buffer(&buffer),
            StreamDisposition::AllowNoExtraStreams
        );
    }

    #[test]
    fn overlapping_entry_length_is_unverifiable() {
        let mut buffer = stream_chain(&[r"::$DATA", ":Zone.Identifier:$DATA"]);
        let name_len = u32::from_le_bytes(buffer[4..8].try_into().unwrap());
        let overlap = 24u32.saturating_add(name_len).saturating_sub(8);
        let overlap = overlap - (overlap % 8);
        buffer[..4].copy_from_slice(&overlap.to_le_bytes());
        assert_eq!(
            super::classify_file_stream_info_buffer(&buffer),
            StreamDisposition::Unverifiable
        );
    }

    #[test]
    fn overflowing_lengths_are_unverifiable() {
        let mut name_overflow = stream_chain(&[r"::$DATA"]);
        name_overflow[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(
            super::classify_file_stream_info_buffer(&name_overflow),
            StreamDisposition::Unverifiable
        );
        let mut offset_overflow = stream_chain(&[r"::$DATA"]);
        offset_overflow[..4].copy_from_slice(&(u32::MAX & !7).to_le_bytes());
        assert_eq!(
            super::classify_file_stream_info_buffer(&offset_overflow),
            StreamDisposition::Unverifiable
        );
    }

    #[test]
    fn too_small_buffer_is_retried_and_not_classified() {
        let mut calls = 0usize;
        let result = super::classify_stream_query_loop(|capacity| {
            calls = calls.saturating_add(1);
            if calls == 1 {
                assert_eq!(capacity, super::STREAM_BUFFER_START);
                return super::StreamQuery::TooSmall;
            }
            assert_eq!(capacity, super::STREAM_BUFFER_START * 2);
            super::StreamQuery::Complete(stream_chain(&[r"::$DATA", ":Zusatzdaten:$DATA"]))
        });
        assert_eq!(calls, 2);
        assert_eq!(result, StreamDisposition::DenyForeignStreams);
    }

    #[test]
    fn other_api_failure_is_unverifiable() {
        let result = super::classify_stream_query_loop(|_| super::StreamQuery::Failed);
        assert_eq!(result, StreamDisposition::Unverifiable);
    }

    #[test]
    fn buffer_cap_stops_growth() {
        let mut seen = Vec::new();
        let result = super::classify_stream_query_loop(|capacity| {
            assert!(capacity <= super::STREAM_BUFFER_MAX);
            seen.push(capacity);
            super::StreamQuery::TooSmall
        });
        assert_eq!(result, StreamDisposition::Unverifiable);
        assert_eq!(seen.first().copied(), Some(super::STREAM_BUFFER_START));
        assert_eq!(seen.last().copied(), Some(super::STREAM_BUFFER_MAX));
        assert!(seen.windows(2).all(|pair| pair[1] > pair[0]));
        assert!(seen
            .iter()
            .all(|capacity| *capacity <= super::STREAM_BUFFER_MAX));
    }

    #[test]
    fn buffer_grows_until_a_complete_enumeration() {
        let mut seen = Vec::new();
        let result = super::classify_stream_query_loop(|capacity| {
            seen.push(capacity);
            if capacity < 64 * 1024 {
                super::StreamQuery::TooSmall
            } else {
                super::StreamQuery::Complete(stream_chain(&[r"::$DATA"]))
            }
        });
        assert_eq!(seen, vec![16 * 1024, 32 * 1024, 64 * 1024]);
        assert_eq!(result, StreamDisposition::AllowNoExtraStreams);
    }

    #[test]
    fn aligned_stream_buffer_is_eight_byte_aligned() {
        let mut buffer = super::AlignedStreamBuffer::with_byte_capacity(16 * 1024).unwrap();
        assert_eq!(buffer.as_mut_ptr() as usize % 8, 0);
        assert_eq!(buffer.byte_len() % 8, 0);
        assert!(buffer.byte_len() >= 16 * 1024);
        assert!(buffer.as_bytes().iter().all(|byte| *byte == 0));
        let mut odd = super::AlignedStreamBuffer::with_byte_capacity(1).unwrap();
        assert_eq!(odd.as_mut_ptr() as usize % 8, 0);
        assert_eq!(odd.byte_len(), 8);
        assert!(super::AlignedStreamBuffer::with_byte_capacity(0).is_none());
    }

    #[test]
    fn forced_stream_disposition_overrides_open_file_query() {
        let _force = super::ForcedStreamDisposition::new(StreamDisposition::DenyForeignStreams);
        let file = tempfile_for_force();
        assert_eq!(
            super::classify_open_file_streams(&file),
            StreamDisposition::DenyForeignStreams
        );
        drop(_force);
        drop(file);
    }

    #[test]
    fn forced_stream_query_failure_is_unverifiable() {
        let _force = super::ForcedStreamQueryFailed::new();
        let file = tempfile_for_force();
        assert_eq!(
            super::classify_open_file_streams(&file),
            StreamDisposition::Unverifiable
        );
        drop(_force);
        drop(file);
    }

    fn tempfile_for_force() -> std::fs::File {
        let path = std::env::temp_dir().join(format!(
            "dotty-stream-force-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&path, b"x").unwrap();
        let file = std::fs::File::open(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        file
    }

    #[cfg(windows)]
    #[test]
    fn ordinary_temp_file_exposes_only_the_default_stream() {
        use std::io::{Read, Seek, SeekFrom};

        struct TempPath(std::path::PathBuf);
        impl Drop for TempPath {
            fn drop(&mut self) {
                let _ = std::fs::remove_file(&self.0);
            }
        }
        let path = TempPath(std::env::temp_dir().join(format!(
            "dotty-stream-query-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )));
        std::fs::write(&path.0, b"hello").unwrap();
        let mut file = std::fs::File::open(&path.0).unwrap();
        assert_eq!(
            super::classify_open_file_streams(&file),
            StreamDisposition::AllowNoExtraStreams
        );
        file.seek(SeekFrom::Start(0)).unwrap();
        let mut content = Vec::new();
        file.read_to_end(&mut content).unwrap();
        assert_eq!(content, b"hello");
        drop(file);

        let small = std::fs::File::open(&path.0).unwrap();
        assert!(matches!(
            super::query_stream_buffer(&small, 32),
            super::StreamQuery::TooSmall
        ));
        drop(small);

        use std::os::windows::fs::OpenOptionsExt;
        let move_like = std::fs::OpenOptions::new()
            .share_mode(0x1 | 0x2 | 0x4)
            .access_mode(0x0001_0000 | 0x80 | 0x0010_0000)
            .custom_flags(0x0020_0000 | 0x0200_0000)
            .open(&path.0)
            .unwrap();
        assert_eq!(
            super::classify_open_file_streams(&move_like),
            StreamDisposition::AllowNoExtraStreams
        );
        drop(move_like);
    }
}
