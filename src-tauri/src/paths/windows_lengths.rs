//! FV2-02b – Conservative Windows target-path length rules.

pub const MAX_ABSOLUTE_TARGET_UTF16: usize = 259;
pub const NUL_INCLUDED_MAX: usize = 260;
pub const CONSERVATIVE_COMPONENT_UTF16: usize = 255;
const _: () = assert!(MAX_ABSOLUTE_TARGET_UTF16 + 1 == NUL_INCLUDED_MAX);

pub fn utf16_length(value: &str) -> usize {
    value.encode_utf16().count()
}

pub fn is_allowed_absolute_target_total_length(absolute_target: &str) -> bool {
    utf16_length(absolute_target) + 1 <= NUL_INCLUDED_MAX
}

pub fn effective_component_limit(filesystem_component_limit: u32) -> usize {
    CONSERVATIVE_COMPONENT_UTF16.min(filesystem_component_limit as usize)
}

pub fn exceeds_conservative_component_cap(name: &str) -> bool {
    utf16_length(name) > CONSERVATIVE_COMPONENT_UTF16
}

pub fn is_allowed_new_component_length(name: &str, filesystem_component_limit: u32) -> bool {
    utf16_length(name) <= effective_component_limit(filesystem_component_limit)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetLengthKind {
    Total,
    Component,
    UnknownLimit,
    UnknownComponents,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TargetLengthVerdict {
    pub ok: bool,
    pub kind: Option<TargetLengthKind>,
    pub reason: Option<&'static str>,
}

pub fn evaluate_new_target_path_length(
    absolute_target: &str,
    new_components: &[&str],
    filesystem_component_limit: Option<u32>,
    require_known_volume_limit: bool,
) -> TargetLengthVerdict {
    if !is_allowed_absolute_target_total_length(absolute_target) {
        return TargetLengthVerdict {
            ok: false,
            kind: Some(TargetLengthKind::Total),
            reason: Some("Der Zielpfad überschreitet die zulässige Windows-Pfadlänge."),
        };
    }
    if new_components.is_empty() {
        return TargetLengthVerdict {
            ok: false,
            kind: Some(TargetLengthKind::UnknownComponents),
            reason: Some("Neue Zielkomponenten sind nicht sicher bestimmbar."),
        };
    }
    if new_components.iter().any(|name| exceeds_conservative_component_cap(name)) {
        return TargetLengthVerdict {
            ok: false,
            kind: Some(TargetLengthKind::Component),
            reason: Some("Eine neue Zielkomponente überschreitet die konservative Namenslänge."),
        };
    }
    if require_known_volume_limit {
        let Some(limit) = filesystem_component_limit.filter(|value| *value > 0) else {
            return TargetLengthVerdict {
                ok: false,
                kind: Some(TargetLengthKind::UnknownLimit),
                reason: Some("Die Dateisystem-Komponentengrenze ist nicht sicher bestimmbar."),
            };
        };
        if new_components
            .iter()
            .any(|name| !is_allowed_new_component_length(name, limit))
        {
            return TargetLengthVerdict {
                ok: false,
                kind: Some(TargetLengthKind::Component),
                reason: Some("Eine neue Zielkomponente überschreitet die Dateisystemgrenze."),
            };
        }
    }
    TargetLengthVerdict {
        ok: true,
        kind: None,
        reason: None,
    }
}

pub fn volume_root_for_query(path: &str) -> Option<String> {
    let normalized = path.replace('/', "\\");
    let bytes = normalized.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        let letter = (bytes[0] as char).to_ascii_uppercase();
        return Some(format!("{letter}:\\"));
    }
    if normalized.starts_with("\\\\") && !super::windows_rules::is_windows_device_path(&normalized) {
        let parts: Vec<&str> = normalized.split('\\').filter(|part| !part.is_empty()).collect();
        if parts.len() >= 2 {
            return Some(format!("\\\\{}\\{}\\", parts[0], parts[1]));
        }
    }
    None
}

#[cfg(windows)]
pub fn maximum_component_length_for_path(path: &str) -> Option<u32> {
    use std::os::windows::ffi::OsStrExt;
    use std::{ffi::OsStr, ptr};

    let root = volume_root_for_query(path)?;
    let wide: Vec<u16> = OsStr::new(&root).encode_wide().chain(std::iter::once(0)).collect();
    let mut maximum_component_length: u32 = 0;
    let ok = unsafe {
        GetVolumeInformationW(
            wide.as_ptr(),
            ptr::null_mut(),
            0,
            ptr::null_mut(),
            &mut maximum_component_length,
            ptr::null_mut(),
            ptr::null_mut(),
            0,
        )
    };
    if ok == 0 || maximum_component_length == 0 {
        None
    } else {
        Some(maximum_component_length)
    }
}

#[cfg(not(windows))]
pub fn maximum_component_length_for_path(_path: &str) -> Option<u32> {
    None
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
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
}

pub fn target_length_blocks_real_operation(
    absolute_target: &str,
    new_components: &[&str],
    filesystem_component_limit: Option<u32>,
) -> Option<&'static str> {
    evaluate_new_target_path_length(absolute_target, new_components, filesystem_component_limit, true)
        .reason
}

#[cfg(test)]
use serde::Deserialize;

#[cfg(test)]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LengthRecipe {
    id: String,
    root: String,
    sizes: Vec<usize>,
    fill: Option<String>,
    total_allowed: bool,
    component_allowed: bool,
}

#[cfg(test)]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LengthLiteral {
    id: String,
    absolute: String,
    expected_utf16: usize,
    total_allowed: bool,
    grants_real_execution: Option<bool>,
}

#[cfg(test)]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LengthUnknownLimit {
    id: String,
    absolute: String,
    new_components: Vec<String>,
    expected_ok: bool,
}

