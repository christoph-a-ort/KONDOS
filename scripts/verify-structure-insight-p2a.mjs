// P2-A: structure insight model foundation — contracts + synthetic case invariants.
// No detectors / UI / persistence / private Realtest names.

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

const modelSrc = read("src/ui/structureInsightModel.ts");
const checkSrc = read("src/ui/structureInsightModelCheck.ts");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const appSrc = read("src/App.tsx");
const treeViewSrc = read("src/ui/TreeView.tsx");

assert(modelSrc.includes("StructureInsightObservation"), "model: observation");
assert(modelSrc.includes("StructureInsightRuleCandidate"), "model: rule candidate");
assert(modelSrc.includes("StructureInsightSuggestion"), "model: suggestion");
assert(modelSrc.includes("StructureInsightConfirmedException"), "model: confirmed exception");
assert(modelSrc.includes("StructureInsightConfidence"), "model: confidence");
assert(modelSrc.includes("StructureInsightProvenance"), "model: provenance");
assert(modelSrc.includes("createEmptyStructureInsightResult"), "model: empty result");
assert(modelSrc.includes("structureInsightJsonRoundTrip"), "model: JSON round-trip");
assert(modelSrc.includes("observationClaimsMissingElements"), "model: missing-element guard");
assert(modelSrc.includes("suggestionTypeLooksLikeFilesystemAction"), "model: FS-action guard");
assert(modelSrc.includes("scan-local") || modelSrc.includes("within one scan"), "model: id semantics");
assert(modelSrc.includes("FORBIDDEN_SUGGESTION_ACTION_TOKENS"), "model: forbids FS verbs");
assert(!/confidence\s*=\s*0\.\d+/.test(modelSrc), "model: no pseudo percentages");

assert(modelSrc.includes('"unassessed"'), "model: unassessed level");
assert(modelSrc.includes("candidateFeatures"), "model: candidateFeatures");
assert(modelSrc.includes("| \"low\"") || modelSrc.includes('"low"'), "model: low remains");
assert(modelSrc.includes('"medium"'), "model: medium remains");
assert(modelSrc.includes('"high"'), "model: high remains");

assert(checkSrc.includes("runStructureInsightModelCheck"), "check exported");
assert(checkSrc.includes("matchedCount: 7") && checkSrc.includes("totalCount: 8"), "check: Fall A 7/8");
assert(checkSrc.includes("matchedCount: 52") && checkSrc.includes("totalCount: 64"), "check: Fall B");
assert(checkSrc.includes("claimsMissingElements: false"), "check: Fall C no missing claim");
assert(checkSrc.includes("rule-d-year") && checkSrc.includes("rule-d-doc"), "check: Fall D competing");
assert(checkSrc.includes("suggestions: []"), "check: empty suggestions allowed");
assert(checkSrc.includes("confirmedExceptions"), "check: Fall F");
assert(checkSrc.includes("contentHash"), "check: Fall G");
assert(checkSrc.includes("structureInsightJsonRoundTrip"), "check: Fall H");
assert(checkSrc.includes("unassessed"), "check: Fall I unassessed");
assert(checkSrc.includes("candidateFeatures"), "check: Fall I features");
assert(checkSrc.includes("low != unassessed") || checkSrc.includes("unassessed != low"), "check: Fall I/J distinct");
assert(modelSrc.includes('kind?: "supporting" | "limiting"'), "model: optional factor kind");
assert(checkSrc.includes('kind: "supporting"') || checkSrc.includes('kind: "limiting"'), "check: Fall K kind");
assert(!checkSrc.includes("Off.Dokumente"), "check: no private real path");
assert(!checkSrc.includes("BahnCard"), "check: no private real names");

assert(workbenchSrc.includes("runStructureInsightModelCheck"), "workbench wires P2-A check");
assert(!appSrc.includes("structureInsight"), "App unchanged / no P2 UI");
assert(!treeViewSrc.includes("structureInsight"), "TreeView unchanged / no P2 UI");
assert(!treeViewSrc.includes("StructureInsight"), "TreeView no insight types");

// --- Synthetic case invariants (mirror TS check; no private names) ---

function nodeRef(nodeId, extras = {}) {
  return { nodeId, ...extras };
}
function evidence(element, role, attributes) {
  const item = { element };
  if (role !== undefined) item.role = role;
  if (attributes !== undefined) item.attributes = attributes;
  return item;
}

