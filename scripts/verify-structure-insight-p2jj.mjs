// P2-J-J.2: Integration helpers – scan-failure insight restore,
// insight→tree under Anzeigefilter, pending-reveal commit policy.

import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

register(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "ts-resolve-hook.mjs")).href);

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return readFileSync(join(rootDir, rel), "utf8");
}

const integrationSrc = read("src/ui/structureInsightIntegration.ts");
const checkSrc = read("src/ui/structureInsightIntegrationCheck.ts");
const appSrc = read("src/App.tsx");
const treeSrc = read("src/ui/TreeView.tsx");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const ruleSrc = read("src/ui/structureRuleCandidate.ts");
const confSrc = read("src/ui/structureConfidenceAssessment.ts");
const vmSrc = read("src/ui/structureInsightViewModel.ts");
const analysisSrc = read("src/ui/structureInsightAnalysis.ts");

assert(integrationSrc.includes("shouldRestorePreviousScanAndInsightsOnError"), "helpers: restore gate");
assert(integrationSrc.includes("captureInsightAnalysisUiSnapshot"), "helpers: snapshot");
assert(integrationSrc.includes("resolveInsightTreeReveal"), "helpers: reveal plan");
assert(integrationSrc.includes("canCommitPendingTreeReveal"), "helpers: pending commit");
assert(integrationSrc.includes("hidden-by-filter"), "helpers: filter kind");
assert(integrationSrc.includes("WARNING_HIDDEN_BY_FILTER_NOTICE"), "helpers: reuse warning notice");
assert(!integrationSrc.includes("buildStructureRuleCandidateInsight"), "helpers: no P2-H");
assert(!integrationSrc.includes("buildStructureConfidenceInsight"), "helpers: no P2-I");
assert(!integrationSrc.includes("buildStructureInsightViewModel"), "helpers: no J-A builder");
assert(!integrationSrc.includes("invoke("), "helpers: no invoke");
assert(!integrationSrc.includes("fs."), "helpers: no fs");

assert(checkSrc.includes("runStructureInsightIntegrationCheck"), "check export");
assert(checkSrc.includes("invalidPath restores previous insights"), "check: A invalidPath");
assert(checkSrc.includes("filtered: hidden-by-filter"), "check: B filter");
assert(checkSrc.includes("pending: hold while viewport height 0"), "check: C viewport");
assert(checkSrc.includes("after filter reset: reveal"), "check: B after reset");
assert(!checkSrc.includes("Off.Dokumente"), "check: no private path");

assert(appSrc.includes("captureInsightAnalysisUiSnapshot"), "App: snapshots insights before scan");
assert(appSrc.includes("restoreInsightAnalysisUiSnapshot"), "App: restores insights on rejected begin");
assert(appSrc.includes("shouldClearScanResultOnError"), "App: keeps clear gate");

assert(treeSrc.includes("resolveInsightTreeReveal"), "TreeView: filter-aware reveal");
assert(treeSrc.includes("canCommitPendingTreeReveal"), "TreeView: pending commit policy");
assert(treeSrc.includes("pendingRevealAfterFilterResetRef"), "TreeView: pending after filter reset");
assert(treeSrc.includes("viewportClientHeight"), "TreeView: measurable viewport gate");

assert(workbenchSrc.includes("runStructureInsightIntegrationCheck"), "workbench wires J-J.2");

assert(!ruleSrc.includes("structureInsightIntegration"), "P2-H unchanged");
assert(!confSrc.includes("structureInsightIntegration"), "P2-I unchanged");
assert(!vmSrc.includes("structureInsightIntegration"), "P2-J-A unchanged");
assert(!analysisSrc.includes("structureInsightIntegration"), "P2-J-B analysis module unchanged");

const checkUrl = pathToFileURL(join(rootDir, "src/ui/structureInsightIntegrationCheck.ts")).href;
const { runStructureInsightIntegrationCheck } = await import(checkUrl);
runStructureInsightIntegrationCheck();

console.log("structure insight p2jj checks passed");
