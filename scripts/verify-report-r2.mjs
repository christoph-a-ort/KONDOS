// R2: IST-Bericht XLSX writer + Tauri command + TS API. No UI button/dialog.

import { readFileSync, existsSync } from "node:fs";
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
const modelRs = read("src-tauri/src/report/model.rs");
const xlsxRs = read("src-tauri/src/report/xlsx.rs");
const persistRs = read("src-tauri/src/report/persist.rs");
const filenameRs = read("src-tauri/src/report/filename.rs");
const reportMod = read("src-tauri/src/report/mod.rs");
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

assert(cargoToml.includes('rust_xlsxwriter'), "dep: rust_xlsxwriter in Cargo.toml");
assert(/rust_xlsxwriter\s*=\s*"0\.99"/.test(cargoToml), "dep: rust_xlsxwriter ~0.99");

assert(reportMod.includes("mod model"), "report mod: model");
assert(reportMod.includes("mod xlsx"), "report mod: xlsx");
assert(reportMod.includes("mod persist"), "report mod: persist");
assert(reportMod.includes("mod filename"), "report mod: filename");

assert(modelRs.includes("InventoryReportModel"), "rust model");
assert(modelRs.includes('rename_all = "camelCase"'), "rust model camelCase");
assert(modelRs.includes("chapter_selection"), "rust model chapter_selection");
assert(modelRs.includes("schema_version"), "rust model schema_version");

assert(xlsxRs.includes("Übersicht"), "sheet Übersicht");
assert(xlsxRs.includes("Dateitypen"), "sheet Dateitypen");
assert(xlsxRs.includes("Ordner"), "sheet Ordner");
assert(xlsxRs.includes("Leere Ordner"), "sheet Leere Ordner");
assert(xlsxRs.includes("Ein-Datei-Ordner"), "sheet Ein-Datei-Ordner");
assert(xlsxRs.includes("Nicht prüfbar"), "sheet Nicht prüfbar");
assert(xlsxRs.includes("Wiederkehrende Ordnernamen"), "sheet Wiederkehrende Ordnernamen");
assert(xlsxRs.includes("Wiederkehrende Dateinamen"), "sheet Wiederkehrende Dateinamen");
assert(xlsxRs.includes("Jahresstrukturen"), "sheet Jahresstrukturen");
assert(xlsxRs.includes("Muster Dateinamen"), "sheet Muster Dateinamen");
assert(xlsxRs.includes("Gleiche Dateistämme"), "sheet Gleiche Dateistämme");
assert(xlsxRs.includes("Exakte Dateinamensstrukturen"), "sheet Exakte Dateinamensstrukturen");
assert(xlsxRs.includes("Endungsverteilungen"), "sheet Endungsverteilungen");
assert(xlsxRs.includes("Prüfen"), "work col Prüfen");
assert(xlsxRs.includes("Erledigt"), "work col Erledigt");
assert(xlsxRs.includes("Notiz"), "work col Notiz");
assert(xlsxRs.includes("allow_list_strings"), "Ja/Nein validation");
assert(xlsxRs.includes("ignore_blank"), "blank allowed");
assert(xlsxRs.includes("autofilter"), "autofilter");
assert(xlsxRs.includes("set_freeze_panes"), "freeze panes");
assert(xlsxRs.includes("chapter_selection"), "respects selection");
assert(!xlsxRs.includes('set_name("Interpretation")') && !xlsxRs.includes('set_name("interpretation")'), "no interpretation sheet");

assert(persistRs.includes(".dottyfm-report-"), "temp prefix .dottyfm-report-");
assert(persistRs.includes("MoveFileExW") || persistRs.includes("replace_existing"), "safe replace");

assert(filenameRs.includes("DottyFM_IST-Bericht_"), "filename pattern");
assert(filenameRs.includes(".xlsx"), "filename xlsx");

assert(cmdRs.includes("export_inventory_report_xlsx"), "command name");
assert(cmdRs.includes("InventoryReportModel"), "command takes model");
assert(cmdRs.includes("try_begin_report_export"), "occupancy via report export");
assert(cmdMod.includes("export_inventory_report_xlsx"), "commands/mod export");
assert(libRs.includes("export_inventory_report_xlsx"), "lib handler");
assert(libRs.includes("mod report"), "lib mod report");

assert(stateRs.includes("try_begin_report_export"), "state report export");
assert(stateRs.includes("ReportExportGuard"), "ReportExportGuard");

assert(apiTs.includes("exportInventoryReportXlsx"), "TS API");
assert(apiTs.includes("export_inventory_report_xlsx"), "TS invoke name");
assert(indexTs.includes("exportInventoryReportXlsx"), "scan index re-export");

assert(testsRs.includes("full_selection_produces_exactly_13_sheets"), "test 13 sheets");
assert(testsRs.includes("disabled_chapter_omits_sheet"), "test selection");
assert(testsRs.includes("work_columns_and_validation_present"), "test validation");
assert(testsRs.includes("safe_write_and_invalid_target"), "test safe write");

assert(!treeView.includes("exportInventoryReportXlsx"), "no TreeView UI wiring");
assert(!appTsx.includes("exportInventoryReportXlsx"), "no App UI wiring");
assert(!appTsx.includes("Bericht erstellen"), "no report button");
assert(modelTs.includes("buildInventoryReportModel"), "R1 model kept");
assert(!modelTs.includes("rust_xlsxwriter"), "R1 model not xlsx-aware");

const lock = read("src-tauri/Cargo.lock");
assert(lock.includes('name = "rust_xlsxwriter"'), "Cargo.lock has rust_xlsxwriter");
assert(lock.includes('version = "0.99.'), "Cargo.lock rust_xlsxwriter 0.99.x");

console.log("report r2 checks passed");
