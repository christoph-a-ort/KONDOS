use crate::model::FsNode;

use super::node::{created_at_ms, is_directory, modified_at_ms, node_children, size_bytes};

#[derive(Debug, Clone, Copy)]
pub struct ExportMetaFlags {
    pub include_size: bool,
    pub include_created_at: bool,
    pub include_modified_at: bool,
}

pub fn meta_flags_from_root(root: &FsNode) -> ExportMetaFlags {
    collect(root)
}

fn collect(node: &FsNode) -> ExportMetaFlags {
    let mut flags = ExportMetaFlags {
        include_size: size_bytes(node).is_some(),
        include_created_at: created_at_ms(node).is_some(),
        include_modified_at: modified_at_ms(node).is_some(),
    };
    if !is_directory(node) {
        return flags;
    }
    for child in node_children(node) {
        let child_flags = collect(child);
        flags.include_size |= child_flags.include_size;
        flags.include_created_at |= child_flags.include_created_at;
        flags.include_modified_at |= child_flags.include_modified_at;
        if flags.include_size && flags.include_created_at && flags.include_modified_at {
            break;
        }
    }
    flags
}
