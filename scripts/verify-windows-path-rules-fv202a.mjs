// FV2-02a: shared Windows name/device rules. No real filesystem operations.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");
const assert = (value, label) => { if (!value) throw new Error(label); };

const fixture = JSON.parse(read("testdata/windows-path-rules.json"));
const editor = read("src/ui/virtualPlanEditor.ts");
const dryRun = read("src/ui/virtualPlanDryRun.ts");
const preflight = read("src/ui/virtualPlanPreflight.ts");
const mkdir = read("src-tauri/src/commands/execution_mkdir.rs");
const moveRs = read("src-tauri/src/commands/execution_move.rs");
const rustPreflight = read("src-tauri/src/commands/execution_preflight.rs");
const rulesTs = read("src/ui/windowsPathRules.ts");
const rulesRs = read("src-tauri/src/paths/windows_rules.rs");

assert(rulesTs.includes("isAllowedWindowsComponent") && rulesTs.includes("isAllowedAbsoluteWindowsPath"), "ts helper surface");
assert(rulesRs.includes("is_allowed_windows_component") && rulesRs.includes("is_allowed_absolute_windows_path"), "rust helper surface");
assert(editor.includes("windowsPathRules") && editor.includes("isAllowedWindowsComponent"), "editor uses shared helper");
assert(dryRun.includes("windowsPathRules") && dryRun.includes("invalidName"), "dry-run keeps invalidName and uses shared helper");
assert(preflight.includes("executionPathLooksUnsafe"), "preflight uses shared helper");
assert(mkdir.includes("is_allowed_windows_component") && mkdir.includes("execution_path_looks_unsafe"), "mkdir uses shared helper");
assert(moveRs.includes("is_allowed_windows_component") && moveRs.includes("execution_path_looks_unsafe"), "move uses shared helper");
assert(rustPreflight.includes("execution_path_looks_unsafe"), "rust preflight uses shared helper");
assert(!/CONIN\$|CONOUT\$/.test(rulesTs) && !/CONIN\$|CONOUT\$/.test(rulesRs), "undecided CONIN$/CONOUT$ not added");
assert(!rulesTs.includes("MAX_PATH") && !rulesRs.includes("MAX_PATH"), "path length is out of scope");

const { runWindowsPathRulesCheck } = await import(
  pathToFileURL(join(root, "src/ui/windowsPathRulesCheck.ts")).href,
);
const { runVirtualPlanEditorCheck } = await import(
  pathToFileURL(join(root, "src/ui/virtualPlanEditorCheck.ts")).href,
);
const { runVirtualPlanDryRunCheck } = await import(
  pathToFileURL(join(root, "src/ui/virtualPlanDryRunCheck.ts")).href,
);
const { runVirtualPlanPreflightCheck } = await import(
  pathToFileURL(join(root, "src/ui/virtualPlanPreflightCheck.ts")).href,
);

runWindowsPathRulesCheck(fixture);
runVirtualPlanEditorCheck();
runVirtualPlanDryRunCheck();
runVirtualPlanPreflightCheck();

console.log("windows path rules fv2-02a checks passed");
