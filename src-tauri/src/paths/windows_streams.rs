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
    static FORCE_SEQUENCE: std::cell::RefCell<std::collections::VecDeque<ForcedQueryStep>> =
        const { std::cell::RefCell::new(std::collections::VecDeque::new()) };
    static FIRST_QUERY_HANDLE: std::cell::Cell<isize> = const { std::cell::Cell::new(0) };
    static LAST_QUERY_HANDLE: std::cell::Cell<isize> = const { std::cell::Cell::new(0) };
    static QUERY_COUNT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// One synthetic result for a single `classify_open_file_streams` call in tests.
#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ForcedQueryStep {
    Disposition(StreamDisposition),
    QueryFailed,
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

/// RAII sequence of per-call stream results. Restores the previous sequence on drop.
#[cfg(test)]
pub struct ForcedStreamQuerySequence {
    previous: std::collections::VecDeque<ForcedQueryStep>,
}

#[cfg(test)]
impl ForcedStreamQuerySequence {
    pub fn new(steps: impl IntoIterator<Item = ForcedQueryStep>) -> Self {
        let previous = FORCE_SEQUENCE.with(|cell| {
            let mut queue = cell.borrow_mut();
            let previous = std::mem::take(&mut *queue);
            queue.extend(steps);
            previous
        });
        Self { previous }
    }
}

#[cfg(test)]
impl Drop for ForcedStreamQuerySequence {
    fn drop(&mut self) {
        FORCE_SEQUENCE.with(|cell| {
            *cell.borrow_mut() = std::mem::take(&mut self.previous);
        });
    }
}

#[cfg(test)]
pub fn first_stream_query_handle() -> isize {
    FIRST_QUERY_HANDLE.with(|cell| cell.get())
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
    FIRST_QUERY_HANDLE.with(|cell| cell.set(0));
    LAST_QUERY_HANDLE.with(|cell| cell.set(0));
    QUERY_COUNT.with(|cell| cell.set(0));
}

fn test_stream_override(file: &std::fs::File) -> Option<StreamDisposition> {
    #[cfg(test)]
    {
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            let handle = file.as_raw_handle() as isize;
            let count = QUERY_COUNT.with(|cell| {
                let next = cell.get().saturating_add(1);
                cell.set(next);
                next
            });
            if count == 1 {
                FIRST_QUERY_HANDLE.with(|cell| cell.set(handle));
            }
            LAST_QUERY_HANDLE.with(|cell| cell.set(handle));
        }
        #[cfg(not(windows))]
        {
            QUERY_COUNT.with(|cell| cell.set(cell.get().saturating_add(1)));
        }
        if let Some(step) = FORCE_SEQUENCE.with(|cell| cell.borrow_mut().pop_front()) {
            return Some(match step {
                ForcedQueryStep::Disposition(kind) => kind,
                ForcedQueryStep::QueryFailed => classify_stream_query_loop(|_| StreamQuery::Failed),
            });
        }
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

/// Test-only live NTFS ADS helpers. Not compiled into release builds.
#[cfg(all(test, windows))]
pub struct LiveAdsSite {
    pub temp_dir: std::path::PathBuf,
    pub final_path: String,
    pub volume_root: String,
    pub file_system: String,
    pub volume_flags: u32,
    pub drive_type: u32,
}

#[cfg(all(test, windows))]
struct LiveRootIdentity {
    volume_serial: u32,
    file_index: u64,
}

#[cfg(all(test, windows))]
pub struct LiveAdsRoot {
    path: std::path::PathBuf,
    site: LiveAdsSite,
    identity: LiveRootIdentity,
    keep: bool,
}

#[cfg(all(test, windows))]
pub struct LiveStreamList {
    pub kind: StreamDisposition,
    pub names: Vec<String>,
    pub too_small_count: usize,
    pub capacities: Vec<usize>,
}

#[cfg(all(test, windows))]
const FILE_NAMED_STREAMS: u32 = 0x0004_0000;
#[cfg(all(test, windows))]
const DRIVE_FIXED: u32 = 3;
#[cfg(all(test, windows))]
const DRIVE_REMOTE: u32 = 4;
#[cfg(all(test, windows))]
const VOLUME_NAME_DOS: u32 = 0;
#[cfg(all(test, windows))]
const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
#[cfg(all(test, windows))]
const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
#[cfg(all(test, windows))]
const FILE_SHARE_READ: u32 = 0x1;
#[cfg(all(test, windows))]
const FILE_SHARE_WRITE: u32 = 0x2;
#[cfg(all(test, windows))]
const FILE_SHARE_DELETE: u32 = 0x4;
#[cfg(all(test, windows))]
pub const ERROR_SHARING_VIOLATION: i32 = 32;
#[cfg(all(test, windows))]
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;

#[cfg(all(test, windows))]
#[repr(C)]
struct ByHandleFileInformation {
    file_attributes: u32,
    creation_time_low: u32,
    creation_time_high: u32,
    access_time_low: u32,
    access_time_high: u32,
    write_time_low: u32,
    write_time_high: u32,
    volume_serial_number: u32,
    file_size_high: u32,
    file_size_low: u32,
    number_of_links: u32,
    file_index_high: u32,
    file_index_low: u32,
}

#[cfg(all(test, windows))]
#[link(name = "kernel32")]
extern "system" {
    fn GetVolumePathNameW(file_name: *const u16, volume_path_name: *mut u16, length: u32) -> i32;
    fn GetVolumeInformationW(
        root_path_name: *const u16,
        volume_name_buffer: *mut u16,
        volume_name_size: u32,
        volume_serial_number: *mut u32,
        maximum_component_length: *mut u32,
        file_system_flags: *mut u32,
        file_system_name_buffer: *mut u16,
        file_system_name_size: u32,
    ) -> i32;
    fn GetDriveTypeW(root_path_name: *const u16) -> u32;
    fn GetFinalPathNameByHandleW(
        handle: std::os::windows::io::RawHandle,
        buf: *mut u16,
        length: u32,
        flags: u32,
    ) -> u32;
    fn GetFileInformationByHandle(
        handle: std::os::windows::io::RawHandle,
        file_information: *mut ByHandleFileInformation,
    ) -> i32;
}

#[cfg(all(test, windows))]
fn to_wide(value: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(all(test, windows))]
fn from_wide(buffer: &[u16]) -> String {
    let nul = buffer
        .iter()
        .position(|&unit| unit == 0)
        .unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..nul])
}

