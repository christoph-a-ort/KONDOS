//! FV2-02d.1 – Handle-bound Windows storage classification before real file operations.

use super::windows_lengths::volume_root_for_query;
use super::windows_rules::is_windows_device_path;

pub const DRIVE_UNKNOWN: u32 = 0;
pub const DRIVE_NO_ROOT_DIR: u32 = 1;
pub const DRIVE_REMOVABLE: u32 = 2;
pub const DRIVE_FIXED: u32 = 3;
pub const DRIVE_REMOTE: u32 = 4;
pub const DRIVE_CDROM: u32 = 5;
pub const DRIVE_RAMDISK: u32 = 6;

const VOLUME_NAME_DOS: u32 = 0;
const VOLUME_NAME_NT: u32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageKind {
    Local,
    Remote,
    Unsupported,
    Unverifiable,
}

impl StorageKind {
    pub fn real_operation_message(self) -> Option<&'static str> {
        match self {
            StorageKind::Local => None,
            StorageKind::Remote => {
                Some("Netzwerkspeicherort – echte Dateioperationen sind nicht zulässig.")
            }
            StorageKind::Unsupported => Some(
                "Dieser Speicherort wird für echte Dateioperationen derzeit nicht unterstützt.",
            ),
            StorageKind::Unverifiable => {
                Some("Der Speicherort konnte nicht zuverlässig überprüft werden.")
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StorageFacts {
    pub dos_path: Option<String>,
    pub nt_path: Option<String>,
    pub volume_path: Option<String>,
    pub drive_type: Option<u32>,
    pub dos_device: Option<String>,
    pub origin_letter_differs: bool,
    pub origin_dos_device: Option<String>,
}

#[cfg(test)]
thread_local! {
    static FORCE_KIND: std::cell::Cell<Option<StorageKind>> = const { std::cell::Cell::new(None) };
}

#[cfg(test)]
pub fn force_storage_kind(kind: Option<StorageKind>) {
    FORCE_KIND.with(|cell| cell.set(kind));
}

#[cfg(test)]
pub struct ForcedStorageKind {
    _private: (),
}

#[cfg(test)]
impl ForcedStorageKind {
    pub fn new(kind: StorageKind) -> Self {
        force_storage_kind(Some(kind));
        Self { _private: () }
    }
}

#[cfg(test)]
impl Drop for ForcedStorageKind {
    fn drop(&mut self) {
        force_storage_kind(None);
    }
}

fn test_override() -> Option<StorageKind> {
    #[cfg(test)]
    {
        return FORCE_KIND.with(|cell| cell.get());
    }
    #[cfg(not(test))]
    {
        None
    }
}

fn normalize_nt(path: &str) -> String {
    path.trim().replace('/', "\\").to_ascii_lowercase()
}

fn normalize_root(path: &str) -> String {
    let mut normalized = path
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_uppercase();
    if !normalized.ends_with('\\') {
        normalized.push('\\');
    }
    normalized
}

fn drive_letter(path: &str) -> Option<char> {
    let normalized = path.replace('/', "\\");
    let bytes = normalized.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        Some((bytes[0] as char).to_ascii_uppercase())
    } else {
        None
    }
}

fn is_unc_dos(path: &str) -> bool {
    let normalized = path.replace('/', "\\");
    normalized.starts_with("\\\\") && !is_windows_device_path(&normalized)
}

fn device_rest_is_boundary(rest: &str) -> bool {
    rest.is_empty() || rest.starts_with('\\') || rest.starts_with(';')
}

fn is_local_harddisk_nt_path(path: &str) -> bool {
    let lower = normalize_nt(path);
    const PREFIX: &str = r"\device\harddiskvolume";
    let Some(rest) = lower.strip_prefix(PREFIX) else {
        return false;
    };
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    if digits == 0 {
        return false;
    }
    matches!(rest.as_bytes().get(digits), None | Some(&b'\\'))
}

fn is_remote_nt_path(path: &str) -> bool {
    let lower = normalize_nt(path);
    const DEVICES: [&str; 4] = [
        r"\device\mup",
        r"\device\lanmanredirector",
        r"\device\webdavredirector",
        r"\device\winwebdavredirector",
    ];
    if DEVICES.iter().any(|device| {
        lower
            .strip_prefix(device)
            .is_some_and(device_rest_is_boundary)
    }) {
        return true;
    }
    lower.starts_with(r"\??\unc\") || lower.starts_with(r"\\??\\unc\\")
}

fn looks_like_subst(target: Option<&str>) -> bool {
    let Some(target) = target else {
        return false;
    };
    let lower = normalize_nt(target);
    lower.starts_with(r"\??\") || lower.starts_with(r"\\??\\")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VolumeShape {
    Simple,
    Mountpoint,
    Unknown,
}

fn volume_shape(dos_path: &str, volume_path: Option<&str>) -> VolumeShape {
    let Some(volume_path) = volume_path.filter(|value| !value.trim().is_empty()) else {
        return VolumeShape::Unknown;
    };
    let Some(expected) = volume_root_for_query(dos_path) else {
        return VolumeShape::Unknown;
    };
    if normalize_root(volume_path) == normalize_root(&expected) {
        VolumeShape::Simple
    } else {
        VolumeShape::Mountpoint
    }
}

fn has_remote_device(facts: &StorageFacts) -> bool {
    facts.dos_device.as_deref().is_some_and(is_remote_nt_path)
        || facts
            .origin_dos_device
            .as_deref()
            .is_some_and(is_remote_nt_path)
}

pub fn classify_storage_facts(facts: &StorageFacts) -> StorageKind {
    let Some(dos) = facts
        .dos_path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    else {
        return StorageKind::Unverifiable;
    };
    let Some(nt) = facts
        .nt_path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    else {
        return StorageKind::Unverifiable;
    };

    if is_windows_device_path(dos) {
        return StorageKind::Unsupported;
    }

    if looks_like_subst(facts.dos_device.as_deref())
        || looks_like_subst(facts.origin_dos_device.as_deref())
    {
        return StorageKind::Unsupported;
    }

    let shape = volume_shape(dos, facts.volume_path.as_deref());
    if shape == VolumeShape::Mountpoint {
        return StorageKind::Unsupported;
    }

    let remote_dos = is_unc_dos(dos);
    let remote_nt = is_remote_nt_path(nt);
    let local_nt = is_local_harddisk_nt_path(nt);
    let remote_device = has_remote_device(facts);
    let remote_drive = facts.drive_type == Some(DRIVE_REMOTE);
    let remote_signal = remote_dos || remote_nt || remote_device || remote_drive;

    if matches!(facts.drive_type, Some(DRIVE_CDROM) | Some(DRIVE_RAMDISK)) {
        return StorageKind::Unsupported;
    }

    if facts.origin_letter_differs && facts.origin_dos_device.is_none() {
        return StorageKind::Unverifiable;
    }

    if remote_signal && local_nt {
        return StorageKind::Unverifiable;
    }
    if remote_signal {
        return StorageKind::Remote;
    }
    if !local_nt {
        return StorageKind::Unverifiable;
    }
    if matches!(
        facts.drive_type,
        None | Some(DRIVE_UNKNOWN) | Some(DRIVE_NO_ROOT_DIR)
    ) {
        return StorageKind::Unverifiable;
    }
    if !matches!(facts.drive_type, Some(DRIVE_FIXED) | Some(DRIVE_REMOVABLE)) {
        return StorageKind::Unverifiable;
    }
    if shape != VolumeShape::Simple {
        return StorageKind::Unverifiable;
    }
    if drive_letter(dos).is_some() {
        match facts.dos_device.as_deref() {
            Some(device) if is_local_harddisk_nt_path(device) => {}
            _ => return StorageKind::Unverifiable,
        }
    }
    StorageKind::Local
}

pub fn classify_opened_path(path: &str) -> StorageKind {
    if let Some(kind) = test_override() {
        return kind;
    }
    classify_opened_path_inner(path)
}

#[cfg(windows)]
fn classify_opened_path_inner(path: &str) -> StorageKind {
    let normalized = path.replace('/', "\\");
    if is_windows_device_path(&normalized) {
        return StorageKind::Unsupported;
    }
    if is_unc_dos(&normalized) {
        return StorageKind::Remote;
    }
    match open_for_classification(&normalized) {
        Ok(file) => classify_storage_from_file_with_origin(&file, &normalized),
        Err(_) => StorageKind::Unverifiable,
    }
}

#[cfg(not(windows))]
fn classify_opened_path_inner(_path: &str) -> StorageKind {
    StorageKind::Unverifiable
}

#[cfg(windows)]
pub fn classify_storage_from_file_with_origin(file: &std::fs::File, origin: &str) -> StorageKind {
    if let Some(kind) = test_override() {
        return kind;
    }
    classify_storage_facts(&collect_facts_from_file(file, Some(origin)))
}

#[cfg(not(windows))]
pub fn classify_storage_from_file_with_origin(_file: &std::fs::File, _origin: &str) -> StorageKind {
    if let Some(kind) = test_override() {
        return kind;
    }
    StorageKind::Unverifiable
}

#[cfg(windows)]
mod win {
    use super::super::windows_lengths::volume_root_for_query;
    use super::{drive_letter, VOLUME_NAME_DOS, VOLUME_NAME_NT};
    use std::ffi::OsStr;
    use std::fs::{File, OpenOptions};
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::{AsRawHandle, RawHandle};

    const FILE_SHARE_READ: u32 = 0x1;
    const FILE_SHARE_WRITE: u32 = 0x2;
    const FILE_SHARE_DELETE: u32 = 0x4;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetFinalPathNameByHandleW(
            handle: RawHandle,
            buf: *mut u16,
            length: u32,
            flags: u32,
        ) -> u32;
        fn GetDriveTypeW(root_path_name: *const u16) -> u32;
        fn GetVolumePathNameW(
            file_name: *const u16,
            volume_path_name: *mut u16,
            length: u32,
        ) -> i32;
        fn QueryDosDeviceW(device_name: *const u16, target_path: *mut u16, max: u32) -> u32;
    }

    pub(super) fn open_for_classification(path: &str) -> std::io::Result<File> {
        OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)
    }

    fn to_wide(value: &str) -> Vec<u16> {
        OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn from_wide(buffer: &[u16], count: usize) -> String {
        let end = count.min(buffer.len());
        let slice = &buffer[..end];
        let nul = slice
            .iter()
            .position(|&unit| unit == 0)
            .unwrap_or(slice.len());
        String::from_utf16_lossy(&slice[..nul])
    }

    fn strip_extended(path: &str) -> String {
        if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{rest}")
        } else if let Some(rest) = path.strip_prefix(r"\\?\") {
            rest.to_string()
        } else {
            path.to_string()
        }
    }

    fn final_path(handle: RawHandle, flags: u32) -> Option<String> {
        let mut buffer = vec![0u16; 32_768];
        let count = unsafe {
            GetFinalPathNameByHandleW(handle, buffer.as_mut_ptr(), buffer.len() as u32, flags)
        };
        if count == 0 || (count as usize) >= buffer.len() {
            return None;
        }
        let raw = from_wide(&buffer, count as usize);
        if raw.trim().is_empty() {
            None
        } else if flags == VOLUME_NAME_DOS {
            Some(strip_extended(&raw))
        } else {
            Some(raw)
        }
    }

    fn volume_path_name(path: &str) -> Option<String> {
        let wide = to_wide(path);
        let mut buffer = vec![0u16; 32_768];
        let ok =
            unsafe { GetVolumePathNameW(wide.as_ptr(), buffer.as_mut_ptr(), buffer.len() as u32) };
        if ok == 0 {
            return None;
        }
        let value = from_wide(&buffer, buffer.len());
        if value.trim().is_empty() {
            None
        } else {
            Some(value)
        }
    }

    fn query_dos_device(letter: char) -> Option<String> {
        if !letter.is_ascii_alphabetic() {
            return None;
        }
        let device = format!("{letter}:");
        let wide = to_wide(&device);
        let mut buffer = vec![0u16; 8_192];
        let count =
            unsafe { QueryDosDeviceW(wide.as_ptr(), buffer.as_mut_ptr(), buffer.len() as u32) };
        if count == 0 {
            return None;
        }
        let value = from_wide(&buffer, count as usize);
        if value.trim().is_empty() {
            None
        } else {
            Some(value)
        }
    }

    fn drive_type_for_root(root: &str) -> Option<u32> {
        let mut root = root.replace('/', "\\");
        if !root.ends_with('\\') {
            root.push('\\');
        }
        let wide = to_wide(&root);
        let value = unsafe { GetDriveTypeW(wide.as_ptr()) };
        Some(value)
    }

    pub(super) fn collect_facts_from_file(
        file: &File,
        origin: Option<&str>,
    ) -> super::StorageFacts {
        let handle = file.as_raw_handle();
        let dos_path = final_path(handle, VOLUME_NAME_DOS);
        let nt_path = final_path(handle, VOLUME_NAME_NT);
        let volume_path = dos_path.as_deref().and_then(volume_path_name);
        let drive_root = volume_path
            .as_deref()
            .and_then(volume_root_for_query)
            .or_else(|| dos_path.as_deref().and_then(volume_root_for_query));
        let drive_type = drive_root.as_deref().and_then(drive_type_for_root);
        let dos_device = dos_path
            .as_deref()
            .and_then(drive_letter)
            .and_then(query_dos_device);
        let origin_letter = origin.and_then(drive_letter);
        let dos_letter = dos_path.as_deref().and_then(drive_letter);
        let origin_letter_differs = match (origin_letter, dos_letter) {
            (Some(origin), Some(dos)) => origin != dos,
            (Some(_), None) => true,
            _ => false,
        };
        let origin_dos_device = if origin_letter_differs {
            origin_letter.and_then(query_dos_device)
        } else {
            None
        };
        super::StorageFacts {
            dos_path,
            nt_path,
            volume_path,
            drive_type,
            dos_device,
            origin_letter_differs,
            origin_dos_device,
        }
    }
}

#[cfg(windows)]
use win::{collect_facts_from_file, open_for_classification};

#[cfg(test)]
mod tests {
    use super::*;

    fn facts(
        dos: Option<&str>,
        nt: Option<&str>,
        volume: Option<&str>,
        drive_type: Option<u32>,
        dos_device: Option<&str>,
        origin_letter_differs: bool,
        origin_dos_device: Option<&str>,
    ) -> StorageFacts {
        StorageFacts {
            dos_path: dos.map(str::to_string),
            nt_path: nt.map(str::to_string),
            volume_path: volume.map(str::to_string),
            drive_type,
            dos_device: dos_device.map(str::to_string),
            origin_letter_differs,
            origin_dos_device: origin_dos_device.map(str::to_string),
        }
    }

    #[test]
    fn local_ntfs_with_complete_proof_is_local() {
        let kind = classify_storage_facts(&facts(
            Some(r"C:\Dotty-Test\Projekte\Datei.pdf"),
            Some(r"\Device\HarddiskVolume3\Dotty-Test\Projekte\Datei.pdf"),
            Some(r"C:\"),
            Some(DRIVE_FIXED),
            Some(r"\Device\HarddiskVolume3"),
            false,
            None,
        ));
        assert_eq!(kind, StorageKind::Local);
        assert_eq!(kind.real_operation_message(), None);
    }

    #[test]
    fn removable_usb_with_complete_proof_is_local() {
        let kind = classify_storage_facts(&facts(
            Some(r"E:\Scan\Quelle.txt"),
            Some(r"\Device\HarddiskVolume8\Scan\Quelle.txt"),
            Some(r"E:\"),
            Some(DRIVE_REMOVABLE),
            Some(r"\Device\HarddiskVolume8"),
            false,
            None,
        ));
        assert_eq!(kind, StorageKind::Local);
    }

    #[test]
    fn mapped_drive_letter_is_remote() {
        let kind = classify_storage_facts(&facts(
            Some(r"Z:\Dokumente\Rechnung.pdf"),
            Some(r"\Device\Mup\server\share\Dokumente\Rechnung.pdf"),
            Some(r"Z:\"),
            Some(DRIVE_REMOTE),
            Some(r"\Device\LanmanRedirector\;Z:0000000000001234\server\share"),
            false,
            None,
        ));
        assert_eq!(kind, StorageKind::Remote);
        assert_eq!(
            kind.real_operation_message(),
            Some("Netzwerkspeicherort – echte Dateioperationen sind nicht zulässig.")
        );
    }

    #[test]
    fn classic_unc_is_remote() {
        let kind = classify_storage_facts(&facts(
            Some(r"\\server\share\Ordner\Datei.txt"),
            Some(r"\Device\Mup\server\share\Ordner\Datei.txt"),
            Some(r"\\server\share\"),
            Some(DRIVE_REMOTE),
            None,
            false,
            None,
        ));
        assert_eq!(kind, StorageKind::Remote);
    }

    #[test]
    fn webdav_nt_path_is_remote() {
        let kind = classify_storage_facts(&facts(
            Some(r"W:\cloud\file.txt"),
            Some(r"\Device\WebDavRedirector\host\dav\cloud\file.txt"),
            Some(r"W:\"),
            Some(DRIVE_REMOTE),
            Some(r"\Device\WebDavRedirector\;W:0\host\dav"),
            false,
            None,
        ));
        assert_eq!(kind, StorageKind::Remote);
    }

    #[test]
    fn drive_remote_without_other_signals_is_remote() {
        let kind = classify_storage_facts(&facts(
            Some(r"Z:\Ordner\Datei.txt"),
            Some(r"\Device\UnknownRedirector\Ordner\Datei.txt"),
            Some(r"Z:\"),
            Some(DRIVE_REMOTE),
            Some(r"\Device\UnknownRedirector"),
            false,
            None,
        ));
        assert_eq!(kind, StorageKind::Remote);
    }

    #[test]
    fn drive_fixed_without_nt_proof_is_not_local() {
        let missing_nt = classify_storage_facts(&facts(
            Some(r"C:\Ordner\Datei.txt"),
            None,
            Some(r"C:\"),
            Some(DRIVE_FIXED),
            Some(r"\Device\HarddiskVolume3"),
            false,
            None,
        ));
        assert_eq!(missing_nt, StorageKind::Unverifiable);
        let unknown_nt = classify_storage_facts(&facts(
            Some(r"C:\Ordner\Datei.txt"),
            Some(r"\Device\SomethingElse\Ordner\Datei.txt"),
            Some(r"C:\"),
            Some(DRIVE_FIXED),
            Some(r"\Device\SomethingElse"),
            false,
            None,
        ));
        assert_eq!(unknown_nt, StorageKind::Unverifiable);
        assert_ne!(missing_nt, StorageKind::Local);
        assert_ne!(unknown_nt, StorageKind::Local);
    }

    #[test]
    fn unknown_drive_type_is_unverifiable() {
        for drive_type in [DRIVE_UNKNOWN, DRIVE_NO_ROOT_DIR] {
            let kind = classify_storage_facts(&facts(
                Some(r"C:\Ordner\Datei.txt"),
                Some(r"\Device\HarddiskVolume3\Ordner\Datei.txt"),
                Some(r"C:\"),
                Some(drive_type),
                Some(r"\Device\HarddiskVolume3"),
                false,
                None,
            ));
            assert_eq!(kind, StorageKind::Unverifiable, "drive_type={drive_type}");
        }
    }

    #[test]
    fn api_error_is_unverifiable() {
        let kind = classify_storage_facts(&facts(
            None,
            Some(r"\Device\HarddiskVolume3\Ordner"),
            Some(r"C:\"),
            Some(DRIVE_FIXED),
            Some(r"\Device\HarddiskVolume3"),
            false,
            None,
        ));
        assert_eq!(kind, StorageKind::Unverifiable);
        assert_eq!(
            kind.real_operation_message(),
            Some("Der Speicherort konnte nicht zuverlässig überprüft werden.")
        );
    }

    #[test]
    fn contradictory_identity_is_unverifiable() {
        let kind = classify_storage_facts(&facts(
            Some(r"C:\Ordner\Datei.txt"),
            Some(r"\Device\HarddiskVolume3\Ordner\Datei.txt"),
            Some(r"C:\"),
            Some(DRIVE_REMOTE),
            Some(r"\Device\HarddiskVolume3"),
            false,
            None,
        ));
        assert_eq!(kind, StorageKind::Unverifiable);
    }

    #[test]
    fn subst_is_unsupported() {
        let kind = classify_storage_facts(&facts(
            Some(r"C:\Ziel\Datei.txt"),
            Some(r"\Device\HarddiskVolume3\Ziel\Datei.txt"),
            Some(r"C:\"),
            Some(DRIVE_FIXED),
            Some(r"\Device\HarddiskVolume3"),
            true,
            Some(r"\??\C:\Ziel"),
        ));
        assert_eq!(kind, StorageKind::Unsupported);
        assert_eq!(
            kind.real_operation_message(),
            Some("Dieser Speicherort wird für echte Dateioperationen derzeit nicht unterstützt.")
        );
    }

    #[test]
    fn mountpoint_is_unsupported() {
        let kind = classify_storage_facts(&facts(
            Some(r"C:\Mount\Data\Datei.txt"),
            Some(r"\Device\HarddiskVolume9\Datei.txt"),
            Some(r"C:\Mount\Data\"),
            Some(DRIVE_FIXED),
            Some(r"\Device\HarddiskVolume9"),
            false,
            None,
        ));
        assert_eq!(kind, StorageKind::Unsupported);
    }

    #[test]
    fn unknown_nt_prefix_is_unverifiable() {
        assert!(!is_local_harddisk_nt_path(
            r"\Device\HarddiskVolumeShadowCopy1\Ordner"
        ));
        assert!(!is_local_harddisk_nt_path(r"\Device\HarddiskVolume"));
        assert!(!is_remote_nt_path(r"\Device\Muppet\share"));
        let kind = classify_storage_facts(&facts(
            Some(r"C:\Ordner\Datei.txt"),
            Some(r"\Device\VeraCryptVolume\Ordner\Datei.txt"),
            Some(r"C:\"),
            Some(DRIVE_FIXED),
            Some(r"\Device\VeraCryptVolume"),
            false,
            None,
        ));
        assert_eq!(kind, StorageKind::Unverifiable);
    }

    #[test]
    fn local_letter_is_not_blocked_only_because_it_is_z() {
        let kind = classify_storage_facts(&facts(
            Some(r"Z:\Lokal\Datei.txt"),
            Some(r"\Device\HarddiskVolume4\Lokal\Datei.txt"),
            Some(r"Z:\"),
            Some(DRIVE_FIXED),
            Some(r"\Device\HarddiskVolume4"),
            false,
            None,
        ));
        assert_eq!(kind, StorageKind::Local);
    }

    #[test]
    fn textual_unc_path_is_remote_without_opening() {
        assert_eq!(
            classify_opened_path(r"\\server\share\Ordner\Datei.txt"),
            StorageKind::Remote
        );
        assert_eq!(
            classify_opened_path(r"//server/share/Ordner"),
            StorageKind::Remote
        );
    }

    #[test]
    fn harddisk_volume_prefix_requires_digits_and_boundary() {
        assert!(is_local_harddisk_nt_path(r"\Device\HarddiskVolume1"));
        assert!(is_local_harddisk_nt_path(
            r"\Device\HarddiskVolume12\Ordner"
        ));
        assert!(!is_local_harddisk_nt_path(
            r"\Device\HarddiskVolume1X\Ordner"
        ));
        assert!(is_remote_nt_path(
            r"\Device\LanmanRedirector\;Z:1\server\share"
        ));
        assert!(is_remote_nt_path(r"\Device\Mup\server\share"));
    }

    #[cfg(windows)]
    #[test]
    fn local_temp_directory_classifies_as_local() {
        let path = std::env::temp_dir().join(format!(
            "dotty-storage-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&path).unwrap();
        let kind = classify_opened_path(&path.to_string_lossy());
        let _ = std::fs::remove_dir_all(&path);
        assert_eq!(kind, StorageKind::Local, "{kind:?} for {}", path.display());
    }
}
