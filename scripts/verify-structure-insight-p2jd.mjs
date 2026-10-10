// P2-J-D: Location groups + compact insight cards.
// ViewModel is the only data source. No J-E lists, no tree nav, no filter/search/retry.

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

const viewSrc = read("src/ui/StructureInsightsView.tsx");
const cardSrc = read("src/ui/InsightCard.tsx");
const helpersSrc = read("src/ui/structureInsightCardsHelpers.ts");
const checkSrc = read("src/ui/structureInsightCardsCheck.ts");
const cssSrc = read("src/App.css");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const appSrc = read("src/App.tsx");
const treeViewSrc = read("src/ui/TreeView.tsx");
const analysisSrc = read("src/ui/structureInsightAnalysis.ts");
const ruleSrc = read("src/ui/structureRuleCandidate.ts");
const confSrc = read("src/ui/structureConfidenceAssessment.ts");
const vmSrc = read("src/ui/structureInsightViewModel.ts");
const pkgSrc = read("package.json");

assert(helpersSrc.includes("listInsightLocationSections"), "helpers: list sections");
assert(helpersSrc.includes("resolveLocationInsightCards"), "helpers: resolve cards");
assert(helpersSrc.includes("formatInsightLocationHeading"), "helpers: path heading");
assert(helpersSrc.includes("buildInsightCardLookup"), "helpers: lookup map");
assert(helpersSrc.includes("INSIGHT_INCOMPLETE_CARD_NOTE"), "helpers: incomplete note");
assert(helpersSrc.includes("Datengrundlage eingeschränkt"), "helpers: incomplete wording");
assert(helpersSrc.includes("Details anzeigen"), "helpers: show details");
assert(helpersSrc.includes("Details ausblenden"), "helpers: hide details");
assert(helpersSrc.includes(" › "), "helpers: breadcrumb sep");
assert(helpersSrc.includes("insightViewModelExpansionKey"), "helpers: expansion key");
assert(!helpersSrc.includes(".sort("), "helpers: no sort");
assert(!helpersSrc.includes("buildStructureRuleCandidateInsight"), "helpers: no P2-H");
assert(!helpersSrc.includes("buildStructureConfidenceInsight"), "helpers: no P2-I");
assert(!helpersSrc.includes("buildStructureInsightViewModel"), "helpers: no J-A builder");

assert(cardSrc.includes("export function InsightCard"), "card export");
assert(cardSrc.includes("card.title"), "card: title");
assert(cardSrc.includes("card.factLine"), "card: factLine");
assert(cardSrc.includes("card.categoryLabel"), "card: categoryLabel");
assert(cardSrc.includes("card.evidenceLabel"), "card: evidenceLabel");
assert(cardSrc.includes("Evidenz:"), "card: evidence prefix");
assert(cardSrc.includes("INSIGHT_INCOMPLETE_CARD_NOTE"), "card: incomplete");
assert(cardSrc.includes("aria-expanded"), "card: aria-expanded");
assert(cardSrc.includes('type="button"'), "card: button");
assert(cardSrc.includes("aria-controls"), "card: aria-controls");
// J-D compact shell; J-E details live in InsightCardDetails.
assert(cardSrc.includes("InsightCardDetails") || cardSrc.includes("insight-card-details"), "card: details region");
assert(cardSrc.includes("Details anzeigen") || cardSrc.includes("INSIGHT_DETAILS_SHOW_LABEL"), "card: details toggle");
assert(!cardSrc.includes("explanationBullets"), "card shell: no bullets");
assert(!cardSrc.includes("primaryElements"), "card shell: no primary");
assert(!cardSrc.includes("secondaryRecurringGroups"), "card shell: no secondary");
assert(!cardSrc.includes("otherElements"), "card shell: no other");
assert(!cardSrc.includes("structureSummary.examples"), "card shell: no examples field");
assert(!cardSrc.toLowerCase().includes("confidenceScore"), "card: no score");
assert(!/%/.test(cardSrc), "card: no percent");

assert(viewSrc.includes("InsightCard"), "view: InsightCard");
assert(viewSrc.includes("listInsightLocationSections"), "view: sections");
assert(viewSrc.includes("insight-location"), "view: location class");
assert(viewSrc.includes("formatInsightLocationHeading"), "view: heading");
assert(viewSrc.includes("expandedIds"), "view: local expand state");
assert(viewSrc.includes("insightViewModelExpansionKey"), "view: expansion reset");
assert(!viewSrc.includes(".sort("), "view: no sort");
assert(!/onClick=\{[^}]*scrollIntoView|selectTree|focusTree|expandTree/i.test(viewSrc), "view: no tree nav");
assert(!viewSrc.includes("Filter"), "view: no Filter");
assert(!viewSrc.includes("Suche"), "view: no Suche");
assert(!viewSrc.includes("Alle Details"), "view: no Alle Details");
assert(!viewSrc.includes("Bestätigen"), "view: no rating");
assert(!viewSrc.includes("Ablehnen"), "view: no rating reject");
assert(!viewSrc.includes("retryInsightAnalysis"), "view: no retry");
assert(!viewSrc.includes("buildStructureInsightViewModel"), "view: no J-A");
assert(!viewSrc.includes("buildStructureRuleCandidateInsight"), "view: no H");
assert(!viewSrc.includes("buildStructureConfidenceInsight"), "view: no I");
assert(!viewSrc.includes("invoke("), "view: no invoke");
assert(!viewSrc.includes("fs."), "view: no fs");

