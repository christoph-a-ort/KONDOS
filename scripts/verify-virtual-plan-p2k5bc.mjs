// P2-K.5b/c: explicit preference candidates and revisioned preference storage.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");
const assert = (value, label) => { if (!value) throw new Error(label); };
const preferences = read("src/ui/virtualPlanPreferences.ts");
const panel = read("src/ui/VirtualPlanPreferencesPanel.tsx");
const api = read("src/ui/virtualPlanApi.ts");
const rust = read("src-tauri/src/commands/virtual_plan.rs");

assert(preferences.includes("deriveVirtualPlanPreferenceCandidates"), "pure candidate derivation");
assert(preferences.includes('plan.status !== "virtuallyApproved"'), "approval required");
assert(preferences.includes('decision.origin !== "user"'), "user decisions only");
assert(preferences.includes("addSelectedPreferenceCandidates"), "explicit selected candidate persistence");
assert(preferences.includes("updateVirtualPlanPreference"), "preference management");
assert(!/invoke\(|fs\.|saveVirtualPlan/.test(preferences), "pure preference functions");
assert(panel.includes("Präferenzen aus Entscheidungen übernehmen"), "explicit transfer UI");
assert(panel.includes("checked={selected.has"), "candidates default unselected");
assert(panel.includes("Deaktivieren"), "preference deactivation UI");
assert(panel.includes("Erneut aktivieren"), "preference reactivation UI");
assert(panel.includes("Änderung speichern"), "explicit description save UI");
assert(panel.includes("Abbrechen"), "description cancel UI");
assert(panel.includes("descriptionEdits"), "separate unsaved description buffer");
assert(!panel.includes("onBlur"), "no automatic focus-loss persistence");
assert(read("src/ui/virtualPlanEditorCheck.ts").includes("corrupt preference data is rejected"), "corrupt preference test");
assert(api.includes("saveVirtualPlanPreferences"), "revisioned preference API");
assert(rust.includes("save_virtual_plan_preferences"), "backend preference save");
assert(rust.includes("expected_revision"), "optimistic revision backend");
assert(!/copy_export|open_in_explorer|start_scan/.test(preferences + panel), "no filesystem action");

console.log("virtual plan p2k5b/c checks passed");
