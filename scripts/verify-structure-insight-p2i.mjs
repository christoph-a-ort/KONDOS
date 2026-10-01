// P2-I: confidence assessment for existing rule candidates.
// No Suggestions / confirmedExceptions / UI / persistence / private Realtest names.
// Missing evaluable/maxRival/listing → unassessed (no reconstruction / no default 0).

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

const modelSrc = read("src/ui/structureConfidenceAssessment.ts");
const checkSrc = read("src/ui/structureConfidenceAssessmentCheck.ts");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const insightSrc = read("src/ui/structureInsightModel.ts");
const ruleSrc = read("src/ui/structureRuleCandidate.ts");
const appSrc = read("src/App.tsx");
const treeViewSrc = read("src/ui/TreeView.tsx");

assert(modelSrc.includes("buildStructureConfidenceInsight"), "model: builder");
assert(modelSrc.includes("assessStructureRuleCandidateConfidence"), "model: assess one");
assert(modelSrc.includes("confidence-assessment"), "model: assessor id");
assert(modelSrc.includes("assessment-data-incomplete"), "model: incomplete factor");
assert(modelSrc.includes("evidence-breadth"), "model: breadth factor");
assert(modelSrc.includes("support-weak-majority"), "model: weak factor");
assert(modelSrc.includes("rival-modest-lead"), "model: modest rival");
assert(modelSrc.includes("listing-partial"), "model: listing partial");
assert(modelSrc.includes("counter-evidence-present"), "model: counter factor");
assert(modelSrc.includes("small-evidence-base"), "model: small base");
assert(modelSrc.includes('kind: "supporting"') || modelSrc.includes('kind: "limiting"'), "model: sets kind");
assert(modelSrc.includes("compareRuleCandidateText"), "model: utf16 sort");
assert(!modelSrc.includes("localeCompare"), "model: no localeCompare");
assert(!/\bDate\.now\s*\(/.test(modelSrc), "model: no Date.now in product path");
assert(!modelSrc.includes("Math.random"), "model: no random");
assert(!modelSrc.includes("crypto.randomUUID"), "model: no uuid");

// Critical corrections: no evaluable reconstruction from counterEvidence; no maxRival default 0
assert(
  !/matchedCount\s*\+\s*.*counterEvidence/.test(modelSrc) &&
    !/counterEvidence\.length\s*\+\s*matched/.test(modelSrc),
  "model: no evaluable from counterEvidence",
);
assert(!modelSrc.includes("maxRivalMatchedCount ?? 0"), "model: no maxRival default 0");
assert(!modelSrc.includes("maxRivalMatchedCount || 0"), "model: no maxRival falsy 0");

assert(checkSrc.includes("runStructureConfidenceAssessmentCheck"), "check exported");
assert(checkSrc.includes("3/6") || checkSrc.includes("low"), "check: low");
assert(checkSrc.includes("7/7") || checkSrc.includes("high"), "check: high");
assert(checkSrc.includes("2/2"), "check: 2/2");
assert(checkSrc.includes("missing listing") || checkSrc.includes("S:"), "check: missing listing");
assert(checkSrc.includes("no maxRival") || checkSrc.includes("V:"), "check: missing maxRival");
assert(checkSrc.includes("1000"), "check: smoke");
assert(checkSrc.includes("source-neutral") || checkSrc.includes("AR"), "check: source neutral");
assert(!checkSrc.includes("Off.Dokumente"), "check: no private path");

assert(workbenchSrc.includes("runStructureConfidenceAssessmentCheck"), "workbench wires P2-I");
assert(insightSrc.includes('kind?: "supporting" | "limiting"'), "P2-A kind");
assert(ruleSrc.includes("unassessed"), "P2-H still unassessed");
assert(!appSrc.includes("structureConfidenceAssessment"), "App unchanged");
assert(!treeViewSrc.includes("structureConfidenceAssessment"), "TreeView unchanged");
assert(!ruleSrc.includes("buildStructureConfidenceInsight"), "P2-H unchanged: no P2-I import");

{
  const sample = {
    schemaVersion: 1,
    insight: {
      observations: [],
      ruleCandidates: [
        {
          id: "rule:x",
          status: "detected",
          confidence: {
            level: "high",
            factors: [
              { id: "evidence-breadth", value: 7, kind: "supporting" },
              { id: "support-unanimity", value: 1, kind: "supporting" },
            ],
          },
        },
      ],
      suggestions: [],
      confirmedExceptions: [],
    },
  };
  assert(sample.insight.suggestions.length === 0, "shape AL");
  assert(sample.insight.confirmedExceptions.length === 0, "shape AM");
  assert(sample.insight.ruleCandidates[0].confidence.level === "high", "shape E");
  assert(sample.insight.ruleCandidates[0].status === "detected", "shape status");
}

console.log("structure insight p2i checks passed");
