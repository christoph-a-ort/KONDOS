use std::io::{self, Write};

use serde::ser::{SerializeSeq, SerializeStruct, Serializer};
use serde::Serialize;

use crate::model::{FsNode, ScanResult, ScanWarning, WarningCode};

use super::meta::ExportMetaFlags;
use super::node::{
    created_at_ms, format_iso8601_utc, modified_at_ms, node_children, node_kind, node_name,
    node_path, size_bytes,
};
use super::paths::to_portable_path;

struct PathCtx<'a> {
    root_abs: &'a str,
    root_name: &'a str,
    flags: ExportMetaFlags,
}

pub fn write_json<W: Write>(
    writer: &mut W,
    result: &ScanResult,
    flags: ExportMetaFlags,
) -> io::Result<()> {
    let ctx = PathCtx {
        root_abs: node_path(&result.root),
        root_name: node_name(&result.root),
        flags,
    };
    let document = JsonDocument {
        result,
        ctx: &ctx,
    };
    serde_json::to_writer_pretty(&mut *writer, &document)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?;
    writer.write_all(b"\n")?;
    Ok(())
}

struct JsonDocument<'a> {
    result: &'a ScanResult,
    ctx: &'a PathCtx<'a>,
}

impl Serialize for JsonDocument<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("JsonDocument", 4)?;
        state.serialize_field("exportVersion", &1u32)?;
        state.serialize_field("root", &JsonNode {
            node: &self.result.root,
            ctx: self.ctx,
        })?;
        state.serialize_field("stats", &self.result.stats)?;
        let warnings: Vec<JsonWarning> = self
            .result
            .warnings
            .iter()
            .map(|warning| JsonWarning::from_warning(warning, self.ctx))
            .collect();
        state.serialize_field("warnings", &warnings)?;
        state.end()
    }
}

struct JsonNode<'a> {
    node: &'a FsNode,
    ctx: &'a PathCtx<'a>,
}

impl Serialize for JsonNode<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let flags = self.ctx.flags;
        let size = if flags.include_size {
            size_bytes(self.node)
        } else {
            None
        };
        let created = if flags.include_created_at {
            created_at_ms(self.node).map(format_iso8601_utc)
        } else {
            None
        };
        let modified = if flags.include_modified_at {
            modified_at_ms(self.node).map(format_iso8601_utc)
        } else {
            None
        };

        let mut field_count = 4;
        if size.is_some() {
            field_count += 1;
        }
        if created.is_some() {
            field_count += 1;
        }
        if modified.is_some() {
            field_count += 1;
        }

        let mut state = serializer.serialize_struct("node", field_count)?;
        state.serialize_field("name", node_name(self.node))?;
        let path = to_portable_path(self.ctx.root_abs, self.ctx.root_name, node_path(self.node));
        state.serialize_field("path", &path)?;
        state.serialize_field("kind", node_kind(self.node))?;
        if let Some(size) = size {
            state.serialize_field("sizeBytes", &size)?;
        }
        if let Some(created) = created.as_ref() {
            state.serialize_field("createdAt", created)?;
        }
        if let Some(modified) = modified.as_ref() {
            state.serialize_field("modifiedAt", modified)?;
        }
        state.serialize_field("children", &JsonChildren { node: self.node, ctx: self.ctx })?;
        state.end()
    }
}

struct JsonChildren<'a> {
    node: &'a FsNode,
    ctx: &'a PathCtx<'a>,
}

impl Serialize for JsonChildren<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let children = node_children(self.node);
        let mut seq = serializer.serialize_seq(Some(children.len()))?;
        for child in children {
            seq.serialize_element(&JsonNode {
                node: child,
                ctx: self.ctx,
            })?;
        }
        seq.end()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsonWarning {
    path: String,
    code: WarningCode,
    message: String,
}

impl JsonWarning {
    fn from_warning(warning: &ScanWarning, ctx: &PathCtx<'_>) -> Self {
        Self {
            path: to_portable_path(ctx.root_abs, ctx.root_name, &warning.path),
            code: warning.code,
            message: warning.message.clone(),
        }
    }
}