#[cfg(test)]
#[derive(Deserialize)]
struct LengthLimits {
    #[serde(rename = "maxAbsoluteUtf16")]
    max_absolute_utf16: usize,
    #[serde(rename = "nulIncludedMax")]
    nul_included_max: usize,
    #[serde(rename = "conservativeComponentUtf16")]
    conservative_component_utf16: usize,
}

#[cfg(test)]
#[derive(Deserialize)]
struct LengthFixture {
    version: u32,
    limits: LengthLimits,
    recipes: Vec<LengthRecipe>,
    literals: Vec<LengthLiteral>,
    #[serde(default, rename = "unknownLimit")]
    unknown_limit: Vec<LengthUnknownLimit>,
}

#[cfg(test)]
fn fixture() -> LengthFixture {
    serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../testdata/windows-path-lengths.json"
    )))
    .expect("windows-path-lengths fixture")
}

#[cfg(test)]
fn fill_ascii(size: usize, fill: &str) -> String {
    fill.repeat(size)
}

#[cfg(test)]
fn build_absolute(root: &str, sizes: &[usize], fill: &str) -> String {
    let slash = if root.contains('\\') { "\\" } else { "/" };
    let trimmed = root.trim_end_matches(['\\', '/']);
    let mut parts = vec![trimmed.to_string()];
    parts.extend(sizes.iter().map(|size| fill_ascii(*size, fill)));
    parts.join(slash)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_fixture_length_rules() {
        let fixture = fixture();
        assert_eq!(fixture.version, 1);
        assert_eq!(fixture.limits.max_absolute_utf16, MAX_ABSOLUTE_TARGET_UTF16);
        assert_eq!(fixture.limits.nul_included_max, NUL_INCLUDED_MAX);
        assert_eq!(
            fixture.limits.conservative_component_utf16,
            CONSERVATIVE_COMPONENT_UTF16
        );
        for recipe in &fixture.recipes {
            let fill = recipe.fill.as_deref().unwrap_or("A");
            let absolute = build_absolute(&recipe.root, &recipe.sizes, fill);
            let expected = recipe.sizes.iter().enumerate().fold(0usize, |sum, (index, size)| {
                sum + size
                    + if index == 0 {
                        utf16_length(recipe.root.trim_end_matches(['\\', '/'])) + 1
                    } else {
                        1
                    }
            });
            assert_eq!(utf16_length(&absolute), expected, "{}", recipe.id);
            assert_eq!(
                is_allowed_absolute_target_total_length(&absolute),
                recipe.total_allowed,
                "{}",
                recipe.id
            );
            let names: Vec<String> = recipe.sizes.iter().map(|size| fill_ascii(*size, fill)).collect();
            let refs: Vec<&str> = names.iter().map(String::as_str).collect();
            let component_ok = refs.iter().all(|name| !exceeds_conservative_component_cap(name));
            assert_eq!(component_ok, recipe.component_allowed, "{}", recipe.id);
            let known = evaluate_new_target_path_length(
                &absolute,
                &refs,
                Some(CONSERVATIVE_COMPONENT_UTF16 as u32),
                true,
            );
            assert_eq!(known.ok, recipe.total_allowed && recipe.component_allowed, "{}", recipe.id);
        }
        for literal in &fixture.literals {
            assert_eq!(
                utf16_length(&literal.absolute),
                literal.expected_utf16,
                "{}",
                literal.id
            );
            assert_eq!(
                is_allowed_absolute_target_total_length(&literal.absolute),
                literal.total_allowed,
                "{}",
                literal.id
            );
            if literal.grants_real_execution == Some(false) {
                assert!(
                    !literal.absolute.starts_with(r"\\?\") && literal.id.contains("unc"),
                    "{}",
                    literal.id
                );
            }
        }
        for row in &fixture.unknown_limit {
            let refs: Vec<&str> = row.new_components.iter().map(String::as_str).collect();
            let verdict = evaluate_new_target_path_length(&row.absolute, &refs, None, true);
            assert_eq!(verdict.ok, row.expected_ok, "{}", row.id);
            assert_eq!(verdict.kind, Some(TargetLengthKind::UnknownLimit), "{}", row.id);
        }
        assert_eq!(utf16_length("📁"), 2);
        assert_eq!(utf16_length(r"C:\📁"), 5);
        let unknown = evaluate_new_target_path_length(r"C:\Ordner\Datei.txt", &["Datei.txt"], None, true);
        assert!(!unknown.ok);
        assert_eq!(unknown.kind, Some(TargetLengthKind::UnknownLimit));
        assert_eq!(volume_root_for_query(r"C:\Dotty-Test\Projekte"), Some(r"C:\".to_string()));
        assert_eq!(
            volume_root_for_query(r"\\server\share\Ordner\Datei.txt"),
            Some(r"\\server\share\".to_string())
        );
        assert_eq!(volume_root_for_query(r"\\?\C:\Windows"), None);
        assert_eq!(effective_component_limit(100), 100);
        assert_eq!(effective_component_limit(400), 255);
        let tight = evaluate_new_target_path_length(
            r"C:\Ordner\AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            &["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
            Some(100),
            true,
        );
        assert!(!tight.ok);
        assert_eq!(tight.kind, Some(TargetLengthKind::Component));
    }

    #[cfg(windows)]
    #[test]
    fn local_volume_limit_is_measured_not_assumed() {
        let limit = maximum_component_length_for_path(r"C:\");
        assert!(limit.is_some(), "GetVolumeInformationW must return a real volume limit");
        assert_ne!(limit, Some(0));
        assert!(effective_component_limit(limit.unwrap()) <= CONSERVATIVE_COMPONENT_UTF16);
    }
}
