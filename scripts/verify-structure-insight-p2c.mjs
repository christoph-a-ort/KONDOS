// P2-C: year/time structure detection → StructureInsightObservation.
// No RuleCandidates / Suggestions / confirmedExceptions / UI / persistence / private Realtest names.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return readFileSync(join(rootDir, rel), "utf8");
}

const modelSrc = read("src/ui/structureTimeInsight.ts");
const checkSrc = read("src/ui/structureTimeInsightCheck.ts");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const insightSrc = read("src/ui/structureInsightModel.ts");
const comparisonSrc = read("src/ui/structureComparisonContext.ts");
const inventoryYearSrc = read("src/ui/inventoryStructureContext.ts");
const appSrc = read("src/App.tsx");
const treeViewSrc = read("src/ui/TreeView.tsx");

assert(modelSrc.includes("buildStructureTimeInsight"), "model: builder");
assert(modelSrc.includes("StructureTimeFeature"), "model: feature type");
assert(modelSrc.includes("year-time-structure"), "model: detector id");
assert(modelSrc.includes("STRUCTURE_TIME_YEAR_MIN = 1900"), "model: year min");
assert(modelSrc.includes("STRUCTURE_TIME_YEAR_MAX = 2199"), "model: year max");
assert(modelSrc.includes("parseDirectStructureTimeName"), "model: direct parse");
assert(modelSrc.includes("parseContextualMonthName"), "model: contextual month");
assert(modelSrc.includes("yearMonth"), "model: yearMonth kind");
assert(modelSrc.includes("yearRange"), "model: yearRange kind");
assert(modelSrc.includes("claimsMissingElements: false"), "model: no missing claims");
assert(modelSrc.includes("ruleCandidates: []"), "model: empty rules");
assert(modelSrc.includes("suggestions: []"), "model: empty suggestions");
assert(modelSrc.includes("confirmedExceptions: []"), "model: empty exceptions");
assert(!/\bDate\.now\s*\(/.test(modelSrc), "model: no Date.now in detector");
assert(!/"confidenceScore"\s*:/.test(modelSrc), "model: no confidenceScore");
assert(!/"shouldExist"\s*:/.test(modelSrc), "model: no shouldExist field");
assert(!/"missingFolder"\s*:/.test(modelSrc), "model: no missingFolder field");
assert(!/"createFolder"\s*:/.test(modelSrc), "model: no createFolder field");
assert(!/"requiredYear"\s*:/.test(modelSrc), "model: no requiredYear field");
assert(!/"requiredMonth"\s*:/.test(modelSrc), "model: no requiredMonth field");
assert(modelSrc.includes("StructureInsightObservation") || modelSrc.includes("observations"), "model: observations");

assert(checkSrc.includes("runStructureTimeInsightCheck"), "check exported");
assert(checkSrc.includes("FALL A") || checkSrc.includes("reines Jahr"), "check: A");
assert(checkSrc.includes("2025-00"), "check: B invalid month");
assert(checkSrc.includes("01-2025"), "check: C");
assert(checkSrc.includes("Q0 2025"), "check: D invalid");
assert(checkSrc.includes("2024-2025"), "check: E");
assert(checkSrc.includes("Archiv 2023"), "check: F");
assert(checkSrc.includes("Projekt"), "check: G/H context");
assert(checkSrc.includes("recurring"), "check: J");
assert(checkSrc.includes("absentYearsInObservedSpan"), "check: K");
assert(checkSrc.includes("mixed-time-kinds"), "check: L");
assert(checkSrc.includes("peer-areas-direct-year-children"), "check: M");
assert(checkSrc.includes("2027"), "check: N");
assert(checkSrc.includes("structureTimeInsightJsonRoundTrip"), "check: O");
assert(checkSrc.includes("identical serialized output"), "check: P");
assert(checkSrc.includes("no RuleCandidate") || checkSrc.includes("no rules"), "check: Q");
assert(!checkSrc.includes("Off.Dokumente"), "check: no private path");
assert(!checkSrc.includes("BahnCard"), "check: no private names");

assert(workbenchSrc.includes("runStructureTimeInsightCheck"), "workbench wires P2-C");
assert(insightSrc.includes("StructureInsightObservation"), "P2-A still present");
assert(comparisonSrc.includes("buildStructureComparisonContexts"), "P2-B still present");
assert(inventoryYearSrc.includes("YEAR_FOLDER_MAX = 2100"), "inventory year bounds unchanged");
assert(!appSrc.includes("structureTimeInsight"), "App unchanged");
assert(!treeViewSrc.includes("structureTimeInsight"), "TreeView unchanged");
assert(!treeViewSrc.includes("StructureTime"), "TreeView no time types");

// Lightweight synthetic invariants (mirror key contracts without importing TS)
{
  assert(1900 <= 2025 && 2025 <= 2199, "bounds: 2025 in range");
  assert(!(1899 >= 1900 && 1899 <= 2199), "bounds: 1899 out");
  assert(!(2200 >= 1900 && 2200 <= 2199), "bounds: 2200 out");

  const sample = {
    schemaVersion: 1,
    features: [
      {
        nodeId: "n1",
        name: "2025",
        recognitionMode: "direct",
        patternId: "exact-year",
        values: { kind: "year", year: 2025 },
        provenance: { detectorId: "year-time-structure", detectorVersion: 1 },
      },
    ],
    insight: {
      schemaVersion: 1,
      observations: [
        {
          id: "obs:year-time-structure:year-features-among-peers:siblings:p",
          observationType: "year-features-among-peers",
          matchedCount: 4,
          totalCount: 4,
          patternFeatures: { claimsMissingElements: false, recurring: true },
          provenance: { detectorId: "year-time-structure", detectorVersion: 1 },
        },
      ],
      ruleCandidates: [],
      suggestions: [],
      confirmedExceptions: [],
    },
  };
  assert(sample.insight.ruleCandidates.length === 0, "shape Q: rules");
  assert(sample.insight.suggestions.length === 0, "shape Q: suggestions");
  assert(sample.insight.confirmedExceptions.length === 0, "shape Q: exceptions");
  assert(sample.insight.observations[0].patternFeatures.claimsMissingElements === false, "shape K/Q");
  const round = JSON.parse(JSON.stringify(sample));
  assert(round.features[0].values.year === 2025, "shape O");
  assert(round.insight.observations[0].id.startsWith("obs:year-time-structure:"), "shape P ids");
}

console.log("structure insight p2c checks passed");
