// P2-L.6: Explorer-like single-file drag-and-drop reuses prepare_and_move, not plan confirmation.
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
const api = read("src/ui/virtualPlanExecutionApi.ts");
const panel = read("src/ui/VirtualPlanExecutionPanel.tsx");
const preview = read("src/ui/VirtualPlanPreviewView.tsx");
const execution = read("src/ui/virtualPlanExecution.ts");
const moveRs = read("src-tauri/src/commands/execution_move.rs");
const { runTreeWorkbenchMoveCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchMoveCheck.ts")).href,
);
const { runVirtualPlanExecutionCheck, assertWorkbenchMoveFollowUpSourceGuards } = await import(
  pathToFileURL(join(root, "src/ui/virtualPlanExecutionCheck.ts")).href,
);
runTreeWorkbenchMoveCheck();
runVirtualPlanExecutionCheck();
assertWorkbenchMoveFollowUpSourceGuards({ execution, panel, preview, app, api });
assert(tree.includes("onWorkbenchFileMove"), "tree exposes a drop handler");
assert(tree.includes("onPointerDown"), "tree uses pointer drag instead of HTML5 dataTransfer");
assert(tree.includes("drop-target"), "valid folders are highlighted while dragging");
assert(moveHelper.includes("workbenchDropKind"), "drop validity is decided before MOVE");
assert(!app.includes("executeMoveFile"), "DnD does not call the plan MOVE API");
assert(app.includes("executeWorkbenchMoveFile"), "DnD calls the workbench MOVE wrapper");
assert(app.includes("pendingRevealNodeIdRef"), "successful DnD reveals the file at the new location");
assert(!app.includes("explicitConfirm"), "DnD does not open a confirmation mask");
assert(api.includes("execute_workbench_move_file"), "workbench command is invoked");
assert(moveRs.includes("fn execute_workbench_move_file_locked"), "workbench MOVE command exists");
assert(moveRs.includes("win_move::prepare_and_move"), "productive MOVE engine is reused");
assert((moveRs.match(/require_approved_test_root/g) ?? []).length === 2, "test-root approval stays on the plan MOVE path only");
assert(panel.includes("executeMoveFile("), "plan confirmation MOVE remains in the panel");
console.log("virtual plan p2l6 checks passed");
