use std::fs::{FileType, Metadata};
use std::path::Path;

/// Einträge, denen der Walker nicht rekursiv folgen darf:
/// Symlinks und unter Windows jeder Namens-Surrogat-Reparse-Point (Junction, Mount-Point).
/// Cloud-Filter-Platzhalter (OneDrive) sind keine Namens-Surrogate und werden nicht wie
/// Symlinks übersprungen.
pub fn must_not_follow(file_type: FileType, metadata: Option<&Metadata>) -> bool {
    if file_type.is_symlink() {
        return true;
    }

    #[cfg(windows)]
    {
        if let Some(meta) = metadata {
            return windows_is_reparse_point(meta);
        }
    }

    let _ = metadata;
    false
}

/// Wie `must_not_follow`, liest bei gesetztem Reparse-Bit aber den Tag.
/// Namens-Surrogate und unlesbare Tags blockieren. Die Cloud-Filter-Familie nicht.
pub fn must_not_follow_with_path(
    path: &Path,
    file_type: FileType,
    metadata: Option<&Metadata>,
) -> bool {
    #[cfg(windows)]
    {
        if file_type.is_symlink() {
            return true;
        }
        let Some(meta) = metadata else {
            return false;
        };
        if !windows_is_reparse_point(meta) {
            return must_not_follow(file_type, Some(meta));
        }
        return path_has_blocking_reparse(path).unwrap_or(true);
    }

    #[cfg(not(windows))]
    {
        let _ = path;
        must_not_follow(file_type, metadata)
    }
}

#[cfg(windows)]
pub fn windows_is_reparse_point(metadata: &Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    windows_attributes_are_reparse(metadata.file_attributes())
}

