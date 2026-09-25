//! Suggested IST-Bericht filename helper.

use std::time::{SystemTime, UNIX_EPOCH};

/// Suggested IST-Bericht XLSX filename helper (used by later R4 workflow).
#[allow(dead_code)]
pub fn suggested_report_file_name(root_name: &str) -> String {
    suggested_report_file_name_at(root_name, SystemTime::now())
}

/// Suggested IST-Bericht PDF filename helper (used by later R4 workflow).
#[allow(dead_code)]
pub fn suggested_report_pdf_file_name(root_name: &str) -> String {
    suggested_report_pdf_file_name_at(root_name, SystemTime::now())
}

pub fn suggested_report_file_name_at(root_name: &str, when: SystemTime) -> String {
    suggested_report_file_name_with_ext(root_name, when, "xlsx")
}

pub fn suggested_report_pdf_file_name_at(root_name: &str, when: SystemTime) -> String {
    suggested_report_file_name_with_ext(root_name, when, "pdf")
}

fn suggested_report_file_name_with_ext(root_name: &str, when: SystemTime, ext: &str) -> String {
    let stem = sanitize_file_stem(root_name);
    let stamp = format_timestamp(when);
    format!("DottyFM_IST-Bericht_{stem}_{stamp}.{ext}")
}

fn sanitize_file_stem(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|ch| !is_forbidden_file_char(*ch))
        .collect();
    let trimmed = cleaned.trim_end_matches([' ', '.']).to_string();
    if trimmed.is_empty() {
        "Bestand".to_string()
    } else {
        trimmed
    }
}

fn is_forbidden_file_char(ch: char) -> bool {
    matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || ch.is_control()
}

fn format_timestamp(when: SystemTime) -> String {
    let secs = when
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    // Local wall clock via UTC offset is Windows-local when interpreting via chrono-less math:
    // Prefer Windows local by converting through `time` crate is unavailable — use local via
    // `chrono` not in deps. Encode as local using `Local` from std is not available.
    // Use a minimal local formatter via Windows API / or UTC stamp.
    // Spec wants YYYYMMDD-HHMMSS in local time. Use `jsystemtime` via offset from `localtime`.
    format_local_secs(secs)
}

#[cfg(windows)]
fn format_local_secs(unix_secs: i64) -> String {
    use std::mem::MaybeUninit;

    #[repr(C)]
    struct SystemTimeWin {
        year: u16,
        month: u16,
        day_of_week: u16,
        day: u16,
        hour: u16,
        minute: u16,
        second: u16,
        milliseconds: u16,
    }

    #[repr(C)]
    struct FileTime {
        low: u32,
        high: u32,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn FileTimeToLocalFileTime(lp: *const FileTime, out: *mut FileTime) -> i32;
        fn FileTimeToSystemTime(lp: *const FileTime, out: *mut SystemTimeWin) -> i32;
    }

    // FILETIME = 100-ns intervals since 1601-01-01 UTC
    const EPOCH_DIFF: i64 = 11644473600;
    let intervals = (unix_secs + EPOCH_DIFF) * 10_000_000;
    let ft = FileTime {
        low: (intervals as u64 & 0xFFFF_FFFF) as u32,
        high: ((intervals as u64) >> 32) as u32,
    };
    let mut local = MaybeUninit::<FileTime>::uninit();
    let mut st = MaybeUninit::<SystemTimeWin>::uninit();
    let ok = unsafe {
        FileTimeToLocalFileTime(&ft, local.as_mut_ptr()) != 0
            && FileTimeToSystemTime(local.as_ptr(), st.as_mut_ptr()) != 0
    };
    if !ok {
        return format_utc_fallback(unix_secs);
    }
    let st = unsafe { st.assume_init() };
    format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}",
        st.year, st.month, st.day, st.hour, st.minute, st.second
    )
}

#[cfg(not(windows))]
fn format_local_secs(unix_secs: i64) -> String {
    format_utc_fallback(unix_secs)
}

fn format_utc_fallback(unix_secs: i64) -> String {
    // Crude UTC breakdown sufficient for tests when local conversion fails.
    let days = unix_secs.div_euclid(86_400);
    let tod = unix_secs.rem_euclid(86_400) as u32;
    let hour = tod / 3600;
    let minute = (tod % 3600) / 60;
    let second = tod % 60;
    let (year, month, day) = civil_from_days(days + 719_468);
    format!("{year:04}{month:02}{day:02}-{hour:02}{minute:02}{second:02}")
}

/// Howard Hinnant civil_from_days (proleptic Gregorian), days since 1970-01-01 + 719468 offset.
fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, UNIX_EPOCH};

    #[test]
    fn suggested_name_contains_prefix_and_xlsx() {
        let name = suggested_report_file_name_at("Mustermann", UNIX_EPOCH + Duration::from_secs(1_700_000_000));
        assert!(name.starts_with("DottyFM_IST-Bericht_Mustermann_"), "{name}");
        assert!(name.ends_with(".xlsx"), "{name}");
        assert!(!name.contains('/'), "{name}");
        assert!(!name.contains('\\'), "{name}");
    }

    #[test]
    fn suggested_pdf_name_uses_same_sanitizer() {
        let name = suggested_report_pdf_file_name_at(
            "Mustermann",
            UNIX_EPOCH + Duration::from_secs(1_700_000_000),
        );
        assert!(name.starts_with("DottyFM_IST-Bericht_Mustermann_"), "{name}");
        assert!(name.ends_with(".pdf"), "{name}");
    }

    #[test]
    fn sanitizes_forbidden_chars() {
        let name = suggested_report_file_name_at("A<>B:C", UNIX_EPOCH);
        assert!(name.contains("ABC"), "{name}");
        assert!(!name.contains('<'), "{name}");
    }

    #[test]
    fn empty_stem_falls_back() {
        let name = suggested_report_file_name_at("<>", UNIX_EPOCH);
        assert!(name.contains("Bestand"), "{name}");
    }
}
