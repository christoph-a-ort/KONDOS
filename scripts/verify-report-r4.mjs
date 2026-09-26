// R4: IST-Bericht UI workflow — dialog, formats, chapters, targets, overwrite, outcomes.
// Reuses R1 model + R2/R3 exporters. No new analysis / rescan / R5.

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

const workflow = read("src/ui/inventoryReportWorkflow.ts");
const workflowCheck = read("src/ui/inventoryReportWorkflowCheck.ts");
const dialog = read("src/ui/InventoryReportDialog.tsx");
const overview = read("src/ui/InventoryOverviewPanel.tsx");
const treeView = read("src/ui/TreeView.tsx");
const appTsx = read("src/App.tsx");
const appCss = read("src/App.css");
const apiTs = read("src/scan/api.ts");
const indexTs = read("src/scan/index.ts");
const modelTs = read("src/ui/inventoryReportModel.ts");
const workbench = read("src/ui/treeWorkbenchCheck.ts");
const explorerRs = read("src-tauri/src/commands/explorer.rs");
const cmdMod = read("src-tauri/src/commands/mod.rs");
const libRs = read("src-tauri/src/lib.rs");
const reportCmd = read("src-tauri/src/commands/report.rs");
const stateRs = read("src-tauri/src/state.rs");
const persistRs = read("src-tauri/src/report/persist.rs");

assert(overview.includes("Bericht erstellen…"), "button label on IST overview");
assert(overview.includes("reportAction"), "reportAction prop");
assert(overview.includes("inventory-overview-summary"), "button in overview header");

assert(treeView.includes("InventoryReportDialog"), "TreeView hosts dialog");
assert(treeView.includes("reportAction"), "TreeView wires report action");
assert(treeView.includes("setReportDialogOpen"), "TreeView opens report dialog");
assert(treeView.includes("onExportBusyChange"), "export busy wiring");
assert(treeView.includes("occupancyIdle"), "busy/occupancy gate");
assert(!treeView.includes("start_scan"), "no rescan invoke from TreeView report path");

assert(appTsx.includes("onExportBusyChange={setExportBusy}"), "App passes export busy setter");

assert(dialog.includes("Ausgabeformat"), "dialog formats section");
assert(dialog.includes("Excel-Arbeitsdatei (.xlsx)"), "xlsx option");
assert(dialog.includes("PDF-Bericht (.pdf)"), "pdf option");
assert(dialog.includes("Inhalte des Berichts"), "chapters section");
assert(dialog.includes("Alle auswählen"), "select all");
assert(dialog.includes("Keine auswählen"), "select none");
assert(dialog.includes("Dateiname"), "basename field");
assert(dialog.includes("Bericht erstellen"), "create button");
assert(dialog.includes("Abbrechen"), "cancel");
assert(dialog.includes("Bericht wird erstellt…"), "busy label");
assert(dialog.includes("buildInventoryReportModel"), "uses R1 builder");
assert(dialog.includes("exportInventoryReportXlsx"), "uses R2 exporter");
assert(dialog.includes("exportInventoryReportPdf"), "uses R3 exporter");
assert(dialog.includes("pathExists"), "existence check");
assert(dialog.includes("Datei bereits vorhanden"), "overwrite title");
assert(dialog.includes("Überschreiben"), "overwrite action");
assert(dialog.includes("Ordner öffnen"), "open folder action");
assert(dialog.includes("openInExplorer"), "reuses explorer open");
assert(dialog.includes("pickDirectory"), "folder pick for both formats");
assert(dialog.includes("pickReportSavePath"), "save dialog for single format");
assert(dialog.includes("Zielordner für Bericht wählen"), "folder dialog title");
assert(!dialog.includes("startScan"), "no rescan in dialog");
assert(!dialog.includes("window.open"), "no auto-open of files");

assert(workflow.includes("suggestedReportBasename"), "basename helper");
assert(workflow.includes("DottyFM_IST-Bericht_"), "basename schema");
assert(workflow.includes("validateReportBasename"), "basename validation");
assert(workflow.includes("INVENTORY_REPORT_CHAPTER_LABELS"), "labels from ids");
assert(workflow.includes("buildReportTargetPlan"), "target plan");
assert(workflow.includes('format: "xlsx"'), "xlsx before pdf order in plan");
assert(workflow.includes("Bericht nur teilweise erstellt"), "partial title");
assert(workflow.includes("Bericht wurde erstellt"), "success title");

assert(workflowCheck.includes("runInventoryReportWorkflowCheck"), "workflow check export");
assert(workbench.includes("runInventoryReportWorkflowCheck"), "workbench runs r4 check");

assert(apiTs.includes("pathExists"), "TS pathExists");
assert(apiTs.includes("path_exists"), "invoke path_exists");
assert(apiTs.includes("pickReportSavePath"), "pickReportSavePath");
assert(apiTs.includes("title?: string"), "pickDirectory title option");
assert(indexTs.includes("pathExists"), "index re-exports pathExists");
assert(indexTs.includes("pickReportSavePath"), "index re-exports pickReportSavePath");

assert(explorerRs.includes("path_exists"), "rust path_exists command");
assert(explorerRs.includes("path_exists_check"), "path_exists helper");
assert(explorerRs.includes("path_exists_check_finds_file"), "path_exists test");
assert(cmdMod.includes("path_exists"), "commands mod exports path_exists");
assert(libRs.includes("path_exists"), "lib registers path_exists");

assert(reportCmd.includes("try_begin_report_export"), "ReportExportGuard still used");
assert(stateRs.includes("ReportExportGuard"), "ReportExportGuard present");
assert(persistRs.includes(".dottyfm-report-"), "Safe Write still used");

assert(modelTs.includes("buildInventoryReportModel"), "R1 model kept");
assert(modelTs.includes("INVENTORY_REPORT_CHAPTER_IDS"), "shared chapter ids");
assert(!modelTs.includes("Bericht erstellen"), "R1 model not UI");

assert(appCss.includes("report-dialog"), "dialog styles");
assert(appCss.includes("inventory-overview-report-btn"), "button styles");

assert(INVENTORY_REPORT_CHAPTER_COUNT(workflow) === 14, "14 chapter labels in workflow");

function INVENTORY_REPORT_CHAPTER_COUNT(src) {
  const block = src.match(/INVENTORY_REPORT_CHAPTER_LABELS[\s\S]*?};/);
  if (!block) return 0;
  return (block[0].match(/:\s*"/g) || []).length;
}

console.log("report r4 checks passed");
