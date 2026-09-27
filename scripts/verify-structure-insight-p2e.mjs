// P2-E: local file-name structure insights (direct files under one parent).
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

const modelSrc = read("src/ui/structureFileNameInsight.ts");
const checkSrc = read("src/ui/structureFileNameInsightCheck.ts");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const insightSrc = read("src/ui/structureInsightModel.ts");
const appSrc = read("src/App.tsx");
const treeViewSrc = read("src/ui/TreeView.tsx");

assert(modelSrc.includes("buildStructureFileNameInsight"), "model: builder");
assert(modelSrc.includes("FileNameComparisonContext"), "model: context");
assert(modelSrc.includes("FileNameStructureFeature"), "model: feature");
assert(modelSrc.includes("file-name-structure"), "model: detector id");
assert(modelSrc.includes("file-name-form-among-peers"), "model: form obs");
assert(modelSrc.includes("detectorVersion"), "model: detector version");
assert(modelSrc.includes("claimsMissingElements: false"), "model: no missing claim");
assert(modelSrc.includes("ruleCandidates: []"), "model: empty rules");
assert(modelSrc.includes("suggestions: []"), "model: empty suggestions");
assert(modelSrc.includes("confirmedExceptions: []"), "model: empty exceptions");
assert(modelSrc.includes(".toLowerCase()"), "model: locale-independent lower");
assert(!modelSrc.includes("toLocaleLowerCase("), "model: no toLocaleLowerCase");
assert(modelSrc.includes("compareFileNameText"), "model: code-unit compare");
assert(!modelSrc.includes("localeCompare"), "model: no localeCompare for identity");
assert(modelSrc.includes('listing === "read"'), "model: listing contract");
assert(modelSrc.includes("matchedCount"), "model: matchedCount");
assert(modelSrc.includes("form-"), "model: form qualifier");
assert(modelSrc.includes("tokenizeFileNameStem"), "model: tokenizer");
assert(modelSrc.includes("splitFileName"), "model: stem/ext");
assert(modelSrc.includes("formSignature"), "model: formSignature");
assert(!/\bDate\.now\s*\(/.test(modelSrc), "model: no Date.now");
assert(!modelSrc.includes("Math.random"), "model: no random");
assert(!modelSrc.includes("crypto.randomUUID") && !/\buuid\b/i.test(modelSrc), "model: no uuid");
assert(!modelSrc.includes("parseStructureTime"), "model: no P2-C time parser");
// Forbidden semantic keys must not appear as produced observation/feature fields.
// Allow them only inside the explicit guard that rejects them in serialized output.
const modelWithoutGuard = modelSrc.replace(
  /export function structureFileNameResultHasForbiddenClaims[\s\S]*?^}/m,
  "",
);
assert(
  !/\bshouldRename\b|\bwrongName\b|\bmissingToken\b|\brequiredPattern\b|\bexpectedPattern\b/.test(modelWithoutGuard),
  "model: no rule keys outside guard",
);

// No recursive file collection: only parent.children + isFile filter
assert(modelSrc.includes("parent.children.filter(isFile)"), "model: direct files only");
assert(!modelSrc.includes("walkAllFiles") && !modelSrc.includes("collectAllFiles"), "model: no recursive collect");
assert(!modelSrc.includes("buildStructureComparisonContexts"), "model: no P2-B cross-peer");
assert(!modelSrc.includes("siblings:"), "model: no sibling context ids");

// Extension not part of form signature
assert(modelSrc.includes('case "text":\n          return "text"') || modelSrc.includes('return "text"'), "model: text kind-only in sig");
assert(modelSrc.includes("extensionKey"), "model: extension on feature");
const formSigFn = modelSrc.slice(modelSrc.indexOf("formSignatureFromTokens"), modelSrc.indexOf("tokensReconstructStem"));
assert(!formSigFn.includes("extension"), "model: extension outside formSignature");

