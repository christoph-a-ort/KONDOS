//! Portable Exportpfade: Root-Name plus Relativpfad, immer `/`.

pub fn looks_like_absolute_local_path(value: &str) -> bool {
    let normalized = normalize_separators(value);
    is_windows_drive(&normalized) || normalized.starts_with("//") || normalized.starts_with('/')
}

pub fn portable_root_label(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() || looks_like_absolute_local_path(trimmed) {
        "root".to_string()
    } else {
        trimmed.replace('\\', "/")
    }
}

pub fn to_portable_path(root_abs: &str, root_name: &str, abs: &str) -> String {
    let root = trim_trailing_slash(&normalize_separators(root_abs));
    let path = trim_trailing_slash(&normalize_separators(abs));
    let label = portable_root_label(root_name);

    let relative = if path_eq(&path, &root) {
        String::new()
    } else if let Some(rest) = strip_root_prefix(&path, &root) {
        rest.trim_start_matches('/').to_string()
    } else {
        return String::new();
    };

    let portable = if relative.is_empty() {
        label
    } else if label.is_empty() {
        relative
    } else {
        format!("{label}/{relative}")
    };

    if looks_like_absolute_local_path(&portable) {
        String::new()
    } else {
        portable
    }
}

fn normalize_separators(value: &str) -> String {
    value.replace('\\', "/")
}

fn trim_trailing_slash(value: &str) -> String {
    if value.len() >= 2 && is_windows_drive(value) && value.ends_with('/') {
        return value.to_string();
    }
    value.trim_end_matches('/').to_string()
}

fn is_windows_drive(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn path_eq(left: &str, right: &str) -> bool {
    if cfg!(windows) {
        left.eq_ignore_ascii_case(right)
    } else {
        left == right
    }
}

fn strip_root_prefix<'a>(path: &'a str, root: &str) -> Option<&'a str> {
    if path.len() < root.len() {
        return None;
    }
    let (head, tail) = path.split_at(root.len());
    if !path_eq(head, root) {
        return None;
    }
    if tail.is_empty() || tail.starts_with('/') {
        Some(tail)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_tree_becomes_portable() {
        let root = r"C:\Users\COrt\Projekte\Mustermann";
        assert_eq!(
            to_portable_path(root, "Mustermann", root),
            "Mustermann"
        );
        assert_eq!(
            to_portable_path(
                root,
                "Mustermann",
                r"C:\Users\COrt\Projekte\Mustermann\DOKUMENTE\Angebot.PDF"
            ),
            "Mustermann/DOKUMENTE/Angebot.PDF"
        );
    }

    #[test]
    fn preserves_case_and_unicode() {
        let root = r"C:\Daten\Äpfel";
        assert_eq!(
            to_portable_path(root, "Äpfel", r"C:\Daten\Äpfel\Straße\Datei.TXT"),
            "Äpfel/Straße/Datei.TXT"
        );
    }

    #[test]
    fn unrelated_warning_path_is_empty() {
        assert_eq!(
            to_portable_path(r"C:\a\root", "root", r"D:\other\file.txt"),
            ""
        );
    }
}
