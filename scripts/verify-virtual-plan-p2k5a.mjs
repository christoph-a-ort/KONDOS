// P2-K.5a: read-only discovery and revalidation of virtual plans.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");
const assert = (value, label) => {
  if (!value) throw new Error(label);
};

const api = read("src/ui/virtualPlanApi.ts");
const history = read("src/ui/virtualPlanRevalidation.ts");
const check = read("src/ui/virtualPlanEditorCheck.ts");
const view = read("src/ui/VirtualPlanPreviewView.tsx");
const rust = read("src-tauri/src/commands/virtual_plan.rs");

assert(api.includes("listVirtualPlanDrafts"), "read-only draft discovery API");
assert(history.includes("revalidateVirtualPlan"), "revalidation function");
assert(history.includes('kind: "current"'), "current result");
assert(history.includes('kind: "stale"'), "stale result");
assert(history.includes('kind: "blocked"'), "blocked result");
assert(history.includes('kind: "notComparable"'), "not comparable result");
assert(!/invoke\(|fs\.|saveVirtualPlanDraft/.test(history), "revalidation is pure and read-only");

assert(check.includes("unchanged snapshot revalidates current"), "unchanged snapshot test");
assert(check.includes("changed scan id revalidates stale"), "scan id test");
assert(check.includes("changed fingerprint revalidates stale"), "fingerprint test");
assert(check.includes("changed scan config revalidates stale"), "config test");
assert(check.includes("changed object set revalidates stale"), "object set test");
assert(check.includes("approved historical plan remains historically valid without rebinding"), "historical approval test");
assert(check.includes("blocked draft remains blocked"), "blocked draft test");

assert(view.includes("Frühere virtuelle Pläne"), "history UI");
assert(view.includes("Früheren Plan ansehen"), "read-only history action");
assert(view.includes("Erneut prüfen"), "explicit revalidation action");
assert(view.includes("nicht auf den aktuellen Scan umgebunden"), "no automatic rebinding UI");

assert(rust.includes("list_virtual_plan_drafts"), "backend list command");
assert(rust.includes("list_keeps_multiple_drafts_distinct_and_marks_corruption"), "backend list test");
assert(!rust.includes("open_in_explorer"), "draft discovery has no user path action");

console.log("virtual plan p2k5a checks passed");
