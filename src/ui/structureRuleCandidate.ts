/**
 * P2-H – Rule candidates from suitable structure observations.
 *
 * Derives cautious local RuleCandidates from P2-C–G observations.
 * Does NOT confirm rules, create suggestions, exceptions, SOLL structures,
 * confidence scores (P2-I), or filesystem actions.
 *
 * confidence.level is always "unassessed" with empty factors.
 * Descriptive formation facts live in candidateFeatures only.
 */

import type { ScanResult } from "../model";
import {
  buildStructureTimeInsight,
  type StructureTimeInsightResult,
} from "./structureTimeInsight";
import {
  buildStructureFolderPatternInsight,
  FOLDER_PATTERN_NAME_OBSERVATION_TYPE,
  FOLDER_PATTERN_SET_OBSERVATION_TYPE,
  type StructureFolderPatternInsightResult,
} from "./structureFolderPatternInsight";
import {
  buildStructureFileNameInsight,
  FILE_NAME_FORM_OBSERVATION_TYPE,
  type StructureFileNameInsightResult,
} from "./structureFileNameInsight";
import {
  buildStructureFileTypeInsight,
  type StructureFileTypeInsightResult,
} from "./structureFileTypeInsight";
import {
  buildStructureParallelInsight,
  PARALLEL_FILE_NAME_FORM_SET_OBSERVATION_TYPE,
  PARALLEL_FILE_TYPE_BUCKET_OBSERVATION_TYPE,
  type StructureParallelInsightResult,
} from "./structureParallelInsight";
import {
  STRUCTURE_INSIGHT_SCHEMA_VERSION,
  createEmptyStructureInsightResult,
  observationClaimsMissingElements,
  structureInsightJsonRoundTrip,
  type StructureInsightAttrMap,
  type StructureInsightObservation,
  type StructureInsightResult,
  type StructureInsightRuleCandidate,
} from "./structureInsightModel";

export const STRUCTURE_RULE_CANDIDATE_SCHEMA_VERSION = 1 as const;
export const STRUCTURE_RULE_CANDIDATE_DETECTOR_ID = "rule-candidate" as const;
export const STRUCTURE_RULE_CANDIDATE_DETECTOR_VERSION = 1 as const;

export const PRINCIPLE_RECURRING_YEAR = "recurring-year-organization-among-peers" as const;
export const PRINCIPLE_RECURRING_CHILD_FOLDER_NAME = "recurring-direct-child-folder-name" as const;
export const PRINCIPLE_RECURRING_CHILD_FOLDER_SET = "recurring-direct-child-folder-set" as const;
export const PRINCIPLE_RECURRING_FILE_NAME_FORM = "recurring-local-file-name-form" as const;
export const PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET = "parallel-local-file-type-bucket-structure" as const;
export const PRINCIPLE_PARALLEL_FILE_NAME_FORM_SET = "parallel-local-file-name-form-set" as const;

export type RuleCandidateFamily =
  | "yearOrganization"
  | "childFolderName"
  | "childFolderSet"
  | "fileNameForm"
  | "parallelFileTypeBucket"
  | "parallelFileNameFormSet";

export interface StructureRuleCandidateInsightResult {
  schemaVersion: typeof STRUCTURE_RULE_CANDIDATE_SCHEMA_VERSION;
  insight: StructureInsightResult;
}

export interface BuildStructureRuleCandidateOptions {
  time?: StructureTimeInsightResult;
  folderPattern?: StructureFolderPatternInsightResult;
  fileName?: StructureFileNameInsightResult;
  fileType?: StructureFileTypeInsightResult;
  parallel?: StructureParallelInsightResult;
}

interface FamilySpec {
  family: RuleCandidateFamily;
  principle: string;
  observationType: string;
  /** Rival observations share family + scopeKey. Additive names: no rivals. */
  usesRivalGate: boolean;
  /** How to resolve evaluableCount for this family. */
  evaluableMode: "patternFeature" | "matchedPlusCounter";
}