#[cfg(all(test, windows))]
fn strip_extended_prefix(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = path.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        path.to_string()
    }
}

#[cfg(all(test, windows))]
fn normalize_for_compare(path: &str) -> String {
    strip_extended_prefix(path)
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

#[cfg(all(test, windows))]
fn is_under_normalized(path: &str, ancestor: &str) -> bool {
    if ancestor.is_empty() {
        return false;
    }
    path == ancestor || path.starts_with(&format!("{ancestor}\\"))
}

#[cfg(all(test, windows))]
fn env_dir(name: &str) -> Option<String> {
    std::env::var_os(name).map(|value| value.to_string_lossy().into_owned())
}

#[cfg(all(test, windows))]
fn forbidden_ancestors() -> Vec<String> {
    let mut out = Vec::new();
    for name in ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"] {
        if let Some(value) = env_dir(name) {
            out.push(normalize_for_compare(&value));
        }
    }
    if let Some(profile) = env_dir("USERPROFILE") {
        out.push(normalize_for_compare(&format!("{profile}\\OneDrive")));
        out.push(normalize_for_compare(&format!("{profile}\\Documents")));
    }
    out.push(normalize_for_compare(r"C:\Windows"));
    out.push(normalize_for_compare(r"C:\Windows\Temp"));
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let repo = std::path::Path::new(&manifest)
            .parent()
            .unwrap_or(std::path::Path::new(&manifest));
        out.push(normalize_for_compare(&repo.to_string_lossy()));
    }
    out
}

#[cfg(all(test, windows))]
fn looks_like_onedrive_or_cloud(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.contains("\\onedrive")
        || lower.contains("/onedrive")
        || lower.contains("\\icloud")
        || lower.contains("\\dropbox")
        || lower.contains("\\google drive")
}

#[cfg(all(test, windows))]
fn open_dir(path: &std::path::Path, open_reparse: bool) -> Result<std::fs::File, String> {
    use std::os::windows::fs::OpenOptionsExt;
    let mut flags = FILE_FLAG_BACKUP_SEMANTICS;
    if open_reparse {
        flags |= FILE_FLAG_OPEN_REPARSE_POINT;
    }
    std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(flags)
        .open(path)
        .map_err(|err| {
            format!(
                "Verzeichnis konnte nicht geöffnet werden ({}): {err}",
                path.display()
            )
        })
}

