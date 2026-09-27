// P2-G: parallel structure insights within P2-B sibling contexts.
// No RuleCandidates / Suggestions / confirmedExceptions / UI / persistence / private Realtest names.
// No folder-set observations (P2-D). No fuzzy similarity. No P2-H rules.

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

const modelSrc = read("src/ui/structureParallelInsight.ts");
const checkSrc = read("src/ui/structureParallelInsightCheck.ts");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const insightSrc = read("src/ui/structureInsightModel.ts");
const fileNameSrc = read("src/ui/structureFileNameInsight.ts");
const fileTypeSrc = read("src/ui/structureFileTypeInsight.ts");
const folderSrc = read("src/ui/structureFolderPatternInsight.ts");
const appSrc = read("src/App.tsx");
const treeViewSrc = read("src/ui/TreeView.tsx");

assert(modelSrc.includes("buildStructureParallelInsight"), "model: builder");
assert(modelSrc.includes("ParallelStructureProfile"), "model: profile");
assert(modelSrc.includes("parallel-structure"), "model: detector id");
assert(modelSrc.includes("parallel-file-type-bucket-group"), "model: type obs");
assert(modelSrc.includes("parallel-file-name-form-set-group"), "model: form obs");
assert(modelSrc.includes("claimsMissingElements: false"), "model: no missing claim");
assert(modelSrc.includes("ruleCandidates: []"), "model: empty rules");
assert(modelSrc.includes("suggestions: []"), "model: empty suggestions");
assert(modelSrc.includes("confirmedExceptions: []"), "model: empty exceptions");
assert(modelSrc.includes("counterEvidence: []"), "model: empty counter");
assert(modelSrc.includes("buildFileTypeBucketSignature"), "model: bucket sig");
assert(modelSrc.includes("buildFileNameFormSetSignature"), "model: form set sig");
assert(modelSrc.includes("JSON.stringify"), "model: structured JSON signatures");
assert(modelSrc.includes("compareParallelText"), "model: UTF-16 compare");
assert(!modelSrc.includes("localeCompare"), "model: no localeCompare");
assert(!modelSrc.includes("toLocaleLowerCase("), "model: no toLocaleLowerCase");
assert(modelSrc.includes("buildStructureComparisonContexts"), "model: uses P2-B");
assert(modelSrc.includes("buildStructureFileNameInsight"), "model: uses P2-E");
assert(modelSrc.includes("buildStructureFileTypeInsight"), "model: uses P2-F");
assert(modelSrc.includes("siblings:") || modelSrc.includes("comparisonContextId"), "model: P2-B context");
assert(modelSrc.includes("group-"), "model: group qualifier");
assert(modelSrc.includes('category: "other"') || modelSrc.includes('"other"'), "model: type category");
assert(modelSrc.includes("fileNamePattern"), "model: form category");
assert(!/\bDate\.now\s*\(/.test(modelSrc), "model: no Date.now");
assert(!modelSrc.includes("Math.random"), "model: no random");
assert(!modelSrc.includes("crypto.randomUUID") && !/\buuid\b/i.test(modelSrc), "model: no uuid");

// No folder observations / no P2-D observation emission
assert(!modelSrc.includes("parallel-folder-structure-group"), "model: no folder parallel obs");
assert(!modelSrc.includes("direct-child-folder-set-among-peers"), "model: no P2-D set obs");
assert(!modelSrc.includes("direct-child-folder-name-among-peers"), "model: no P2-D name obs");
assert(!modelSrc.includes("buildStructureFolderPatternInsight"), "model: no P2-D builder");
assert(!modelSrc.includes("parallel-file-type-count-group"), "model: no count-group obs");

// No fuzzy / similarity
assert(!modelSrc.includes("Levenshtein"), "model: no Levenshtein");
assert(!modelSrc.includes("Jaccard"), "model: no Jaccard");
assert(!modelSrc.includes("embedding"), "model: no embedding");

const modelWithoutGuard = modelSrc.replace(
  /export function structureParallelResultHasForbiddenClaims[\s\S]*?^}/m,
  "",
);
assert(!modelWithoutGuard.includes("similarityScore"), "model: no similarityScore outside guard");
assert(!modelWithoutGuard.includes("outlier"), "model: no outlier outside guard");
assert(
  !/\bshouldRename\b|\bwrongType\b|\brequiredType\b|\bshouldConvert\b|\bmissingToken\b/.test(modelWithoutGuard),
  "model: no rule keys outside guard",
);

