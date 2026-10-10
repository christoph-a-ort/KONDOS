// P2-J-F: Bidirectional insight ↔ tree navigation and folder markers.
// No filter/search/retry/rating. No H/I/J-A mutation.

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

const navSrc = read("src/ui/structureInsightNavigation.ts");
const checkSrc = read("src/ui/structureInsightNavigationCheck.ts");
const appSrc = read("src/App.tsx");
const treeSrc = read("src/ui/TreeView.tsx");
const viewSrc = read("src/ui/StructureInsightsView.tsx");
const cardSrc = read("src/ui/InsightCard.tsx");
const detailsSrc = read("src/ui/InsightCardDetails.tsx");
const cssSrc = read("src/App.css");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const analysisSrc = read("src/ui/structureInsightAnalysis.ts");
const ruleSrc = read("src/ui/structureRuleCandidate.ts");
const confSrc = read("src/ui/structureConfidenceAssessment.ts");
const vmSrc = read("src/ui/structureInsightViewModel.ts");
const pkgSrc = read("package.json");

assert(navSrc.includes("buildFolderInsightIdsByLocation"), "nav: index");
assert(navSrc.includes("insightMarkerTooltip"), "nav: tooltip");
assert(navSrc.includes("TreeRevealRequest"), "nav: tree reveal");
assert(navSrc.includes("InsightFocusRequest"), "nav: insight focus");
assert(navSrc.includes("canNavigateToScanNode"), "nav: can navigate");
assert(navSrc.includes("Im Strukturbaum anzeigen"), "nav: show in tree");
assert(!navSrc.includes(".sort("), "nav: no sort");
assert(!navSrc.includes("buildStructureRuleCandidateInsight"), "nav: no H");
assert(!navSrc.includes("buildStructureConfidenceInsight"), "nav: no I");
assert(!navSrc.includes("buildStructureInsightViewModel"), "nav: no J-A");

assert(appSrc.includes("requestRevealInTree"), "App: reveal");
assert(appSrc.includes("requestShowInsightsForLocation"), "App: marker→insights");
assert(appSrc.includes("clearInsightNavigationState"), "App: clear nav");
assert(appSrc.includes("treeRevealRequest"), "App: tree request state");
assert(appSrc.includes("insightFocusRequest"), "App: focus request state");
assert(appSrc.includes("folderInsightIdsByLocation"), "App: marker map");
assert(appSrc.includes("onNavigateToNode"), "App: navigate prop");

assert(treeSrc.includes("revealRequest"), "Tree: reveal prop");
assert(treeSrc.includes("insight-tree-marker"), "Tree: marker class");
assert(treeSrc.includes("onInsightMarkerActivate"), "Tree: marker handler");
assert(treeSrc.includes("stopPropagation"), "Tree: marker stopPropagation");
assert(treeSrc.includes("shouldAcceptTreeRevealRequest"), "Tree: stale guard");
assert(treeSrc.includes("revealTreeNode"), "Tree: reveal helper");

assert(viewSrc.includes("onNavigateToNode"), "View: navigate");
assert(viewSrc.includes("focusRequest"), "View: focus");
assert(viewSrc.includes("insight-location-path-segment"), "View: breadcrumb buttons");
assert(viewSrc.includes("highlightedInsightId") || viewSrc.includes("highlighted"), "View: highlight");

assert(cardSrc.includes("INSIGHT_SHOW_IN_TREE_LABEL") || cardSrc.includes("Im Strukturbaum anzeigen"), "Card: tree action");
assert(cardSrc.includes("onNavigateToLocation"), "Card: location nav");
assert(detailsSrc.includes("onNavigateToNode"), "Details: element nav");
assert(detailsSrc.includes("insight-detail-element-nav"), "Details: element button");

assert(cssSrc.includes(".insight-tree-marker"), "CSS: marker");
assert(cssSrc.includes(".insight-card--highlighted"), "CSS: highlight");
assert(cssSrc.includes(".insight-location-path-segment"), "CSS: path segment");
const jfCss = cssSrc.slice(cssSrc.indexOf("P2-J-F"));
assert(jfCss.length > 0, "CSS: P2-J-F block");
assert(!/\bpurple\b|\bviolet\b|\bmagenta\b|\bpink\b/i.test(jfCss), "CSS: no purple/pink");

assert(checkSrc.includes("runStructureInsightNavigationCheck"), "check export");
assert(checkSrc.includes("no child aggregation"), "check: no aggregation");
assert(checkSrc.includes("tooltip singular"), "check: tooltip");
assert(checkSrc.includes("reject stale scan reveal"), "check: stale");
assert(!checkSrc.includes("Off.Dokumente"), "check: no private path");

assert(workbenchSrc.includes("runStructureInsightNavigationCheck"), "workbench wires J-F");
assert(!analysisSrc.includes("structureInsightNavigation"), "J-B unchanged");
assert(!ruleSrc.includes("structureInsightNavigation"), "P2-H unchanged");
assert(!confSrc.includes("structureInsightNavigation"), "P2-I unchanged");
assert(!vmSrc.includes("structureInsightNavigation"), "P2-J-A unchanged");
assert(!viewSrc.includes("Filter"), "view: no Filter");
assert(!viewSrc.includes("Suche"), "view: no Suche");
assert(!viewSrc.includes("retryInsightAnalysis"), "view: no retry");
assert(!cardSrc.includes("Bestätigen"), "card: no rating");

const deps = JSON.parse(pkgSrc).dependencies ?? {};
assert(!deps["react-router"] && !deps["react-router-dom"], "no router dep");

const checkUrl = pathToFileURL(join(rootDir, "src/ui/structureInsightNavigationCheck.ts")).href;
const { runStructureInsightNavigationCheck } = await import(checkUrl);
runStructureInsightNavigationCheck();

console.log("structure insight p2jf checks passed");