#[cfg(all(test, windows))]
fn dir_identity(file: &std::fs::File) -> Result<(LiveRootIdentity, u32), String> {
    use std::os::windows::io::AsRawHandle;
    let mut info = ByHandleFileInformation {
        file_attributes: 0,
        creation_time_low: 0,
        creation_time_high: 0,
        access_time_low: 0,
        access_time_high: 0,
        write_time_low: 0,
        write_time_high: 0,
        volume_serial_number: 0,
        file_size_high: 0,
        file_size_low: 0,
        number_of_links: 0,
        file_index_high: 0,
        file_index_low: 0,
    };
    // SAFETY: `file` is open for this borrow. `info` is a local C-layout buffer matching
    // BY_HANDLE_FILE_INFORMATION. The pointer is not stored.
    let ok = unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) };
    if ok == 0 {
        return Err("GetFileInformationByHandle fehlgeschlagen.".into());
    }
    let file_index = (u64::from(info.file_index_high) << 32) | u64::from(info.file_index_low);
    Ok((
        LiveRootIdentity {
            volume_serial: info.volume_serial_number,
            file_index,
        },
        info.file_attributes,
    ))
}

#[cfg(all(test, windows))]
fn path_is_reparse(path: &std::path::Path) -> Result<bool, String> {
    let file = open_dir(path, true)?;
    let (_, attributes) = dir_identity(&file)?;
    Ok(attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0)
}

#[cfg(all(test, windows))]
fn resolve_final_path(path: &std::path::Path, open_reparse: bool) -> Result<String, String> {
    use std::os::windows::io::AsRawHandle;
    let file = open_dir(path, open_reparse)?;
    let mut capacity = 1024usize;
    loop {
        let mut buffer = vec![0u16; capacity];
        // SAFETY: `file` is open for this borrow. `buffer` is a local UTF-16 Vec.
        let written = unsafe {
            GetFinalPathNameByHandleW(
                file.as_raw_handle(),
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                VOLUME_NAME_DOS,
            )
        };
        if written == 0 {
            return Err("GetFinalPathNameByHandleW konnte den Pfad nicht auflösen.".into());
        }
        let written = written as usize;
        if written >= buffer.len() {
            if written > 32_768 {
                return Err("GetFinalPathNameByHandleW: Pfad länger als 32 KiB.".into());
            }
            capacity = written.saturating_add(1);
            continue;
        }
        return Ok(from_wide(&buffer));
    }
}

#[cfg(all(test, windows))]
fn query_volume(path: &std::path::Path) -> Result<(String, String, u32, u32), String> {
    let wide_path = to_wide(&path.to_string_lossy());
    let mut volume = vec![0u16; 64];
    // SAFETY: `wide_path` is NUL-terminated. `volume` is a local 64-unit buffer. Both pointers
    // remain valid for this call only.
    let ok =
        unsafe { GetVolumePathNameW(wide_path.as_ptr(), volume.as_mut_ptr(), volume.len() as u32) };
    if ok == 0 {
        return Err("GetVolumePathNameW fehlgeschlagen.".into());
    }
    let volume_root = from_wide(&volume);
    let wide_root = to_wide(&volume_root);
    let mut fs_name = vec![0u16; 32];
    let mut flags = 0u32;
    let mut serial = 0u32;
    let mut component = 0u32;
    // SAFETY: `wide_root` is NUL-terminated. Output buffers are local Vecs; serial/flags/component
    // are local stack integers. All remain valid for this call only.
    let ok = unsafe {
        GetVolumeInformationW(
            wide_root.as_ptr(),
            std::ptr::null_mut(),
            0,
            &mut serial,
            &mut component,
            &mut flags,
            fs_name.as_mut_ptr(),
            fs_name.len() as u32,
        )
    };
    if ok == 0 {
        return Err("GetVolumeInformationW fehlgeschlagen.".into());
    }
    // SAFETY: `wide_root` is still the local NUL-terminated volume-root string.
    let drive_type = unsafe { GetDriveTypeW(wide_root.as_ptr()) };
    Ok((volume_root, from_wide(&fs_name), flags, drive_type))
}

#[cfg(all(test, windows))]
fn reject_unusable_location(displayed: &str, followed: &str) -> Result<(), String> {
    if looks_like_onedrive_or_cloud(displayed) || looks_like_onedrive_or_cloud(followed) {
        return Err(format!(
            "Pfad liegt in einem Cloud-Ordner (displayed={displayed}, followed={followed})."
        ));
    }
    for ancestor in forbidden_ancestors() {
        if is_under_normalized(displayed, &ancestor) || is_under_normalized(followed, &ancestor) {
            return Err(format!(
                "Pfad liegt in einem ausgeschlossenen Bereich ({ancestor}): {followed}"
            ));
        }
    }
    if displayed.starts_with("\\\\") || followed.starts_with("\\\\") {
        return Err(format!("Pfad ist eine UNC-Netzwerkfreigabe: {followed}"));
    }
    Ok(())
}

