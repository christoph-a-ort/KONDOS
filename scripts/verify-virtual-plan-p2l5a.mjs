// P2-L.5a: empty plan for a freshly scanned folder, then assign / dry-run / confirm.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");
const assert = (value, label) => { if (!value) throw new Error(label); };
const editor = read("src/ui/virtualPlanEditor.ts");
const panel = read("src/ui/VirtualPlanEditorPanel.tsx");
const preview = read("src/ui/VirtualPlanPreviewView.tsx");
const app = read("src/App.tsx");
const moveRs = read("src-tauri/src/commands/execution_move.rs");
assert(editor.includes("createEmptyVirtualPlan"), "empty plan builder reuses editor module");
assert(editor.includes("addVirtualPlanFolder"), "manual target folder uses existing folder model");
assert(editor.includes("emptyVirtualPlanBlockReason"), "existing drafts are not overwritten");
assert(editor.includes("createVirtualPlanFromProposal"), "proposal path remains");
assert(!editor.includes("invoke("), "editor still has no invoke");
assert(preview.includes("Leere Planung anlegen"), "empty plan is reachable in the planning view");
assert(preview.includes("onStartEmptyPlan"), "planning view can start an empty plan");
assert(panel.includes("Zielordner hinzufügen"), "editor can add a destination folder");
assert(panel.includes("addVirtualPlanFolder"), "editor reuses addVirtualPlanFolder");
assert(app.includes("createEmptyVirtualPlan"), "workbench starts empty plans via existing editor");
assert(app.includes("onRealFileMoveFinished"), "P2-L.5 workbench MOVE follow-up remains");
assert(app.includes("executeMoveFile") === false, "no second MOVE path in the workbench");
assert(moveRs.includes("execute_move_file"), "productive MOVE backend remains");
const { runVirtualPlanEditorCheck } = await import(
  pathToFileURL(join(root, "src/ui/virtualPlanEditorCheck.ts")).href,
);
const { runVirtualPlanExecutionCheck } = await import(
  pathToFileURL(join(root, "src/ui/virtualPlanExecutionCheck.ts")).href,
);
runVirtualPlanEditorCheck();
runVirtualPlanExecutionCheck();
console.log("virtual plan p2l5a checks passed");
