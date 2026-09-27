// R5-B: Realtest corrections — PDF readability, single-file names, size display,
// extension folder limits, singular/plural. No scanner rewrite / no R6.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return readFileSync(join(rootDir, rel), "utf8");
}

const pdfRs = read("src-tauri/src/report/pdf.rs");
const xlsxRs = read("src-tauri/src/report/xlsx.rs");
const modelRs = read("src-tauri/src/report/model.rs");
const testsRs = read("src-tauri/src/report/tests.rs");
const analysisTs = read("src/ui/inventoryAnalysis.ts");
const reportModelTs = read("src/ui/inventoryReportModel.ts");
const analysisCheck = read("src/ui/inventoryAnalysisCheck.ts");
const modelCheck = read("src/ui/inventoryReportModelCheck.ts");
const walkerRs = read("src-tauri/src/scan/walker.rs");

// B.1 folder overview
assert(pdfRs.includes('"Unterordner"'), "B1: Unterordner header");
assert(pdfRs.includes("vec![3, 5, 1, 2, 3, 2]"), "B1: readable weights");
assert(!/push_table\([\s\S]*"Listing"[\s\S]*Ordnerübersicht|Ordnerübersicht[\s\S]*"Listing"/.test(pdfRs), "B1: listing not in folder PDF section");
assert(xlsxRs.includes('"Listing"'), "B1: Excel still has Listing");

// B.2 single-file robust capture
assert(analysisTs.includes("SingleDirectFileFolder"), "B2: analysis type");
assert(analysisTs.includes("directFileName") || analysisTs.includes("file: soleDirectFile"), "B2: file captured");
assert(analysisTs.includes("soleDirectFile"), "B2: soleDirectFile");
assert(reportModelTs.includes("singleFileFolderRow(rootPath, entry)"), "B2: uses analysis entry");
assert(!reportModelTs.includes("folderByAbsPath"), "B2: no fragile Map join");
assert(analysisCheck.includes("allein.txt"), "B2: analysis check name");
assert(modelCheck.includes("allein.txt"), "B2: model check name");

// B.3 size display — scanner untouched for this fix
assert(walkerRs.includes("include_size.then_some(meta.len())"), "B3: scanner gate unchanged");
assert(modelRs.includes("files_with_known_size"), "B3: model files_with_known_size");
assert(modelRs.includes("direct_files_with_known_size"), "B3: model folder known count");
assert(pdfRs.includes("nicht erfasst"), "B3: PDF unknown sizes wording");
assert(pdfRs.includes("format_aggregate_size_display"), "B3: size display helper");
assert(xlsxRs.includes("nicht erfasst"), "B3: Excel unknown sizes wording");
assert(xlsxRs.includes("write_optional_known_size"), "B3: Excel empty cell helper");
assert(testsRs.includes("format_aggregate_size_distinguishes_unknown_from_zero"), "B3: size test");

// B.4 extension limits
assert(pdfRs.includes("PDF_EXTENSION_FOLDER_LIMIT"), "B4: extension limit const");
assert(pdfRs.includes("PDF_EXACT_NAME_FOLDER_LIMIT"), "B4: exact-name limit const");
assert(pdfRs.includes("Angezeigt werden {folder_shown} von {folder_total} Ordnern"), "B4: truncation notice");
assert(!pdfRs.includes(".take(20)"), "B4: no silent take(20)");
assert(!pdfRs.includes(".take(30)"), "B4: no silent take(30)");
assert(testsRs.includes("pdf_extension_folder_list_limit_is_explicit"), "B4: limit test");

// B.5 singular/plural
assert(pdfRs.includes("format_dateien"), "B5: helper");
assert(pdfRs.includes("1 Datei"), "B5: singular string");
assert(testsRs.includes("format_dateien_singular_plural"), "B5: test");

// Nachkorrektur: long unbroken PDF table tokens soft-break
const pdfTableRs = read("src-tauri/src/report/pdf_table.rs");
assert(pdfTableRs.includes("soft_break_cell_atoms"), "PDF soft-break helper");
assert(pdfTableRs.includes("cell_paragraph"), "PDF cell paragraph uses soft-break");
assert(testsRs.includes("pdf_single_file_long_filenames_survive_soft_break_and_render"), "long name regression");
assert(testsRs.includes("overflow_token_needs_soft_break_XXXX.pdf"), "former DROP fixture");
assert(testsRs.includes("keep_ok_short_token.pdf"), "KEEP fixture");
assert(!testsRs.includes("BahnCard"), "no private Realtest filenames in tests");
assert(!pdfTableRs.includes("BahnCard"), "no private Realtest filenames in pdf_table");

console.log("report r5 checks passed");
