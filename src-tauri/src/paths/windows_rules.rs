//! FV2-02a – Pure Windows name and device-path rules. No filesystem access.

const SUPERSCRIPT_DIGITS: &[(char, char)] = &[
    ('\u{2070}', '0'),
    ('\u{00B9}', '1'),
    ('\u{00B2}', '2'),
    ('\u{00B3}', '3'),
    ('\u{2074}', '4'),
    ('\u{2075}', '5'),
    ('\u{2076}', '6'),
    ('\u{2077}', '7'),
    ('\u{2078}', '8'),
    ('\u{2079}', '9'),
];

fn fold_superscript_digits(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            SUPERSCRIPT_DIGITS
                .iter()
                .find(|(from, _)| *from == character)
                .map(|(_, to)| *to)
                .unwrap_or(character)
        })
        .collect()
}

fn device_stem(name: &str) -> String {
    let folded = fold_superscript_digits(name);
    let before_dot = folded.split('.').next().unwrap_or(&folded);
    before_dot.trim().to_ascii_lowercase()
}

fn has_forbidden_char(name: &str) -> bool {
    name.chars().any(|character| {
        matches!(character, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
            || (character as u32) < 32
    })
}

pub fn is_reserved_device_stem(name: &str) -> bool {
    matches!(
        device_stem(name).as_str(),
        "con"
            | "prn"
            | "aux"
            | "nul"
            | "com0"
            | "com1"
            | "com2"
            | "com3"
            | "com4"
            | "com5"
            | "com6"
            | "com7"
            | "com8"
            | "com9"
            | "lpt0"
            | "lpt1"
            | "lpt2"
            | "lpt3"
            | "lpt4"
            | "lpt5"
            | "lpt6"
            | "lpt7"
            | "lpt8"
            | "lpt9"
    )
}

pub fn is_windows_device_path(path: &str) -> bool {
    let normalized = path.trim().replace('/', "\\").to_ascii_uppercase();
    normalized.starts_with(r"\\.\")
        || normalized.starts_with(r"\\?\")
        || normalized.starts_with(r"\??\")
}

fn looks_absolute_windows_path(path: &str) -> bool {
    let trimmed = path.trim();
    if is_windows_device_path(trimmed) {
        return true;
    }
    let bytes = trimmed.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return bytes.len() == 2 || bytes[2] == b'\\' || bytes[2] == b'/';
    }
    trimmed.replace('/', "\\").starts_with("\\\\")
}

fn components_after_structural_prefix(path: &str, leading_empty_count: usize) -> Option<Vec<&str>> {
    let parts: Vec<&str> = path.split(['\\', '/']).collect();
    let mut index = 0;
    let mut skipped = 0;
    while index < parts.len() && parts[index].is_empty() && skipped < leading_empty_count {
        index += 1;
        skipped += 1;
    }
    if skipped != leading_empty_count {
        return None;
    }
    let rest = &parts[index..];
    if rest.is_empty() || rest.iter().any(|part| part.is_empty()) {
        return None;
    }
    Some(rest.to_vec())
}

pub fn is_allowed_windows_component(name: &str) -> bool {
    if name.is_empty() || name == "." || name == ".." {
        return false;
    }
    if has_forbidden_char(name) {
        return false;
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return false;
    }
    if name.eq_ignore_ascii_case("globalroot") {
        return false;
    }
    !is_reserved_device_stem(name)
}

pub fn is_allowed_relative_plan_path(path: &str) -> bool {
    if path.contains('\0') || is_windows_device_path(path) {
        return false;
    }
    if path.is_empty() || looks_absolute_windows_path(path) {
        return false;
    }
    if path == "." {
        return true;
    }
    if path.contains(':') {
        return false;
    }
    let unified = path.replace('\\', "/");
    if unified.starts_with('/') {
        return false;
    }
    let parts: Vec<&str> = unified.split('/').collect();
    !parts.is_empty() && parts.iter().copied().all(is_allowed_windows_component)
}

pub fn is_allowed_absolute_windows_path(path: &str) -> bool {
    if path.contains('\0') || is_windows_device_path(path) {
        return false;
    }
    if path.is_empty() {
        return false;
    }
    let bytes = path.as_bytes();
    if bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return false;
    }
    if bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && matches!(bytes[2], b'\\' | b'/')
    {
        return match components_after_structural_prefix(&path[2..], 1) {
            Some(parts) => !parts.is_empty() && parts.iter().copied().all(is_allowed_windows_component),
            None => false,
        };
    }
    let slashes = path.replace('/', "\\");
    if slashes.starts_with("\\\\") {
        return match components_after_structural_prefix(&slashes, 2) {
            Some(parts) => parts.len() >= 2 && parts.iter().copied().all(is_allowed_windows_component),
            None => false,
        };
    }
    false
}

pub fn execution_path_looks_unsafe(path: &str) -> bool {
    if path.contains('\0') || is_windows_device_path(path) {
        return true;
    }
    if looks_absolute_windows_path(path) {
        return !is_allowed_absolute_windows_path(path);
    }
    !is_allowed_relative_plan_path(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> serde_json::Value {
        serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../testdata/windows-path-rules.json"
        )))
        .expect("windows-path-rules fixture")
    }

    fn strings<'a>(value: &'a serde_json::Value, key: &str) -> Vec<&'a str> {
        value[key]
            .as_array()
            .expect(key)
            .iter()
            .map(|entry| entry.as_str().expect(key))
            .collect()
    }

    #[test]
    fn shared_fixture_components() {
        let fixture = fixture();
        for name in strings(&fixture["components"], "allowed") {
            assert!(is_allowed_windows_component(name), "allowed component {name:?}");
        }
        for name in strings(&fixture["components"], "rejected") {
            assert!(
                !is_allowed_windows_component(name),
                "rejected component {name:?}"
            );
        }
    }

    #[test]
    fn shared_fixture_relative_paths() {
        let fixture = fixture();
        for path in strings(&fixture["relativePaths"], "allowed") {
            assert!(is_allowed_relative_plan_path(path), "allowed relative {path:?}");
        }
        for path in strings(&fixture["relativePaths"], "rejected") {
            assert!(
                !is_allowed_relative_plan_path(path),
                "rejected relative {path:?}"
            );
        }
    }

    #[test]
    fn shared_fixture_absolute_paths() {
        let fixture = fixture();
        for path in strings(&fixture["absolutePaths"], "allowed") {
            assert!(
                is_allowed_absolute_windows_path(path),
                "allowed absolute {path:?}"
            );
        }
        for path in strings(&fixture["absolutePaths"], "rejected") {
            assert!(
                !is_allowed_absolute_windows_path(path),
                "rejected absolute {path:?}"
            );
        }
        assert!(is_allowed_absolute_windows_path(r"C:\Ordner\Datei.txt"));
        assert!(!is_allowed_windows_component("Datei.txt:Stream"));
        assert!(execution_path_looks_unsafe("CON.txt"));
        assert!(!execution_path_looks_unsafe(r"C:\Ordner\Datei.txt"));
    }
}