const FAMILY_SPECS: readonly FamilySpec[] = [
  {
    family: "yearOrganization",
    principle: PRINCIPLE_RECURRING_YEAR,
    observationType: "year-features-among-peers",
    usesRivalGate: true,
    evaluableMode: "matchedPlusCounter",
  },
  {
    family: "childFolderName",
    principle: PRINCIPLE_RECURRING_CHILD_FOLDER_NAME,
    observationType: FOLDER_PATTERN_NAME_OBSERVATION_TYPE,
    usesRivalGate: false,
    evaluableMode: "patternFeature",
  },
  {
    family: "childFolderSet",
    principle: PRINCIPLE_RECURRING_CHILD_FOLDER_SET,
    observationType: FOLDER_PATTERN_SET_OBSERVATION_TYPE,
    usesRivalGate: true,
    evaluableMode: "patternFeature",
  },
  {
    family: "fileNameForm",
    principle: PRINCIPLE_RECURRING_FILE_NAME_FORM,
    observationType: FILE_NAME_FORM_OBSERVATION_TYPE,
    usesRivalGate: true,
    evaluableMode: "patternFeature",
  },
  {
    family: "parallelFileTypeBucket",
    principle: PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET,
    observationType: PARALLEL_FILE_TYPE_BUCKET_OBSERVATION_TYPE,
    usesRivalGate: true,
    evaluableMode: "patternFeature",
  },
  {
    family: "parallelFileNameFormSet",
    principle: PRINCIPLE_PARALLEL_FILE_NAME_FORM_SET,
    observationType: PARALLEL_FILE_NAME_FORM_SET_OBSERVATION_TYPE,
    usesRivalGate: true,
    evaluableMode: "patternFeature",
  },
];

/** Locale-independent deterministic string order (UTF-16 code units). */
export function compareRuleCandidateText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function createEmptyStructureRuleCandidateInsightResult(): StructureRuleCandidateInsightResult {
  return {
    schemaVersion: STRUCTURE_RULE_CANDIDATE_SCHEMA_VERSION,
    insight: createEmptyStructureInsightResult(),
  };
}

export function structureRuleCandidateInsightJsonRoundTrip(
  result: StructureRuleCandidateInsightResult,
): StructureRuleCandidateInsightResult {
  return JSON.parse(JSON.stringify(result)) as StructureRuleCandidateInsightResult;
}

export function passesRepetitionGate(matchedCount: number, evaluableCount: number): boolean {
  if (matchedCount < 2) {
    return false;
  }
  if (matchedCount >= 3) {
    return true;
  }
  return matchedCount === evaluableCount;
}

export function passesRivalGate(matchedCount: number, maxRivalMatchedCount: number): boolean {
  return matchedCount > maxRivalMatchedCount;
}

/**
 * Build rule candidates from P2-C–G insights.
 * Pure: does not mutate ScanResult or upstream insight results.
 */
export function buildStructureRuleCandidateInsight(
  result: ScanResult,
  options: BuildStructureRuleCandidateOptions = {},
): StructureRuleCandidateInsightResult {
  const time = options.time ?? buildStructureTimeInsight(result);
  const folderPattern = options.folderPattern ?? buildStructureFolderPatternInsight(result);
  const fileName = options.fileName ?? buildStructureFileNameInsight(result);
  // fileType is accepted for prepared-input parity but never produces candidates alone.
  void (options.fileType ?? buildStructureFileTypeInsight(result));
  const parallel = options.parallel ?? buildStructureParallelInsight(result);

  const observations: StructureInsightObservation[] = [
    ...time.insight.observations,
    ...folderPattern.insight.observations,
    ...fileName.insight.observations,
    ...parallel.insight.observations,
  ];

  const candidates: StructureInsightRuleCandidate[] = [];

  for (const spec of FAMILY_SPECS) {
    const familyObs = observations.filter((observation) => observation.observationType === spec.observationType);
    const byScope = groupByScopeKey(familyObs);

    for (const [, scopeObs] of byScope) {
      for (const observation of scopeObs) {
        if (!isObservationEligible(observation, spec)) {
          continue;
        }
        const evaluableCount = resolveEvaluableCount(observation, spec);
        const matchedCount = observation.matchedCount;
        if (!passesRepetitionGate(matchedCount, evaluableCount)) {
          continue;
        }

        let maxRivalMatchedCount = 0;
        let rivalGroupCount = 0;
        if (spec.usesRivalGate) {
          const rivalStats = resolveRivalStats(observation, spec, scopeObs, parallel);
          rivalGroupCount = rivalStats.rivalGroupCount;
          maxRivalMatchedCount = rivalStats.maxRivalMatchedCount;
          if (!passesRivalGate(matchedCount, maxRivalMatchedCount)) {
            continue;
          }
        }

        candidates.push(
          buildCandidate(observation, spec, evaluableCount, rivalGroupCount, maxRivalMatchedCount),
        );
      }
    }
  }

  candidates.sort((left, right) => compareRuleCandidateText(left.id, right.id));

  return {
    schemaVersion: STRUCTURE_RULE_CANDIDATE_SCHEMA_VERSION,
    insight: {
      schemaVersion: STRUCTURE_INSIGHT_SCHEMA_VERSION,
      observations: [],
      ruleCandidates: candidates,
      suggestions: [],
      confirmedExceptions: [],
    },
  };
}

