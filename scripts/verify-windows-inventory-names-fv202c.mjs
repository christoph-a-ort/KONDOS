// FV2-02c: existing Windows inventory-name marking. No real filesystem operations.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");
const assert = (value, label) => { if (!value) throw new Error(label); };

const helper = read("src/ui/windowsInventoryNames.ts");
const check = read("src/ui/windowsInventoryNamesCheck.ts");
const treeRows = read("src/ui/treeRows.ts");
const treeView = read("src/ui/TreeView.tsx");
const editor = read("src/ui/virtualPlanEditor.ts");
const editorPanel = read("src/ui/VirtualPlanEditorPanel.tsx");
const dryRun = read("src/ui/virtualPlanDryRun.ts");
const dryRunPanel = read("src/ui/VirtualPlanDryRunPanel.tsx");
const preview = read("src/ui/VirtualPlanPreviewView.tsx");
const plan = read("src/ui/virtualPlan.ts");
const journal = read("src/ui/virtualPlanJournal.ts");
const walker = read("src-tauri/src/scan/walker.rs");
const mkdir = read("src-tauri/src/commands/execution_mkdir.rs");
const moveRs = read("src-tauri/src/commands/execution_move.rs");
const rustPreflight = read("src-tauri/src/commands/execution_preflight.rs");

assert(helper.includes("isAllowedWindowsComponent"), "inventory helper reuses FV2-02a component rules");
assert(helper.includes("hasProblematicExistingName"), "optional inventory issue is independently typed");
assert(!helper.includes("openCase") && !helper.includes("item.status"), "inventory helper does not reinterpret plan status");
assert(!check.includes("assert(true"), "02c check has no always-true assertion");
assert(!check.includes("node:fs"), "02c check stays in-memory");
assert(treeRows.includes("existingWindowsNameIssueForNode") && treeRows.includes("hasProblematicExistingWindowsName"), "tree rows derive the inventory mark");
assert(treeView.includes("existing-name-badge") && treeView.includes("EXISTING_WINDOWS_NAME_MARK"), "tree shows a text mark, not color only");
assert(editor.includes("existingWindowsNameIssue") && editorPanel.includes("EXISTING_WINDOWS_NAME_MARK"), "virtual plan projection and editor show the mark");
assert(dryRun.includes("existingWindowsNameIssue(source)") && dryRun.includes("Problematischer bestehender Quellname"), "dry-run checks existing source names");
assert(dryRunPanel.includes("checkStatus === \"blocked\"") && preview.includes("hasProblematicExistingWindowsName"), "dry-run and plan preview keep blocked objects visible");
assert(journal.includes("report.status !== \"restricted\""), "journal still requires a restricted dry-run");
assert(!plan.includes("hasProblematicExistingName") && !plan.includes("existingWindowsNameIssue"), "persisted plan contract was not extended");
assert(!walker.includes("is_allowed_windows_component") && !walker.includes("existingWindowsName"), "scanner was not rewritten for inventory marks");
assert(!mkdir.includes("existingWindowsName") && !moveRs.includes("existingWindowsName") && !rustPreflight.includes("existingWindowsName"), "rust execute path was not widened");

const { runWindowsInventoryNamesCheck } = await import(
  pathToFileURL(join(root, "src/ui/windowsInventoryNamesCheck.ts")).href,
);
runWindowsInventoryNamesCheck();
console.log("windows inventory names fv2-02c checks passed");