// P1-E3 static contract check: shared PDF+DOCX+XLSX prepare/search, no second pipeline.
// Not imported by the app.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

assert(existsSync(join(root, "src-tauri/src/content/xlsx.rs")), "xlsx extractor exists");
assert(existsSync(join(root, "src-tauri/src/content/ooxml.rs")), "shared OOXML helpers exist");

const formatRs = read("src-tauri/src/content/format.rs");
const extractRs = read("src-tauri/src/content/extract.rs");
const prepareRs = read("src-tauri/src/content/prepare.rs");
const searchRs = read("src-tauri/src/content/search.rs");
const commandsRs = read("src-tauri/src/commands/content.rs");
const typesTs = read("src/model/types.ts");
const helpers = read("src/ui/contentSearch.ts");
const hook = read("src/ui/useContentSearch.ts");
const results = read("src/ui/ContentSearchResults.tsx");
const cargoToml = read("src-tauri/Cargo.toml");
const rows = read("src/ui/treeRows.ts");
const exportMod = read("src-tauri/src/export/mod.rs");
const xlsxRs = read("src-tauri/src/content/xlsx.rs");
const docxRs = read("src-tauri/src/content/docx.rs");
const ooxmlRs = read("src-tauri/src/content/ooxml.rs");
const modRs = read("src-tauri/src/content/mod.rs");
const treeView = read("src/ui/TreeView.tsx");
const css = read("src/App.css");
const productive = [
  formatRs,
  extractRs,
  prepareRs,
  searchRs,
  commandsRs,
  typesTs,
  helpers,
  hook,
  results,
  xlsxRs,
  docxRs,
  ooxmlRs,
  modRs,
].join("\n");

assert(formatRs.includes("ContentFormat::Pdf | ContentFormat::Docx | ContentFormat::Xlsx"), "collect supports Pdf|Docx|Xlsx");
assert(formatRs.includes("assert!(is_supported_content_document(ContentFormat::Xlsx))"), "XLSX is a supported content document");
assert(extractRs.includes("extract_xlsx_text"), "extract dispatches XLSX");
assert(extractRs.includes("catch_parser_unwind(|| extract_xlsx_text(&bytes))"), "XLSX uses catch_unwind");
assert(xlsxRs.includes('WORKBOOK_XML: &str = "xl/workbook.xml"'), "reads workbook.xml");
assert(xlsxRs.includes('WORKBOOK_RELS: &str = "xl/_rels/workbook.xml.rels"'), "reads workbook rels");
assert(xlsxRs.includes('SHARED_STRINGS: &str = "xl/sharedStrings.xml"'), "reads shared strings");
assert(xlsxRs.includes('t="inlineStr"') || xlsxRs.includes('"inlineStr"'), "inline strings supported");
assert(xlsxRs.includes("CellType::Shared"), "shared strings supported");
assert(xlsxRs.includes("Formeltext bewusst nicht"), "formula text excluded");
assert(xlsxRs.includes("numeric_excel_date_serial_stays_numeric"), "unstyled date serial stays numeric");
assert(xlsxRs.includes('STYLES_XML: &str = "xl/styles.xml"'), "reads styles.xml");
assert(xlsxRs.includes("parse_styles"), "parses styles.xml");
assert(xlsxRs.includes("cellXfs"), "reads cellXfs");
assert(xlsxRs.includes("numFmt"), "reads numFmt");
assert(xlsxRs.includes("numFmtId"), "maps numFmtId");
assert(xlsxRs.includes("workbook_uses_1904") && xlsxRs.includes("date1904"), "reads workbook 1904 flag");
assert(xlsxRs.includes("excel_day_to_ymd"), "converts Excel serials");
assert(xlsxRs.includes("29.02.1900") || xlsxRs.includes("1900, 2, 29"), "Excel 1900 leap serial 60");
assert(xlsxRs.includes("17.05.2025"), "German date search representation");
assert(xlsxRs.includes("2025-05-17"), "ISO date search representation");
assert(xlsxRs.includes("format_hms"), "time search representation");
assert(xlsxRs.includes("styled_1900_date_17_05_2025_is_extracted"), "17.05.2025 extract test");
assert(xlsxRs.includes("styled_1900_date_22_03_2014_from_41720"), "41720 date extract test");
assert(xlsxRs.includes("date1904_system_converts_serial"), "1904 system test");
assert(xlsxRs.includes("excel_1900_leap_serial_60_is_29_feb_1900"), "1900 leap test");
assert(xlsxRs.includes("unstyled_720_and_41720_stay_numbers"), "unstyled numbers stay numeric");
assert(xlsxRs.includes("missing_styles_xml_keeps_numeric"), "missing styles keep numbers");
assert(searchRs.includes("xlsx_styled_date_text_is_found_by_german_and_iso"), "search finds 17.05.2025 and ISO");
assert(searchRs.includes("xlsx_unstyled_41720_is_not_found_as_date"), "unstyled 41720 is not a date hit");
assert(searchRs.includes("xlsx_styled_41720_is_found_as_date_and_720_does_not_match"), "styled 41720 date search; 720 does not match");
assert(!xlsxRs.includes("calamine"), "xlsx extractor has no calamine");
assert(ooxmlRs.includes("MAX_XLSX_XML_TOTAL_BYTES: u64 = 64 * 1024 * 1024"), "64 MiB XLSX XML budget");
assert(ooxmlRs.includes("MAX_XML_PART_BYTES: u64 = 32 * 1024 * 1024"), "32 MiB part limit");
assert(ooxmlRs.includes("MAX_ZIP_ENTRIES: usize = 4096"), "4096 zip entries");
assert(extractRs.includes("MAX_PDF_FILE_BYTES: u64 = 50 * 1024 * 1024"), "50 MiB file limit");
assert(extractRs.includes("MAX_EXTRACTED_TEXT_BYTES: usize = 1024 * 1024"), "1 MiB extract cap");

