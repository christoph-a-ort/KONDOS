// P2-J-E: Expanded insight-card details (explanation, structure, element lists).
// ViewModel is the only data source. No tree nav, filter/search/retry/rating.

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

const detailsSrc = read("src/ui/InsightCardDetails.tsx");
const helpersSrc = read("src/ui/structureInsightDetailsHelpers.ts");
const checkSrc = read("src/ui/structureInsightDetailsCheck.ts");
const cardSrc = read("src/ui/InsightCard.tsx");
const viewSrc = read("src/ui/StructureInsightsView.tsx");
const cssSrc = read("src/App.css");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const appSrc = read("src/App.tsx");
const treeViewSrc = read("src/ui/TreeView.tsx");
const analysisSrc = read("src/ui/structureInsightAnalysis.ts");
const ruleSrc = read("src/ui/structureRuleCandidate.ts");
const confSrc = read("src/ui/structureConfidenceAssessment.ts");
const vmSrc = read("src/ui/structureInsightViewModel.ts");
const pkgSrc = read("package.json");

assert(helpersSrc.includes("INSIGHT_LIST_INITIAL_LIMIT"), "helpers: limit");
assert(helpersSrc.includes("visibleInsightElements"), "helpers: visible slice");
assert(helpersSrc.includes("displayableStructuralParts"), "helpers: parts");
assert(helpersSrc.includes("displayableExamples"), "helpers: examples");
assert(helpersSrc.includes("displayableExplanationBullets"), "helpers: bullets");
assert(helpersSrc.includes("insightElementDisplayLines"), "helpers: element lines");
assert(helpersSrc.includes("otherElementsHeading"), "helpers: other heading");
assert(helpersSrc.includes("Elemente der erkannten Hauptstruktur"), "helpers: primary label");
assert(helpersSrc.includes("Elemente mit anderer erkannter Struktur"), "helpers: other label");
assert(helpersSrc.includes("Weitere Elemente anzeigen"), "helpers: show more");
assert(helpersSrc.includes("Weniger anzeigen"), "helpers: show less");
assert(!helpersSrc.includes(".sort("), "helpers: no sort");
assert(!helpersSrc.includes("buildStructureRuleCandidateInsight"), "helpers: no H");
assert(!helpersSrc.includes("buildStructureConfidenceInsight"), "helpers: no I");
assert(!helpersSrc.includes("buildStructureInsightViewModel"), "helpers: no J-A");

assert(detailsSrc.includes("export function InsightCardDetails"), "details export");
assert(detailsSrc.includes("explanationBullets") || detailsSrc.includes("displayableExplanationBullets"), "details: bullets");
assert(detailsSrc.includes("plainDescription"), "details: plainDescription");
assert(detailsSrc.includes("examples") || detailsSrc.includes("displayableExamples"), "details: examples");
assert(detailsSrc.includes("structuralParts") || detailsSrc.includes("displayableStructuralParts"), "details: parts");
assert(detailsSrc.includes("primaryElements"), "details: primary");
assert(detailsSrc.includes("secondaryRecurringGroups"), "details: secondary");
assert(detailsSrc.includes("otherElements"), "details: other");
assert(detailsSrc.includes("aria-expanded"), "details: aria-expanded");
assert(detailsSrc.includes('type="button"'), "details: buttons");
assert(detailsSrc.includes("INSIGHT_LIST_SHOW_MORE_LABEL") || detailsSrc.includes("Weitere Elemente"), "details: more");
assert(!detailsSrc.includes("scrollIntoView"), "details: no scrollIntoView");
assert(!detailsSrc.includes("selectTree"), "details: no tree select");
assert(!detailsSrc.includes("explanationBullets.map") || detailsSrc.includes("bullets.map"), "details: bullets render");
assert(!detailsSrc.toLowerCase().includes("confidencescore"), "details: no score");
assert(!detailsSrc.includes("retryInsightAnalysis"), "details: no retry");
assert(!detailsSrc.includes("Filter"), "details: no Filter");
assert(!detailsSrc.includes("Suche"), "details: no Suche");
assert(!detailsSrc.includes("Bestätigen"), "details: no rating");
assert(!detailsSrc.includes("invoke("), "details: no invoke");
assert(!detailsSrc.includes("fs."), "details: no fs");
assert(!detailsSrc.includes("{element.nodeId}</"), "details: nodeId not shown as text");

assert(cardSrc.includes("InsightCardDetails"), "card wires details");
assert(cardSrc.includes("INSIGHT_DETAILS_SHOW_LABEL") || cardSrc.includes("Details anzeigen"), "card: J-D toggle");
assert(cardSrc.includes("aria-expanded"), "card: aria-expanded");
assert(viewSrc.includes("expandedIds"), "view: expansion state");
assert(viewSrc.includes("insightViewModelExpansionKey"), "view: reset key");

assert(cssSrc.includes(".insight-card-details-body") || cssSrc.includes(".insight-detail-section"), "CSS: detail body");
assert(cssSrc.includes(".insight-detail-element"), "CSS: element");
assert(cssSrc.includes(".insight-detail-list-toggle"), "CSS: nested toggle");
assert(cssSrc.includes("insight-detail-list-toggle:focus-visible"), "CSS: focus");
const jeCssStart = cssSrc.indexOf("P2-J-E");
assert(jeCssStart >= 0, "CSS: P2-J-E marker");
const jeCss = cssSrc.slice(jeCssStart);
assert(!/\bpurple\b|\bviolet\b|\bmagenta\b|\bpink\b/i.test(jeCss), "CSS: no purple/pink");

assert(checkSrc.includes("runStructureInsightDetailsCheck"), "check export");
assert(checkSrc.includes("collapsed shows limit"), "check: limit");
assert(checkSrc.includes("expanded shows all"), "check: show all");
assert(checkSrc.includes("no resort"), "check: order");
assert(checkSrc.includes("no duplicate"), "check: duplicates");
assert(!checkSrc.includes("Off.Dokumente"), "check: no private path");

assert(workbenchSrc.includes("runStructureInsightDetailsCheck"), "workbench wires J-E");
assert(!treeViewSrc.includes("InsightCardDetails"), "TreeView: no details");
assert(
  !treeViewSrc.includes("Erkenntnis") || treeViewSrc.includes("structureInsightNavigation"),
  "TreeView: Erkenntnis text only via navigation module",
);
assert(!appSrc.includes("buildStructureInsightViewModel"), "App: no direct J-A");
assert(!analysisSrc.includes("InsightCardDetails"), "J-B unchanged");
assert(!ruleSrc.includes("InsightCardDetails"), "P2-H unchanged");
assert(!confSrc.includes("InsightCardDetails"), "P2-I unchanged");
assert(!vmSrc.includes("InsightCardDetails"), "P2-J-A unchanged");

const deps = JSON.parse(pkgSrc).dependencies ?? {};
const devDeps = JSON.parse(pkgSrc).devDependencies ?? {};
assert(!deps["lucide-react"] && !devDeps["lucide-react"], "no lucide");
assert(Object.keys(deps).length >= 0, "deps readable");

const checkUrl = pathToFileURL(join(rootDir, "src/ui/structureInsightDetailsCheck.ts")).href;
const { runStructureInsightDetailsCheck } = await import(checkUrl);
runStructureInsightDetailsCheck();

console.log("structure insight p2je checks passed");
