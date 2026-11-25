// P2-L.11d: create one suggested folder and MOVE the file with the workbench engine.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");
const assert = (value, label) => { if (!value) throw new Error(label); };
const apply = read("src/ui/treeWorkbenchFolderSuggestApply.ts");
const dialog = read("src/ui/FolderSuggestDialog.tsx");
const app = read("src/App.tsx");
const tree = read("src/ui/TreeView.tsx");
const api = read("src/ui/virtualPlanExecutionApi.ts");
const mkdirRs = read("src-tauri/src/commands/execution_mkdir.rs");
const moveRs = read("src-tauri/src/commands/execution_move.rs");
assert(dialog.includes("executePlan.plan.label") && dialog.includes("handleApply") && dialog.includes("applyBusy"), "the dialog uses the execute-plan label and blocks extra clicks");
assert(dialog.includes("Zielpfad:") && dialog.includes("onApply"), "the target path is visible and the click is the consent");
assert(!dialog.includes("executeWorkbenchMoveFile") && !dialog.includes("executeWorkbenchCreateFolder"), "the dialog does not call mkdir or MOVE itself");
assert(apply.includes("FOLDER_SUGGEST_CREATE_AND_MOVE") && apply.includes("FOLDER_SUGGEST_MOVE"), "move and create-and-move actions exist");
assert(apply.includes("folderSuggestNeedsTargetChoice") && apply.includes("FOLDER_SUGGEST_PICK_TARGET"), "multiple targets require an explicit choice");
assert(apply.includes("executeWorkbenchMoveFile") === false, "the planner does not call MOVE itself");
assert(app.includes("executeWorkbenchCreateFolder") && app.includes("executeWorkbenchMoveFile"), "App uses workbench mkdir then the existing MOVE engine");
assert(app.includes("handleStartScan") && app.includes("handleWorkbenchFolderSuggestApply"), "a successful apply refreshes the tree");
assert(tree.includes("onApply={onWorkbenchFolderSuggestApply}"), "TreeView forwards the apply handler");
assert(api.includes("execute_workbench_create_folder") && api.includes("execute_workbench_move_file"), "workbench mkdir and MOVE APIs are used");
assert(mkdirRs.includes("fn execute_workbench_create_folder") && mkdirRs.includes("create_single_folder"), "workbench mkdir reuses the single-folder backend");
assert(mkdirRs.includes("FILE_CREATE") && mkdirRs.includes("split_at(components.len() - 1)"), "only the last missing folder is created");
assert(moveRs.includes("fn execute_workbench_move_file"), "the productive workbench MOVE engine remains");
assert(!apply.includes("requestLocalAiNameFields") && !dialog.includes("requestLocalAiNameFields"), "no extra KI");
assert(!apply.includes("remove_dir") && !app.includes("remove_dir"), "failed MOVE does not delete the new folder");
const { runTreeWorkbenchFolderSuggestCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchFolderSuggestCheck.ts")).href,
);
runTreeWorkbenchFolderSuggestCheck();
const { runTreeWorkbenchMoveCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchMoveCheck.ts")).href,
);
runTreeWorkbenchMoveCheck();
console.log("virtual plan p2l11d checks passed");
