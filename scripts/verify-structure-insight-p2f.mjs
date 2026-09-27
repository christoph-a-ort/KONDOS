// P2-F: local file-type distribution insights (direct files under one parent).
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

const modelSrc = read("src/ui/structureFileTypeInsight.ts");
const checkSrc = read("src/ui/structureFileTypeInsightCheck.ts");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const insightSrc = read("src/ui/structureInsightModel.ts");
const fileNameSrc = read("src/ui/structureFileNameInsight.ts");
const appSrc = read("src/App.tsx");
const treeViewSrc = read("src/ui/TreeView.tsx");

assert(modelSrc.includes("buildStructureFileTypeInsight"), "model: builder");
assert(modelSrc.includes("FileTypeLocalContext"), "model: context");
assert(modelSrc.includes("FileTypeFeature"), "model: feature");
assert(modelSrc.includes("FileTypeDistribution"), "model: distribution");
assert(modelSrc.includes("file-type-structure"), "model: detector id");
assert(modelSrc.includes("local-direct-file-type-distribution"), "model: obs type");
assert(modelSrc.includes('category: "other"'), "model: category other");
assert(modelSrc.includes("claimsMissingElements: false"), "model: no missing claim");
assert(modelSrc.includes("ruleCandidates: []"), "model: empty rules");
assert(modelSrc.includes("suggestions: []"), "model: empty suggestions");
assert(modelSrc.includes("confirmedExceptions: []"), "model: empty exceptions");
assert(modelSrc.includes("counterEvidence: []"), "model: empty counter");
assert(modelSrc.includes(".toLowerCase()"), "model: locale-independent lower");
assert(!modelSrc.includes("toLocaleLowerCase("), "model: no toLocaleLowerCase");
assert(modelSrc.includes("compareFileTypeText"), "model: code-unit compare");
assert(!modelSrc.includes("localeCompare"), "model: no localeCompare");
assert(modelSrc.includes('listing === "read"'), "model: listing contract");
assert(modelSrc.includes("classifyFileTypeExtension"), "model: classifier");
assert(modelSrc.includes("typeCountsJson"), "model: typeCountsJson");
assert(!/\bDate\.now\s*\(/.test(modelSrc), "model: no Date.now");
assert(!modelSrc.includes("Math.random"), "model: no random");
assert(!modelSrc.includes("crypto.randomUUID") && !/\buuid\b/i.test(modelSrc), "model: no uuid");
assert(!modelSrc.includes("buildStructureComparisonContexts"), "model: no P2-B");
assert(!modelSrc.includes("siblings:"), "model: no sibling ids");
assert(modelSrc.includes("parent.children.filter(isFile)"), "model: direct files");
assert(!modelSrc.includes("structureFileNameInsight"), "model: no P2-E import");
assert(!modelSrc.includes("fileExtensionKey"), "model: no displayFilter helper");
assert(!modelSrc.includes("parseStructureTime"), "model: no P2-C");

const modelWithoutGuard = modelSrc.replace(
  /export function structureFileTypeResultHasForbiddenClaims[\s\S]*?^}/m,
  "",
);
assert(!modelWithoutGuard.includes("mostFrequent"), "model: no mostFrequent outside guard");
assert(!modelWithoutGuard.includes("dominantType"), "model: no dominantType outside guard");
assert(
  !/\bshouldRename\b|\bwrongType\b|\brequiredType\b|\bshouldConvert\b|\bmissingToken\b/.test(modelWithoutGuard),
  "model: no rule keys outside guard",
);

assert(checkSrc.includes("runStructureFileTypeInsightCheck"), "check exported");
assert(checkSrc.includes("FALL A") || checkSrc.includes("0 files"), "check: A");
assert(checkSrc.includes("1 PDF") || checkSrc.includes("FALL B"), "check: B");
assert(checkSrc.includes("2 PDF") || checkSrc.includes("FALL C"), "check: C");
assert(checkSrc.includes("xlsx"), "check: D");
assert(checkSrc.includes(".PDF") || checkSrc.includes("PDF"), "check: E");
assert(checkSrc.includes("README"), "check: F");
assert(checkSrc.includes(".datei"), "check: G");
assert(checkSrc.includes("datei."), "check: H");
assert(checkSrc.includes("archiv.tar.gz"), "check: I");
assert(checkSrc.includes("10000") || checkSrc.includes("10_000"), "check: Q");
assert(checkSrc.includes("incomplete"), "check: L");
assert(checkSrc.includes("structureFileTypeInsightJsonRoundTrip"), "check: N");
assert(checkSrc.includes("observationClaimsMissingElements"), "check: P");
assert(checkSrc.includes("null last") || checkSrc.includes("null"), "check: V/U");
assert(!checkSrc.includes("Off.Dokumente"), "check: no private path");
assert(!checkSrc.includes("BahnCard"), "check: no private names");

assert(workbenchSrc.includes("runStructureFileTypeInsightCheck"), "workbench wires P2-F");
assert(insightSrc.includes("StructureInsightObservation"), "P2-A present");
assert(fileNameSrc.includes("buildStructureFileNameInsight"), "P2-E present unchanged path");
assert(!appSrc.includes("structureFileTypeInsight"), "App unchanged");
assert(!treeViewSrc.includes("structureFileTypeInsight"), "TreeView unchanged");
assert(!treeViewSrc.includes("FileTypeDistribution"), "TreeView no file-type types");

{
  const sample = {
    schemaVersion: 1,
    contexts: [{ id: "files:p", evaluable: true, comparisonPossible: true, totalCount: 2 }],
    features: [{ extensionKey: ".pdf", hasExtension: true }],
    distributions: [
      {
        comparisonContextId: "files:p",
        distinctTypeCount: 1,
        typeCounts: [{ extensionKey: ".pdf", count: 2 }],
      },
    ],
    insight: {
      observations: [
        {
          id: "obs:file-type-structure:local-direct-file-type-distribution:files:p",
          category: "other",
          observationType: "local-direct-file-type-distribution",
          matchedCount: 2,
          counterEvidence: [],
          patternFeatures: {
            claimsMissingElements: false,
            typeCountsJson: JSON.stringify([{ extensionKey: ".pdf", count: 2 }]),
            distinctTypeCount: 1,
            comparisonContextId: "files:p",
          },
        },
      ],
      ruleCandidates: [],
      suggestions: [],
      confirmedExceptions: [],
    },
  };
  assert(sample.insight.ruleCandidates.length === 0, "shape O");
  assert(sample.insight.observations[0].patternFeatures.claimsMissingElements === false, "shape P");
  assert(sample.insight.observations[0].counterEvidence.length === 0, "shape counter");
  assert(!JSON.stringify(sample).includes("mostFrequent"), "shape no mostFrequent");
  const parsed = JSON.parse(sample.insight.observations[0].patternFeatures.typeCountsJson);
  assert(parsed[0].extensionKey === ".pdf" && parsed[0].count === 2, "shape T");
}

console.log("structure insight p2f checks passed");
