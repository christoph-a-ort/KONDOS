// P2-K.3a: virtual SOLL preview + justifiable suggestions (no user FS mutation).
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

const preview = read("src/ui/virtualPlanPreview.ts");
const check = read("src/ui/virtualPlanPreviewCheck.ts");
const view = read("src/ui/VirtualPlanPreviewView.tsx");
const app = read("src/App.tsx");
const css = read("src/App.css");
const workbench = read("src/ui/treeWorkbenchCheck.ts");
const model = read("src/ui/virtualPlan.ts");
const api = read("src/ui/virtualPlanApi.ts");
const rust = read("src-tauri/src/commands/virtual_plan.rs");
const productionRust = rust.split("\n#[cfg(test)]\nmod tests")[0];

assert(preview.includes("buildVirtualSollPreview"), "preview builder");
assert(preview.includes("structureHint"), "hint category");
assert(preview.includes("reviewCase"), "review category");
assert(preview.includes("unchanged"), "unchanged category");
assert(preview.includes("assessDraftConflict"), "draft conflict");
assert(preview.includes("mayPersistPreviewDraft"), "persist guard");
assert(!preview.includes("invoke("), "preview no invoke");
assert(!preview.includes("fs."), "preview no fs");
assert(!preview.includes("startScan"), "preview no scan");
assert(!/virtualRename|moveUser|deleteUser|createUserFolder/.test(preview), "no user mutation APIs");
assert(preview.includes("changeKind: \"unchanged\""), "nodes stay unchanged");

assert(check.includes("runVirtualPlanPreviewCheck"), "check export");
assert(check.includes("deterministic"), "check deterministic");
assert(check.includes("no structural intent"), "check no structural");
assert(check.includes("stale fingerprint"), "check stale");
assert(check.includes("large tree complete"), "check large");
assert(!check.includes("Off.Dokumente"), "check no private path");

assert(view.includes("VirtualPlanPreviewView"), "view export");
assert(view.includes("IST"), "ist mode");
assert(view.includes("SOLL"), "soll mode");
assert(view.includes("Nebeneinander"), "split mode");
assert(view.includes("Offene Prüffälle"), "cases panel");
assert(view.includes("Strukturhinweise"), "hints panel");
assert(view.includes("deriveVisibleRows"), "expandable hierarchy");
assert(view.includes("computeTreeWindow"), "windowing helper");
assert(view.includes("ROW_HEIGHT"), "windowing");
assert(view.includes("plan-details-toggle"), "collapsible details");
assert(view.includes("reviewReasonLabel"), "German reason labels");
assert(view.includes("reviewFeatureLabel"), "German feature labels");
assert(view.includes("scanResult"), "scanResult prop for hierarchy");
assert(!view.includes("saveVirtualPlanDraft"), "view no draft write");
assert(!view.includes("invoke("), "view no invoke");

assert(app.includes("VirtualPlanPreviewView"), "App wires view");
assert(app.includes("buildVirtualSollPreview"), "App builds preview");
assert(app.includes("loadVirtualPlanDraft"), "App loads draft");
assert(app.includes("scanResult={result}"), "App passes scanResult");
assert(app.includes("Planung"), "App planning tab");
assert(app.includes('"planning"'), "App planning mainView");
assert(
  !app.includes("saveVirtualPlanDraft(") || app.includes("saveEditableVirtualPlan"),
  "App persistence is explicit, not silent",
);
assert(!app.includes("discardVirtualPlanDraft("), "App no discard in K.3a");

assert(css.includes("P2-K.3a"), "css marker");
assert(css.includes(".plan-workspace-split"), "css split workspace");
assert(css.includes(".plan-view"), "css plan-view");
assert(css.includes("overflow: hidden"), "css outer overflow hidden");
assert(css.includes("min-height: 0"), "css min-height 0");
assert(css.includes("position: absolute"), "css absolute rows");
assert(css.includes(".plan-details-body"), "css collapsible body");
assert(preview.includes("reviewReasonLabel"), "preview German reasons");
assert(preview.includes("looksLikeTechnicalFeatureKey"), "tech key detector");
assert(check.includes("identity is status flag not list spam"), "check identity flag");
assert(check.includes("recurring pattern is hint only"), "check hint not auto case");
assert(check.includes("no auto merge review from recurring"), "check no merge case");
assert(check.includes("evidence does not repeat fact"), "check no duplicate fact");
assert(check.includes("incomplete yields one review case"), "check incomplete case");
assert(check.includes("unassessed no review case"), "check unassessed zero cases");
assert(preview.includes("formatHintEvidenceBasis"), "hint evidence helper");
assert(!/purple|violet|magenta|pink/i.test(css.slice(css.indexOf("P2-K.3a"))), "no purple/pink in K.3a css");

assert(workbench.includes("runVirtualPlanPreviewCheck"), "workbench wires K.3a");
assert(model.includes("SnapshotBinding"), "reuses K.2 model");
assert(api.includes("load_virtual_plan_draft"), "reuses K.2 api");
assert(productionRust.includes("virtual-plans"), "reuses app-data drafts");
assert(!productionRust.includes("std::fs::copy"), "no user copy");

const { runVirtualPlanPreviewCheck } = await import(
  pathToFileURL(join(root, "src/ui/virtualPlanPreviewCheck.ts")).href,
);
runVirtualPlanPreviewCheck();
console.log("virtual plan p2k3a checks passed");
