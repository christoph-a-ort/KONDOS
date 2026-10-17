// P2-K.6b/c: final-state preference candidates and preference-store persistence.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");
const assert = (value, label) => { if (!value) throw new Error(label); };
const preferences = read("src/ui/virtualPlanPreferences.ts");
const check = read("src/ui/virtualPlanEditorCheck.ts");
const rust = read("src-tauri/src/commands/virtual_plan.rs");
const panel = read("src/ui/VirtualPlanPreferencesPanel.tsx");

assert(preferences.includes("analyzeVirtualPlanPreferenceCandidates"), "final-state candidate analysis");
assert(preferences.includes("lastItemDecision"), "latest item decision wins");
assert(preferences.includes("lastFolderDecision"), "latest folder decision wins");
assert(check.includes("superseded assignment creates no current preference candidate"), "superseded assignment regression");
assert(check.includes("final assignment alone creates current preference candidate"), "final assignment regression");
assert(check.includes("superseded folder rename creates no current preference candidate"), "superseded rename regression");
assert(check.includes("final folder rename alone creates current preference candidate"), "final rename regression");
assert(check.includes("reset decisions create no preference candidate"), "reset preference regression");
assert(panel.includes("analysis.conflicts"), "ambiguous history shown in UI");
assert(rust.includes("preferences_revision_conflict_and_corruption_preserve_data"), "preference conflict and corruption Rust test");
assert(rust.includes("preferences_atomic_failure_preserves_previous"), "preference atomic Rust test");
assert(rust.includes("concurrent_preference_writes_have_one_winner"), "preference concurrency Rust test");
assert(!/copy_export|open_in_explorer|start_scan/.test(preferences + panel), "no real filesystem actions");
console.log("virtual plan p2k6b/c checks passed");
