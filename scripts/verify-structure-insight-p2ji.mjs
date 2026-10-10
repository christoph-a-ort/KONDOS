// P2-J-I: Insight UI polish, accessibility, presentation performance helpers.
// No H/I/J-A mutation. No new search/filter semantics. No rating.

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

const presentationSrc = read("src/ui/structureInsightPresentation.ts");
const checkSrc = read("src/ui/structureInsightPresentationCheck.ts");
const cardSrc = read("src/ui/InsightCard.tsx");
const detailsSrc = read("src/ui/InsightCardDetails.tsx");
const viewSrc = read("src/ui/StructureInsightsView.tsx");
const highlightSrc = read("src/ui/InsightSearchHighlight.tsx");
const cssSrc = read("src/App.css");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const analysisSrc = read("src/ui/structureInsightAnalysis.ts");
const ruleSrc = read("src/ui/structureRuleCandidate.ts");
const confSrc = read("src/ui/structureConfidenceAssessment.ts");
const vmSrc = read("src/ui/structureInsightViewModel.ts");
const filtersSrc = read("src/ui/structureInsightFilters.ts");
const navSrc = read("src/ui/structureInsightNavigation.ts");
const errorSrc = read("src/ui/structureInsightErrorHelpers.ts");
const pkgSrc = read("package.json");

assert(presentationSrc.includes("INSIGHT_EXAMPLES_INITIAL_LIMIT"), "presentation: examples limit");
assert(presentationSrc.includes("insightElementPathPresentation"), "presentation: path");
assert(presentationSrc.includes("isElementPathCoveredByLocation"), "presentation: covered");
assert(presentationSrc.includes("visibleInsightExamples"), "presentation: visible examples");
assert(presentationSrc.includes("formatInsightLocationCountLabel"), "presentation: count");
assert(!presentationSrc.includes("buildStructureRuleCandidateInsight"), "presentation: no H");
assert(!presentationSrc.includes("buildStructureConfidenceInsight"), "presentation: no I");
assert(!presentationSrc.includes("buildStructureInsightViewModel"), "presentation: no J-A");
assert(!presentationSrc.includes(".sort("), "presentation: no sort");

assert(cardSrc.includes("memo(") || cardSrc.includes("memo(InsightCard"), "card: memo");
assert(cardSrc.includes("insight-card-title"), "card: title first hierarchy");
assert(cardSrc.includes("locationSegmentNames"), "card: location segments");
assert(cardSrc.includes("aria-expanded"), "card: aria-expanded");
assert(cardSrc.includes("aria-controls"), "card: aria-controls");

assert(detailsSrc.includes("insightElementPathPresentation"), "details: path presentation");
assert(detailsSrc.includes("visibleInsightExamples"), "details: example limit");
assert(detailsSrc.includes("fullPathTitle") || detailsSrc.includes("title={title}"), "details: path title");
assert(detailsSrc.includes("locationSegmentNames"), "details: location context");
assert(!detailsSrc.includes("dangerouslySetInnerHTML"), "details: no html inject");

assert(viewSrc.includes("formatInsightLocationCountLabel"), "view: location count");
assert(viewSrc.includes("insight-location-heading"), "view: heading layout");
assert(viewSrc.includes("locationSegmentNames"), "view: passes segments");
assert(viewSrc.includes("useCallback"), "view: stable callbacks");
assert(viewSrc.includes("filterInsightLocationSections"), "view: J-G filters");
assert(viewSrc.includes("onRetryAnalysis"), "view: J-H retry");
assert(viewSrc.includes("onNavigateToNode"), "view: J-F nav");
assert(viewSrc.includes("focusRequest"), "view: J-F focus");

assert(highlightSrc.includes("splitInsightHighlightSegments"), "highlight retained");
assert(!highlightSrc.includes("dangerouslySetInnerHTML"), "highlight safe");

assert(cssSrc.includes("insight-location-heading"), "CSS: location heading");
assert(cssSrc.includes("insight-location-count"), "CSS: location count");
assert(cssSrc.includes("overflow-wrap: anywhere"), "CSS: long text wrap");
assert(cssSrc.includes("prefers-reduced-motion"), "CSS: reduced motion");
const jiCss = cssSrc.slice(cssSrc.indexOf("P2-J-I"));
assert(jiCss.length > 0, "CSS: P2-J-I block");
assert(!/\bpurple\b|\bviolet\b|\bmagenta\b|\bpink\b/i.test(jiCss), "CSS: no purple/pink");

