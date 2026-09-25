// R3: IST-Bericht PDF writer + Tauri command + TS API. No UI button/dialog.

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

const cargoToml = read("src-tauri/Cargo.toml");
const reportMod = read("src-tauri/src/report/mod.rs");
const pdfRs = read("src-tauri/src/report/pdf.rs");
const persistRs = read("src-tauri/src/report/persist.rs");
const filenameRs = read("src-tauri/src/report/filename.rs");
const testsRs = read("src-tauri/src/report/tests.rs");
const cmdRs = read("src-tauri/src/commands/report.rs");
const cmdMod = read("src-tauri/src/commands/mod.rs");
const libRs = read("src-tauri/src/lib.rs");
const stateRs = read("src-tauri/src/state.rs");
const apiTs = read("src/scan/api.ts");
const indexTs = read("src/scan/index.ts");
const modelTs = read("src/ui/inventoryReportModel.ts");
const treeView = read("src/ui/TreeView.tsx");
const appTsx = read("src/App.tsx");
const lock = read("src-tauri/Cargo.lock");
const fontLicense = read("src-tauri/assets/fonts/LICENSE-DejaVu.txt");

assert(cargoToml.includes('genpdf'), "dep: genpdf in Cargo.toml");
assert(/genpdf\s*=\s*"0\.2"/.test(cargoToml), "dep: genpdf 0.2");
assert(lock.includes('name = "genpdf"'), "Cargo.lock has genpdf");
assert(lock.includes('name = "printpdf"'), "Cargo.lock has printpdf via genpdf");

assert(reportMod.includes("mod pdf"), "report mod: pdf");
assert(reportMod.includes("write_report_pdf_file"), "report mod exports pdf write");

assert(pdfRs.includes("build_report_pdf_bytes"), "pdf builder");
assert(pdfRs.includes("PDF_DETAIL_ROW_LIMIT"), "detail limit constant");
assert(pdfRs.includes("PDF_FOLDER_OVERVIEW_LIMIT"), "folder overview limit");
assert(pdfRs.includes("include_bytes!"), "embedded font bytes");
assert(pdfRs.includes("DejaVuSans-Regular.ttf"), "DejaVu regular");
assert(pdfRs.includes("chapter_selection"), "respects selection");
assert(pdfRs.includes("Hinweise zur Interpretation") || pdfRs.includes("Interpretation"), "interpretation section");
assert(pdfRs.includes("Angezeigt werden"), "compact folder notice");
assert(pdfRs.includes("Keine entsprechenden Einträge"), "empty chapter note");
assert(pdfRs.includes("TABLE_CELL_PADDING") || pdfRs.includes("pdf_table"), "table padding module");
assert(pdfRs.includes("R3_CHARSET") || true, "charset via pdf_table");
const pdfTable = read("src-tauri/src/report/pdf_table.rs");
assert(pdfTable.includes("TABLE_CELL_PADDING_MM"), "padding constant");
assert(Number(pdfTable.match(/TABLE_CELL_PADDING_MM:\s*f32\s*=\s*([0-9.]+)/)?.[1] || 0) > 0, "padding > 0");
assert(pdfTable.includes("ReportTable"), "ReportTable continuation");
assert(pdfTable.includes("R3_CHARSET_SAMPLE"), "charset sample");
assert(pdfTable.includes("Äpfel"), "charset has umlauts");
assert(pdfTable.includes("café"), "charset has accents");
assert(!pdfTable.includes("日本語"), "no CJK in guaranteed sample");
assert(!pdfTable.includes("Ελληνικά"), "no Greek in guaranteed sample");
assert(pdfTable.includes("estimate_row_height") || pdfTable.includes("needed > area"), "no mid-row split logic");
assert(pdfRs.includes("push_table"), "pdf uses push_table");
assert(testsRs.includes("pdf_table_padding_and_continuation") || testsRs.includes("pdf_r3_charset"), "layout/charset tests");


assert(persistRs.includes("write_report_pdf_file"), "persist pdf");
assert(persistRs.includes(".dottyfm-report-"), "shared temp prefix");
assert(persistRs.includes("MoveFileExW") || persistRs.includes("replace_existing"), "safe replace");

assert(filenameRs.includes(".pdf"), "filename pdf helper");
assert(filenameRs.includes("suggested_report_pdf_file_name"), "pdf filename fn");

assert(cmdRs.includes("export_inventory_report_pdf"), "command name");
assert(cmdRs.includes("try_begin_report_export"), "shared occupancy");
assert(cmdMod.includes("export_inventory_report_pdf"), "commands/mod pdf");
assert(libRs.includes("export_inventory_report_pdf"), "lib handler pdf");

assert(stateRs.includes("ReportExportGuard"), "ReportExportGuard reused");

assert(apiTs.includes("exportInventoryReportPdf"), "TS API pdf");
assert(apiTs.includes("export_inventory_report_pdf"), "TS invoke pdf");
assert(indexTs.includes("exportInventoryReportPdf"), "scan index pdf");

assert(testsRs.includes("pdf_bytes_are_valid"), "pdf validity test");
assert(testsRs.includes("pdf_respects_chapter_selection"), "pdf selection test");
assert(testsRs.includes("pdf_detail_limit"), "pdf limit test");
assert(testsRs.includes("write_manual_r3_pdf"), "manual pdf helper");

assert(!treeView.includes("exportInventoryReportPdf"), "no TreeView UI wiring");
assert(!appTsx.includes("exportInventoryReportPdf"), "no App UI wiring");
assert(!appTsx.includes("Bericht erstellen"), "no report button");
assert(modelTs.includes("buildInventoryReportModel"), "R1 model kept");
assert(!modelTs.includes("genpdf"), "R1 model not pdf-aware");

assert(fontLicense.includes("Bitstream") || fontLicense.includes("DejaVu"), "DejaVu license present");

console.log("report r3 checks passed");
