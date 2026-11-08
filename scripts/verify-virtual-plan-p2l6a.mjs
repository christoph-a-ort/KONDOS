// P2-L.6a: pointer-based workbench MOVE plus simplified main navigation.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");
const assert = (value, label) => { if (!value) throw new Error(label); };
const app = read("src/App.tsx");
const tree = read("src/ui/TreeView.tsx");
const moveHelper = read("src/ui/treeWorkbenchMove.ts");
const helpers = read("src/ui/structureInsightsViewHelpers.ts");
const api = read("src/ui/virtualPlanExecutionApi.ts");
const panel = read("src/ui/VirtualPlanExecutionPanel.tsx");
const preview = read("src/ui/VirtualPlanPreviewView.tsx");
const execution = read("src/ui/virtualPlanExecution.ts");
const moveRs = read("src-tauri/src/commands/execution_move.rs");
const conf = read("src-tauri/tauri.conf.json");
const { runTreeWorkbenchMoveCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchMoveCheck.ts")).href,
);
const { runStructureInsightsViewCheck } = await import(
  pathToFileURL(join(root, "src/ui/structureInsightsViewCheck.ts")).href,
);
const { runVirtualPlanExecutionCheck, assertWorkbenchMoveFollowUpSourceGuards } = await import(
  pathToFileURL(join(root, "src/ui/virtualPlanExecutionCheck.ts")).href,
);
runTreeWorkbenchMoveCheck();
runStructureInsightsViewCheck();
runVirtualPlanExecutionCheck();
assertWorkbenchMoveFollowUpSourceGuards({ execution, panel, preview, app, api });
assert(tree.includes("onPointerDown"), "tree starts a pointer drag on files");
assert(tree.includes("handleFilePointerDown"), "pointer-down is wired to the row");
assert(tree.includes("workbenchPointerDragShouldStart"), "drag starts only after movement");
assert(tree.includes("WORKBENCH_TREE_ROW_ID_ATTR"), "drop target is resolved from the row under the pointer");
assert(tree.includes("workbenchMoveRequest"), "valid drop still builds the MOVE request");
assert(!tree.includes("draggable={"), "HTML5 draggable is not used on tree rows");
assert(!tree.includes("onDragStart"), "HTML5 dragstart is not used");
assert(!tree.includes("dataTransfer"), "HTML5 dataTransfer is not used for workbench MOVE");
assert(moveHelper.includes("workbenchDropKind"), "invalid targets stay rejected");
assert(app.includes("executeWorkbenchMoveFile"), "successful drop still calls the productive MOVE wrapper");
assert(app.includes("pendingRevealNodeIdRef"), "successful MOVE still refreshes and reveals");
assert(app.includes("FILES_NAV_LABEL") && app.includes("AUTOSORT_NAV_LABEL"), "main navigation has two sections");
assert(app.includes("INSIGHTS_NAV_LABEL") && app.includes("PLANNING_NAV_LABEL"), "insights and planning remain reachable");
assert(helpers.includes('FILES_NAV_LABEL = "Dateien & Ordner"'), "files label");
assert(helpers.includes('AUTOSORT_NAV_LABEL = "Automatische Sortierung"'), "autosort label");
assert(!conf.includes("dragDropEnabled"), "OS folder-drop onto the window stays on the native Tauri path");
assert(moveRs.includes("win_move::prepare_and_move"), "productive MOVE engine is reused");
assert(panel.includes("executeMoveFile("), "plan confirmation MOVE remains");
console.log("virtual plan p2l6a checks passed");
