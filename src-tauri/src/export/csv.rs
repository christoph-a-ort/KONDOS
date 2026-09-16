use std::io::{self, Write};

use crate::model::{FsNode, ScanResult};

use super::meta::ExportMetaFlags;
use super::node::{
    created_at_ms, format_iso8601_utc, is_directory, modified_at_ms, node_children, node_depth,
    node_kind, node_name, node_path, size_bytes,
};
use super::paths::to_portable_path;

const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

pub fn write_csv<W: Write>(
    writer: &mut W,
    result: &ScanResult,
    flags: ExportMetaFlags,
) -> io::Result<()> {
    writer.write_all(UTF8_BOM)?;

    let mut headers = vec!["path", "kind", "name", "depth"];
    if flags.include_size {
        headers.push("sizeBytes");
    }
    if flags.include_created_at {
        headers.push("createdAt");
    }
    if flags.include_modified_at {
        headers.push("modifiedAt");
    }
    writer.write_all(headers.join(",").as_bytes())?;
    writer.write_all(b"\n")?;

    let root_abs = node_path(&result.root);
    let root_name = node_name(&result.root);
    write_row(writer, &result.root, root_abs, root_name, flags)?;
    write_descendants(writer, &result.root, root_abs, root_name, flags)?;
    Ok(())
}

fn write_descendants<W: Write>(
    writer: &mut W,
    node: &FsNode,
    root_abs: &str,
    root_name: &str,
    flags: ExportMetaFlags,
) -> io::Result<()> {
    if !is_directory(node) {
        return Ok(());
    }
    for child in node_children(node) {
        write_row(writer, child, root_abs, root_name, flags)?;
        write_descendants(writer, child, root_abs, root_name, flags)?;
    }
    Ok(())
}

fn write_row<W: Write>(
    writer: &mut W,
    node: &FsNode,
    root_abs: &str,
    root_name: &str,
    flags: ExportMetaFlags,
) -> io::Result<()> {
    let path = to_portable_path(root_abs, root_name, node_path(node));
    let mut values = vec![
        csv_escape(&path),
        csv_escape(node_kind(node)),
        csv_escape(node_name(node)),
        node_depth(node).to_string(),
    ];
    if flags.include_size {
        values.push(size_bytes(node).map(|size| size.to_string()).unwrap_or_default());
    }
    if flags.include_created_at {
        values.push(csv_escape(
            &created_at_ms(node)
                .map(format_iso8601_utc)
                .unwrap_or_default(),
        ));
    }
    if flags.include_modified_at {
        values.push(csv_escape(
            &modified_at_ms(node)
                .map(format_iso8601_utc)
                .unwrap_or_default(),
        ));
    }
    writer.write_all(values.join(",").as_bytes())?;
    writer.write_all(b"\n")?;
    Ok(())
}

fn csv_escape(value: &str) -> String {
    if value.contains(['"', ',', '\r', '\n']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::csv_escape;

    #[test]
    fn quotes_comma_quote_and_newline() {
        assert_eq!(csv_escape(r#"a"b,c"#), r#""a""b,c""#);
        assert_eq!(csv_escape("a;b"), "a;b");
        assert_eq!(csv_escape("line\nbreak"), "\"line\nbreak\"");
    }
}
