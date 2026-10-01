/**
 * P2-I confidence-assessment checks — synthetic fixtures only.
 * No private real paths. No filesystem mutations.
 */

import {
  STRUCTURE_INSIGHT_SCHEMA_VERSION,
  type StructureInsightAttrMap,
  type StructureInsightEvidenceItem,
  type StructureInsightRuleCandidate,
} from "./structureInsightModel";
import {
  FACTOR_ASSESSMENT_DATA_INCOMPLETE,
  FACTOR_COUNTER_EVIDENCE_PRESENT,
  FACTOR_EVIDENCE_BREADTH,
  FACTOR_LISTING_COMPLETE,
  FACTOR_LISTING_PARTIAL,
  FACTOR_LISTING_UNKNOWN,
  FACTOR_RIVAL_ABSENT,
  FACTOR_RIVAL_CLEAR_LEAD,
  FACTOR_RIVAL_MODEST_LEAD,
  FACTOR_SMALL_EVIDENCE_BASE,
  FACTOR_SUPPORT_MAJORITY,
  FACTOR_SUPPORT_NEAR_UNANIMITY,
  FACTOR_SUPPORT_UNANIMITY,
  FACTOR_SUPPORT_WEAK_MAJORITY,
  STRUCTURE_CONFIDENCE_ASSESSOR_ID,
  STRUCTURE_CONFIDENCE_ASSESSOR_VERSION,
  STRUCTURE_CONFIDENCE_SCHEMA_VERSION,
  assessStructureRuleCandidateConfidence,
  buildStructureConfidenceInsight,
  classifyBreadth,
  classifyConsistency,
  classifyRivalClarity,
  createEmptyStructureConfidenceInsightResult,
  structureConfidenceInsightRoundTripEquals,
  structureConfidenceResultHasForbiddenClaims,
} from "./structureConfidenceAssessment";
import { compareRuleCandidateText } from "./structureRuleCandidate";

function assert(condition: boolean, label: string): asserts condition {
  if (!condition) {
    throw new Error(label);
  }
}

function evidence(nodeId: string): StructureInsightEvidenceItem {
  return { element: { nodeId, name: nodeId } };
}

function baseCandidate(
  id: string,
  matched: number,
  evaluable: number,
  maxRival: number,
  extras: {
    listing?: string;
    counter?: number;
    total?: number;
    features?: StructureInsightAttrMap | null;
    omitFeatures?: boolean;
    sourceType?: string;
    status?: StructureInsightRuleCandidate["status"];
  } = {},
): StructureInsightRuleCandidate {
  const listing = extras.listing ?? "allEvaluableRead";
  const counter = extras.counter ?? 0;
  const total = extras.total ?? evaluable;
  const features: StructureInsightAttrMap | undefined =
    extras.omitFeatures === true
      ? undefined
      : extras.features === null
        ? undefined
        : {
            sourceObservationType: extras.sourceType ?? "parallel-file-type-bucket-group",
            evaluableCount: evaluable,
            rivalGroupCount: maxRival > 0 ? 1 : 0,
            maxRivalMatchedCount: maxRival,
            listingCompleteness: listing,
            ...(extras.features ?? {}),
          };

  const candidate: StructureInsightRuleCandidate = {
    id,
    category: "other",
    principle: "test-principle",
    scope: { kind: "comparisonSet", nodeIds: ["a", "b"] },
    observationIds: [`obs:${id}`],
    supportingEvidence: Array.from({ length: matched }, (_, index) => evidence(`s${index}`)),
    counterEvidence: Array.from({ length: counter }, (_, index) => evidence(`c${index}`)),
    support: { matchedCount: matched, totalCount: total },
    confidence: { level: "unassessed", factors: [] },
    status: extras.status ?? "detected",
  };
  if (features !== undefined) {
    candidate.candidateFeatures = features;
  }
  return candidate;
}

function levelOf(candidate: StructureInsightRuleCandidate): string {
  return assessStructureRuleCandidateConfidence(candidate).confidence.level;
}

function factorIds(candidate: StructureInsightRuleCandidate): string[] {
  return assessStructureRuleCandidateConfidence(candidate).confidence.factors.map((f) => f.id);
}

