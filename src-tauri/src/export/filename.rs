use std::path::{Path, PathBuf};

use crate::model::ExportFormat;

pub fn suggested_export_file_name(root_name: &str, format: ExportFormat) -> String {
    let sanitized = sanitize_file_stem(root_name);
    apply_format_extension(&sanitized, format)
}

pub fn apply_export_extension(path: &Path, format: ExportFormat) -> PathBuf {
    match path.file_name().and_then(|name| name.to_str()) {
        Some(name) => {
            let next = apply_format_extension(name, format);
            match path.parent() {
                Some(parent) if !parent.as_os_str().is_empty() => parent.join(next),
                _ => PathBuf::from(next),
            }
        }
        None => path.with_extension(format.extension()),
    }
}

pub fn apply_format_extension(file_name: &str, format: ExportFormat) -> String {
    let ext = format.extension();
    let trimmed = trim_windows_trailing(file_name);
    if trimmed.is_empty() {
        return format!("export.{ext}");
    }
    match trimmed.rfind('.') {
        Some(index) if index > 0 && index < trimmed.len() - 1 => {
            format!("{}.{ext}", &trimmed[..index])
        }
        _ => format!("{trimmed}.{ext}"),
    }
}

fn sanitize_file_stem(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|ch| !is_forbidden_file_char(*ch))
        .collect();
    trim_windows_trailing(&cleaned)
}

fn trim_windows_trailing(name: &str) -> String {
    name.trim_end_matches([' ', '.']).to_string()
}

fn is_forbidden_file_char(ch: char) -> bool {
    matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || ch.is_control()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_root_appends_extension() {
        assert_eq!(
            suggested_export_file_name("Mustermann", ExportFormat::Csv),
            "Mustermann.csv"
        );
    }

    #[test]
    fn file_root_replaces_last_extension() {
        assert_eq!(
            suggested_export_file_name("Angebot.pdf", ExportFormat::Csv),
            "Angebot.csv"
        );
        assert_eq!(
            suggested_export_file_name("Angebot.final.geprüft.pdf", ExportFormat::Csv),
            "Angebot.final.geprüft.csv"
        );
    }

    #[test]
    fn name_without_extension() {
        assert_eq!(
            suggested_export_file_name("README", ExportFormat::Txt),
            "README.txt"
        );
    }

    #[test]
    fn replaces_only_last_extension_on_target() {
        let path = Path::new("Mustermann.final.v2.json");
        assert_eq!(
            apply_export_extension(path, ExportFormat::Csv),
            Path::new("Mustermann.final.v2.csv")
        );
        assert_eq!(
            apply_export_extension(Path::new("Mustermann.txt"), ExportFormat::Csv),
            Path::new("Mustermann.csv")
        );
        assert_eq!(
            apply_export_extension(Path::new("Mustermann.backup.txt"), ExportFormat::Csv),
            Path::new("Mustermann.backup.csv")
        );
    }

    #[test]
    fn extension_is_lowercase_and_not_duplicated() {
        assert_eq!(
            apply_format_extension("Mustermann.csv", ExportFormat::Csv),
            "Mustermann.csv"
        );
        assert_eq!(
            apply_format_extension("Mustermann.JSON", ExportFormat::Json),
            "Mustermann.json"
        );
    }

    #[test]
    fn empty_or_invalid_falls_back_to_export() {
        assert_eq!(
            suggested_export_file_name("<>", ExportFormat::Json),
            "export.json"
        );
        assert_eq!(
            suggested_export_file_name("   ", ExportFormat::Txt),
            "export.txt"
        );
    }

    #[test]
    fn preserves_case_and_unicode() {
        assert_eq!(
            suggested_export_file_name("Äpfel 📁", ExportFormat::Txt),
            "Äpfel 📁.txt"
        );
    }
}
