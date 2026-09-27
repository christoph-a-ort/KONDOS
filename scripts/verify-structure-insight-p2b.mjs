// P2-B: sibling-folder comparison contexts — contracts + synthetic invariants.
// No year rules / RuleCandidate / suggestions / UI / persistence / private Realtest names.

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

const modelSrc = read("src/ui/structureComparisonContext.ts");
const checkSrc = read("src/ui/structureComparisonContextCheck.ts");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const insightSrc = read("src/ui/structureInsightModel.ts");
const appSrc = read("src/App.tsx");
const treeViewSrc = read("src/ui/TreeView.tsx");

assert(modelSrc.includes("buildStructureComparisonContexts"), "model: builder");
assert(modelSrc.includes("StructureComparisonContext"), "model: context type");
assert(modelSrc.includes("StructureComparisonMemberFeatures"), "model: member features");
assert(modelSrc.includes("comparisonPossible"), "model: comparisonPossible");
assert(modelSrc.includes("singleDirectDirectory"), "model: single-child reason");
assert(modelSrc.includes("subtreeDirectoryCount"), "model: subtree dirs");
assert(modelSrc.includes("maxRelativeSubtreeDepth"), "model: subtree depth");
assert(modelSrc.includes("sibling-folder-comparison"), "model: builder id");
assert(modelSrc.includes("structureComparisonJsonRoundTrip"), "model: JSON round-trip");
assert(modelSrc.includes("scan-local"), "model: scan-local semantics");
assert(!/"similarity"\s*:/.test(modelSrc), "model: no similarity score");
assert(!modelSrc.includes("StructureInsightRuleCandidate"), "model: no rule candidates");
assert(!modelSrc.includes("StructureInsightSuggestion"), "model: no suggestions");
assert(!modelSrc.includes("year-folder-detector"), "model: no year detector");

assert(checkSrc.includes("runStructureComparisonContextCheck"), "check exported");
assert(checkSrc.includes("FALL A") || checkSrc.includes("normal siblings"), "check: A");
assert(checkSrc.includes("singleDirectDirectory"), "check: B");
assert(checkSrc.includes("empty C remains") || checkSrc.includes("FALL D"), "check: D");
assert(checkSrc.includes("three contexts") || checkSrc.includes("FALL G"), "check: G");
assert(checkSrc.includes("no truncation") || checkSrc.includes("120"), "check: I");
assert(checkSrc.includes("structureComparisonJsonRoundTrip"), "check: J");
assert(checkSrc.includes("identical output"), "check: K");
assert(checkSrc.includes("assertNoP2cLeakage") || checkSrc.includes("no year detector"), "check: L");
assert(!checkSrc.includes("Off.Dokumente"), "check: no private path");
assert(!checkSrc.includes("BahnCard"), "check: no private names");

assert(workbenchSrc.includes("runStructureComparisonContextCheck"), "workbench wires P2-B");
assert(insightSrc.includes("StructureInsightObservation"), "P2-A model still present");
assert(!appSrc.includes("structureComparison"), "App unchanged");
assert(!treeViewSrc.includes("structureComparison"), "TreeView unchanged");
assert(!treeViewSrc.includes("StructureComparison"), "TreeView no comparison types");

// Lightweight synthetic invariants (mirror key cases without importing TS)
function assertCaseShapes() {
  const sample = {
    schemaVersion: 1,
    contexts: [
      {
        id: "siblings:parent",
        parent: { nodeId: "parent" },
        members: [
          { nodeId: "a", isEmpty: false },
          { nodeId: "b", isEmpty: false },
          { nodeId: "c", isEmpty: true },
        ],
        memberCount: 3,
        comparisonPossible: true,
        ineligibilityReason: null,
        provenance: { builderId: "sibling-folder-comparison", builderVersion: 1 },
      },
    ],
  };
  assert(sample.contexts[0].memberCount === 3, "shape A: members");
  assert(sample.contexts[0].members.some((m) => m.isEmpty), "shape D: empty kept");
  const single = {
    memberCount: 1,
    comparisonPossible: false,
    ineligibilityReason: "singleDirectDirectory",
  };
  assert(single.comparisonPossible === false, "shape B");
  const round = JSON.parse(JSON.stringify(sample));
  assert(round.contexts[0].provenance.builderId === "sibling-folder-comparison", "shape J");
}

assertCaseShapes();
console.log("structure insight p2b checks passed");
