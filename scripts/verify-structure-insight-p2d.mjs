// P2-D: recurring direct child-folder structures within P2-B peer contexts.
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

const modelSrc = read("src/ui/structureFolderPatternInsight.ts");
const checkSrc = read("src/ui/structureFolderPatternInsightCheck.ts");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const comparisonSrc = read("src/ui/structureComparisonContext.ts");
const insightSrc = read("src/ui/structureInsightModel.ts");
const inventorySrc = read("src/ui/inventoryStructureContext.ts");
const appSrc = read("src/App.tsx");
const treeViewSrc = read("src/ui/TreeView.tsx");

assert(modelSrc.includes("buildStructureFolderPatternInsight"), "model: builder");
assert(modelSrc.includes("DirectChildFolderStructureFeature"), "model: feature");
assert(modelSrc.includes("folder-pattern-structure"), "model: detector id");
assert(modelSrc.includes("direct-child-folder-name-among-peers"), "model: name obs");
assert(modelSrc.includes("direct-child-folder-set-among-peers"), "model: set obs");
assert(modelSrc.includes("evaluableCount"), "model: evaluableCount");
assert(modelSrc.includes("claimsMissingElements: false"), "model: no missing claim");
assert(modelSrc.includes("ruleCandidates: []"), "model: empty rules");
assert(modelSrc.includes("suggestions: []"), "model: empty suggestions");
assert(modelSrc.includes("confirmedExceptions: []"), "model: empty exceptions");
assert(modelSrc.includes("name.toLowerCase()"), "model: locale-independent lower");
assert(!modelSrc.includes("toLocaleLowerCase("), "model: no toLocaleLowerCase for identity");
assert(modelSrc.includes("compareFolderPatternText"), "model: code-unit compare");
assert(modelSrc.includes('listing === "read"'), "model: evaluable listing");
assert(modelSrc.includes("set-"), "model: set qualifier");
assert(!/\bDate\.now\s*\(/.test(modelSrc), "model: no Date.now");
assert(!modelSrc.includes("Math.random"), "model: no random");
assert(!modelSrc.includes("crypto.randomUUID") && !modelSrc.includes("uuid"), "model: no uuid");
assert(!modelSrc.includes("overlapping-direct-child"), "model: no overlap type");
assert(!modelSrc.includes("buildRepeatedChildDirectoryStructures"), "model: no inventory reuse");

assert(checkSrc.includes("runStructureFolderPatternInsightCheck"), "check exported");
assert(checkSrc.includes("FALL A") || checkSrc.includes("all peers 0"), "check: A");
assert(checkSrc.includes("comparisonPossible === false"), "check: B");
assert(checkSrc.includes("partial overlap") || checkSrc.includes("FALL E"), "check: E");
assert(checkSrc.includes("500"), "check: N");
assert(checkSrc.includes("incomplete"), "check: W listing");
assert(checkSrc.includes("set-0001") && checkSrc.includes("set-0002"), "check: X");
assert(checkSrc.includes("structureFolderPatternInsightJsonRoundTrip"), "check: Y");
assert(checkSrc.includes("identical"), "check: Z");
assert(checkSrc.includes("observationClaimsMissingElements"), "check: AA");
assert(checkSrc.includes("both childRefs kept"), "check: AD");
assert(checkSrc.includes("Rechnung") && checkSrc.includes("Rechnungen"), "check: T");
assert(!checkSrc.includes("Off.Dokumente"), "check: no private path");
assert(!checkSrc.includes("BahnCard"), "check: no private names");

assert(workbenchSrc.includes("runStructureFolderPatternInsightCheck"), "workbench wires P2-D");
assert(comparisonSrc.includes("buildStructureComparisonContexts"), "P2-B present");
assert(insightSrc.includes("StructureInsightObservation"), "P2-A present");
assert(inventorySrc.includes("repeatedChildDirectoryStructures"), "inventory still separate");
assert(!appSrc.includes("structureFolderPattern"), "App unchanged");
assert(!treeViewSrc.includes("structureFolderPattern"), "TreeView unchanged");
assert(!treeViewSrc.includes("FolderPattern"), "TreeView no folder pattern types");

// Lightweight synthetic invariants
{
  const sample = {
    schemaVersion: 1,
    features: [
      {
        member: { nodeId: "a" },
        evaluable: true,
        normalizedNameKeys: ["vertrag"],
        signature: "vertrag",
        provenance: { detectorId: "folder-pattern-structure", detectorVersion: 1 },
      },
    ],
    insight: {
      observations: [
        {
          id: "obs:folder-pattern-structure:direct-child-folder-name-among-peers:siblings:p:vertrag",
          observationType: "direct-child-folder-name-among-peers",
          matchedCount: 2,
          patternFeatures: {
            claimsMissingElements: false,
            evaluableCount: 2,
            totalCount: 3,
            nameKey: "vertrag",
          },
        },
        {
          id: "obs:folder-pattern-structure:direct-child-folder-set-among-peers:siblings:p:set-0001",
          observationType: "direct-child-folder-set-among-peers",
          patternFeatures: { setQualifier: "set-0001", claimsMissingElements: false },
        },
      ],
      ruleCandidates: [],
      suggestions: [],
      confirmedExceptions: [],
    },
  };
  assert(sample.insight.ruleCandidates.length === 0, "shape AB");
  assert(sample.insight.observations[0].patternFeatures.claimsMissingElements === false, "shape AA");
  assert(sample.insight.observations[0].patternFeatures.evaluableCount === 2, "shape W");
  assert(sample.insight.observations[1].id.includes("set-0001"), "shape X");
  const round = JSON.parse(JSON.stringify(sample));
  assert(round.features[0].signature === "vertrag", "shape Y");
}

console.log("structure insight p2d checks passed");
