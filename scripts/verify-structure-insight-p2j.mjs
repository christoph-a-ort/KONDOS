// P2-J-A: READ-ONLY structure insight view model / mapping.
// No UI / App wiring / CSS / P2-H/I mutation / private Realtest paths.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return readFileSync(join(rootDir, rel), "utf8");
}

const modelSrc = read("src/ui/structureInsightViewModel.ts");
const checkSrc = read("src/ui/structureInsightViewModelCheck.ts");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const appSrc = read("src/App.tsx");
const treeViewSrc = read("src/ui/TreeView.tsx");
const cssSrc = read("src/App.css");
const ruleSrc = read("src/ui/structureRuleCandidate.ts");
const confSrc = read("src/ui/structureConfidenceAssessment.ts");

assert(modelSrc.includes("buildStructureInsightViewModel"), "model: builder");
assert(modelSrc.includes("STRUCTURE_INSIGHT_VIEW_MODEL_SCHEMA_VERSION"), "model: schema");
assert(modelSrc.includes("InsightCardModel"), "model: card");
assert(modelSrc.includes("InsightLocationGroup"), "model: location");
assert(modelSrc.includes("countsByEvidence"), "model: evidence counts");
assert(modelSrc.includes("countsByCategory"), "model: category counts");
assert(modelSrc.includes("globallyIncomplete"), "model: incomplete");
assert(modelSrc.includes("unassessed"), "model: unassessed");
assert(modelSrc.includes("Noch nicht bewertet"), "model: unassessed label");
assert(modelSrc.includes("file-names"), "model: cat file-names");
assert(modelSrc.includes("folder-structure"), "model: cat folder");
assert(modelSrc.includes("time-years"), "model: cat years");
assert(modelSrc.includes("file-distribution"), "model: cat distribution");
assert(modelSrc.includes("Eingelesener Hauptordner"), "model: root label");
assert(modelSrc.includes("searchText"), "model: searchText");
assert(modelSrc.includes("secondaryRecurringGroups"), "model: secondary");
assert(modelSrc.includes("compareRuleCandidateText"), "model: utf16 sort");
assert(!modelSrc.includes("localeCompare"), "model: no localeCompare");
assert(!/\bDate\.now\s*\(/.test(modelSrc), "model: no Date.now");
assert(!modelSrc.includes("Math.random"), "model: no random");
assert(!modelSrc.includes("buildStructureRuleCandidateInsight"), "model: no P2-H call");
assert(!modelSrc.includes("buildStructureConfidenceInsight"), "model: no P2-I call");
assert(!modelSrc.includes("confidenceScore"), "model: no score");
assert(modelSrc.includes("factLineForPrinciple"), "model: fact helper");

assert(checkSrc.includes("runStructureInsightViewModelCheck"), "check exported");
assert(checkSrc.includes("unassessed"), "check: unassessed");
assert(checkSrc.includes("Noch nicht bewertet"), "check: label");
assert(checkSrc.includes("orphan"), "check: unresolved location");
assert(checkSrc.includes("determinism"), "check: determinism");
assert(checkSrc.includes("immutable"), "check: immutability");
assert(!checkSrc.includes("Off.Dokumente"), "check: no private path");

assert(workbenchSrc.includes("runStructureInsightViewModelCheck"), "workbench wires P2-J-A");
// P2-J-B may hold StructureInsightViewModel state in App via analysis orchestration.
assert(!appSrc.includes("buildStructureInsightViewModel"), "App: no direct J-A builder call");
assert(!treeViewSrc.includes("structureInsightViewModel"), "TreeView unchanged");
assert(!cssSrc.includes("structureInsightViewModel"), "CSS unchanged");
assert(!ruleSrc.includes("structureInsightViewModel"), "P2-H unchanged");
assert(!confSrc.includes("structureInsightViewModel"), "P2-I unchanged");

const checkUrl = pathToFileURL(join(rootDir, "src/ui/structureInsightViewModelCheck.ts")).href;
const { runStructureInsightViewModelCheck } = await import(checkUrl);
runStructureInsightViewModelCheck();

console.log("structure insight p2j checks passed");