#[cfg(all(test, windows))]
fn require_local_ntfs_named_streams(
    path: &std::path::Path,
) -> Result<(String, String, u32, u32), String> {
    let (volume_root, file_system, volume_flags, drive_type) = query_volume(path)?;
    if drive_type == DRIVE_REMOTE {
        return Err(format!("Volume ist DRIVE_REMOTE ({volume_root})."));
    }
    if drive_type != DRIVE_FIXED {
        return Err(format!(
            "Volume ist nicht DRIVE_FIXED (drive_type={drive_type}, root={volume_root})."
        ));
    }
    if !file_system.eq_ignore_ascii_case("NTFS") {
        return Err(format!(
            "Volume ist nicht NTFS ({file_system}, {volume_root})."
        ));
    }
    if volume_flags & FILE_NAMED_STREAMS == 0 {
        return Err(format!(
            "Volume unterstützt FILE_NAMED_STREAMS nicht (flags=0x{volume_flags:08x})."
        ));
    }
    Ok((volume_root, file_system, volume_flags, drive_type))
}

#[cfg(all(test, windows))]
pub fn live_ads_site() -> Result<LiveAdsSite, String> {
    let temp_dir = std::env::temp_dir();
    if !temp_dir.exists() {
        return Err(format!(
            "std::env::temp_dir existiert nicht: {}",
            temp_dir.display()
        ));
    }
    if path_is_reparse(&temp_dir)? {
        return Err(format!(
            "Temp-Verzeichnis ist ein Reparse-Punkt/Junction: {}",
            temp_dir.display()
        ));
    }
    let followed = resolve_final_path(&temp_dir, false)?;
    let unfollowed = resolve_final_path(&temp_dir, true)?;
    let followed_norm = normalize_for_compare(&followed);
    let unfollowed_norm = normalize_for_compare(&unfollowed);
    if followed_norm != unfollowed_norm {
        return Err(format!(
            "Temp-Finalpfad und Reparse-Öffnung unterscheiden sich (followed={followed}, unfollowed={unfollowed})."
        ));
    }
    let displayed = normalize_for_compare(&temp_dir.to_string_lossy());
    reject_unusable_location(&displayed, &followed_norm)?;
    let followed_path = std::path::PathBuf::from(strip_extended_prefix(&followed));
    let (volume_root, file_system, volume_flags, drive_type) =
        require_local_ntfs_named_streams(&followed_path)?;
    Ok(LiveAdsSite {
        temp_dir,
        final_path: followed,
        volume_root,
        file_system,
        volume_flags,
        drive_type,
    })
}

#[cfg(all(test, windows))]
fn live_root_name_ok(path: &std::path::Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|name| name.starts_with("dotty-ads-live-") && !name.contains(['\\', '/', ':']))
}

#[cfg(all(test, windows))]
fn parent_is_site_temp(path: &std::path::Path, site: &LiveAdsSite) -> bool {
    let parent = path
        .parent()
        .map(|value| normalize_for_compare(&value.to_string_lossy()));
    let temp = normalize_for_compare(&site.temp_dir.to_string_lossy());
    parent.as_deref() == Some(temp.as_str())
}

#[cfg(all(test, windows))]
fn inspect_owned_root(
    path: &std::path::Path,
    site: &LiveAdsSite,
    expected: &LiveRootIdentity,
) -> Result<(), String> {
    if !live_root_name_ok(path) || !parent_is_site_temp(path, site) {
        return Err("Pfad ist kein eigener dotty-ads-live-Testroot unter TEMP.".into());
    }
    if path_is_reparse(path)? {
        return Err("Testroot ist ein Reparse-Punkt/Junction.".into());
    }
    let followed = resolve_final_path(path, false)?;
    let followed_norm = normalize_for_compare(&followed);
    let site_final = normalize_for_compare(&site.final_path);
    if !is_under_normalized(&followed_norm, &site_final) {
        return Err(format!(
            "Finalpfad liegt nicht unter dem geprüften TEMP ({followed})."
        ));
    }
    reject_unusable_location(
        &normalize_for_compare(&path.to_string_lossy()),
        &followed_norm,
    )?;
    let file = open_dir(path, true)?;
    let (identity, attributes) = dir_identity(&file)?;
    if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err("Testroot-Handle ist ein Reparse-Punkt.".into());
    }
    if identity.volume_serial != expected.volume_serial
        || identity.file_index != expected.file_index
    {
        return Err("Testroot-Identität (Volume/Index) stimmt nicht mehr.".into());
    }
    Ok(())
}