assert(cssSrc.includes(".insight-location"), "CSS: location");
assert(cssSrc.includes(".insight-location-path"), "CSS: path");
assert(cssSrc.includes(".insight-card"), "CSS: card");
assert(cssSrc.includes(".insight-card-category"), "CSS: category");
assert(cssSrc.includes(".insight-card-title"), "CSS: title");
assert(cssSrc.includes(".insight-card-fact"), "CSS: fact");
assert(cssSrc.includes(".insight-card-evidence"), "CSS: evidence");
assert(cssSrc.includes(".insight-card-details-toggle"), "CSS: details toggle");
assert(cssSrc.includes(".insight-card-details"), "CSS: details");
assert(cssSrc.includes(".insight-card-incomplete"), "CSS: incomplete");
assert(cssSrc.includes("insight-card--file-names"), "CSS: file-names");
assert(cssSrc.includes("insight-card--folder-structure"), "CSS: folder");
assert(cssSrc.includes("insight-card--time-years"), "CSS: time");
assert(cssSrc.includes("insight-card--file-distribution"), "CSS: distribution");
assert(cssSrc.includes("insight-card-details-toggle:focus-visible"), "CSS: focus visible");
const jdCssStart = cssSrc.indexOf(".insight-locations");
assert(jdCssStart >= 0, "CSS: insight-locations block");
const jdCss = cssSrc.slice(jdCssStart);
assert(!/\bpurple\b|\bviolet\b|\bmagenta\b|\bpink\b/i.test(jdCss), "CSS: no purple/pink tokens");
assert(!/#(?:7|8|9|a|b|c|d|e|f)[0-9a-f]{2}[89a-f][0-9a-f]{2}ff/i.test(jdCss), "CSS: no purple-ish hex");

assert(checkSrc.includes("runStructureInsightCardsCheck"), "check export");
assert(checkSrc.includes("missing insightId skipped"), "check: missing id");
assert(checkSrc.includes("root uses rootContextLabel"), "check: root");
assert(checkSrc.includes("folder uses displayPathSegments"), "check: path");
assert(checkSrc.includes("title unchanged"), "check: title");
assert(checkSrc.includes("factLine unchanged"), "check: fact");
assert(checkSrc.includes("no sort") || !checkSrc.includes(".sort("), "check: no sort logic");
assert(!checkSrc.includes("Off.Dokumente"), "check: no private path");

assert(workbenchSrc.includes("runStructureInsightCardsCheck"), "workbench wires J-D");

assert(!treeViewSrc.includes("InsightCard"), "TreeView: no InsightCard");
assert(!treeViewSrc.includes("insight-card"), "TreeView: no insight-card");
assert(!treeViewSrc.includes("Erkenntnis"), "TreeView: no markers");
assert(!appSrc.includes("buildStructureInsightViewModel"), "App: no direct J-A");
assert(!analysisSrc.includes("InsightCard"), "J-B unchanged by cards");
assert(!ruleSrc.includes("InsightCard"), "P2-H unchanged");
assert(!confSrc.includes("InsightCard"), "P2-I unchanged");
assert(!vmSrc.includes("insight-card"), "P2-J-A no card CSS");
assert(!vmSrc.includes("InsightCard.tsx"), "P2-J-A no card component");

const deps = JSON.parse(pkgSrc).dependencies ?? {};
const devDeps = JSON.parse(pkgSrc).devDependencies ?? {};
assert(!deps["lucide-react"] && !devDeps["lucide-react"], "no lucide");
assert(!deps["react-icons"] && !devDeps["react-icons"], "no react-icons");
assert(!deps["@mui/icons-material"] && !devDeps["@mui/icons-material"], "no mui icons");

// Path interaction: location path is display-only (no onClick on path heading)
assert(!viewSrc.includes("insight-location-path") || !/insight-location-path[\s\S]{0,200}onClick/.test(viewSrc), "path not interactive");
assert(!cardSrc.includes("onClick") || cardSrc.includes("onToggleDetails"), "card click is details only");

const checkUrl = pathToFileURL(join(rootDir, "src/ui/structureInsightCardsCheck.ts")).href;
const { runStructureInsightCardsCheck } = await import(checkUrl);
runStructureInsightCardsCheck();

console.log("structure insight p2jd checks passed");
