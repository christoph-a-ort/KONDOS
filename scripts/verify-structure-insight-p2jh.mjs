// P2-J-H: Failed analysis presentation, technical details, retry without rescan.
// No H/I/J-A mutation. No rating. No filesystem scan on retry.

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

const helpersSrc = read("src/ui/structureInsightErrorHelpers.ts");
const checkSrc = read("src/ui/structureInsightErrorHelpersCheck.ts");
const analysisSrc = read("src/ui/structureInsightAnalysis.ts");
const viewSrc = read("src/ui/StructureInsightsView.tsx");
const appSrc = read("src/App.tsx");
const cssSrc = read("src/App.css");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const ruleSrc = read("src/ui/structureRuleCandidate.ts");
const confSrc = read("src/ui/structureConfidenceAssessment.ts");
const vmSrc = read("src/ui/structureInsightViewModel.ts");
const filtersSrc = read("src/ui/structureInsightFilters.ts");
const navSrc = read("src/ui/structureInsightNavigation.ts");
const pkgSrc = read("package.json");

assert(helpersSrc.includes("canRetryInsightAnalysis"), "helpers: retry gate");
assert(helpersSrc.includes("formatInsightAnalysisErrorDetailLines"), "helpers: detail lines");
assert(helpersSrc.includes("INSIGHT_RETRY_LABEL"), "helpers: retry label");
assert(helpersSrc.includes("INSIGHT_FAILED_HEADLINE"), "helpers: failed headline");
assert(helpersSrc.includes("INSIGHT_RUNNING_MESSAGE"), "helpers: running");
assert(helpersSrc.includes("INSIGHT_PARTIAL_GLOBAL_HEADLINE"), "helpers: partial");
assert(!helpersSrc.includes("buildStructureRuleCandidateInsight"), "helpers: no H");
assert(!helpersSrc.includes("buildStructureConfidenceInsight"), "helpers: no I");
assert(!helpersSrc.includes("buildStructureInsightViewModel"), "helpers: no J-A");
assert(!helpersSrc.includes("startScan"), "helpers: no scan");
assert(!helpersSrc.includes("invoke("), "helpers: no invoke");

assert(analysisSrc.includes("name?:"), "analysis: optional error name");
assert(analysisSrc.includes("toInsightAnalysisError"), "analysis: normalize");
assert(analysisSrc.includes("shouldAcceptInsightAnalysisResult"), "analysis: stale guard");

assert(viewSrc.includes("INSIGHT_FAILED_HEADLINE") || viewSrc.includes("nicht abgeschlossen"), "view: failed");
assert(viewSrc.includes("onRetryAnalysis"), "view: retry prop");
assert(viewSrc.includes("analysisError"), "view: error prop");
assert(viewSrc.includes("INSIGHT_TECH_DETAILS_SHOW_LABEL") || viewSrc.includes("Technische Details"), "view: tech details");
assert(viewSrc.includes("aria-expanded"), "view: details aria");
assert(viewSrc.includes("INSIGHT_RUNNING_MESSAGE") || viewSrc.includes("untersucht"), "view: running");
assert(viewSrc.includes("INSIGHT_ZERO_HEADLINE") || viewSrc.includes("Keine strukturellen Muster erkannt"), "view: zero");
assert(viewSrc.includes("INSIGHT_PARTIAL_GLOBAL_HEADLINE"), "view: partial");
assert(viewSrc.includes("filterInsightLocationSections"), "view: J-G filters retained");
assert(viewSrc.includes("onNavigateToNode"), "view: J-F nav retained");
assert(viewSrc.includes("focusRequest"), "view: J-F focus retained");
assert(!viewSrc.includes("dangerouslySetInnerHTML"), "view: no html inject");
assert(!viewSrc.includes("Bestätigen"), "view: no rating");
assert(!viewSrc.includes("startScan"), "view: no startScan");
assert(!viewSrc.includes("83 %"), "view: no fake percent");

assert(appSrc.includes("onRetryAnalysis={retryInsightAnalysis}"), "App: retry wired");
assert(appSrc.includes("analysisError={insightAnalysisError}"), "App: error wired");
assert(appSrc.includes("insightAnalysisInFlightRef"), "App: in-flight guard");
assert(appSrc.includes("insightAnalysisPhase !== \"failed\""), "App: retry only from failed");
assert(appSrc.includes("resultRef.current"), "App: retry uses current result");
assert(!appSrc.includes("startScan(") || appSrc.includes("retryInsightAnalysis"), "App: retry present");
assert(!/retryInsightAnalysis[\s\S]{0,400}startScan/.test(appSrc), "App: retry does not call startScan nearby");
assert(appSrc.includes("clearInsightNavigationState"), "App: nav clear retained");

assert(cssSrc.includes(".insight-failed"), "CSS: failed");
assert(cssSrc.includes(".insight-failed-retry"), "CSS: retry");
assert(cssSrc.includes(".insight-failed-details"), "CSS: details");
const jhCss = cssSrc.slice(cssSrc.indexOf("P2-J-H"));
assert(jhCss.length > 0, "CSS: P2-J-H block");
assert(!/\bpurple\b|\bviolet\b|\bmagenta\b|\bpink\b/i.test(jhCss), "CSS: no purple/pink");

assert(checkSrc.includes("runStructureInsightErrorHelpersCheck"), "check export");
assert(checkSrc.includes("retry allowed from failed"), "check: retry");
assert(checkSrc.includes("no retry while in flight"), "check: double");
assert(checkSrc.includes("object not dumped"), "check: object");
assert(checkSrc.includes("null fallback"), "check: null");
assert(!checkSrc.includes("Off.Dokumente"), "check: no private path");

assert(workbenchSrc.includes("runStructureInsightErrorHelpersCheck"), "workbench wires J-H");
assert(!ruleSrc.includes("structureInsightErrorHelpers"), "P2-H unchanged");
assert(!confSrc.includes("structureInsightErrorHelpers"), "P2-I unchanged");
assert(!vmSrc.includes("structureInsightErrorHelpers"), "P2-J-A unchanged");
assert(filtersSrc.includes("filterInsightLocationSections"), "J-G filters file retained");
assert(navSrc.includes("InsightFocusRequest"), "J-F nav retained");

const deps = JSON.parse(pkgSrc).dependencies ?? {};
assert(!deps["react-error-boundary"], "no error-boundary dep");

const checkUrl = pathToFileURL(join(rootDir, "src/ui/structureInsightErrorHelpersCheck.ts")).href;
const { runStructureInsightErrorHelpersCheck } = await import(checkUrl);
runStructureInsightErrorHelpersCheck();

const analysisCheckUrl = pathToFileURL(join(rootDir, "src/ui/structureInsightAnalysisCheck.ts")).href;
const { runStructureInsightAnalysisCheck } = await import(analysisCheckUrl);
runStructureInsightAnalysisCheck();

console.log("structure insight p2jh checks passed");