// No null-sentinel strings for extension null
assert(!modelSrc.includes("\\0null"), "model: no \\0null sentinel");
assert(!modelSrc.includes("NO_EXTENSION"), "model: no NO_EXTENSION");
assert(!modelSrc.includes('"unknown"'), "model: no unknown sentinel");

assert(checkSrc.includes("runStructureParallelInsightCheck"), "check exported");
assert(checkSrc.includes("FALL A") || checkSrc.includes("no profiles"), "check: A");
assert(checkSrc.includes("FALL B") || checkSrc.includes("one profile"), "check: B");
assert(checkSrc.includes("FALL E") || checkSrc.includes("matched 2"), "check: E");
assert(checkSrc.includes("incomplete"), "check: I listing");
assert(checkSrc.includes("120"), "check: U");
assert(checkSrc.includes("1000") || checkSrc.includes("1.000") || checkSrc.includes("1000"), "check: V");
assert(checkSrc.includes("group-0002") || checkSrc.includes("AF"), "check: AF");
assert(checkSrc.includes("null"), "check: AB null");
assert(checkSrc.includes("prepared") || checkSrc.includes("AA"), "check: AA");
assert(!checkSrc.includes("Off.Dokumente"), "check: no private path");
assert(!checkSrc.includes("BahnCard"), "check: no private names");

assert(workbenchSrc.includes("runStructureParallelInsightCheck"), "workbench wires P2-G");
assert(insightSrc.includes("StructureInsightObservation"), "P2-A present");
assert(fileNameSrc.includes("buildStructureFileNameInsight"), "P2-E present");
assert(fileTypeSrc.includes("buildStructureFileTypeInsight"), "P2-F present");
assert(folderSrc.includes("buildStructureFolderPatternInsight"), "P2-D present");
assert(!appSrc.includes("structureParallelInsight"), "App unchanged");
assert(!treeViewSrc.includes("structureParallelInsight"), "TreeView unchanged");
assert(!treeViewSrc.includes("ParallelStructureProfile"), "TreeView no parallel types");

// P2-E/F must not gain P2-G coupling beyond existing comments
assert(!fileNameSrc.includes("buildStructureParallelInsight"), "P2-E unchanged: no P2-G import");
assert(!fileTypeSrc.includes("buildStructureParallelInsight"), "P2-F unchanged: no P2-G import");

{
  const sample = {
    schemaVersion: 1,
    profiles: [
      {
        comparisonContextId: "siblings:p",
        evaluableByFamily: { fileType: true, fileName: true },
        fileTypeBucketSignature: '[".pdf"]',
        fileTypeCountsJson: JSON.stringify([{ extensionKey: ".pdf", count: 2 }]),
        fileNameFormSetSignature: "[]",
      },
    ],
    insight: {
      observations: [
        {
          id: "obs:parallel-structure:parallel-file-type-bucket-group:siblings:p:group-0001",
          category: "other",
          observationType: "parallel-file-type-bucket-group",
          matchedCount: 2,
          counterEvidence: [],
          patternFeatures: {
            featureKind: "fileTypeBucket",
            signature: '[".pdf"]',
            claimsMissingElements: false,
            comparisonContextId: "siblings:p",
            groupQualifier: "group-0001",
          },
        },
      ],
      ruleCandidates: [],
      suggestions: [],
      confirmedExceptions: [],
    },
  };
  assert(sample.insight.ruleCandidates.length === 0, "shape S");
  assert(sample.insight.observations[0].patternFeatures.claimsMissingElements === false, "shape T");
  assert(sample.insight.observations[0].counterEvidence.length === 0, "shape AE");
  assert(!JSON.stringify(sample).includes("similarityScore"), "shape W");
  const keys = JSON.parse(sample.insight.observations[0].patternFeatures.signature);
  assert(Array.isArray(keys) && keys[0] === ".pdf", "shape bucket json");
}

console.log("structure insight p2g checks passed");
