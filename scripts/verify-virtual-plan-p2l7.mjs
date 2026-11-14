// P2-L.7: inline file rename reuses execute_workbench_move_file, not the plan path.
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
const renameHelper = read("src/ui/treeWorkbenchRename.ts");
const moveHelper = read("src/ui/treeWorkbenchMove.ts");
const api = read("src/ui/virtualPlanExecutionApi.ts");
const moveRs = read("src-tauri/src/commands/execution_move.rs");
const { runTreeWorkbenchRenameCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchRenameCheck.ts")).href,
);
const { runTreeWorkbenchMoveCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchMoveCheck.ts")).href,
);
runTreeWorkbenchRenameCheck();
runTreeWorkbenchMoveCheck();
assert(tree.includes("beginFileRename"), "shortcut starts inline rename");
assert(tree.includes("isWorkbenchRenameShortcut"), "Ctrl+Shift+U is wired in the tree");
assert(!tree.includes('event.key === "F2"'), "F2 is not wired in the tree");
assert(tree.includes("tree-rename-input"), "filename is edited in the row");
assert(tree.includes("onRenameCommit"), "Enter commits the rename");
assert(tree.includes("onRenameCancel"), "Esc cancels the rename");
assert(tree.includes("renameId !== null"), "active rename blocks pointer drag");
assert(tree.includes("closest(\"button, input, textarea\")"), "rename input does not start a drag");
assert(renameHelper.includes("fileNameEditSelection"), "stem without extension is selected");
assert(renameHelper.includes("isUnchangedWorkbenchRename"), "unchanged names skip the file operation");
assert(renameHelper.includes("isAllowedWindowsComponent"), "invalid names are rejected before MOVE");
assert(renameHelper.includes("canRenameWorkbenchFile"), "folders are not renamed");
assert(moveHelper.includes("workbenchMoveRequest"), "drag-and-drop helper remains");
assert(app.includes("executeWorkbenchMoveFile"), "rename reuses the workbench MOVE command");
assert(app.includes("handleWorkbenchFileRename"), "workbench has a rename handler");
assert(app.includes("workbenchRenameEventFromResult"), "rename success refreshes the tree");
assert(!app.includes("executeMoveFile"), "plan MOVE API is not used for inline rename");
assert(api.includes("execute_workbench_move_file"), "one productive workbench command");
assert(moveRs.includes("win_move::prepare_and_move"), "productive engine is reused");
assert(moveRs.includes("fn workbench_renames_file_in_same_folder"), "same-folder rename is tested");
console.log("virtual plan p2l7 checks passed");
