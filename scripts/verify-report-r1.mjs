// R1: format-independent inventory report model. Aggregation only — no PDF/XLSX/UI.
// Pattern matches verify-p1m1/2/3: source contracts + TS check wired via workbench.

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

const modelSrc = read("src/ui/inventoryReportModel.ts");
const checkSrc = read("src/ui/inventoryReportModelCheck.ts");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const treeViewSrc = read("src/ui/TreeView.tsx");
const appSrc = read("src/App.tsx");

assert(modelSrc.includes("export function buildInventoryReportModel"), "core: builder exported");
assert(modelSrc.includes("export interface InventoryReportModel"), "core: model type");
assert(modelSrc.includes("INVENTORY_REPORT_SCHEMA_VERSION = 1"), "core: schema version");
assert(modelSrc.includes('"overview"'), "core: overview chapter");
assert(modelSrc.includes('"fileTypes"'), "core: fileTypes");
assert(modelSrc.includes('"folders"'), "core: folders");
assert(modelSrc.includes('"emptyFolders"'), "core: emptyFolders");
assert(modelSrc.includes('"singleFileFolders"'), "core: singleFileFolders");
assert(modelSrc.includes('"unreadable"'), "core: unreadable");
assert(modelSrc.includes('"repeatedFolderNames"'), "core: repeatedFolderNames");
assert(modelSrc.includes('"repeatedFileNames"'), "core: repeatedFileNames");
assert(modelSrc.includes('"yearStructures"'), "core: yearStructures");
assert(modelSrc.includes('"fileNamePatterns"'), "core: fileNamePatterns");
assert(modelSrc.includes('"sameFileStems"'), "core: sameFileStems");
assert(modelSrc.includes('"exactFileNameStructures"'), "core: exactFileNameStructures");
assert(modelSrc.includes('"extensionDistributions"'), "core: extensionDistributions");
assert(modelSrc.includes('"interpretation"'), "core: interpretation");
assert(modelSrc.includes("createDefaultInventoryReportChapterSelection"), "core: default selection");
assert(modelSrc.includes("displayInventoryPath"), "core: reuses path helper");
assert(modelSrc.includes("chapterSelection"), "core: selection in model");
assert(modelSrc.includes("PATTERN_OBSERVATION_HINT"), "core: neutral pattern hint");
assert(modelSrc.includes("analyzeInventory") || modelSrc.includes("InventoryAnalysis"), "core: uses InventoryAnalysis");
assert(modelSrc.includes("InventoryStructureContext") || modelSrc.includes("structure"), "core: structure context");
assert(modelSrc.includes("InventoryFileNameSyntaxContext") || modelSrc.includes("fileNameSyntax"), "core: file-name syntax");
assert(modelSrc.includes("InventoryExactFolderFileStructureContext") || modelSrc.includes("exactFolderStructures"), "core: exact structures");
assert(!modelSrc.includes("start_scan"), "no scan IPC");
assert(!modelSrc.includes("invoke("), "no tauri invoke");
assert(!modelSrc.includes("localStorage"), "no localStorage");
assert(!modelSrc.includes("writeFile") && !modelSrc.includes("createWriteStream"), "no file writers");
assert(!modelSrc.includes("jspdf") && !modelSrc.includes("exceljs") && !modelSrc.includes("pdfkit"), "no report libs");
assert(!modelSrc.includes("useState") && !modelSrc.includes("useEffect"), "no react");
assert(!modelSrc.includes("analyzeRepeatedFolderNameContext"), "no P1-K wiring");
assert(!modelSrc.includes("analyzeRepeatedFileNameContext"), "no P1-L H2 wiring");
assert(!modelSrc.includes("startPrepareContent") && !modelSrc.includes("content://"), "no content cache");

assert(checkSrc.includes("runInventoryReportModelCheck"), "check: exported");
assert(checkSrc.includes("assertJsonSerializable"), "check: json");
assert(checkSrc.includes("assertNoExoticValues"), "check: no Map/Set");
assert(checkSrc.includes("inputs: analysis not mutated"), "check: no mutation");
assert(checkSrc.includes("disabled: data still present"), "check: disabled chapter semantics");
assert(checkSrc.includes("meta: absolute root"), "check: root in meta");
assert(checkSrc.includes("folders: relative paths"), "check: relative detail paths");
assert(checkSrc.includes('rootPath === "X:/bestand"'), "check: synthetic fixture root");
assert(checkSrc.includes("X:/bestand"), "check: uses synthetic X: fixture");
assert(workbenchSrc.includes("runInventoryReportModelCheck"), "wired via workbench");
assert(!treeViewSrc.includes("buildInventoryReportModel"), "TreeView not owning report model yet");
assert(!appSrc.includes("buildInventoryReportModel"), "App not owning report model yet");

console.log("report r1 checks passed");
