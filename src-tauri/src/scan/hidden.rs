use std::fs::Metadata;
use std::path::Path;

/// Plattformspezifische Hidden-Erkennung.
/// Namen wie `.git` oder `.DS_Store` sind nur Beispiele für die Punkt-Regel.
pub fn is_hidden(path: &Path, metadata: Option<&Metadata>) -> bool {
    if name_is_dotfile(path) {
        return true;
    }

    #[cfg(windows)]
    {
        if let Some(meta) = metadata {
            if windows_hidden_attribute(meta) {
                return true;
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(meta) = metadata {
            if macos_hidden_flag(meta) {
                return true;
            }
        }
    }

    let _ = metadata;
    false
}

fn name_is_dotfile(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.starts_with('.') && name != "." && name != "..")
        .unwrap_or(false)
}

#[cfg(windows)]
fn windows_hidden_attribute(metadata: &Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
}

#[cfg(target_os = "macos")]
fn macos_hidden_flag(metadata: &Metadata) -> bool {
    use std::os::macos::fs::MetadataExt;
    const UF_HIDDEN: u32 = 0x8000;
    metadata.st_flags() & UF_HIDDEN != 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn dotfiles_are_hidden_on_all_platforms() {
        assert!(is_hidden(Path::new(".git"), None));
        assert!(is_hidden(Path::new("/tmp/.DS_Store"), None));
        assert!(is_hidden(&PathBuf::from(".env.local"), None));
        assert!(!is_hidden(Path::new("README.md"), None));
        assert!(!is_hidden(Path::new("git"), None));
    }
}
