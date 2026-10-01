/**
 * P2-I – Traceable confidence assessment for existing rule candidates.
 *
 * Assesses structural evidence strength/clarity of P2-H RuleCandidates.
 * Does NOT discover patterns, create candidates, change status, create
 * suggestions/exceptions, confirm/reject rules, or mutate the filesystem.
 *
 * Confidence is ordinal (low | medium | high), evidence-based, deterministic,
 * and explained via named factors — not a probability, score, or percentage.
 *
 * Missing/invalid evaluableCount or maxRivalMatchedCount → unassessed
 * (no reconstruction from counterEvidence; no default maxRival=0).
 */

import {
  STRUCTURE_INSIGHT_SCHEMA_VERSION,
  createEmptyStructureInsightResult,
  structureInsightJsonRoundTrip,
  type StructureInsightConfidence,
  type StructureInsightConfidenceFactor,
  type StructureInsightConfidenceLevel,
  type StructureInsightResult,
  type StructureInsightRuleCandidate,
} from "./structureInsightModel";
import { compareRuleCandidateText } from "./structureRuleCandidate";

export const STRUCTURE_CONFIDENCE_SCHEMA_VERSION = 1 as const;
export const STRUCTURE_CONFIDENCE_ASSESSOR_ID = "confidence-assessment" as const;
export const STRUCTURE_CONFIDENCE_ASSESSOR_VERSION = 1 as const;

export const FACTOR_EVIDENCE_BREADTH = "evidence-breadth" as const;
export const FACTOR_SUPPORT_UNANIMITY = "support-unanimity" as const;
export const FACTOR_SUPPORT_NEAR_UNANIMITY = "support-near-unanimity" as const;
export const FACTOR_SUPPORT_MAJORITY = "support-majority" as const;
export const FACTOR_SUPPORT_WEAK_MAJORITY = "support-weak-majority" as const;
export const FACTOR_RIVAL_ABSENT = "rival-absent" as const;
export const FACTOR_RIVAL_CLEAR_LEAD = "rival-clear-lead" as const;
export const FACTOR_RIVAL_MODEST_LEAD = "rival-modest-lead" as const;
export const FACTOR_LISTING_COMPLETE = "listing-complete" as const;
export const FACTOR_LISTING_PARTIAL = "listing-partial" as const;
export const FACTOR_LISTING_UNKNOWN = "listing-unknown" as const;
export const FACTOR_COUNTER_EVIDENCE_PRESENT = "counter-evidence-present" as const;
export const FACTOR_SMALL_EVIDENCE_BASE = "small-evidence-base" as const;
export const FACTOR_ASSESSMENT_DATA_INCOMPLETE = "assessment-data-incomplete" as const;

export type ConfidenceBreadth = "small" | "modest" | "ample";
export type ConfidenceConsistency = "unanimous" | "near-unanimous" | "majority" | "weak";
export type ConfidenceRivalClarity = "absent" | "clear-lead" | "modest-lead";

export interface StructureConfidenceInsightResult {
  schemaVersion: typeof STRUCTURE_CONFIDENCE_SCHEMA_VERSION;
  insight: StructureInsightResult;
}

export interface BuildStructureConfidenceOptions {
  /** Pre-built P2-H-style candidates. When set, ScanResult is not required. */
  ruleCandidates?: readonly StructureInsightRuleCandidate[];
}

const LEVEL_RANK: Record<"low" | "medium" | "high", number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const RANK_LEVEL: Array<"low" | "medium" | "high"> = ["low", "medium", "high"];

function isFiniteNonNegInt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function minLevel(left: "low" | "medium" | "high", right: "low" | "medium" | "high"): "low" | "medium" | "high" {
  return RANK_LEVEL[Math.min(LEVEL_RANK[left], LEVEL_RANK[right])]!;
}

function factor(
  id: string,
  kind: "supporting" | "limiting",
  value?: number,
  detail?: string,
): StructureInsightConfidenceFactor {
  const item: StructureInsightConfidenceFactor = { id, kind };
  if (value !== undefined) {
    item.value = value;
  }
  if (detail !== undefined) {
    item.detail = detail;
  }
  return item;
}

function sortFactors(factors: StructureInsightConfidenceFactor[]): StructureInsightConfidenceFactor[] {
  return factors.slice().sort((left, right) => compareRuleCandidateText(left.id, right.id));
}

function incomplete(detail: string): StructureInsightConfidence {
  return {
    level: "unassessed",
    factors: sortFactors([factor(FACTOR_ASSESSMENT_DATA_INCOMPLETE, "limiting", undefined, detail)]),
  };
}

