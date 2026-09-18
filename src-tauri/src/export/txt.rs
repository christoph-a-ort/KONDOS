use std::io::{self, Write};

use crate::model::{FsNode, ScanResult};

use super::meta::ExportMetaFlags;
use super::node::{
    created_at_ms, is_directory, modified_at_ms, node_children, node_name, size_bytes,
};
use super::paths::portable_root_label;

pub fn write_txt<W: Write>(
    writer: &mut W,
    result: &ScanResult,
    flags: ExportMetaFlags,
) -> io::Result<()> {
    let root_label = portable_root_label(node_name(&result.root));
    write!(
        writer,
        "[Root] {root_label}/{}",
        meta_suffix(&result.root, flags)
    )?;
    writer.write_all(b"\n")?;
    write_children(writer, &result.root, "", flags)?;
    Ok(())
}

fn write_children<W: Write>(
    writer: &mut W,
    node: &FsNode,
    prefix: &str,
    flags: ExportMetaFlags,
) -> io::Result<()> {
    let children = node_children(node);
    for (index, child) in children.iter().enumerate() {
        let is_last = index + 1 == children.len();
        let connector = if is_last { "└── " } else { "├── " };
        write!(writer, "{prefix}{connector}{}", format_node_label(child, flags))?;
        writer.write_all(b"\n")?;
        if is_directory(child) && !node_children(child).is_empty() {
            let next_prefix = format!("{prefix}{}", if is_last { "    " } else { "│   " });
            write_children(writer, child, &next_prefix, flags)?;
        }
    }
    Ok(())
}

fn format_node_label(node: &FsNode, flags: ExportMetaFlags) -> String {
    let suffix = if is_directory(node) { "/" } else { "" };
    format!(
        "{}{suffix}{}",
        node_name(node),
        meta_suffix(node, flags)
    )
}

fn meta_suffix(node: &FsNode, flags: ExportMetaFlags) -> String {
    if is_directory(node) {
        return String::new();
    }
    let mut parts = Vec::new();
    if flags.include_size {
        if let Some(size) = size_bytes(node) {
            parts.push(format!("{size} B"));
        }
    }
    if flags.include_modified_at {
        if let Some(ms) = modified_at_ms(node) {
            parts.push(format!("geändert {}", format_txt_datetime(ms)));
        }
    }
    if flags.include_created_at {
        if let Some(ms) = created_at_ms(node) {
            parts.push(format!("erstellt {}", format_txt_datetime(ms)));
        }
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!(" ({})", parts.join(", "))
    }
}

/// Lokale Kalenderzeit wie TreeView `formatDateTime`: TT.MM.JJJJ HH:MM, ohne Sekunden.
pub(super) fn format_txt_datetime(ms: u64) -> String {
    #[cfg(windows)]
    {
        if let Some(text) = windows_local_datetime_minutes(ms) {
            return text;
        }
    }
    utc_datetime_minutes(ms)
}

fn utc_datetime_minutes(ms: u64) -> String {
    let total_minutes = ms / 60_000;
    let days = total_minutes / (24 * 60);
    let minutes_in_day = total_minutes % (24 * 60);
    let hour = minutes_in_day / 60;
    let minute = minutes_in_day % 60;
    let (year, month, day) = civil_from_days(days as i64);
    format!("{day:02}.{month:02}.{year} {hour:02}:{minute:02}")
}

fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i32 + era as i32 * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = y + if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

#[cfg(windows)]
fn windows_local_datetime_minutes(ms: u64) -> Option<String> {
    const FILETIME_UNIX_EPOCH: u64 = 116_444_736_000_000_000;
    let ticks = ms.checked_mul(10_000)?.checked_add(FILETIME_UNIX_EPOCH)?;
    #[repr(C)]
    struct FileTime {
        dw_low_date_time: u32,
        dw_high_date_time: u32,
    }
    #[repr(C)]
    struct SystemTime {
        year: u16,
        month: u16,
        day_of_week: u16,
        day: u16,
        hour: u16,
        minute: u16,
        second: u16,
        milliseconds: u16,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn FileTimeToLocalFileTime(utc: *const FileTime, local: *mut FileTime) -> i32;
        fn FileTimeToSystemTime(time: *const FileTime, system: *mut SystemTime) -> i32;
    }
    let utc = FileTime {
        dw_low_date_time: (ticks & 0xFFFF_FFFF) as u32,
        dw_high_date_time: (ticks >> 32) as u32,
    };
    let mut local = FileTime {
        dw_low_date_time: 0,
        dw_high_date_time: 0,
    };
    let mut system = SystemTime {
        year: 0,
        month: 0,
        day_of_week: 0,
        day: 0,
        hour: 0,
        minute: 0,
        second: 0,
        milliseconds: 0,
    };
    unsafe {
        if FileTimeToLocalFileTime(&utc, &mut local) == 0 {
            return None;
        }
        if FileTimeToSystemTime(&local, &mut system) == 0 {
            return None;
        }
    }
    Some(format!(
        "{:02}.{:02}.{} {:02}:{:02}",
        system.day, system.month, system.year, system.hour, system.minute
    ))
}