#[cfg(all(test, windows))]
pub fn create_live_ads_root(label: &str) -> Result<LiveAdsRoot, String> {
    if label.is_empty() || !label.chars().all(|ch| ch.is_ascii_alphanumeric()) {
        return Err(format!("Ungültiges Testroot-Label: {label}"));
    }
    let site = live_ads_site()?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let name = format!("dotty-ads-live-{label}-{stamp}-{}", std::process::id());
    let path = site.temp_dir.join(&name);
    if path.exists() {
        return Err(format!("Testroot existiert bereits: {}", path.display()));
    }
    std::fs::create_dir(&path).map_err(|err| format!("Testroot anlegen fehlgeschlagen: {err}"))?;
    let inspected = (|| {
        if path_is_reparse(&path)? {
            return Err("Frisch angelegter Testroot ist ein Reparse-Punkt.".into());
        }
        let file = open_dir(&path, true)?;
        let (identity, attributes) = dir_identity(&file)?;
        if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err("Frisch angelegter Testroot-Handle ist ein Reparse-Punkt.".into());
        }
        inspect_owned_root(&path, &site, &identity)?;
        Ok(identity)
    })();
    let identity = match inspected {
        Ok(identity) => identity,
        Err(reason) => {
            eprintln!(
                "LIVE_ADS_KEEP {} Anlageprüfung fehlgeschlagen: {reason}",
                path.display()
            );
            return Err(reason);
        }
    };
    Ok(LiveAdsRoot {
        path,
        site,
        identity,
        keep: false,
    })
}

#[cfg(all(test, windows))]
pub fn require_live_ads_root(label: &str) -> LiveAdsRoot {
    match create_live_ads_root(label) {
        Ok(root) => {
            eprintln!(
                "LIVE_ADS_RAN {label} root={} final={}",
                root.path.display(),
                root.site.final_path
            );
            root
        }
        Err(reason) => panic!("LIVE_ADS_NOT_RUN {label}: {reason}"),
    }
}

#[cfg(all(test, windows))]
impl LiveAdsRoot {
    pub fn path(&self) -> &std::path::Path {
        &self.path
    }

    pub fn site(&self) -> &LiveAdsSite {
        &self.site
    }

    pub fn keep_for_diagnosis(&mut self) {
        self.keep = true;
    }
}

#[cfg(all(test, windows))]
impl Drop for LiveAdsRoot {
    fn drop(&mut self) {
        if self.keep || std::thread::panicking() {
            eprintln!("LIVE_ADS_KEEP {}", self.path.display());
            return;
        }
        match inspect_owned_root(&self.path, &self.site, &self.identity) {
            Ok(()) => {
                if let Err(err) = std::fs::remove_dir_all(&self.path) {
                    eprintln!("LIVE_ADS_CLEANUP_FAIL {}: {err}", self.path.display());
                }
            }
            Err(reason) => {
                eprintln!("LIVE_ADS_CLEANUP_SKIP {}: {reason}", self.path.display());
            }
        }
    }
}

#[cfg(all(test, windows))]
fn named_stream_path(file: &std::path::Path, name: &str) -> Result<std::path::PathBuf, String> {
    if name.is_empty()
        || !name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '_')
    {
        return Err(format!("Ungültiger Streamname: {name}"));
    }
    if !file.is_file() {
        return Err(format!("Streamziel ist keine Datei: {}", file.display()));
    }
    Ok(std::path::PathBuf::from(format!(
        "{}:{name}",
        file.display()
    )))
}

#[cfg(all(test, windows))]
pub fn write_named_stream(
    file: &std::path::Path,
    name: &str,
    bytes: &[u8],
) -> Result<(), std::io::Error> {
    use std::io::Write;
    use std::os::windows::fs::OpenOptionsExt;
    let path = named_stream_path(file, name)
        .map_err(|message| std::io::Error::new(std::io::ErrorKind::InvalidInput, message))?;
    let mut out = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .open(&path)?;
    out.write_all(bytes)?;
    out.flush()?;
    Ok(())
}

