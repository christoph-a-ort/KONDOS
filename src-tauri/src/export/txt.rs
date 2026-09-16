use std::io::{self, Write};

use crate::model::{FsNode, ScanResult};

use super::meta::ExportMetaFlags;
use super::node::{
    created_at_ms, format_iso8601_utc, is_directory, modified_at_ms, node_children, node_name,
    size_bytes,
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
    let mut parts = Vec::new();
    if flags.include_size {
        if let Some(size) = size_bytes(node) {
            parts.push(format!("{size} B"));
        }
    }
    if flags.include_created_at {
        if let Some(ms) = created_at_ms(node) {
            parts.push(format!("erstellt {}", format_iso8601_utc(ms)));
        }
    }
    if flags.include_modified_at {
        if let Some(ms) = modified_at_ms(node) {
            parts.push(format!("geändert {}", format_iso8601_utc(ms)));
        }
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!(" ({})", parts.join(", "))
    }
}
