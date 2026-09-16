use crate::model::FsNode;

pub fn is_directory(node: &FsNode) -> bool {
    matches!(node, FsNode::Directory { .. })
}

pub fn node_name(node: &FsNode) -> &str {
    match node {
        FsNode::Directory { name, .. } | FsNode::File { name, .. } => name,
    }
}

pub fn node_path(node: &FsNode) -> &str {
    match node {
        FsNode::Directory { path, .. } | FsNode::File { path, .. } => path,
    }
}

pub fn node_kind(node: &FsNode) -> &'static str {
    match node {
        FsNode::Directory { .. } => "directory",
        FsNode::File { .. } => "file",
    }
}

pub fn node_depth(node: &FsNode) -> u8 {
    match node {
        FsNode::Directory { depth, .. } | FsNode::File { depth, .. } => *depth,
    }
}

pub fn node_children(node: &FsNode) -> &[FsNode] {
    match node {
        FsNode::Directory { children, .. } => children,
        FsNode::File { .. } => &[],
    }
}

pub fn size_bytes(node: &FsNode) -> Option<u64> {
    match node {
        FsNode::Directory { size_bytes, .. } | FsNode::File { size_bytes, .. } => *size_bytes,
    }
}

pub fn created_at_ms(node: &FsNode) -> Option<u64> {
    match node {
        FsNode::Directory { created_at_ms, .. } | FsNode::File { created_at_ms, .. } => {
            *created_at_ms
        }
    }
}

pub fn modified_at_ms(node: &FsNode) -> Option<u64> {
    match node {
        FsNode::Directory {
            modified_at_ms, ..
        }
        | FsNode::File {
            modified_at_ms, ..
        } => *modified_at_ms,
    }
}

pub fn format_iso8601_utc(ms: u64) -> String {
    let secs = (ms / 1000) as i64;
    let millis = ms % 1000;
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400) as u32;
    let hour = tod / 3600;
    let min = (tod % 3600) / 60;
    let sec = tod % 60;
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{min:02}:{sec:02}.{millis:03}Z")
}

fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

#[cfg(test)]
mod tests {
    use super::format_iso8601_utc;

    #[test]
    fn unix_epoch_iso() {
        assert_eq!(format_iso8601_utc(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(format_iso8601_utc(1_001), "1970-01-01T00:00:01.001Z");
    }
}