export function classifyBreadth(matchedCount: number): ConfidenceBreadth {
  if (matchedCount <= 2) {
    return "small";
  }
  if (matchedCount <= 4) {
    return "modest";
  }
  return "ample";
}

export function classifyConsistency(matchedCount: number, evaluableCount: number): ConfidenceConsistency {
  if (matchedCount === evaluableCount) {
    return "unanimous";
  }
  if (matchedCount === evaluableCount - 1) {
    return "near-unanimous";
  }
  if (matchedCount * 2 > evaluableCount) {
    return "majority";
  }
  return "weak";
}

export function classifyRivalClarity(matchedCount: number, maxRivalMatchedCount: number): ConfidenceRivalClarity {
  if (maxRivalMatchedCount === 0) {
    return "absent";
  }
  if (matchedCount >= maxRivalMatchedCount * 2) {
    return "clear-lead";
  }
  return "modest-lead";
}

/**
 * Assess one candidate. Pure: does not mutate input.
 * Returns a shallow copy with replaced confidence only.
 */
export function assessStructureRuleCandidateConfidence(
  candidate: StructureInsightRuleCandidate,
): StructureInsightRuleCandidate {
  const confidence = deriveConfidence(candidate);
  return {
    ...candidate,
    supportingEvidence: candidate.supportingEvidence.slice(),
    counterEvidence: candidate.counterEvidence.slice(),
    observationIds: candidate.observationIds.slice(),
    support: { ...candidate.support },
    candidateFeatures: candidate.candidateFeatures === undefined ? undefined : { ...candidate.candidateFeatures },
    confidence,
  };
}

function deriveConfidence(candidate: StructureInsightRuleCandidate): StructureInsightConfidence {
  const features = candidate.candidateFeatures;
  if (features === undefined || features === null || typeof features !== "object") {
    return incomplete("missing-candidateFeatures");
  }

  const matchedCount = candidate.support?.matchedCount;
  if (!isFiniteNonNegInt(matchedCount)) {
    return incomplete("invalid-matchedCount");
  }

  const evaluableRaw = features.evaluableCount;
  if (!isFiniteNonNegInt(evaluableRaw)) {
    return incomplete("invalid-evaluableCount");
  }

  const maxRivalRaw = features.maxRivalMatchedCount;
  if (!isFiniteNonNegInt(maxRivalRaw)) {
    return incomplete("invalid-maxRivalMatchedCount");
  }

  const listingRaw = features.listingCompleteness;
  if (typeof listingRaw !== "string") {
    return incomplete("invalid-listingCompleteness");
  }
  if (listingRaw !== "allEvaluableRead" && listingRaw !== "partial" && listingRaw !== "unknown") {
    return incomplete("invalid-listingCompleteness");
  }

  if (matchedCount > evaluableRaw) {
    return incomplete("matched-gt-evaluable");
  }
  if (maxRivalRaw >= matchedCount) {
    return incomplete("maxRival-ge-matched");
  }

  const breadth = classifyBreadth(matchedCount);
  const consistency = classifyConsistency(matchedCount, evaluableRaw);
  const rival = classifyRivalClarity(matchedCount, maxRivalRaw);

  let base: "low" | "medium" | "high";
  if (
    breadth === "ample" &&
    (consistency === "unanimous" || consistency === "near-unanimous") &&
    (rival === "absent" || rival === "clear-lead")
  ) {
    base = "high";
  } else if (consistency === "weak") {
    base = "low";
  } else {
    base = "medium";
  }

  let hardCap: "low" | "medium" | "high" = "high";
  if (listingRaw === "partial" || listingRaw === "unknown") {
    hardCap = minLevel(hardCap, "medium");
  }
  if (breadth === "small") {
    hardCap = minLevel(hardCap, "medium");
  }
  if (rival === "modest-lead") {
    hardCap = minLevel(hardCap, "medium");
  }
  if (consistency === "weak") {
    hardCap = minLevel(hardCap, "low");
  }

  const level: StructureInsightConfidenceLevel = minLevel(base, hardCap);
  const factors: StructureInsightConfidenceFactor[] = [];

  factors.push(factor(FACTOR_EVIDENCE_BREADTH, "supporting", matchedCount));

  if (breadth === "small") {
    factors.push(factor(FACTOR_SMALL_EVIDENCE_BASE, "limiting", matchedCount));
  }

  if (consistency === "unanimous") {
    factors.push(factor(FACTOR_SUPPORT_UNANIMITY, "supporting", 1));
  } else if (consistency === "near-unanimous") {
    factors.push(factor(FACTOR_SUPPORT_NEAR_UNANIMITY, "supporting", 1));
  } else if (consistency === "majority") {
    factors.push(factor(FACTOR_SUPPORT_MAJORITY, "supporting", 1));
  } else {
    factors.push(factor(FACTOR_SUPPORT_WEAK_MAJORITY, "limiting", 1));
  }

  if (rival === "absent") {
    factors.push(factor(FACTOR_RIVAL_ABSENT, "supporting", 0));
  } else if (rival === "clear-lead") {
    factors.push(factor(FACTOR_RIVAL_CLEAR_LEAD, "supporting", maxRivalRaw));
  } else {
    factors.push(factor(FACTOR_RIVAL_MODEST_LEAD, "limiting", maxRivalRaw));
  }

  if (listingRaw === "allEvaluableRead") {
    factors.push(factor(FACTOR_LISTING_COMPLETE, "supporting", undefined, listingRaw));
  } else if (listingRaw === "partial") {
    factors.push(factor(FACTOR_LISTING_PARTIAL, "limiting", undefined, listingRaw));
  } else {
    factors.push(factor(FACTOR_LISTING_UNKNOWN, "limiting", undefined, listingRaw));
  }

  const counterLen = candidate.counterEvidence.length;
  if (counterLen > 0) {
    factors.push(factor(FACTOR_COUNTER_EVIDENCE_PRESENT, "limiting", counterLen));
  }

  return {
    level,
    factors: sortFactors(factors),
  };
}

