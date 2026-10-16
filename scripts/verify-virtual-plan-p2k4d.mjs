// P2-K.4d: virtual-only validation and explicit approval.
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

const approval = read("src/ui/virtualPlanApproval.ts");
const check = read("src/ui/virtualPlanEditorCheck.ts");
const panel = read("src/ui/VirtualPlanEditorPanel.tsx");
const app = read("src/App.tsx");

assert(approval.includes("assessVirtualPlanApproval"), "approval assessment");
assert(approval.includes("validateVirtualPlan"), "existing plan validator reused");
assert(approval.includes("prepareVirtualPlanApproval"), "approval plan preparation");
assert(approval.includes('kind: "approveVirtual"'), "approval decision record");
assert(approval.includes('status: "virtuallyApproved"'), "virtual approval status");
assert(!/invoke\(|fs\.|rename|unlink|mkdir/.test(approval), "approval remains filesystem-free");

assert(check.includes("saved complete plan is virtually approvable"), "valid approval test");
assert(check.includes("unsaved local changes block approval"), "unsaved change test");
assert(check.includes("revision conflict blocks approval"), "revision conflict test");
assert(check.includes("stale snapshot blocks approval"), "stale test");
assert(check.includes("incomplete scan blocks approval"), "incomplete scan test");
assert(check.includes("blocked draft blocks approval"), "blocked draft test");
assert(check.includes("duplicate objects block approval"), "completeness test");
assert(check.includes("approved plan is not silently editable"), "approved edit guard test");

assert(panel.includes("Virtuellen Plan bestätigen"), "explicit approval UI");
assert(panel.includes("Freigabefähig"), "approval state UI");
assert(panel.includes("plan-editor-approval-blockers"), "approval blockers shown by action");
assert(panel.includes("Datei- oder Ordneroperation"), "virtual-only UI explanation");
assert(app.includes("approveEditableVirtualPlan"), "explicit approval handler");
assert(app.includes("saveVirtualPlanDraft(candidate.planId"), "existing draft API used for approval");

console.log("virtual plan p2k4d checks passed");