// FALL A
{
  const group = Array.from({ length: 8 }, (_, i) => nodeRef(`ins-${i + 1}`));
  const observation = {
    matchedCount: 7,
    totalCount: 8,
    counterEvidence: [evidence(group[7], "counter")],
    patternFeatures: { pattern: "year-folders", claimsMissingElements: false },
  };
  const rule = {
    observationIds: ["obs-a"],
    confidence: {
      level: "high",
      factors: [
        { id: "matchedCount", value: 7 },
        { id: "totalCount", value: 8 },
      ],
    },
  };
  const suggestion = {
    ruleCandidateId: "rule-a",
    suggestionType: "review-structure-alignment",
  };
  assert(observation.matchedCount === 7 && observation.totalCount === 8, "A: 7/8");
  assert(observation.counterEvidence.length === 1, "A: counter");
  assert(rule.confidence.factors.length >= 2, "A: structured confidence");
  assert(suggestion.suggestionType !== "move", "A: not FS action");
}

// FALL B
{
  const observation = {
    category: "fileNamePattern",
    matchedCount: 52,
    totalCount: 64,
    observationType: "date-like-file-names",
  };
  assert(observation.category === "fileNamePattern", "B: category");
  assert(observation.matchedCount === 52 && observation.totalCount === 64, "B: counts");
  assert(observation.observationType !== "year-folders-among-peers", "B: not year-coupled");
}

// FALL C
{
  const observation = {
    counterEvidence: [
      evidence(nodeRef("proj-5"), "counter", { claimsMissingElements: false }),
    ],
    patternFeatures: { claimsMissingElements: false },
  };
  assert(observation.patternFeatures.claimsMissingElements === false, "C: no missing claim");
}

// FALL D
{
  const result = {
    ruleCandidates: [
      { id: "rule-d-year", principle: "year-based-filing-within-peers", status: "detected" },
      { id: "rule-d-doc", principle: "document-kind-filing-within-peers", status: "detected" },
    ],
    suggestions: [],
  };
  assert(result.ruleCandidates.length === 2, "D: competing");
  assert(result.suggestions.length === 0, "D: no forced suggestion");
}

// FALL E
{
  const result = {
    observations: [{ id: "obs-e" }],
    ruleCandidates: [{ id: "rule-e", observationIds: [] }],
    suggestions: [],
  };
  assert(result.suggestions.length === 0, "E: empty suggestions");
  assert(result.ruleCandidates[0].observationIds.length === 0, "E: rule without obs");
}

// FALL F
{
  const result = {
    observations: [{ counterEvidence: [evidence(nodeRef("ins-8"), "counter")] }],
    ruleCandidates: [{ id: "rule-a" }],
    confirmedExceptions: [
      {
        id: "exc-1",
        ruleCandidateId: "rule-a",
        element: nodeRef("ins-8"),
        confirmed: true,
      },
    ],
  };
  assert(result.observations[0].counterEvidence.length === 1, "F: deviation remains");
  assert(result.confirmedExceptions[0].confirmed === true, "F: exception separate");
}

// FALL G
{
  const observation = {
    category: "contentHash",
    provenance: { detectorId: "hash-duplicate-detector", detectorVersion: 1 },
  };
  assert(observation.category === "contentHash", "G: hash category");
}

// FALL H
{
  const sample = {
    schemaVersion: 1,
    observations: [{ matchedCount: 7, totalCount: 8, patternFeatures: { pattern: "year-folders" } }],
    ruleCandidates: [{ confidence: { level: "high", factors: [{ id: "matchedCount", value: 7 }] } }],
    suggestions: [],
    confirmedExceptions: [{ confirmed: true }],
  };
  const round = JSON.parse(JSON.stringify(sample));
  assert(round.observations[0].matchedCount === 7, "H: counts");
  assert(round.ruleCandidates[0].confidence.level === "high", "H: confidence");
  assert(round.confirmedExceptions[0].confirmed === true, "H: exception");
}

// FALL I – unassessed
{
  const sample = {
    ruleCandidates: [
      {
        confidence: { level: "unassessed", factors: [] },
        candidateFeatures: { evaluableCount: 6, rivalGroupCount: 1 },
        status: "detected",
      },
    ],
  };
  const round = JSON.parse(JSON.stringify(sample));
  assert(round.ruleCandidates[0].confidence.level === "unassessed", "I: unassessed");
  assert(round.ruleCandidates[0].confidence.factors.length === 0, "I: empty factors");
  assert(round.ruleCandidates[0].candidateFeatures.evaluableCount === 6, "I: features");
  assert(round.ruleCandidates[0].confidence.level !== "low", "I: != low");
}

console.log("structure insight p2a checks passed");