function hasFactor(candidate: StructureInsightRuleCandidate, id: string): boolean {
  return factorIds(candidate).includes(id);
}

function factorKind(candidate: StructureInsightRuleCandidate, id: string): string | undefined {
  return assessStructureRuleCandidateConfidence(candidate).confidence.factors.find((f) => f.id === id)?.kind;
}

export function runStructureConfidenceAssessmentCheck(): void {
  assert(STRUCTURE_CONFIDENCE_SCHEMA_VERSION === 1, "schema");
  assert(STRUCTURE_CONFIDENCE_ASSESSOR_ID === "confidence-assessment", "assessor id");
  assert(STRUCTURE_CONFIDENCE_ASSESSOR_VERSION === 1, "assessor version");
  assert(createEmptyStructureConfidenceInsightResult().insight.ruleCandidates.length === 0, "empty");
  assert(classifyBreadth(2) === "small", "breadth small");
  assert(classifyBreadth(4) === "modest", "breadth modest");
  assert(classifyBreadth(5) === "ample", "breadth ample");
  assert(classifyConsistency(7, 7) === "unanimous", "cons unanimous");
  assert(classifyConsistency(6, 7) === "near-unanimous", "cons near");
  assert(classifyConsistency(6, 8) === "majority", "cons majority");
  assert(classifyConsistency(3, 6) === "weak", "cons weak");
  assert(classifyRivalClarity(7, 0) === "absent", "rival absent");
  assert(classifyRivalClarity(5, 1) === "clear-lead", "rival clear");
  assert(classifyRivalClarity(4, 3) === "modest-lead", "rival modest");

  // A–E levels
  assert(levelOf(baseCandidate("a-low", 3, 6, 0)) === "low", "C: 3/6 low");
  assert(levelOf(baseCandidate("a-med", 3, 3, 0)) === "medium", "D: 3/3 medium");
  assert(levelOf(baseCandidate("a-high", 7, 7, 0)) === "high", "E: 7/7 high");

  // F–H small/large unanimous
  assert(levelOf(baseCandidate("f-2-2", 2, 2, 0)) === "medium", "F: 2/2 medium");
  assert(hasFactor(baseCandidate("f-2-2", 2, 2, 0), FACTOR_SMALL_EVIDENCE_BASE), "F: small factor");
  assert(levelOf(baseCandidate("g-7-7", 7, 7, 0)) === "high", "G: 7/7");
  assert(levelOf(baseCandidate("h-20-20", 20, 20, 0)) === "high", "H: 20/20");

  // I–K
  assert(levelOf(baseCandidate("i-3-6", 3, 6, 0)) === "low", "I: 3/6");
  assert(levelOf(baseCandidate("j-6-8", 6, 8, 2)) === "medium", "J: 6/8");
  assert(levelOf(baseCandidate("k-9-10", 9, 10, 0, { counter: 1 })) === "high", "K: 9/10 high");
  assert(hasFactor(baseCandidate("k-9-10", 9, 10, 0, { counter: 1 }), FACTOR_COUNTER_EVIDENCE_PRESENT), "K: counter factor");
  assert(factorKind(baseCandidate("k-9-10", 9, 10, 0, { counter: 1 }), FACTOR_COUNTER_EVIDENCE_PRESENT) === "limiting", "K: counter limiting");

  // L–N rivals
  assert(hasFactor(baseCandidate("l", 7, 7, 0), FACTOR_RIVAL_ABSENT), "L: absent");
  assert(hasFactor(baseCandidate("m", 5, 6, 1), FACTOR_RIVAL_CLEAR_LEAD), "M: clear");
  assert(levelOf(baseCandidate("m", 5, 6, 1)) === "high", "M: 5/6 high");
  assert(levelOf(baseCandidate("n-modest", 5, 6, 3)) === "medium", "N: 5vs3 modest → medium");
  assert(hasFactor(baseCandidate("n-modest", 5, 6, 3), FACTOR_RIVAL_MODEST_LEAD), "N: modest factor");
  assert(levelOf(baseCandidate("n-4-3", 4, 5, 3)) === "medium", "N: 4vs3 max medium");
  assert(hasFactor(baseCandidate("n-4-3", 4, 5, 3), FACTOR_RIVAL_MODEST_LEAD), "N: 4vs3 modest factor");

  // O counter without cap
  assert(levelOf(baseCandidate("o", 9, 10, 0, { counter: 1 })) === "high", "O: counter no high-block");

  // P–R listing
  assert(levelOf(baseCandidate("p", 7, 7, 0, { listing: "allEvaluableRead" })) === "high", "P: complete");
  assert(hasFactor(baseCandidate("p", 7, 7, 0), FACTOR_LISTING_COMPLETE), "P: listing-complete");
  assert(levelOf(baseCandidate("q", 7, 7, 0, { listing: "partial" })) === "medium", "Q: partial cap");
  assert(hasFactor(baseCandidate("q", 7, 7, 0, { listing: "partial" }), FACTOR_LISTING_PARTIAL), "Q: factor");
  assert(levelOf(baseCandidate("r", 7, 7, 0, { listing: "unknown" })) === "medium", "R: unknown cap");
  assert(hasFactor(baseCandidate("r", 7, 7, 0, { listing: "unknown" }), FACTOR_LISTING_UNKNOWN), "R: factor");

  // S listing field missing → unassessed (not silent unknown)
  {
    const c = baseCandidate("s", 7, 7, 0);
    delete c.candidateFeatures!.listingCompleteness;
    assert(levelOf(c) === "unassessed", "S: missing listing → unassessed");
    assert(hasFactor(c, FACTOR_ASSESSMENT_DATA_INCOMPLETE), "S: incomplete factor");
  }

  // T features missing
  assert(levelOf(baseCandidate("t", 7, 7, 0, { omitFeatures: true })) === "unassessed", "T: no features");

  // U evaluable missing
  {
    const c = baseCandidate("u", 7, 7, 0);
    delete c.candidateFeatures!.evaluableCount;
    assert(levelOf(c) === "unassessed", "U: no evaluable");
  }

  // V maxRival missing — NOT default 0
  {
    const c = baseCandidate("v", 7, 7, 0);
    delete c.candidateFeatures!.maxRivalMatchedCount;
    assert(levelOf(c) === "unassessed", "V: no maxRival → unassessed");
  }

  // W invalid core numbers
  {
    const nanEval = baseCandidate("w1", 5, 5, 0);
    nanEval.candidateFeatures!.evaluableCount = Number.NaN;
    assert(levelOf(nanEval) === "unassessed", "W: NaN evaluable");

    const neg = baseCandidate("w2", 5, 5, 0);
    neg.candidateFeatures!.evaluableCount = -1;
    assert(levelOf(neg) === "unassessed", "W: negative evaluable");

    const matchedGt = baseCandidate("w3", 8, 5, 0);
    assert(levelOf(matchedGt) === "unassessed", "W: matched>evaluable");

    const rivalGe = baseCandidate("w4", 5, 6, 5);
    assert(levelOf(rivalGe) === "unassessed", "W: maxRival>=matched");

    const badListing = baseCandidate("w5", 7, 7, 0, { listing: "weird" });
    assert(levelOf(badListing) === "unassessed", "W: invalid listing string");
  }

  // X unknown sourceObservationType still assessable
  assert(
    levelOf(baseCandidate("x", 7, 7, 0, { sourceType: "future-unknown-type" })) === "high",
    "X: unknown source type ok",
  );

  // Y/Z/AA factors sorted, kinds, no dups
  {
    const assessed = assessStructureRuleCandidateConfidence(baseCandidate("y", 7, 7, 0, { counter: 1 }));
    const ids = assessed.confidence.factors.map((f) => f.id);
    const sorted = ids.slice().sort(compareRuleCandidateText);
    assert(ids.join("|") === sorted.join("|"), "Y: sorted by id utf16");
    assert(new Set(ids).size === ids.length, "AA: no dup factors");
    for (const item of assessed.confidence.factors) {
      assert(item.kind === "supporting" || item.kind === "limiting", "Z: kind always set");
    }
    assert(factorKind(baseCandidate("y2", 3, 6, 0), FACTOR_SUPPORT_WEAK_MAJORITY) === "limiting", "Z: weak limiting");
    assert(factorKind(baseCandidate("y3", 7, 7, 0), FACTOR_SUPPORT_UNANIMITY) === "supporting", "Z: unanimous supporting");
    assert(factorKind(baseCandidate("y4", 6, 7, 0), FACTOR_SUPPORT_NEAR_UNANIMITY) === "supporting", "Z: near supporting");
    assert(factorKind(baseCandidate("y5", 6, 8, 0), FACTOR_SUPPORT_MAJORITY) === "supporting", "Z: majority supporting");
    assert(hasFactor(baseCandidate("y6", 9, 10, 0), FACTOR_EVIDENCE_BREADTH), "breadth factor");
  }

  // Edge matrix extras
  assert(levelOf(baseCandidate("e44", 4, 4, 0)) === "medium", "4/4 medium");
  assert(levelOf(baseCandidate("e55", 5, 5, 0)) === "high", "5/5 high");
  assert(levelOf(baseCandidate("e34", 3, 4, 1)) === "medium", "3/4 medium");
  assert(levelOf(baseCandidate("e35", 3, 5, 0)) === "medium", "3/5 medium");
  assert(levelOf(baseCandidate("e46", 4, 6, 1)) === "medium", "4/6 medium");
  assert(levelOf(baseCandidate("e47", 4, 7, 1)) === "medium", "4/7 medium");
  assert(levelOf(baseCandidate("e41", 4, 6, 1)) === "medium", "4vs1 modest breadth");
  assert(levelOf(baseCandidate("e62", 6, 8, 2)) === "medium", "6vs2 medium");

  // P2-G-like: 4/6 counter=[] must use evaluable=6 (not reconstruct)
  {
    const c = baseCandidate("pg", 4, 6, 1, { counter: 0 });
    assert(c.counterEvidence.length === 0, "pg: empty counter");
    assert(levelOf(c) === "medium", "pg: 4/6 medium");
    assert(!hasFactor(c, FACTOR_ASSESSMENT_DATA_INCOMPLETE), "pg: assessed");
  }

  // AB idempotence
  {
    const input = baseCandidate("ab", 7, 7, 0, { counter: 1 });
    const first = buildStructureConfidenceInsight([input]);
    const second = buildStructureConfidenceInsight([input]);
    assert(JSON.stringify(first) === JSON.stringify(second), "AB: identical");
    const third = buildStructureConfidenceInsight(first);
    assert(JSON.stringify(first) === JSON.stringify(third), "AB: reassess identical");
    assert(structureConfidenceInsightRoundTripEquals(first), "AQ: roundtrip");
  }

  // AC–AJ immutability / field preservation
  {
    const input = baseCandidate("ac", 9, 10, 0, { counter: 1, sourceType: "file-name-form-among-peers" });
    const before = JSON.stringify(input);
    const assessed = assessStructureRuleCandidateConfidence(input);
    assert(JSON.stringify(input) === before, "AC: input unchanged");
    assert(assessed.id === input.id, "AD: id");
    assert(assessed.status === "detected", "AE: status");
    assert(JSON.stringify(assessed.observationIds) === JSON.stringify(input.observationIds), "AF");
    assert(JSON.stringify(assessed.supportingEvidence) === JSON.stringify(input.supportingEvidence), "AG");
    assert(JSON.stringify(assessed.counterEvidence) === JSON.stringify(input.counterEvidence), "AH");
    assert(JSON.stringify(assessed.support) === JSON.stringify(input.support), "AI");
    assert(JSON.stringify(assessed.candidateFeatures) === JSON.stringify(input.candidateFeatures), "AJ");
    assert(assessed.confidence.level === "high", "AC: assessed high");
    assert(input.confidence.level === "unassessed", "AC: input still unassessed");
  }

  // AK–AM empty arrays in insight
  {
    const built = buildStructureConfidenceInsight([baseCandidate("ak", 7, 7, 0)]);
    assert(built.insight.observations.length === 0, "AK");
    assert(built.insight.suggestions.length === 0, "AL");
    assert(built.insight.confirmedExceptions.length === 0, "AM");
    assert(structureConfidenceResultHasForbiddenClaims(built) === false, "AN/AO/AP guard");
    assert(!JSON.stringify(built).includes('"confidenceScore"'), "AN");
    assert(!JSON.stringify(built).includes('"supportRatio"'), "AP");
  }

  // AR source neutrality
  {
    const a = levelOf(baseCandidate("ar1", 7, 7, 0, { sourceType: "year-features-among-peers" }));
    const b = levelOf(baseCandidate("ar2", 7, 7, 0, { sourceType: "file-name-form-among-peers" }));
    const c = levelOf(baseCandidate("ar3", 7, 7, 0, { sourceType: "parallel-file-type-bucket-group" }));
    assert(a === "high" && a === b && b === c, "AR: source-neutral");
  }

  // B unassessed → assessed via builder
  {
    const built = buildStructureConfidenceInsight({
      schemaVersion: STRUCTURE_INSIGHT_SCHEMA_VERSION,
      observations: [],
      ruleCandidates: [baseCandidate("b", 7, 7, 0)],
      suggestions: [],
      confirmedExceptions: [],
    });
    assert(built.insight.ruleCandidates[0].confidence.level === "high", "B: assessed");
    assert(built.insight.ruleCandidates[0].confidence.factors.length > 0, "B: factors");
  }

  // Strom+Gas expected synthetic mapping
  assert(levelOf(baseCandidate("sg-gasag", 9, 10, 0, { counter: 1 })) === "high", "sg Gasag");
  assert(levelOf(baseCandidate("sg-preis", 3, 3, 0)) === "medium", "sg Preis");
  assert(levelOf(baseCandidate("sg-vatt", 6, 8, 2, { counter: 2 })) === "medium", "sg Vattenfall");
  assert(levelOf(baseCandidate("sg-eprimo", 3, 6, 0, { counter: 3 })) === "low", "sg ePrimo");
  assert(levelOf(baseCandidate("sg-root", 4, 6, 1)) === "medium", "sg Root");
  assert(levelOf(baseCandidate("sg-hammb", 5, 6, 1)) === "high", "sg Hamm bucket");
  assert(levelOf(baseCandidate("sg-schw", 3, 4, 1)) === "medium", "sg Schwerin");
  assert(levelOf(baseCandidate("sg-rechb", 7, 7, 0)) === "high", "sg Rechnungen bucket");
  assert(levelOf(baseCandidate("sg-form", 4, 7, 1)) === "medium", "sg FormSet");
  assert(levelOf(baseCandidate("sg-hammy", 6, 6, 0)) === "high", "sg Hamm year");
  assert(levelOf(baseCandidate("sg-rechy", 7, 7, 0)) === "high", "sg Rechnungen year");

  // AS 1000-candidate smoke
  {
    const many = Array.from({ length: 1000 }, (_, index) =>
      baseCandidate(`smoke-${String(index).padStart(4, "0")}`, 7, 7, 0),
    );
    const started = Date.now();
    const built = buildStructureConfidenceInsight(many);
    const elapsed = Date.now() - started;
    assert(built.insight.ruleCandidates.length === 1000, "AS: count");
    assert(built.insight.ruleCandidates.every((c) => c.confidence.level === "high"), "AS: all high");
    assert(elapsed < 5_000, `AS: timely (${elapsed}ms)`);
    // sorted by id
    const ids = built.insight.ruleCandidates.map((c) => c.id);
    const sorted = ids.slice().sort(compareRuleCandidateText);
    assert(ids.join("\n") === sorted.join("\n"), "AS: sorted");
  }

  // status never changed for low/medium/high/unassessed
  for (const [label, candidate] of [
    ["low", baseCandidate("st-l", 3, 6, 0)],
    ["med", baseCandidate("st-m", 3, 3, 0)],
    ["high", baseCandidate("st-h", 7, 7, 0)],
    ["una", baseCandidate("st-u", 7, 7, 0, { omitFeatures: true })],
  ] as const) {
    assert(assessStructureRuleCandidateConfidence(candidate).status === "detected", `status ${label}`);
  }
}