assert(prepareRs.includes("fn collect_snapshot_content_files"), "shared collect");
assert(searchRs.includes("fn search_file_content"), "one shared search entry");
assert(searchRs.includes("MAX_CONTENT_SEARCH_HITS: usize = 200"), "global 200-hit cap");
assert(!searchRs.includes("extract_path"), "search never re-extracts");
assert(!productive.includes("XlsxCache"), "no separate XLSX cache");
assert(!productive.includes("search_xlsx"), "no XLSX-specific search function");
assert(!productive.includes("calamine"), "no calamine");
assert(!cargoToml.includes("calamine"), "no calamine dependency");
assert(!cargoToml.includes("umya"), "no umya-spreadsheet");
assert(cargoToml.includes('zip = { version = "8"'), "zip 8 reused");
assert(cargoToml.includes('quick-xml = "0.42"'), "quick-xml reused");
assert(xlsxRs.includes("quick_xml"), "XLSX uses quick-xml");
assert(xlsxRs.includes("open_office_zip"), "XLSX reuses OOXML zip helper");
assert(docxRs.includes("word/document.xml"), "DOCX extractor unchanged target");
assert(rows.includes("export const ROW_HEIGHT = 28;"), "ROW_HEIGHT");
assert(rows.includes("export const OVERSCAN = 12;"), "OVERSCAN");
assert(exportMod.includes("pub fn write_export"), "export writer unchanged");

assert(helpers.includes("In PDF-, Word- und Excel-Inhalten suchen …"), "placeholder includes Excel");
assert(helpers.includes('CONTENT_SEARCH_ARIA_LABEL = "In PDF-, Word- und Excel-Inhalten suchen"'), "aria includes Excel");
assert(helpers.includes("Durchsucht werden PDF-, Word- (.docx) und Excel-Dateien (.xlsx)."), "hint names xlsx");
assert(helpers.includes('format === "xlsx"'), "XLSX badge helper");
assert(results.includes("content-hit-format"), "shared format badge");
assert(css.includes(".content-hit-format"), "badge CSS");
assert(treeView.includes("CONTENT_SEARCH_ARIA_LABEL"), "TreeView uses shared aria");
assert(typesTs.includes('"pdf" | "docx" | "xlsx"'), "frontend format union includes xlsx");
assert(prepareRs.includes("xlsx_only_snapshot_is_prepared_and_not_counted_as_empty"), "xlsx-only prepare test");
assert(prepareRs.includes("mixed_pdf_docx_and_xlsx_are_prepared"), "mixed prepare test");
assert(searchRs.includes("mixed_pdf_docx_and_xlsx_hits_share_one_200_cap"), "shared 200-cap test");

console.log("p1-e3 checks passed");
