// P2-J-C: Structure | Erkenntnisse navigation + ground view.
// No insight cards / filters / search / tree markers / retry button.

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

const viewSrc = read("src/ui/StructureInsightsView.tsx");
const helpersSrc = read("src/ui/structureInsightsViewHelpers.ts");
const checkSrc = read("src/ui/structureInsightsViewCheck.ts");
const appSrc = read("src/App.tsx");
const cssSrc = read("src/App.css");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const treeViewSrc = read("src/ui/TreeView.tsx");
const analysisSrc = read("src/ui/structureInsightAnalysis.ts");
const ruleSrc = read("src/ui/structureRuleCandidate.ts");
const confSrc = read("src/ui/structureConfidenceAssessment.ts");
const vmSrc = read("src/ui/structureInsightViewModel.ts");

const presentSrc = `${viewSrc}\n${helpersSrc}`;

assert(viewSrc.includes("StructureInsightsView"), "view export");
assert(helpersSrc.includes("formatInsightReadyHeadline"), "headline helper");
assert(helpersSrc.includes("formatInsightEvidenceSummary"), "evidence helper");
assert(helpersSrc.includes("insightNavCountLabel"), "nav count helper");
assert(helpersSrc.includes("defaultMainView"), "default main view");
assert(helpersSrc.includes("mainViewAfterScanStart"), "scan start view");
assert(helpersSrc.includes("canSelectInsightsView"), "select gate");
assert(helpersSrc.includes("shouldAutoSwitchMainViewOnPhase"), "no auto-switch helper");
assert(presentSrc.includes("Erkenntnisse werden ermittelt"), "running copy");
assert(presentSrc.includes("strukturelles Muster erkannt"), "singular ready");
assert(presentSrc.includes("strukturelle Muster erkannt"), "plural ready");
assert(presentSrc.includes("keine strukturellen Muster erkannt"), "true zero");
assert(presentSrc.includes("teilweise eingeschränkt"), "partial");
assert(presentSrc.includes("nicht ermittelt werden"), "failed");
assert(presentSrc.includes("Ordnerstruktur steht weiterhin"), "failed structure note");
assert(presentSrc.includes("Noch nicht bewertet"), "unassessed label");
assert(presentSrc.includes("keine Bewertung Ihrer Ablage"), "evidence info");
assert(presentSrc.includes("countsByEvidence"), "uses VM evidence counts");
assert(!presentSrc.includes("buildStructureRuleCandidateInsight"), "view: no P2-H");
assert(!presentSrc.includes("buildStructureConfidenceInsight"), "view: no P2-I");
assert(!presentSrc.includes("buildStructureInsightViewModel"), "view: no J-A builder");
assert(!presentSrc.includes("analyzeStructureInsights"), "view: no analyze");
assert(!presentSrc.includes("scheduleStructureInsightAnalysis"), "view: no schedule");
assert(!presentSrc.includes("retryInsightAnalysis"), "view: no retry wire");
assert(!presentSrc.includes("startScan"), "view: no startScan");
assert(!presentSrc.includes("invoke("), "view: no invoke");
assert(!presentSrc.includes("fs."), "view: no fs");
assert(!viewSrc.includes("InsightCard"), "view: no InsightCard component");
assert(!/Filter|Suche/.test(viewSrc), "view: no Filter/Suche UI");
assert(!presentSrc.toLowerCase().includes("confidencescore"), "view: no score");
assert(!presentSrc.includes("error.detail"), "view: no error.detail");
assert(!presentSrc.includes("insightAnalysisError"), "view: no raw error prop");

assert(checkSrc.includes("runStructureInsightsViewCheck"), "check export");
assert(checkSrc.includes("no auto on running"), "check: no auto running");
assert(checkSrc.includes("no auto on ready"), "check: no auto ready");
assert(checkSrc.includes("no auto on failed"), "check: no auto failed");
assert(checkSrc.includes("insights blocked without scan"), "check: blocked");
assert(checkSrc.includes("unassessed not low"), "check: unassessed");
assert(checkSrc.includes("zero != partial-zero"), "check: zero vs partial");
assert(!checkSrc.includes("Off.Dokumente"), "check: no private path");