pub fn windows_attributes_are_reparse(attributes: u32) -> bool {
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

pub fn attributes_are_recall_on_data_access(attributes: u32) -> bool {
    const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;
    attributes & FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS != 0
}

pub fn is_name_surrogate_reparse_tag(tag: u32) -> bool {
    const IO_REPARSE_TAG_NAME_SURROGATE: u32 = 0x2000_0000;
    tag & IO_REPARSE_TAG_NAME_SURROGATE != 0
}

/// IO_REPARSE_TAG_CLOUD … CLOUD_F (0x9000n01A).
pub fn is_cloud_filter_reparse_tag(tag: u32) -> bool {
    tag & 0xFFFF_0FFF == 0x9000_001A
}

pub fn reparse_tag_blocks_follow(attributes: u32, tag: Option<u32>) -> bool {
    if !windows_attributes_are_reparse(attributes) {
        return false;
    }
    match tag {
        Some(tag) => !is_cloud_filter_reparse_tag(tag),
        None => true,
    }
}

pub fn path_has_blocking_reparse(path: &Path) -> std::io::Result<bool> {
    #[cfg(windows)]
    {
        return win::path_has_blocking_reparse(path);
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Ok(false)
    }
}

pub fn handle_has_blocking_reparse(file: &std::fs::File) -> std::io::Result<bool> {
    #[cfg(windows)]
    {
        return win::handle_has_blocking_reparse(file);
    }
    #[cfg(not(windows))]
    {
        let _ = file;
        Ok(false)
    }
}

pub fn handle_attributes(file: &std::fs::File) -> std::io::Result<u32> {
    #[cfg(windows)]
    {
        return win::handle_attributes(file);
    }
    #[cfg(not(windows))]
    {
        let _ = file;
        Err(std::io::Error::from(std::io::ErrorKind::Unsupported))
    }
}

/// Unter Windows ohne Metadaten kann ein Junction nicht erkannt werden.
/// Dann nicht traversieren.
pub fn refuse_unverified_windows_directory(file_type: FileType, metadata: Option<&Metadata>) -> bool {
    #[cfg(windows)]
    {
        return file_type.is_dir() && metadata.is_none() && !file_type.is_symlink();
    }
    #[cfg(not(windows))]
    {
        let _ = (file_type, metadata);
        false
    }
}

#[cfg(windows)]
mod win {
    use super::{reparse_tag_blocks_follow, windows_attributes_are_reparse};
    use std::fs::{File, OpenOptions};
    use std::io;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::{AsRawHandle, RawHandle};
    use std::path::Path;

    const FILE_SHARE_READ: u32 = 0x1;
    const FILE_SHARE_WRITE: u32 = 0x2;
    const FILE_SHARE_DELETE: u32 = 0x4;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_ATTRIBUTE_TAG_INFO: i32 = 9;
    const FSCTL_GET_REPARSE_POINT: u32 = 0x0009_00A8;
    const ERROR_NOT_A_REPARSE_POINT: i32 = 4390;

    #[link(name = "kernel32")]
    extern "system" {
        fn DeviceIoControl(
            handle: RawHandle,
            ioctl: u32,
            in_buffer: *mut u8,
            in_size: u32,
            out_buffer: *mut u8,
            out_size: u32,
            returned: *mut u32,
            overlapped: *mut u8,
        ) -> i32;
        fn GetFileInformationByHandleEx(
            handle: RawHandle,
            class: i32,
            buffer: *mut u8,
            buffer_size: u32,
        ) -> i32;
    }

    fn open_reparse(path: &Path) -> io::Result<File> {
        OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)
    }

    fn attribute_tag_info(file: &File) -> io::Result<(u32, u32)> {
        let mut info = [0u32; 2];
        let ok = unsafe {
            GetFileInformationByHandleEx(
                file.as_raw_handle(),
                FILE_ATTRIBUTE_TAG_INFO,
                info.as_mut_ptr().cast(),
                8,
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok((info[0], info[1]))
    }

    pub(super) fn handle_attributes(file: &File) -> io::Result<u32> {
        match attribute_tag_info(file) {
            Ok((attributes, _)) => Ok(attributes),
            Err(_) => {
                use std::os::windows::fs::MetadataExt;
                Ok(file.metadata()?.file_attributes())
            }
        }
    }

    fn reparse_tag_from_handle(file: &File) -> io::Result<Option<u32>> {
        let mut buffer = vec![0u8; 16 * 1024];
        let mut returned = 0u32;
        let ok = unsafe {
            DeviceIoControl(
                file.as_raw_handle(),
                FSCTL_GET_REPARSE_POINT,
                std::ptr::null_mut(),
                0,
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                &mut returned,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            let err = io::Error::last_os_error();
            if err.raw_os_error() == Some(ERROR_NOT_A_REPARSE_POINT) {
                return Ok(None);
            }
            return Err(err);
        }
        if (returned as usize) < 4 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Reparse-Tag unvollständig",
            ));
        }
        Ok(Some(u32::from_le_bytes([
            buffer[0], buffer[1], buffer[2], buffer[3],
        ])))
    }

    fn tag_for_attributes(file: &File, attributes: u32) -> Option<u32> {
        if !windows_attributes_are_reparse(attributes) {
            return None;
        }
        match attribute_tag_info(file) {
            Ok((_, tag)) if tag != 0 => return Some(tag),
            Ok((_, _)) | Err(_) => {}
        }
        reparse_tag_from_handle(file).ok().flatten()
    }

    fn blocking_from_handle(file: &File, attributes: u32) -> bool {
        reparse_tag_blocks_follow(attributes, tag_for_attributes(file, attributes))
    }

    pub(super) fn handle_has_blocking_reparse(file: &File) -> io::Result<bool> {
        if file.metadata()?.file_type().is_symlink() {
            return Ok(true);
        }
        let attributes = handle_attributes(file)?;
        Ok(blocking_from_handle(file, attributes))
    }

    pub(super) fn path_has_blocking_reparse(path: &Path) -> io::Result<bool> {
        match std::fs::symlink_metadata(path) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error),
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Ok(true);
                }
                use std::os::windows::fs::MetadataExt;
                let meta_attrs = metadata.file_attributes();
                let file = match open_reparse(path) {
                    Ok(file) => file,
                    Err(_) => {
                        return Ok(windows_attributes_are_reparse(meta_attrs));
                    }
                };
                let handle_attrs = handle_attributes(&file).unwrap_or(meta_attrs);
                let attributes = if windows_attributes_are_reparse(handle_attrs) {
                    handle_attrs
                } else {
                    meta_attrs
                };
                if !windows_attributes_are_reparse(attributes) {
                    return Ok(false);
                }
                Ok(blocking_from_handle(&file, attributes))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reparse_attribute_bit_is_detected() {
        assert!(windows_attributes_are_reparse(0x400));
        assert!(windows_attributes_are_reparse(0x400 | 0x10));
        assert!(!windows_attributes_are_reparse(0x10));
        assert!(!windows_attributes_are_reparse(0));
    }

    #[test]
    fn name_surrogate_and_cloud_tags_are_distinct() {
        const MOUNT_POINT: u32 = 0xA000_0003;
        const SYMLINK: u32 = 0xA000_000C;
        const CLOUD: u32 = 0x9000_001A;
        const CLOUD_6: u32 = 0x9000_601A;
        const CLOUD_F: u32 = 0x9000_F01A;
        const NFS: u32 = 0x8000_0014;

        assert!(is_name_surrogate_reparse_tag(MOUNT_POINT));
        assert!(is_name_surrogate_reparse_tag(SYMLINK));
        assert!(!is_name_surrogate_reparse_tag(CLOUD_6));
        assert!(is_cloud_filter_reparse_tag(CLOUD));
        assert!(is_cloud_filter_reparse_tag(CLOUD_6));
        assert!(is_cloud_filter_reparse_tag(CLOUD_F));
        assert!(!is_cloud_filter_reparse_tag(MOUNT_POINT));
        assert!(!is_cloud_filter_reparse_tag(NFS));

        assert!(reparse_tag_blocks_follow(0x400, Some(MOUNT_POINT)));
        assert!(reparse_tag_blocks_follow(0x410, Some(SYMLINK)));
        assert!(!reparse_tag_blocks_follow(0x400, Some(CLOUD_6)));
        assert!(!reparse_tag_blocks_follow(0x420, Some(CLOUD)));
        assert!(reparse_tag_blocks_follow(0x400, Some(NFS)));
        assert!(reparse_tag_blocks_follow(0x400, None));
        assert!(!reparse_tag_blocks_follow(0x10, None));
        assert!(!reparse_tag_blocks_follow(0x20, Some(CLOUD_6)));
    }

    #[test]
    fn recall_on_data_access_is_distinct_from_reparse() {
        assert!(attributes_are_recall_on_data_access(0x0040_0000));
        assert!(attributes_are_recall_on_data_access(0x0040_0420));
        assert!(!attributes_are_recall_on_data_access(0x420));
        assert!(!attributes_are_recall_on_data_access(0x400));
    }

    #[cfg(windows)]
    #[test]
    fn temp_directory_is_not_a_blocking_reparse() {
        let path = std::env::temp_dir().join(format!(
            "dotty-reparse-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&path).unwrap();
        let result = path_has_blocking_reparse(&path);
        let _ = std::fs::remove_dir_all(&path);
        assert_eq!(result.unwrap(), false);
    }

    #[cfg(windows)]
    #[test]
    fn junction_is_a_blocking_reparse() {
        let root = std::env::temp_dir().join(format!(
            "dotty-reparse-junc-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let real = root.join("real");
        let junction = root.join("link");
        std::fs::create_dir_all(&real).unwrap();
        let output = std::process::Command::new("cmd")
            .arg("/c")
            .arg(format!("mklink /J {} {}", junction.display(), real.display()))
            .output()
            .unwrap();
        assert!(output.status.success(), "mklink /J failed");
        let blocked = path_has_blocking_reparse(&junction).unwrap();
        let _ = std::fs::remove_dir(&junction);
        let _ = std::fs::remove_dir_all(&root);
        assert!(blocked);
    }

    #[cfg(windows)]
    #[test]
    fn locally_synced_onedrive_desktop_dottytest_is_followable_if_present() {
        use crate::paths::windows_storage::{
            classify_opened_path, classify_storage_from_file_with_origin, StorageKind,
        };

        let folder = std::path::Path::new(r"C:\Users\26101\OneDrive\Desktop\DottyTest");
        if !folder.is_dir() {
            return;
        }
        let file = folder.join("test.txt");
        let dest = folder.join("zielordner");
        for path in [folder, file.as_path(), dest.as_path()] {
            if !path.exists() {
                continue;
            }
            assert_eq!(
                classify_opened_path(&path.to_string_lossy()),
                StorageKind::Local,
                "storage for {}",
                path.display()
            );
            assert!(
                !path_has_blocking_reparse(path).unwrap(),
                "blocking reparse for {}",
                path.display()
            );
        }
        if file.is_file() {
            let attrs = {
                use std::os::windows::fs::MetadataExt;
                std::fs::symlink_metadata(&file).unwrap().file_attributes()
            };
            if attributes_are_recall_on_data_access(attrs) {
                panic!("test.txt is only a cloud placeholder; pin it locally for this check");
            }
        }

        use std::os::windows::fs::OpenOptionsExt;
        let opened = std::fs::OpenOptions::new()
            .read(true)
            .access_mode(0x1 | 0x80 | 0x0010_0000)
            .share_mode(0x1 | 0x2 | 0x4)
            .custom_flags(0x0200_0000 | 0x0020_0000)
            .open(folder)
            .expect("open OneDrive test folder with MOVE directory flags");
        assert!(
            !handle_has_blocking_reparse(&opened).unwrap(),
            "MOVE directory handle must not treat a locally synced OneDrive folder as a blocking reparse"
        );
        assert_eq!(
            classify_storage_from_file_with_origin(&opened, &folder.to_string_lossy()),
            StorageKind::Local,
            "MOVE-style directory handle must still classify as local"
        );
    }
}
