// FV2-02b: conservative Windows target-path lengths. No real filesystem operations.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");
const assert = (value, label) => { if (!value) throw new Error(label); };

const fixture = JSON.parse(read("testdata/windows-path-lengths.json"));
const lengthsTs = read("src/ui/windowsPathLengths.ts");
const lengthsCheck = read("src/ui/windowsPathLengthsCheck.ts");
const lengthsRs = read("src-tauri/src/paths/windows_lengths.rs");
const editor = read("src/ui/virtualPlanEditor.ts");
const dryRun = read("src/ui/virtualPlanDryRun.ts");
const preflight = read("src/ui/virtualPlanPreflight.ts");
const mkdir = read("src-tauri/src/commands/execution_mkdir.rs");
const moveRs = read("src-tauri/src/commands/execution_move.rs");
const rustPreflight = read("src-tauri/src/commands/execution_preflight.rs");
const rulesTs = read("src/ui/windowsPathRules.ts");
const rulesRs = read("src-tauri/src/paths/windows_rules.rs");

assert(fixture.limits.maxAbsoluteUtf16 === 259 && fixture.limits.nulIncludedMax === 260, "shared 259/260 bound");
assert(fixture.recipes.some((row) => row.id === "A-total-258"), "case A present");
assert(fixture.recipes.some((row) => row.id === "O-new-target-too-long"), "case O present");
assert(fixture.literals.some((row) => row.id === "N-long-existing-source"), "case N present");
assert(fixture.literals.some((row) => row.id === "G-emoji-vs-visible" && row.expectedUtf16 === 5), "emoji G expects 5");
assert(fixture.literals.some((row) => row.id === "R-unc-length-ok-not-execute-grant" && row.grantsRealExecution === false), "case R present");
assert(!lengthsTs.includes("assert(true"), "N1: fixture helper has no always-true assertion");
assert(lengthsTs.includes("canConfirm") && lengthsTs.includes("grantsRealExecution"), "N1: length verdict is checked for grant fields");
assert(lengthsCheck.includes("canSubmitRealFileMove") && lengthsCheck.includes("isReadyForRealExecution"), "N2: R uses structured grant functions");
assert(!lengthsCheck.includes("UNC-Ausführung") && !lengthsCheck.includes("unc ausgeführt"), "N2: R no longer uses tautological reason text");
assert(fixture.unknownLimit.some((row) => row.id === "P-unknown-volume-limit"), "case P present");

assert(lengthsTs.includes("evaluateNewTargetPathLength") && lengthsTs.includes("newComponentsRelativeToExisting"), "ts length helper surface");
assert(lengthsRs.includes("evaluate_new_target_path_length") && lengthsRs.includes("GetVolumeInformationW"), "rust length helper uses existing kernel32 FFI");
assert(lengthsTs.includes("requireKnownVolumeLimit") && lengthsRs.includes("require_known_volume_limit"), "unknown volume stays fail-closed");
assert(!editor.includes("windowsPathLengths") && !editor.includes("evaluateNewTargetPathLength"), "editor stays name-only");
assert(dryRun.includes("windowsPathLengths") && dryRun.includes("evaluateNewTargetPathLength"), "dry-run uses length helper");
assert(preflight.includes("withTargetLengthGate") && preflight.includes("maximumComponentLength"), "preflight gates total length and volume limit");
assert(mkdir.includes("target_length_blocks_real_operation") && mkdir.indexOf("target_length_blocks_real_operation") < mkdir.indexOf("NtCreateFile"), "mkdir checks length before NtCreateFile");
assert(moveRs.includes("target_length_blocks_real_operation") && moveRs.indexOf("target_length_blocks_real_operation") < moveRs.indexOf("NtSetInformationFile"), "move checks length before NtSetInformationFile");
assert(rustPreflight.includes("maximum_component_length_for_path"), "rust inspect reports the measured volume limit");
assert(!lengthsTs.includes("\\\\?\\"), "ts helper has no long-path prefix bypass");
assert(lengthsRs.includes("is_windows_device_path"), "device and long-path roots are excluded from volume query");
assert(!lengthsRs.includes("r\"\\\\?\\\" +") && !lengthsRs.includes("format!(\"\\\\?\\"), "rust length helper does not prepend a long-path prefix");
assert(rulesTs.includes("isAllowedWindowsComponent") && rulesRs.includes("is_allowed_windows_component"), "FV2-02a helpers remain");

const { runWindowsPathLengthsCheck } = await import(
  pathToFileURL(join(root, "src/ui/windowsPathLengthsCheck.ts")).href,
);
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

runWindowsPathLengthsCheck(fixture);
runWindowsPathRulesCheck(JSON.parse(read("testdata/windows-path-rules.json")));
runVirtualPlanEditorCheck();
runVirtualPlanDryRunCheck();
runVirtualPlanPreflightCheck();

console.log("windows path lengths fv2-02b checks passed");