#[cfg(all(test, windows))]
pub fn read_named_stream(file: &std::path::Path, name: &str) -> Result<Vec<u8>, std::io::Error> {
    use std::io::Read;
    use std::os::windows::fs::OpenOptionsExt;
    let path = named_stream_path(file, name)
        .map_err(|message| std::io::Error::new(std::io::ErrorKind::InvalidInput, message))?;
    let mut input = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .open(&path)?;
    let mut bytes = Vec::new();
    input.read_to_end(&mut bytes)?;
    Ok(bytes)
}

#[cfg(all(test, windows))]
pub fn named_stream_exists(file: &std::path::Path, name: &str) -> bool {
    named_stream_path(file, name)
        .ok()
        .map(|path| path.exists())
        .unwrap_or(false)
}

#[cfg(all(test, windows))]
fn stream_names_from_buffer(buffer: &[u8]) -> Option<Vec<String>> {
    let spans = parse_stream_spans(buffer)?;
    let mut names = Vec::with_capacity(spans.len());
    for span in spans {
        let bytes = buffer.get(span.name_at..)?.get(..span.name_len)?;
        let text = decode_stream_name(span.name_len, bytes)?;
        match split_stream_name(&text) {
            Some((name, _)) => names.push(name.to_string()),
            None => names.push(text),
        }
    }
    Some(names)
}

#[cfg(all(test, windows))]
pub fn live_classify_and_list(file: &std::fs::File) -> LiveStreamList {
    let mut too_small_count = 0usize;
    let mut names = Vec::new();
    let mut capacities = Vec::new();
    let kind = classify_stream_query_loop(|capacity| {
        capacities.push(capacity);
        match query_stream_buffer(file, capacity) {
            StreamQuery::TooSmall => {
                too_small_count = too_small_count.saturating_add(1);
                StreamQuery::TooSmall
            }
            StreamQuery::Complete(buffer) => {
                names = stream_names_from_buffer(&buffer).unwrap_or_default();
                StreamQuery::Complete(buffer)
            }
            other => other,
        }
    });
    LiveStreamList {
        kind,
        names,
        too_small_count,
        capacities,
    }
}

