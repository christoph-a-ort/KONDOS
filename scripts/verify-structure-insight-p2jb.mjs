// P2-J-B: structure insight analysis lifecycle / H→I→J-A orchestration.
// No visible insight UI / CSS / Tree markers / private Realtest paths.

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

const analysisSrc = read("src/ui/structureInsightAnalysis.ts");
const checkSrc = read("src/ui/structureInsightAnalysisCheck.ts");
const appSrc = read("src/App.tsx");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const treeViewSrc = read("src/ui/TreeView.tsx");
const cssSrc = read("src/App.css");
const ruleSrc = read("src/ui/structureRuleCandidate.ts");
const confSrc = read("src/ui/structureConfidenceAssessment.ts");
const vmSrc = read("src/ui/structureInsightViewModel.ts");

assert(analysisSrc.includes("analyzeStructureInsights"), "analysis: builder");
assert(analysisSrc.includes("scheduleStructureInsightAnalysis"), "analysis: schedule");
assert(analysisSrc.includes("shouldAcceptInsightAnalysisResult"), "analysis: stale guard");
assert(analysisSrc.includes("buildStructureRuleCandidateInsight"), "analysis: uses P2-H");
assert(analysisSrc.includes("buildStructureConfidenceInsight"), "analysis: uses P2-I");
assert(analysisSrc.includes("buildStructureInsightViewModel"), "analysis: uses P2-J-A");
assert(analysisSrc.includes('"idle"'), "analysis: idle");
assert(analysisSrc.includes('"running"'), "analysis: running");
assert(analysisSrc.includes('"ready"'), "analysis: ready");
assert(analysisSrc.includes('"failed"'), "analysis: failed");
assert(analysisSrc.includes("setTimeout"), "analysis: macrotask schedule");
assert(!analysisSrc.includes("localeCompare"), "analysis: no localeCompare");
assert(!/\bDate\.now\s*\(/.test(analysisSrc), "analysis: no Date.now");
assert(!analysisSrc.includes("Math.random"), "analysis: no random");
assert(!analysisSrc.includes("confidenceScore"), "analysis: no score");
assert(!analysisSrc.includes("startScan"), "analysis: no startScan");
assert(!analysisSrc.includes("invoke("), "analysis: no invoke");
assert(!analysisSrc.includes("fs."), "analysis: no fs");
assert(!analysisSrc.includes("Worker"), "analysis: no Worker");

assert(checkSrc.includes("runStructureInsightAnalysisCheck"), "check exported");
assert(checkSrc.includes("stale"), "check: stale");
assert(checkSrc.includes("zero insights"), "check: zero");
assert(checkSrc.includes("partial"), "check: partial");
assert(checkSrc.includes("injected-h-failure"), "check: failure inject");
assert(!checkSrc.includes("Off.Dokumente"), "check: no private path");

assert(appSrc.includes("scheduleStructureInsightAnalysis"), "App wires schedule");
assert(appSrc.includes("beginInsightAnalysisForScan"), "App begin analysis");
assert(appSrc.includes("clearInsightAnalysisState"), "App clear on new scan");
assert(appSrc.includes("retryInsightAnalysis"), "App retry foundation");
assert(appSrc.includes("insightAnalysisPhase"), "App phase state");
assert(appSrc.includes("insightViewModel"), "App view model state");
assert(!appSrc.includes("Erkenntnisse"), "App: no visible Erkenntnisse label");
assert(!appSrc.includes("activeView"), "App: no view toggle yet");
assert(!treeViewSrc.includes("structureInsightAnalysis"), "TreeView unchanged by analysis");
assert(!treeViewSrc.includes("insightViewModel"), "TreeView no insight prop");
assert(!cssSrc.includes("structureInsightAnalysis"), "CSS unchanged");
assert(!ruleSrc.includes("structureInsightAnalysis"), "P2-H unchanged");
assert(!confSrc.includes("structureInsightAnalysis"), "P2-I unchanged");
assert(!vmSrc.includes("structureInsightAnalysis"), "P2-J-A unchanged");
assert(workbenchSrc.includes("runStructureInsightAnalysisCheck"), "workbench wires J-B");

const checkUrl = pathToFileURL(join(rootDir, "src/ui/structureInsightAnalysisCheck.ts")).href;
const { runStructureInsightAnalysisCheck } = await import(checkUrl);
runStructureInsightAnalysisCheck();

console.log("structure insight p2jb checks passed");