function resolveRivalStats(
  observation: StructureInsightObservation,
  spec: FamilySpec,
  scopeObs: readonly StructureInsightObservation[],
  parallel: StructureParallelInsightResult,
): { rivalGroupCount: number; maxRivalMatchedCount: number } {
  // P2-G: singleton signature groups produce no observations — use profiles.
  if (spec.family === "parallelFileTypeBucket" || spec.family === "parallelFileNameFormSet") {
    const contextId = observation.patternFeatures.comparisonContextId;
    if (typeof contextId !== "string") {
      return { rivalGroupCount: 0, maxRivalMatchedCount: 0 };
    }
    const ownSignature = observation.patternFeatures.signature;
    const counts = new Map<string, number>();
    for (const profile of parallel.profiles) {
      if (profile.comparisonContextId !== contextId) {
        continue;
      }
      const signature =
        spec.family === "parallelFileTypeBucket"
          ? profile.fileTypeBucketSignature
          : profile.fileNameFormSetSignature;
      if (signature === null) {
        continue;
      }
      counts.set(signature, (counts.get(signature) ?? 0) + 1);
    }
    let rivalGroupCount = 0;
    let maxRivalMatchedCount = 0;
    for (const [signature, count] of counts) {
      if (signature === ownSignature) {
        continue;
      }
      rivalGroupCount += 1;
      if (count > maxRivalMatchedCount) {
        maxRivalMatchedCount = count;
      }
    }
    return { rivalGroupCount, maxRivalMatchedCount };
  }

  // Observation-based rivals (P2-C/D-set/E): other obs of same type+scope.
  const rivals = scopeObs.filter((other) => other.id !== observation.id);
  let maxRivalMatchedCount = 0;
  for (const rival of rivals) {
    if (rival.matchedCount > maxRivalMatchedCount) {
      maxRivalMatchedCount = rival.matchedCount;
    }
  }
  return { rivalGroupCount: rivals.length, maxRivalMatchedCount };
}

function isObservationEligible(observation: StructureInsightObservation, spec: FamilySpec): boolean {
  if (observationClaimsMissingElements(observation)) {
    return false;
  }
  if (observation.matchedCount < 2) {
    return false;
  }

  if (spec.family === "yearOrganization") {
    if (observation.patternFeatures.recurring !== true) {
      return false;
    }
  }

  if (spec.family === "parallelFileTypeBucket" || spec.family === "parallelFileNameFormSet") {
    if (observation.patternFeatures.signature === "[]") {
      return false;
    }
  }

  if (spec.family === "childFolderSet") {
    const signature = observation.patternFeatures.signature;
    if (signature === "" || signature === "[]") {
      return false;
    }
  }

  return true;
}

function resolveEvaluableCount(observation: StructureInsightObservation, spec: FamilySpec): number {
  if (spec.evaluableMode === "patternFeature") {
    const raw = observation.patternFeatures.evaluableCount;
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
      return raw;
    }
  }
  return observation.matchedCount + observation.counterEvidence.length;
}

function groupByScopeKey(
  observations: readonly StructureInsightObservation[],
): Map<string, StructureInsightObservation[]> {
  const map = new Map<string, StructureInsightObservation[]>();
  for (const observation of observations) {
    const key = scopeKey(observation);
    const list = map.get(key);
    if (list === undefined) {
      map.set(key, [observation]);
    } else {
      list.push(observation);
    }
  }
  return map;
}