#[cfg(all(test, windows))]
fn probe_stream_buffer(file: &std::fs::File, capacity: usize) -> (StreamQuery, u32) {
    use std::os::windows::io::AsRawHandle;
    let Some(mut buffer) = AlignedStreamBuffer::with_byte_capacity(capacity) else {
        return (StreamQuery::Failed, 0);
    };
    let Ok(capacity_u32) = u32::try_from(buffer.byte_len()) else {
        return (StreamQuery::Failed, 0);
    };
    // SAFETY: same contract as `query_stream_buffer`, test-only diagnostic wrapper.
    let ok = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FILE_STREAM_INFO_CLASS,
            buffer.as_mut_ptr(),
            capacity_u32,
        )
    };
    if ok != 0 {
        return (StreamQuery::Complete(buffer.as_bytes().to_vec()), 0);
    }
    // SAFETY: GetLastError is read immediately after the failed query on this thread.
    let error = unsafe { GetLastError() };
    if error == ERROR_MORE_DATA {
        (StreamQuery::TooSmall, error)
    } else {
        (StreamQuery::Failed, error)
    }
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

    #[test]
    fn forced_stream_query_sequence_applies_per_call_and_restores() {
        super::reset_stream_query_probe();
        let file = tempfile_for_force();
        let _force = super::ForcedStreamQuerySequence::new([
            super::ForcedQueryStep::Disposition(StreamDisposition::AllowNoExtraStreams),
            super::ForcedQueryStep::Disposition(StreamDisposition::DenyForeignStreams),
        ]);
        assert_eq!(
            super::classify_open_file_streams(&file),
            StreamDisposition::AllowNoExtraStreams
        );
        assert_eq!(
            super::classify_open_file_streams(&file),
            StreamDisposition::DenyForeignStreams
        );
        drop(_force);
        assert_eq!(super::stream_query_count(), 2);
        let after = super::classify_open_file_streams(&file);
        drop(file);
        assert_ne!(after, StreamDisposition::DenyForeignStreams);
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

    #[cfg(windows)]
    fn assert_never_allow(kind: StreamDisposition, live: &mut super::LiveAdsRoot, label: &str) {
        if matches!(
            kind,
            StreamDisposition::AllowNoExtraStreams | StreamDisposition::AllowOnlyZoneIdentifier
        ) {
            live.keep_for_diagnosis();
            panic!(
                "KRITISCHER SICHERHEITSFEHLER {label}: fälschliche Allow-Klassifikation {kind:?}"
            );
        }
    }

    #[cfg(windows)]
    fn assert_complete_foreign_enumeration(
        kind: StreamDisposition,
        names: &[String],
        expected: &[String],
        live: &mut super::LiveAdsRoot,
        label: &str,
    ) {
        assert_never_allow(kind, live, label);
        if kind != StreamDisposition::DenyForeignStreams {
            live.keep_for_diagnosis();
            panic!(
                "{label} FAIL completeness: {kind:?} ist fail-closed, aber kein Nachweis vollständiger Enumeration"
            );
        }
        let missing: Vec<&String> = expected
            .iter()
            .filter(|name| !names.iter().any(|listed| listed == *name))
            .collect();
        let extra: Vec<&String> = names
            .iter()
            .filter(|name| !name.is_empty() && !expected.iter().any(|expected| expected == *name))
            .collect();
        let mut sorted = names.to_vec();
        sorted.sort();
        let duplicates = sorted.windows(2).filter(|pair| pair[0] == pair[1]).count();
        eprintln!(
            "{label} completeness listed={} expected_foreign={} missing={} extra={} dups={} default={}",
            names.len(),
            expected.len(),
            missing.len(),
            extra.len(),
            duplicates,
            names.iter().any(|name| name.is_empty())
        );
        if !missing.is_empty() || !extra.is_empty() || duplicates != 0 {
            live.keep_for_diagnosis();
        }
        assert!(
            names.iter().any(|name| name.is_empty()),
            "{label} Default-Stream fehlt in der Liste"
        );
        assert!(
            missing.is_empty(),
            "{label} fehlende Streamnamen: {:?}",
            &missing[..missing.len().min(8)]
        );
        assert!(
            extra.is_empty(),
            "{label} unerwartete Streamnamen: {extra:?}"
        );
        assert_eq!(duplicates, 0, "{label} doppelte Streamnamen");
        assert_eq!(
            names.len(),
            expected.len().saturating_add(1),
            "{label} Listenlänge Default+fremd"
        );
    }

    #[cfg(windows)]
    #[test]
    fn live_ads_site_probe() {
        match super::live_ads_site() {
            Ok(site) => eprintln!(
                "LIVE_ADS_SITE temp={} final={} volume={} fs={} flags=0x{:08x} drive={}",
                site.temp_dir.display(),
                site.final_path,
                site.volume_root,
                site.file_system,
                site.volume_flags,
                site.drive_type
            ),
            Err(reason) => panic!("LIVE_ADS_NOT_RUN site: {reason}"),
        }
    }

    #[cfg(windows)]
    #[test]
    fn live_h2_small_stream_buffer_is_too_small() {
        let mut live = super::require_live_ads_root("H2");
        let path = live.path().join("h2.txt");
        std::fs::write(&path, b"h2-default").unwrap();
        super::write_named_stream(&path, "DottyFmH2a", b"alpha").unwrap();
        super::write_named_stream(&path, "DottyFmH2b", b"beta").unwrap();
        super::write_named_stream(&path, "DottyFmH2c", b"gamma").unwrap();
        let file = std::fs::File::open(&path).unwrap();
        let (small, error) = super::probe_stream_buffer(&file, 32);
        let small_label = match &small {
            super::StreamQuery::TooSmall => "TooSmall",
            super::StreamQuery::Failed => "Failed",
            super::StreamQuery::Complete(_) => "Complete",
        };
        eprintln!("LIVE_H2 small_buffer query={small_label} win32={error}");
        match small {
            super::StreamQuery::TooSmall => {
                assert_eq!(error, super::ERROR_MORE_DATA);
            }
            super::StreamQuery::Failed => {
                live.keep_for_diagnosis();
                panic!("LIVE_H2 FAIL: 32-Byte-Puffer lieferte Failed, Win32={error}");
            }
            super::StreamQuery::Complete(_) => {
                live.keep_for_diagnosis();
                panic!("H2 FAIL: 32-Byte-Puffer wurde als vollständig gemeldet");
            }
        }
        let listed = super::live_classify_and_list(&file);
        eprintln!(
            "LIVE_H2 full kind={:?} names={:?} too_small={} capacities={:?}",
            listed.kind, listed.names, listed.too_small_count, listed.capacities
        );
        drop(file);
        assert_never_allow(listed.kind, &mut live, "H2");
        assert_eq!(
            listed.kind,
            StreamDisposition::DenyForeignStreams,
            "H2 unexpected {:?}",
            listed.kind
        );
        eprintln!("LIVE_H2 PASS");
    }

    #[cfg(windows)]
    #[test]
    fn live_h1_many_named_streams_never_allow() {
        let mut live = super::require_live_ads_root("H1");
        let path = live.path().join("h1.txt");
        std::fs::write(&path, b"h1-default").unwrap();
        const COUNT: usize = 250;
        let mut expected = Vec::with_capacity(COUNT);
        for index in 0..COUNT {
            let name = format!("T{index:03}");
            super::write_named_stream(&path, &name, name.as_bytes()).unwrap();
            expected.push(name);
        }
        eprintln!(
            "LIVE_H1 created {COUNT} named streams on {}",
            path.display()
        );
        let file = std::fs::File::open(&path).unwrap();
        let start = super::query_stream_buffer(&file, super::STREAM_BUFFER_START);
        let start_too_small = matches!(start, super::StreamQuery::TooSmall);
        let start_label = match &start {
            super::StreamQuery::TooSmall => "TooSmall",
            super::StreamQuery::Failed => "Failed",
            super::StreamQuery::Complete(_) => "Complete",
        };
        eprintln!("LIVE_H1 start_buffer_16KiB too_small={start_too_small} query={start_label}");
        let listed = super::live_classify_and_list(&file);
        eprintln!(
            "LIVE_H1 kind={:?} listed={} too_small={} capacities={:?}",
            listed.kind,
            listed.names.len(),
            listed.too_small_count,
            listed.capacities
        );
        drop(file);
        assert_complete_foreign_enumeration(listed.kind, &listed.names, &expected, &mut live, "H1");
        eprintln!("LIVE_H1 PASS");
    }

    #[cfg(windows)]
    #[test]
    fn live_h1b_real_buffer_growth_detects_all_streams() {
        let mut live = super::require_live_ads_root("H1b");
        let path = live.path().join("h1b.txt");
        std::fs::write(&path, b"h1b-default").unwrap();
        const COUNT: usize = 250;
        let mut expected = Vec::with_capacity(COUNT);
        for index in 0..COUNT {
            let name = format!("DottyH1bStreamName{index:03}");
            super::write_named_stream(&path, &name, name.as_bytes()).unwrap();
            expected.push(name);
        }
        eprintln!(
            "LIVE_H1b created {COUNT} named streams on {}",
            path.display()
        );
        let file = std::fs::File::open(&path).unwrap();
        let (start, error) = super::probe_stream_buffer(&file, super::STREAM_BUFFER_START);
        let start_label = match &start {
            super::StreamQuery::TooSmall => "TooSmall",
            super::StreamQuery::Failed => "Failed",
            super::StreamQuery::Complete(_) => "Complete",
        };
        eprintln!(
            "LIVE_H1b start_buffer={} query={start_label} win32={error}",
            super::STREAM_BUFFER_START
        );
        match start {
            super::StreamQuery::TooSmall => {
                assert_eq!(error, super::ERROR_MORE_DATA, "H1b Win32={error}");
            }
            super::StreamQuery::Failed | super::StreamQuery::Complete(_) => {
                live.keep_for_diagnosis();
                panic!(
                    "H1b FAIL: 16-KiB-Startpuffer lieferte {start_label} statt TooSmall (Win32={error}). Nicht künstlich angepasst."
                );
            }
        }
        let listed = super::live_classify_and_list(&file);
        eprintln!(
            "LIVE_H1b kind={:?} listed={} too_small={} capacities={:?}",
            listed.kind,
            listed.names.len(),
            listed.too_small_count,
            listed.capacities
        );
        drop(file);
        assert!(
            listed.too_small_count >= 1,
            "H1b produktive Schleife hat TooSmall nicht gesehen: {:?}",
            listed.capacities
        );
        assert_eq!(
            listed.capacities.first().copied(),
            Some(super::STREAM_BUFFER_START)
        );
        assert!(
            listed.capacities.len() >= 2,
            "H1b kein Pufferwachstum: {:?}",
            listed.capacities
        );
        assert!(
            listed.capacities[1] > listed.capacities[0],
            "H1b Puffer nicht vergrößert: {:?}",
            listed.capacities
        );
        assert_complete_foreign_enumeration(
            listed.kind,
            &listed.names,
            &expected,
            &mut live,
            "H1b",
        );
        eprintln!("LIVE_H1b PASS");
    }
}
