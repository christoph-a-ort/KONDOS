use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RootKind {
    Directory,
    File,
}

/// Prüft, ob ein abgelegter Pfad ein Verzeichnis ist, ohne den Scanner zu starten.
pub fn classify_root(path: &str) -> Result<RootKind, AppError> {
    if path.is_empty() {
        return Err(AppError::invalid_path(
            "Bitte wählen Sie ein Startverzeichnis.",
        ));
    }

    let root = Path::new(path);
    if !root.exists() {
        return Err(AppError::invalid_path(
            "Das Startverzeichnis existiert nicht.",
        ));
    }

    let metadata = match fs::metadata(root) {
        Ok(metadata) => metadata,
        Err(_) => return Err(AppError::root_inaccessible()),
    };

    if metadata.is_dir() {
        Ok(RootKind::Directory)
    } else {
        Ok(RootKind::File)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppErrorKind;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "kondos-classify-{}-{}-{}",
            label,
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ))
    }

    #[test]
    fn classifies_directory() {
        let root = temp_path("dir");
        fs::create_dir_all(&root).expect("dir");
        let kind = classify_root(&root.to_string_lossy()).expect("ok");
        let _ = fs::remove_dir_all(&root);
        assert_eq!(kind, RootKind::Directory);
    }

    #[test]
    fn classifies_file() {
        let root = temp_path("file-root");
        fs::create_dir_all(&root).expect("dir");
        let file = root.join("not-a-dir.txt");
        fs::write(&file, b"x").expect("file");
        let kind = classify_root(&file.to_string_lossy()).expect("ok");
        let _ = fs::remove_dir_all(&root);
        assert_eq!(kind, RootKind::File);
    }

    #[test]
    fn classifies_unicode_and_space_directory() {
        let root = temp_path("names");
        let folder = root.join("Ordner äöü");
        fs::create_dir_all(&folder).expect("unicode dir");
        let kind = classify_root(&folder.to_string_lossy()).expect("ok");
        let _ = fs::remove_dir_all(&root);
        assert_eq!(kind, RootKind::Directory);
    }

    #[test]
    fn rejects_missing_path() {
        let missing = temp_path("missing");
        let err = classify_root(&missing.to_string_lossy()).unwrap_err();
        assert_eq!(err.kind, AppErrorKind::InvalidPath);
        assert!(err.message.contains("existiert nicht"));
    }

    #[test]
    fn rejects_empty_path() {
        let err = classify_root("").unwrap_err();
        assert_eq!(err.kind, AppErrorKind::InvalidPath);
    }

    #[test]
    fn root_kind_serializes_as_camel_case_strings() {
        assert_eq!(
            serde_json::to_string(&RootKind::Directory).expect("dir"),
            "\"directory\""
        );
        assert_eq!(
            serde_json::to_string(&RootKind::File).expect("file"),
            "\"file\""
        );
    }
}
