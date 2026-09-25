//! Transport model matching `src/ui/inventoryReportModel.ts` (serde camelCase).
//! Pure deserialize/render shape — no filesystem analysis.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportModel {
    pub meta: InventoryReportMeta,
    pub chapter_selection: InventoryReportChapterSelection,
    pub chapters: InventoryReportChapters,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportMeta {
    pub schema_version: u32,
    pub created_at_ms: i64,
    pub root_path: String,
    pub root_name: String,
    pub max_depth: Option<u32>,
    pub scan_id: Option<u64>,
    pub max_observed_depth: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportChapterSelection {
    pub overview: bool,
    pub file_types: bool,
    pub folders: bool,
    pub empty_folders: bool,
    pub single_file_folders: bool,
    pub unreadable: bool,
    pub repeated_folder_names: bool,
    pub repeated_file_names: bool,
    pub year_structures: bool,
    pub file_name_patterns: bool,
    pub same_file_stems: bool,
    pub exact_file_name_structures: bool,
    pub extension_distributions: bool,
    pub interpretation: bool,
}

impl InventoryReportChapterSelection {
    pub fn all_enabled() -> Self {
        Self {
            overview: true,
            file_types: true,
            folders: true,
            empty_folders: true,
            single_file_folders: true,
            unreadable: true,
            repeated_folder_names: true,
            repeated_file_names: true,
            year_structures: true,
            file_name_patterns: true,
            same_file_stems: true,
            exact_file_name_structures: true,
            extension_distributions: true,
            interpretation: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportChapters {
    pub overview: InventoryReportOverview,
    pub file_types: Vec<InventoryReportFileTypeRow>,
    pub folders: Vec<InventoryReportFolderRow>,
    pub empty_folders: Vec<InventoryReportPathRow>,
    pub single_file_folders: Vec<InventoryReportSingleFileFolderRow>,
    pub unreadable: InventoryReportUnreadable,
    pub repeated_folder_names: Vec<InventoryReportNameGroup>,
    pub repeated_file_names: Vec<InventoryReportNameGroup>,
    pub year_structures: Vec<InventoryReportYearStructure>,
    pub file_name_patterns: InventoryReportFileNamePatterns,
    pub same_file_stems: Vec<InventoryReportSameStemGroup>,
    pub exact_file_name_structures: Vec<InventoryReportExactNameStructureGroup>,
    pub extension_distributions: Vec<InventoryReportExtensionDistributionGroup>,
    pub interpretation: InventoryReportInterpretation,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportOverview {
    pub directory_count: u64,
    pub file_count: u64,
    pub known_size_bytes: u64,
    pub files_without_known_size: u64,
    pub depth_limited_folder_count: u64,
    pub subdirectory_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportFileTypeRow {
    pub extension: String,
    pub label: String,
    pub file_count: u64,
    pub known_size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportFolderRow {
    pub name: String,
    pub relative_path: String,
    pub depth: u32,
    pub listing: String,
    pub direct_file_count: u64,
    pub direct_directory_count: u64,
    pub direct_known_size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportPathRow {
    pub name: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportSingleFileFolderRow {
    pub folder_name: String,
    pub relative_path: String,
    pub file_name: String,
    pub extension: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportUnreadable {
    pub warnings: Vec<InventoryReportWarningRow>,
    pub unconfirmed_empty_looking_folders: Vec<InventoryReportPathRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportWarningRow {
    pub relative_path: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportNameGroup {
    pub name: String,
    pub count: u64,
    pub relative_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportYearStructure {
    pub parent_relative_path: String,
    pub parent_name: String,
    pub years: Vec<i32>,
    pub min_year: i32,
    pub max_year: i32,
    pub missing_years: Vec<i32>,
    pub consecutive_runs: Vec<InventoryReportYearRun>,
    pub year_folders: Vec<InventoryReportYearFolder>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportYearRun {
    pub start: i32,
    pub end: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportYearFolder {
    pub year: i32,
    pub relative_path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportFileNamePatterns {
    pub analyzed_file_count: u64,
    pub files_with_digits: u64,
    pub files_with_leading_digits: u64,
    pub files_with_recognized_date_forms: u64,
    pub files_with_six_digit_blocks: u64,
    pub date_form_groups: Vec<InventoryReportDateFormGroup>,
    pub six_digit_hint: String,
    pub date_forms_hint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportDateFormGroup {
    pub format: String,
    pub label: String,
    pub match_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportSameStemGroup {
    pub normalized_stem: String,
    pub observed_stem_forms: Vec<String>,
    pub extension_keys: Vec<String>,
    pub occurrence_count: u64,
    pub occurrences: Vec<InventoryReportStemOccurrence>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportStemOccurrence {
    pub relative_path: String,
    pub filename: String,
    pub extension_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportExactNameStructureGroup {
    pub signature: String,
    pub direct_file_names: Vec<String>,
    pub direct_file_count: u64,
    pub folder_count: u64,
    pub folders: Vec<InventoryReportStructureFolder>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportStructureFolder {
    pub relative_path: String,
    pub name: String,
    pub depth: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportExtensionDistributionGroup {
    pub signature: String,
    pub extension_counts: Vec<InventoryReportExtensionCount>,
    pub direct_file_count: u64,
    pub folder_count: u64,
    pub folders: Vec<InventoryReportStructureFolder>,
    pub hint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportExtensionCount {
    pub extension_key: String,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportInterpretation {
    pub notes: Vec<String>,
}
