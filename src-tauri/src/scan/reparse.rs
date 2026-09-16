use std::fs::{FileType, Metadata};

/// Einträge, denen der Walker nicht rekursiv folgen darf:
/// Symlinks und unter Windows jeder Reparse Point (inkl. Junctions).
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

#[cfg(windows)]
pub fn windows_is_reparse_point(metadata: &Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    windows_attributes_are_reparse(metadata.file_attributes())
}

pub fn windows_attributes_are_reparse(attributes: u32) -> bool {
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
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
}