function scopeKey(observation: StructureInsightObservation): string {
  const contextId = observation.patternFeatures.comparisonContextId;
  if (typeof contextId === "string" && contextId.length > 0) {
    return `ctx:${contextId}`;
  }
  const scope = observation.scope;
  if (scope.kind === "comparisonSet") {
    return `set:${scope.nodeIds.slice().sort(compareRuleCandidateText).join("\n")}`;
  }
  if (scope.kind === "node") {
    return `node:${scope.nodeId}`;
  }
  if (scope.kind === "labeled") {
    return `label:${scope.label}`;
  }
  return "scanRoot";
}

function buildCandidate(
  observation: StructureInsightObservation,
  spec: FamilySpec,
  evaluableCount: number,
  rivalGroupCount: number,
  maxRivalMatchedCount: number,
): StructureInsightRuleCandidate {
  const candidateFeatures: StructureInsightAttrMap = {
    sourceObservationType: observation.observationType,
    evaluableCount,
    rivalGroupCount,
    maxRivalMatchedCount,
    listingCompleteness: resolveListingCompleteness(observation, evaluableCount),
  };

  const signature = observation.patternFeatures.signature;
  if (typeof signature === "string") {
    candidateFeatures.signature = signature;
  }
  const nameKey = observation.patternFeatures.nameKey;
  if (typeof nameKey === "string") {
    candidateFeatures.sourcePatternKey = nameKey;
  } else if (typeof signature === "string") {
    candidateFeatures.sourcePatternKey = signature;
  } else if (typeof observation.patternFeatures.pattern === "string") {
    candidateFeatures.sourcePatternKey = observation.patternFeatures.pattern;
  }

  const detectorId =
    typeof observation.provenance.detectorId === "string"
      ? observation.provenance.detectorId
      : STRUCTURE_RULE_CANDIDATE_DETECTOR_ID;

  return {
    id: `rule:${detectorId}:${spec.principle}:${observation.id}`,
    category: observation.category,
    principle: spec.principle,
    scope: observation.scope,
    observationIds: [observation.id],
    supportingEvidence: observation.supportingEvidence.slice(),
    counterEvidence: observation.counterEvidence.slice(),
    support: {
      matchedCount: observation.matchedCount,
      totalCount: observation.totalCount,
    },
    confidence: {
      level: "unassessed",
      factors: [],
    },
    status: "detected",
    candidateFeatures,
  };
}

function resolveListingCompleteness(
  observation: StructureInsightObservation,
  evaluableCount: number,
): string {
  const featureEvaluable = observation.patternFeatures.evaluableCount;
  if (typeof featureEvaluable === "number" && featureEvaluable === observation.totalCount) {
    return "allEvaluableRead";
  }
  if (typeof featureEvaluable === "number" && featureEvaluable < observation.totalCount) {
    return "partial";
  }
  if (evaluableCount === observation.totalCount && observation.counterEvidence.length + observation.matchedCount === evaluableCount) {
    return "allEvaluableRead";
  }
  return "unknown";
}

export function structureRuleCandidateResultHasForbiddenClaims(
  result: StructureRuleCandidateInsightResult,
): boolean {
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
    if (candidate.confidence.level !== "unassessed") {
      return true;
    }
    if (candidate.confidence.factors.length > 0) {
      return true;
    }
    if (candidate.observationIds.length !== 1) {
      return true;
    }
  }
  const serialized = JSON.stringify(result);
  if (/"confidenceScore"\s*:/.test(serialized)) {
    return true;
  }
  if (/"similarityScore"\s*:/.test(serialized)) {
    return true;
  }
  if (/"supportRatio"\s*:/.test(serialized)) {
    return true;
  }
  if (/"outlier"\s*:/.test(serialized)) {
    return true;
  }
  if (/"violation"\s*:/.test(serialized)) {
    return true;
  }
  if (/"shouldRename"\s*:/.test(serialized)) {
    return true;
  }
  if (/"missingToken"\s*:/.test(serialized)) {
    return true;
  }
  return false;
}

export function structureRuleCandidateInsightRoundTripEquals(
  result: StructureRuleCandidateInsightResult,
): boolean {
  const round = structureRuleCandidateInsightJsonRoundTrip(result);
  const insightRound = structureInsightJsonRoundTrip(result.insight);
  return (
    JSON.stringify(round) === JSON.stringify(result) &&
    JSON.stringify(insightRound) === JSON.stringify(result.insight)
  );
}