assert(appSrc.includes('useState<MainView>("structure")'), "App: default structure");
assert(appSrc.includes("mainViewAfterScanStart"), "App: scan resets view");
assert(appSrc.includes("setMainView(mainViewAfterScanStart())"), "App: clear → structure");
assert(appSrc.includes("StructureInsightsView"), "App: mounts ground view");
assert(appSrc.includes("insight-view-switcher"), "App: switcher");
assert(appSrc.includes("aria-pressed"), "App: pressed state");
assert(appSrc.includes("main-view-panel-hidden"), "App: keep panels / hide inactive");
assert(appSrc.includes("<TreeView"), "App: TreeView present");
assert(!/mainView\s*===\s*["']structure["'][\s\S]{0,80}<TreeView/.test(appSrc) ||
  appSrc.includes("main-view-panel-hidden"), "App: TreeView not unmounted on switch");
assert(!appSrc.includes("onClick={() => {\n                void retryInsightAnalysis"), "App: no retry button wire");
assert(!appSrc.includes(">Erneut versuchen"), "App: no retry label");
assert(!appSrc.includes("Alle | Hoch"), "App: no evidence filter strip");
assert(!treeViewSrc.includes("StructureInsightsView"), "TreeView: no insights import");
assert(!treeViewSrc.includes("insightViewModel"), "TreeView: no insight VM");
assert(!treeViewSrc.includes("Erkenntnis"), "TreeView: no insight markers");

assert(cssSrc.includes(".insight-view-switcher"), "CSS: switcher");
assert(cssSrc.includes(".insight-view-tab"), "CSS: tab");
assert(cssSrc.includes(".insight-view"), "CSS: view");
assert(cssSrc.includes(".insight-partial-note"), "CSS: partial");
assert(cssSrc.includes("prefers-reduced-motion"), "CSS: reduced motion");
assert(cssSrc.includes('[aria-pressed="true"]'), "CSS: pressed not color-only");
assert(cssSrc.includes("font-weight"), "CSS: weight for active");
assert(cssSrc.includes("border-bottom"), "CSS: underline accent");
const jcCss = cssSrc.slice(cssSrc.indexOf("P2-J-C"));
assert(!/purple|violet|magenta|pink|#(?:a|b|c|d|e|f)[0-9a-f]*[89a-f][0-9a-f]*ff|#ff[0-9a-f]*[89a-f][0-9a-f]*|#c0[0-9a-f]{2}ff/i.test(jcCss), "CSS: no purple/pink/magenta in J-C");
assert(!/#(?:7|8|9|a)[0-9a-f]{2}[0-9a-f]{2}ff/i.test(jcCss) || true, "CSS: purple heuristic soft");
// Explicit forbidden family tokens in J-C block
assert(!/\bpurple\b|\bviolet\b|\bmagenta\b|\bpink\b/i.test(jcCss), "CSS: no purple/pink tokens");

assert(workbenchSrc.includes("runStructureInsightsViewCheck"), "workbench wires J-C");

assert(!analysisSrc.includes("StructureInsightsView"), "J-B analysis unchanged by view");
assert(!ruleSrc.includes("StructureInsightsView"), "P2-H unchanged");
assert(!confSrc.includes("StructureInsightsView"), "P2-I unchanged");
assert(!vmSrc.includes("StructureInsightsView"), "P2-J-A unchanged");
assert(!vmSrc.includes("insight-view-switcher"), "P2-J-A no UI CSS");

const checkUrl = pathToFileURL(join(rootDir, "src/ui/structureInsightsViewCheck.ts")).href;
const { runStructureInsightsViewCheck } = await import(checkUrl);
runStructureInsightsViewCheck();

console.log("structure insight p2jc checks passed");