assert(checkSrc.includes("runStructureInsightPresentationCheck"), "check export");
assert(checkSrc.includes("examples collapsed"), "check: examples");
assert(checkSrc.includes("covered by location"), "check: path covered");
assert(checkSrc.includes("duplicate keeps path"), "check: duplicates");
assert(checkSrc.includes("no path invented from nodeId"), "check: no invent");
assert(checkSrc.includes("long name preserved"), "check: long names");
assert(!checkSrc.includes("Off.Dokumente"), "check: no private path");

assert(workbenchSrc.includes("runStructureInsightPresentationCheck"), "workbench wires J-I");
assert(!analysisSrc.includes("structureInsightPresentation"), "J-B unchanged");
assert(!ruleSrc.includes("structureInsightPresentation"), "P2-H unchanged");
assert(!confSrc.includes("structureInsightPresentation"), "P2-I unchanged");
assert(!vmSrc.includes("structureInsightPresentation"), "P2-J-A unchanged");
assert(filtersSrc.includes("filterInsightLocationSections"), "J-G retained");
assert(navSrc.includes("InsightFocusRequest"), "J-F retained");
assert(errorSrc.includes("INSIGHT_RETRY_LABEL"), "J-H retained");

const deps = JSON.parse(pkgSrc).dependencies ?? {};
assert(!deps["@tanstack/react-virtual"] && !deps["react-window"], "no new virtualization dep");

const checkUrl = pathToFileURL(join(rootDir, "src/ui/structureInsightPresentationCheck.ts")).href;
const { runStructureInsightPresentationCheck } = await import(checkUrl);
runStructureInsightPresentationCheck();

// Synthetic large ViewModel filter stress (in-memory only)
const filtersUrl = pathToFileURL(join(rootDir, "src/ui/structureInsightFilters.ts")).href;
const { filterInsightLocationSections, DEFAULT_INSIGHT_FILTER_STATE, countFilteredInsights } =
  await import(filtersUrl);
const vmUrl = pathToFileURL(join(rootDir, "src/ui/structureInsightViewModel.ts")).href;
const { STRUCTURE_INSIGHT_VIEW_MODEL_SCHEMA_VERSION } = await import(vmUrl);

const insights = [];
const locations = [];
for (let i = 0; i < 80; i += 1) {
  const locationId = `loc-${i}`;
  const ids = [];
  for (let j = 0; j < 3; j += 1) {
    const id = `c-${i}-${j}`;
    ids.push(id);
    insights.push({
      id,
      locationId,
      principle: "p",
      category: j === 0 ? "file-names" : j === 1 ? "time-years" : "folder-structure",
      categoryLabel: "x",
      title: `Titel ${i}-${j}`,
      factLine: `Fakt Gasag ${i}`,
      evidenceLevel: j === 0 ? "high" : "medium",
      evidenceLabel: "x",
      incompleteData: false,
      explanationBullets: [],
      structureSummary: { plainDescription: "", examples: [] },
      primaryElements: [],
      secondaryRecurringGroups: [],
      otherElements: [],
      searchText: `titel fakt gasag ${i} ${j}`,
    });
  }
  locations.push({
    locationId,
    kind: "folder",
    insightIds: ids,
    displayPathSegments: [
      { nodeId: "root", displayName: "Root" },
      { nodeId: locationId, displayName: `Ordner_${i}` },
    ],
  });
}
const largeVm = {
  schemaVersion: STRUCTURE_INSIGHT_VIEW_MODEL_SCHEMA_VERSION,
  locations,
  insights,
  countsByEvidence: { high: 80, medium: 160, low: 0, unassessed: 0, total: 240 },
  countsByCategory: {
    "file-names": 80,
    "folder-structure": 80,
    "time-years": 80,
    "file-distribution": 0,
  },
  globallyIncomplete: false,
};
const filtered = filterInsightLocationSections(largeVm, {
  ...DEFAULT_INSIGHT_FILTER_STATE,
  query: "gasag",
  evidence: "high",
});
assert(countFilteredInsights(filtered) === 80, "large filter high+gasag count");
assert(filtered[0]?.cards[0]?.id === "c-0-0", "large filter order stable");
const filteredAgain = filterInsightLocationSections(largeVm, {
  ...DEFAULT_INSIGHT_FILTER_STATE,
  query: "gasag",
  evidence: "high",
});
assert(
  filteredAgain.map((section) => section.cards.map((card) => card.id).join(",")).join("|") ===
    filtered.map((section) => section.cards.map((card) => card.id).join(",")).join("|"),
  "large filter deterministic",
);

console.log("structure insight p2ji checks passed");
