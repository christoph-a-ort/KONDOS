// P2-H: rule candidates from suitable structure observations.
// No Suggestions / confirmedExceptions / UI / persistence / private Realtest names.
// Confidence from P2-H is always unassessed with empty factors.

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

const modelSrc = read("src/ui/structureRuleCandidate.ts");
const checkSrc = read("src/ui/structureRuleCandidateCheck.ts");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const insightSrc = read("src/ui/structureInsightModel.ts");
const appSrc = read("src/App.tsx");
const treeViewSrc = read("src/ui/TreeView.tsx");
const parallelSrc = read("src/ui/structureParallelInsight.ts");
const fileTypeSrc = read("src/ui/structureFileTypeInsight.ts");

assert(modelSrc.includes("buildStructureRuleCandidateInsight"), "model: builder");
assert(modelSrc.includes("rule-candidate"), "model: detector id");
assert(modelSrc.includes("unassessed"), "model: unassessed");
assert(modelSrc.includes("candidateFeatures"), "model: candidateFeatures");
assert(modelSrc.includes("factors: []"), "model: empty factors");
assert(modelSrc.includes("status: \"detected\""), "model: detected");
assert(modelSrc.includes("suggestions: []"), "model: no suggestions");
assert(modelSrc.includes("confirmedExceptions: []"), "model: no exceptions");
assert(modelSrc.includes("recurring-year-organization-among-peers"), "model: year principle");
assert(modelSrc.includes("parallel-local-file-type-bucket-structure"), "model: bucket principle");
assert(modelSrc.includes("passesRepetitionGate"), "model: repetition gate");
assert(modelSrc.includes("passesRivalGate"), "model: rival gate");
assert(modelSrc.includes('signature === "[]"'), "model: empty signature skip");
assert(!modelSrc.includes("localeCompare"), "model: no localeCompare");
assert(!/\bDate\.now\s*\(/.test(modelSrc), "model: no Date.now");
assert(!modelSrc.includes("Math.random"), "model: no random");
assert(!modelSrc.includes("crypto.randomUUID"), "model: no uuid");

const modelWithoutGuard = modelSrc.replace(
  /export function structureRuleCandidateResultHasForbiddenClaims[\s\S]*?^}/m,
  "",
);
assert(!modelWithoutGuard.includes("supportRatio"), "model: no supportRatio outside guard");
assert(!modelWithoutGuard.includes("outlier"), "model: no outlier outside guard");

assert(checkSrc.includes("runStructureRuleCandidateCheck"), "check exported");
assert(checkSrc.includes("FALL A") || checkSrc.includes("0 candidates"), "check: A");
assert(checkSrc.includes("3 vs 3") || checkSrc.includes("FALL H"), "check: H");
assert(checkSrc.includes("additive") || checkSrc.includes("rechnungen,vertrag"), "check: Q");
assert(checkSrc.includes("1000"), "check: AQ");
assert(checkSrc.includes("unassessed"), "check: AA");
assert(checkSrc.includes("prepared"), "check: AP");
assert(!checkSrc.includes("Off.Dokumente"), "check: no private path");

assert(workbenchSrc.includes("runStructureRuleCandidateCheck"), "workbench wires P2-H");
assert(insightSrc.includes('"unassessed"'), "P2-A unassessed");
assert(insightSrc.includes("candidateFeatures"), "P2-A candidateFeatures");
assert(!appSrc.includes("structureRuleCandidate"), "App unchanged");
assert(!treeViewSrc.includes("structureRuleCandidate"), "TreeView unchanged");
assert(!parallelSrc.includes("buildStructureRuleCandidateInsight"), "P2-G unchanged: no P2-H import");
assert(!fileTypeSrc.includes("buildStructureRuleCandidateInsight"), "P2-F unchanged: no P2-H import");

{
  const sample = {
    schemaVersion: 1,
    insight: {
      observations: [],
      ruleCandidates: [
        {
          id: "rule:parallel-structure:parallel-local-file-type-bucket-structure:obs:x",
          status: "detected",
          confidence: { level: "unassessed", factors: [] },
          observationIds: ["obs:x"],
          support: { matchedCount: 5, totalCount: 6 },
          candidateFeatures: {
            evaluableCount: 6,
            rivalGroupCount: 1,
            maxRivalMatchedCount: 1,
          },
        },
      ],
      suggestions: [],
      confirmedExceptions: [],
    },
  };
  assert(sample.insight.suggestions.length === 0, "shape AE");
  assert(sample.insight.confirmedExceptions.length === 0, "shape AF");
  assert(sample.insight.ruleCandidates[0].confidence.level === "unassessed", "shape AA");
  assert(sample.insight.ruleCandidates[0].confidence.factors.length === 0, "shape AB");
  assert(sample.insight.ruleCandidates[0].confidence.level !== "low", "shape AC");
}

console.log("structure insight p2h checks passed");