assert(checkSrc.includes("runStructureFileNameInsightCheck"), "check exported");
assert(checkSrc.includes("FALL A") || checkSrc.includes("Rechnung_001"), "check: A");
assert(checkSrc.includes("FALL B") || checkSrc.includes("001_Rechnung"), "check: B");
assert(checkSrc.includes("2025_01_Rechnung_001"), "check: C");
assert(checkSrc.includes("KundeA_Rechnung"), "check: D");
assert(checkSrc.includes("Rechnung-001") && checkSrc.includes("Rechnung_001"), "check: E");
assert(checkSrc.includes("Rechnung_12"), "check: F/AD");
assert(checkSrc.includes("RECHNUNG_003"), "check: G");
assert(checkSrc.includes("Rechnung _001"), "check: H");
assert(checkSrc.includes("hasExtension === false"), "check: I");
assert(checkSrc.includes("rechnung.final.2025"), "check: J");
assert(checkSrc.includes("Bücher"), "check: K");
assert(checkSrc.includes("😀"), "check: L");
assert(checkSrc.includes("single file") || checkSrc.includes("FALL M"), "check: M");
assert(checkSrc.includes("10000") || checkSrc.includes("10_000"), "check: T");
assert(checkSrc.includes("incomplete"), "check: Q listing");
assert(checkSrc.includes("structureFileNameInsightJsonRoundTrip"), "check: U");
assert(checkSrc.includes("identical"), "check: V");
assert(checkSrc.includes("observationClaimsMissingElements"), "check: W");
assert(checkSrc.includes("rules 0") || checkSrc.includes("ruleCandidates.length === 0"), "check: X");
assert(checkSrc.includes("node-a"), "check: Y");
assert(checkSrc.includes("A__B") || checkSrc.includes('"__"'), "check: AA");
assert(checkSrc.includes(".datei") && checkSrc.includes("datei."), "check: AB");
assert(checkSrc.includes("A-_B") || checkSrc.includes('"-_"'), "check: AG");
assert(checkSrc.includes("docx"), "check: AI");
assert(checkSrc.includes("20250131"), "check: AJ");
assert(checkSrc.includes("4711"), "check: AK");
assert(checkSrc.includes("tokensReconstructStem") || checkSrc.includes("assertTokensLossFree"), "check: AF");
assert(!checkSrc.includes("Off.Dokumente"), "check: no private path");
assert(!checkSrc.includes("BahnCard"), "check: no private names");

assert(workbenchSrc.includes("runStructureFileNameInsightCheck"), "workbench wires P2-E");
assert(insightSrc.includes("StructureInsightObservation"), "P2-A present");
assert(!appSrc.includes("structureFileNameInsight"), "App unchanged");
assert(!treeViewSrc.includes("structureFileNameInsight"), "TreeView unchanged");
assert(!treeViewSrc.includes("FileNameStructure"), "TreeView no file-name structure types");

// Lightweight synthetic invariants (shape only)
{
  const sample = {
    schemaVersion: 1,
    contexts: [
      {
        id: "files:p",
        evaluable: true,
        comparisonPossible: true,
        totalCount: 3,
        evaluableCount: 3,
      },
    ],
    features: [
      {
        formSignature: 'text|sep:"_"|digits:3',
        stem: "Rechnung_001",
        extensionKey: ".pdf",
        provenance: { detectorId: "file-name-structure", detectorVersion: 1 },
      },
    ],
    insight: {
      observations: [
        {
          id: "obs:file-name-structure:file-name-form-among-peers:files:p:form-0001",
          observationType: "file-name-form-among-peers",
          matchedCount: 2,
          patternFeatures: {
            claimsMissingElements: false,
            formSignature: 'text|sep:"_"|digits:3',
            matchedCount: 2,
            evaluableCount: 3,
            totalCount: 3,
            comparisonContextId: "files:p",
            formQualifier: "form-0001",
          },
        },
      ],
      ruleCandidates: [],
      suggestions: [],
      confirmedExceptions: [],
    },
  };
  assert(sample.insight.ruleCandidates.length === 0, "shape X");
  assert(sample.insight.observations[0].patternFeatures.claimsMissingElements === false, "shape W");
  assert(sample.insight.observations[0].matchedCount >= 2, "shape matched>=2");
  assert(sample.features[0].extensionKey === ".pdf", "shape extension feature");
  assert(!String(sample.features[0].formSignature).includes(".pdf"), "shape ext not in sig");
  const round = JSON.parse(JSON.stringify(sample));
  assert(round.contexts[0].id === "files:p", "shape roundtrip");
}

console.log("structure insight p2e checks passed");
