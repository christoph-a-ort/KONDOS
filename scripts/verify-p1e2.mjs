// P1-E2 static contract check: shared PDF+DOCX prepare/search, no second pipeline.
// Not imported by the app.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

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
const productive = [formatRs, extractRs, prepareRs, searchRs, commandsRs, typesTs, helpers, hook, results].join(
  "\n",
);

assert(formatRs.includes("ContentFormat::Pdf | ContentFormat::Docx | ContentFormat::Xlsx"), "A: collect supports Pdf|Docx|Xlsx");
assert(formatRs.includes("is_supported_content_document"), "A: shared support helper");
assert(formatRs.includes("ContentFormat::Xlsx"), "xlsx format exists");
assert(
  formatRs.includes("assert!(is_supported_content_document(ContentFormat::Xlsx))"),
  "F: XLSX is collected",
);

assert(prepareRs.includes("fn collect_snapshot_content_files"), "collect renamed");
assert(prepareRs.includes("struct SnapshotContentFile"), "snapshot file struct renamed");
assert(!prepareRs.includes("collect_snapshot_pdfs"), "old collect gone");
assert(!prepareRs.includes("SnapshotPdf"), "old snapshot struct gone");
assert(prepareRs.includes("total_document_count"), "prepare DTO totalDocumentCount");
assert(prepareRs.includes("processed_document_count"), "prepare DTO processedDocumentCount");
assert(!prepareRs.includes("total_pdf_count"), "no leftover total_pdf_count");
assert(!prepareRs.includes("processed_pdf_count"), "no leftover processed_pdf_count");

assert(searchRs.includes("collect_snapshot_content_files"), "search uses shared collect");
assert(searchRs.includes("total_document_count"), "search DTO totalDocumentCount");
assert(searchRs.includes("processed_document_count"), "search DTO processedDocumentCount");
assert(!searchRs.includes("total_pdf_count"), "search has no total_pdf_count");
assert(!searchRs.includes("processed_pdf_count"), "search has no processed_pdf_count");

assert(commandsRs.includes("total_document_count"), "command failed DTO migrated");
assert(!commandsRs.includes("total_pdf_count"), "command has no total_pdf_count");

assert(typesTs.includes("totalDocumentCount"), "frontend totalDocumentCount");
assert(typesTs.includes("processedDocumentCount"), "frontend processedDocumentCount");
assert(!typesTs.includes("totalPdfCount"), "frontend has no totalPdfCount");
assert(!typesTs.includes("processedPdfCount"), "frontend has no processedPdfCount");

assert(helpers.includes("von ${total} Dokumenten"), "UI document counts");
assert(helpers.includes("CONTENT_NO_DOCUMENTS_MESSAGE"), "empty stock is document-neutral");
assert(!helpers.includes("von ${total} PDFs"), "UI no longer counts PDFs");
assert(hook.includes("totalDocumentCount"), "hook uses new counts");
assert(results.includes("processedDocumentCount"), "progress panel uses new counts");
assert(!productive.includes("totalPdfCount"), "R: no productive totalPdfCount");
assert(!productive.includes("processedPdfCount"), "R: no productive processedPdfCount");

assert(extractRs.includes("ContentFormat::Docx"), "C: DOCX format is preserved");
assert(extractRs.includes("ContentFormat::Xlsx"), "D: XLSX format is preserved");
assert(
  extractRs.includes("entry_from_extracted_text(path, name, ContentFormat::Pdf, raw)"),
  "PDF extract keeps Pdf format",
);
assert(extractRs.includes("extract_docx_text"), "DOCX extract is dispatched");
assert(extractRs.includes("extract_xlsx_text"), "XLSX extract is dispatched");
assert(!extractRs.includes("word/document.xml"), "DOCX XML parser stays in docx.rs");
assert(!extractRs.includes("xl/workbook.xml"), "XLSX XML parser stays in xlsx.rs");
assert(!extractRs.includes("zip::"), "zip usage stays out of extract.rs");
assert(!extractRs.includes("quick_xml"), "quick-xml usage stays out of extract.rs");

const docxRs = read("src-tauri/src/content/docx.rs");
assert(docxRs.includes("word/document.xml"), "document.xml is the required part");
assert(docxRs.includes('DOCUMENT_XML: &str = "word/document.xml"'), "only document.xml is selected");
assert(docxRs.includes("zip::"), "zip crate used in docx extractor");
assert(docxRs.includes("quick_xml"), "quick-xml used in docx extractor");
assert(cargoToml.includes('zip = { version = "8"'), "zip is a direct dependency");
assert(cargoToml.includes("default-features = false"), "zip default features disabled");
assert(cargoToml.includes('features = ["deflate"]'), "zip deflate only");
assert(cargoToml.includes('quick-xml = "0.42"'), "quick-xml is a direct dependency");
assert(cargoToml.includes('pdf-extract = "0.12"'), "PDF parser dependency unchanged");
assert(!cargoToml.includes("docx-rs"), "no docx-rs");

assert(prepareRs.includes('CONTENT_PROGRESS_EVENT: &str = "content://progress"'), "event name unchanged");
assert(rows.includes("export const ROW_HEIGHT = 28;"), "S: ROW_HEIGHT");
assert(rows.includes("export const OVERSCAN = 12;"), "S: OVERSCAN");
assert(exportMod.includes("pub fn write_export"), "T: export writer unchanged");

assert(!productive.includes("DocxCache"), "no format-split DOCX cache");
assert(!productive.includes("PdfCache"), "no format-split PDF cache");
assert(searchRs.includes("fn search_file_content"), "one shared search entry");
assert(!searchRs.includes("extract_path"), "search never re-extracts");
assert(searchRs.includes("cmp_name_then_path(&left.name, &left.path, &right.name, &right.path)"), "sort ignores format");
assert(searchRs.includes("format: entry.format"), "hit format comes from cache entry");
assert(prepareRs.includes("content_has_path"), "resume checks cached paths");
assert(prepareRs.includes("if already"), "resume skips any cached path");
assert(!productive.includes("search_docx"), "no DOCX-specific search function");

const treeView = read("src/ui/TreeView.tsx");
const css = read("src/App.css");
assert(helpers.includes("In PDF-, Word- und Excel-Inhalten suchen …"), "placeholder names PDF, Word and Excel");
assert(helpers.includes('CONTENT_SEARCH_ARIA_LABEL = "In PDF-, Word- und Excel-Inhalten suchen"'), "aria names PDF, Word and Excel");
assert(treeView.includes("CONTENT_SEARCH_ARIA_LABEL"), "TreeView uses shared content aria-label");
assert(!helpers.includes("In PDF-Inhalten suchen …"), "old PDF-only placeholder gone");
assert(!treeView.includes("In PDF-Inhalten suchen"), "old PDF-only aria gone");
assert(helpers.includes("contentHitFormatLabel"), "shared format label");
assert(results.includes("content-hit-format"), "format badge in shared hit list");
assert(css.includes(".content-hit-format"), "compact format badge CSS");
assert(helpers.includes("Durchsucht werden PDF-, Word- (.docx) und Excel-Dateien (.xlsx)."), "empty stock names PDF, Word and Excel");
assert(helpers.includes('format === "xlsx"'), "XLSX format label is implemented");
assert(results.includes("onClick={onActivate}"), "hit click still activates tree");
assert(results.includes("onDoubleClick") && results.includes("onOpen()"), "hit double-click still opens");
assert(treeView.includes("openWithDefault(resultScanId, nodeId)"), "open path remains format-agnostic");

console.log("p1-e2 checks passed");