export function createEmptyStructureConfidenceInsightResult(): StructureConfidenceInsightResult {
  return {
    schemaVersion: STRUCTURE_CONFIDENCE_SCHEMA_VERSION,
    insight: createEmptyStructureInsightResult(),
  };
}

/**
 * Assess rule candidates from a P2-H-style insight result or an explicit candidate list.
 * Pure: does not mutate input candidates or ScanResult.
 */
export function buildStructureConfidenceInsight(
  input: StructureInsightResult | StructureRuleCandidateInsightLike | readonly StructureInsightRuleCandidate[],
): StructureConfidenceInsightResult {
  const candidates = resolveInputCandidates(input);
  const assessed = candidates
    .map((candidate) => assessStructureRuleCandidateConfidence(candidate))
    .sort((left, right) => compareRuleCandidateText(left.id, right.id));

  return {
    schemaVersion: STRUCTURE_CONFIDENCE_SCHEMA_VERSION,
    insight: {
      schemaVersion: STRUCTURE_INSIGHT_SCHEMA_VERSION,
      observations: [],
      ruleCandidates: assessed,
      suggestions: [],
      confirmedExceptions: [],
    },
  };
}

interface StructureRuleCandidateInsightLike {
  insight: StructureInsightResult;
}

function resolveInputCandidates(
  input: StructureInsightResult | StructureRuleCandidateInsightLike | readonly StructureInsightRuleCandidate[],
): readonly StructureInsightRuleCandidate[] {
  if (Array.isArray(input)) {
    return input;
  }
  if (input !== null && typeof input === "object" && "insight" in input && input.insight !== undefined) {
    return input.insight.ruleCandidates;
  }
  if (input !== null && typeof input === "object" && "ruleCandidates" in input) {
    return (input as StructureInsightResult).ruleCandidates;
  }
  return [];
}

export function structureConfidenceInsightJsonRoundTrip(
  result: StructureConfidenceInsightResult,
): StructureConfidenceInsightResult {
  return JSON.parse(JSON.stringify(result)) as StructureConfidenceInsightResult;
}

export function structureConfidenceInsightRoundTripEquals(result: StructureConfidenceInsightResult): boolean {
  const round = structureConfidenceInsightJsonRoundTrip(result);
  const insightRound = structureInsightJsonRoundTrip(result.insight);
  return (
    JSON.stringify(round) === JSON.stringify(result) &&
    JSON.stringify(insightRound) === JSON.stringify(result.insight)
  );
}

export function structureConfidenceResultHasForbiddenClaims(result: StructureConfidenceInsightResult): boolean {
  if (result.insight.observations.length > 0) {
    return true;
  }
  if (result.insight.suggestions.length > 0) {
    return true;
  }
  if (result.insight.confirmedExceptions.length > 0) {
    return true;
  }
  for (const candidate of result.insight.ruleCandidates) {
    if (candidate.status !== "detected") {
      return true;
    }
    for (const item of candidate.confidence.factors) {
      if (item.id === "supportRatio" || item.id === "confidenceScore") {
        return true;
      }
    }
  }
  const serialized = JSON.stringify(result);
  if (/"confidenceScore"\s*:/.test(serialized)) {
    return true;
  }
  if (/"supportRatio"\s*:/.test(serialized)) {
    return true;
  }
  if (/"similarityScore"\s*:/.test(serialized)) {
    return true;
  }
  return false;
}
