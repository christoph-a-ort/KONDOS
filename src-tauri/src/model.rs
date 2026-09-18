use serde::{Deserialize, Serialize};

pub const MIN_DEPTH: u8 = 1;
pub const MAX_DEPTH: u8 = 8;
pub const DEFAULT_DEPTH: u8 = 8;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NodeKind {
    File,
    Directory,
}

/// Wie der Inhalt eines Ordners in diesem Scan behandelt wurde.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DirectoryListing {
    Read,
    DepthLimited,
    Incomplete,
}

/// Hierarchischer Dateisystemknoten.
/// Dateien haben kein `children`-Feld (intern getaggt über `kind`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum FsNode {
    #[serde(rename = "directory")]
    Directory {
        id: String,
        name: String,
        path: String,
        depth: u8,
        listing: DirectoryListing,
        children: Vec<FsNode>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "sizeBytes")]
        size_bytes: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "createdAtMs")]
        created_at_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "modifiedAtMs")]
        modified_at_ms: Option<u64>,
    },
    #[serde(rename = "file")]
    File {
        id: String,
        name: String,
        path: String,
        depth: u8,
        #[serde(skip_serializing_if = "Option::is_none", rename = "sizeBytes")]
        size_bytes: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "createdAtMs")]
        created_at_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "modifiedAtMs")]
        modified_at_ms: Option<u64>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanConfig {
    pub root_path: String,
    pub max_depth: u8,
    pub exclude_hidden: bool,
    pub extensions: Vec<String>,
    pub include_size: bool,
    pub include_created_at: bool,
    pub include_modified_at: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WarningCode {
    PermissionDenied,
    NotFound,
    NotReadable,
    IoError,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanWarning {
    pub path: String,
    pub code: WarningCode,
    pub message: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ScanStatus {
    Running,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub scan_id: u64,
    pub processed_count: u64,
    pub current_path: String,
    pub status: ScanStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanStats {
    pub directory_count: u64,
    pub file_count: u64,
    pub skipped_count: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub root: FsNode,
    pub warnings: Vec<ScanWarning>,
    pub stats: ScanStats,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Txt,
    Csv,
    Json,
}

impl ExportFormat {
    pub fn as_label(self) -> &'static str {
        match self {
            Self::Txt => "TXT",
            Self::Csv => "CSV",
            Self::Json => "JSON",
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Txt => "txt",
            Self::Csv => "csv",
            Self::Json => "json",
        }
    }
}
