// P2-K.3c: conservative, read-only usefulness assessment for virtual proposals.
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

const assessment = read("src/ui/virtualPlanProposalUsefulness.ts");
const assessmentCheck = read("src/ui/virtualPlanProposalUsefulnessCheck.ts");
const preview = read("src/ui/virtualPlanPreview.ts");
const view = read("src/ui/VirtualPlanPreviewView.tsx");
const css = read("src/App.css");
const workbench = read("src/ui/treeWorkbenchCheck.ts");

assert(assessment.includes("assessVirtualProposalUsefulness"), "assessment export");
assert(assessment.includes("likelyHelpful"), "helpful category");
assert(assessment.includes("likelyNotHelpful"), "not-helpful category");
assert(assessment.includes("notAssessable"), "not-assessable category");
assert(assessment.includes("VIRTUAL_PLAN_TARGET_DEPTH_SOFT_LIMIT"), "central soft limit");
assert(assessment.includes("overlapsWithProposalIds"), "overlap consideration");
assert(assessment.includes("Pure/read-only"), "read-only contract");
assert(!assessment.includes("invoke("), "assessment no invoke");
assert(!/fs\.write|fs\.rename|fs\.unlink|saveVirtualPlanDraft/.test(assessment), "no FS/draft write");

assert(assessmentCheck.includes("gasag nine singleton folders"), "gasag check");
assert(assessmentCheck.includes("three files one folder unclear"), "small folder check");
assert(assessmentCheck.includes("100 files five groups helpful"), "large folder check");
assert(assessmentCheck.includes("partial grouping unclear"), "partial check");
assert(assessmentCheck.includes("high depth downside"), "depth check");
assert(assessmentCheck.includes("incomplete not assessable"), "incomplete check");
assert(assessmentCheck.includes("overlap unclear"), "overlap check");
assert(assessmentCheck.includes("deterministic"), "determinism check");
assert(assessmentCheck.includes("does not mutate proposal"), "immutability check");

assert(preview.includes("proposalUsefulness"), "preview carries assessments");
assert(preview.includes("assessVirtualProposalUsefulness"), "preview assesses proposals");
assert(preview.includes('changeKind: "unchanged"'), "SOLL unchanged");

assert(view.includes("Organisatorischer Nutzen"), "view assessment label");
assert(view.includes("Mögliche Nachteile"), "view drawbacks");
assert(view.includes("Beobachtete Merkmale"), "view observed features");
assert(view.includes("bestehende Struktur kann beibehalten"), "view no pressure");
assert(!view.includes("Übernehmen"), "view no adopt button");
assert(!view.includes("Bestätigen"), "view no confirmation button");

assert(css.includes("P2-K.3c"), "css marker");
assert(css.includes(".plan-proposal-usefulness"), "assessment css");
assert(!/purple|violet|magenta|pink/i.test(css.slice(css.indexOf("P2-K.3c"))), "no purple/pink");
assert(workbench.includes("runVirtualPlanProposalUsefulnessCheck"), "workbench wires check");

const { runVirtualPlanProposalUsefulnessCheck } = await import(
  pathToFileURL(join(root, "src/ui/virtualPlanProposalUsefulnessCheck.ts")).href,
);
runVirtualPlanProposalUsefulnessCheck();

console.log("virtual plan p2k3c checks passed");
