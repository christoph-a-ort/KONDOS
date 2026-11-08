// P2-L.5: single-file MOVE from the workbench reuses execute_move_file and refreshes the tree.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");
const execution = read("src/ui/virtualPlanExecution.ts");
const panel = read("src/ui/VirtualPlanExecutionPanel.tsx");
const preview = read("src/ui/VirtualPlanPreviewView.tsx");
const app = read("src/App.tsx");
const api = read("src/ui/virtualPlanExecutionApi.ts");
const moveRs = read("src-tauri/src/commands/execution_move.rs");
const { runVirtualPlanExecutionCheck, assertWorkbenchMoveFollowUpSourceGuards } = await import(
  pathToFileURL(join(root, "src/ui/virtualPlanExecutionCheck.ts")).href,
);
runVirtualPlanExecutionCheck();
assertWorkbenchMoveFollowUpSourceGuards({ execution, panel, preview, app, api });
if (!moveRs.includes("execute_move_file")) {
  throw new Error("productive MOVE command must remain unchanged");
}
if ((panel.match(/invoke\(/g) ?? []).length !== 0) {
  throw new Error("execution panel must not add a second invoke path");
}
console.log("virtual plan p2l5 checks passed");
