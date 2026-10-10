// P2-J-G: Insight search, filters, hit count, central detail control.
// No H/I/J-A mutation. No filesystem search. No rating/retry.

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

const filtersSrc = read("src/ui/structureInsightFilters.ts");
const checkSrc = read("src/ui/structureInsightFiltersCheck.ts");
const viewSrc = read("src/ui/StructureInsightsView.tsx");
const cardSrc = read("src/ui/InsightCard.tsx");
const detailsSrc = read("src/ui/InsightCardDetails.tsx");
const highlightSrc = read("src/ui/InsightSearchHighlight.tsx");
const cssSrc = read("src/App.css");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const appSrc = read("src/App.tsx");
const analysisSrc = read("src/ui/structureInsightAnalysis.ts");
const ruleSrc = read("src/ui/structureRuleCandidate.ts");
const confSrc = read("src/ui/structureConfidenceAssessment.ts");
const vmSrc = read("src/ui/structureInsightViewModel.ts");
const navSrc = read("src/ui/structureInsightNavigation.ts");
const pkgSrc = read("package.json");

assert(filtersSrc.includes("normalizeInsightSearchQuery"), "filters: normalize");
assert(filtersSrc.includes("filterInsightLocationSections"), "filters: sections");
assert(filtersSrc.includes("formatInsightHitCount"), "filters: hit count");
assert(filtersSrc.includes("cardNeedsDetailOpenForSearch"), "filters: detail open");
assert(filtersSrc.includes("elementListNeedsShowAllForSearch"), "filters: show all");
assert(filtersSrc.includes("splitInsightHighlightSegments"), "filters: highlight split");
assert(filtersSrc.includes("INSIGHT_FILTER_RESET_LABEL"), "filters: reset label");
assert(filtersSrc.includes("INSIGHT_DETAILS_EXPAND_ALL_LABEL"), "filters: expand all");
assert(!filtersSrc.includes(".sort("), "filters: no sort");
assert(!filtersSrc.includes("buildStructureRuleCandidateInsight"), "filters: no H");
assert(!filtersSrc.includes("buildStructureConfidenceInsight"), "filters: no I");
assert(!filtersSrc.includes("buildStructureInsightViewModel"), "filters: no J-A");

assert(viewSrc.includes("insight-filter-bar"), "view: filter bar");
assert(viewSrc.includes("INSIGHT_SEARCH_LABEL") || viewSrc.includes("Erkenntnisse durchsuchen"), "view: search label");
assert(viewSrc.includes("formatInsightHitCount"), "view: hit count");
assert(viewSrc.includes("expandAllVisibleDetails"), "view: expand all");
assert(viewSrc.includes("collapseAllVisibleDetails"), "view: collapse all");
assert(viewSrc.includes("resetInsightFilters") || viewSrc.includes("resetSearchAndFilters"), "view: reset");
assert(viewSrc.includes("focusRequest"), "view: J-F focus retained");
assert(viewSrc.includes("onNavigateToNode"), "view: J-F nav retained");
assert(viewSrc.includes("setFilters(resetInsightFilters())"), "view: marker resets filters");
assert(!viewSrc.includes("dangerouslySetInnerHTML"), "view: no html inject");
// J-H may add onRetryAnalysis; J-G still forbids rating and owning the analysis scheduler.
assert(!viewSrc.includes("scheduleStructureInsightAnalysis"), "view: no schedule");
assert(!viewSrc.includes("Bestätigen"), "view: no rating");

assert(cardSrc.includes("searchQuery"), "card: searchQuery");
assert(cardSrc.includes("InsightSearchHighlight"), "card: highlight");
assert(detailsSrc.includes("searchQuery"), "details: searchQuery");
assert(detailsSrc.includes("elementListNeedsShowAllForSearch"), "details: long list");
assert(highlightSrc.includes("splitInsightHighlightSegments"), "highlight helper");
assert(!highlightSrc.includes("dangerouslySetInnerHTML"), "highlight: no html inject");

assert(cssSrc.includes(".insight-filter-bar"), "CSS: filter bar");
assert(cssSrc.includes(".insight-search-hit"), "CSS: search hit");
assert(cssSrc.includes("position: sticky"), "CSS: sticky filter");
const jgCss = cssSrc.slice(cssSrc.indexOf("P2-J-G"));
assert(jgCss.length > 0, "CSS: P2-J-G block");
assert(!/\bpurple\b|\bviolet\b|\bmagenta\b|\bpink\b/i.test(jgCss), "CSS: no purple/pink");

assert(checkSrc.includes("runStructureInsightFiltersCheck"), "check export");
assert(checkSrc.includes("normalize spaces"), "check: normalize");
assert(checkSrc.includes("combined AND"), "check: AND");
assert(checkSrc.includes("empty groups hidden"), "check: empty groups");
assert(checkSrc.includes("order stable"), "check: order");
assert(checkSrc.includes("unassessed included in Alle"), "check: unassessed");
assert(checkSrc.includes("hit beyond first six"), "check: long list");
assert(checkSrc.includes("detail-only needs open"), "check: detail open");
assert(!checkSrc.includes("Off.Dokumente"), "check: no private path");

assert(workbenchSrc.includes("runStructureInsightFiltersCheck"), "workbench wires J-G");
assert(!analysisSrc.includes("structureInsightFilters"), "J-B unchanged");
assert(!ruleSrc.includes("structureInsightFilters"), "P2-H unchanged");
assert(!confSrc.includes("structureInsightFilters"), "P2-I unchanged");
assert(!vmSrc.includes("structureInsightFilters"), "P2-J-A unchanged");
assert(navSrc.includes("InsightFocusRequest"), "J-F nav types retained");
assert(!appSrc.includes("buildStructureInsightViewModel"), "App: no direct J-A");

const deps = JSON.parse(pkgSrc).dependencies ?? {};
assert(!deps["fuse.js"] && !deps["minisearch"] && !deps["flexsearch"], "no search deps");
assert(!deps["react-router"] && !deps["react-router-dom"], "no router dep");

const checkUrl = pathToFileURL(join(rootDir, "src/ui/structureInsightFiltersCheck.ts")).href;
const { runStructureInsightFiltersCheck } = await import(checkUrl);
runStructureInsightFiltersCheck();

console.log("structure insight p2jg checks passed");
