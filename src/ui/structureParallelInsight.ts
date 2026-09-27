/**
 * P2-G – Parallel structure insights within P2-B sibling contexts.
 *
 * Observes exact shared file-type bucket signatures and file-name form-set
 * signatures among peers of the same siblings:<parentNodeId> context.
 *
 * Does NOT decide correctness, rules, similarity scores, or folder-set facts
 * (folder-set observations remain P2-D only).
 * No RuleCandidates, Suggestions, confirmedExceptions, or filesystem actions.
 *
 * Identity: scan-local nodeId. Paths are display/sort only.
 * Signatures: JSON.stringify of deterministically sorted unique keys (UTF-16).
 * null extensionKey stays JSON null (last in sort). No fuzzy similarity.
 */

import type { ScanResult } from "../model";
import {
  buildStructureComparisonContexts,
  type StructureComparisonContext,
  type StructureComparisonResult,
} from "./structureComparisonContext";
import {
  buildStructureFileNameInsight,
  compareFileNameText,
  type StructureFileNameInsightResult,
} from "./structureFileNameInsight";
import {
  buildStructureFileTypeInsight,
  compareFileTypeExtensionKeys,
  type FileTypeCount,
  type StructureFileTypeInsightResult,
} from "./structureFileTypeInsight";
import {
  STRUCTURE_INSIGHT_SCHEMA_VERSION,
  createEmptyStructureInsightResult,
  evidence,
  nodeRef,
  observationClaimsMissingElements,
  structureInsightJsonRoundTrip,
  type StructureInsightNodeRef,
  type StructureInsightObservation,
  type StructureInsightResult,
} from "./structureInsightModel";

export const STRUCTURE_PARALLEL_SCHEMA_VERSION = 1 as const;
export const STRUCTURE_PARALLEL_DETECTOR_ID = "parallel-structure" as const;
export const STRUCTURE_PARALLEL_DETECTOR_VERSION = 1 as const;

export const PARALLEL_FILE_TYPE_BUCKET_OBSERVATION_TYPE = "parallel-file-type-bucket-group" as const;
export const PARALLEL_FILE_NAME_FORM_SET_OBSERVATION_TYPE = "parallel-file-name-form-set-group" as const;

export type ParallelFeatureKind = "fileTypeBucket" | "fileNameFormSet";

export interface StructureParallelProvenance {
  detectorId: typeof STRUCTURE_PARALLEL_DETECTOR_ID;
  detectorVersion: typeof STRUCTURE_PARALLEL_DETECTOR_VERSION;
}

export interface ParallelEvaluability {
  fileType: boolean;
  fileName: boolean;
}

/**
 * Per P2-B member profile. Signatures are null only when the family is not evaluable.
 * Empty evaluable structures use JSON "[]", never null.
 */
export interface ParallelStructureProfile {
  member: StructureInsightNodeRef;
  comparisonContextId: string;
  evaluableByFamily: ParallelEvaluability;
  /** JSON.stringify(sorted unique extension keys); null when not evaluable. */
  fileTypeBucketSignature: string | null;
  /** Canonical P2-F typeCounts JSON; null when not evaluable. */
  fileTypeCountsJson: string | null;
  /** JSON.stringify(sorted unique formSignatures); null when not evaluable. */
  fileNameFormSetSignature: string | null;
  provenance: StructureParallelProvenance;
}

export interface StructureParallelInsightResult {
  schemaVersion: typeof STRUCTURE_PARALLEL_SCHEMA_VERSION;
  profiles: ParallelStructureProfile[];
  insight: StructureInsightResult;
}

export interface BuildStructureParallelInsightOptions {
  comparison?: StructureComparisonResult;
  fileName?: StructureFileNameInsightResult;
  fileType?: StructureFileTypeInsightResult;
}

const PARALLEL_PROVENANCE: StructureParallelProvenance = {
  detectorId: STRUCTURE_PARALLEL_DETECTOR_ID,
  detectorVersion: STRUCTURE_PARALLEL_DETECTOR_VERSION,
};

/** Locale-independent deterministic string order (UTF-16 code units). */
export function compareParallelText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function createEmptyStructureParallelInsightResult(): StructureParallelInsightResult {
  return {
    schemaVersion: STRUCTURE_PARALLEL_SCHEMA_VERSION,
    profiles: [],
    insight: createEmptyStructureInsightResult(),
  };
}

export function structureParallelInsightJsonRoundTrip(
  result: StructureParallelInsightResult,
): StructureParallelInsightResult {
  return JSON.parse(JSON.stringify(result)) as StructureParallelInsightResult;
}

/**
 * Canonical file-type bucket signature from unique extension keys.
 * null keys sort last and remain JSON null.
 */
export function buildFileTypeBucketSignature(extensionKeys: readonly (string | null)[]): string {
  const unique = [...new Set(extensionKeys)];
  unique.sort(compareFileTypeExtensionKeys);
  return JSON.stringify(unique);
}

/**
 * Canonical file-name form-set signature from unique P2-E formSignatures.
 */
export function buildFileNameFormSetSignature(formSignatures: readonly string[]): string {
  const unique = [...new Set(formSignatures)];
  unique.sort(compareFileNameText);
  return JSON.stringify(unique);
}

/**
 * Build parallel structure profiles and observations from P2-B peers.
 * Pure: does not mutate ScanResult or optional upstream results.
 */
export function buildStructureParallelInsight(
  result: ScanResult,
  options: BuildStructureParallelInsightOptions = {},
): StructureParallelInsightResult {
  const comparison = options.comparison ?? buildStructureComparisonContexts(result);
  const fileName = options.fileName ?? buildStructureFileNameInsight(result);
  const fileType = options.fileType ?? buildStructureFileTypeInsight(result);

  const distributionByParentId = indexFileTypeDistributions(fileType);
  const formSignaturesByParentId = indexFileNameFormSignatures(fileName);
  const fileNameEvaluableByParentId = indexFileNameEvaluable(fileName);

  const profiles: ParallelStructureProfile[] = [];
  const observations: StructureInsightObservation[] = [];

  for (const context of comparison.contexts) {
    const contextProfiles = context.members.map((member) =>
      buildProfile(
        member.nodeId,
        member.name,
        member.relativePath,
        context.id,
        distributionByParentId,
        formSignaturesByParentId,
        fileNameEvaluableByParentId,
      ),
    );
    profiles.push(...contextProfiles);
    if (context.comparisonPossible) {
      observations.push(...observationsForContext(context, contextProfiles));
    }
  }

  profiles.sort((left, right) => {
    const byContext = compareParallelText(left.comparisonContextId, right.comparisonContextId);
    if (byContext !== 0) {
      return byContext;
    }
    return compareParallelText(left.member.nodeId, right.member.nodeId);
  });
  observations.sort((left, right) => compareParallelText(left.id, right.id));

  return {
    schemaVersion: STRUCTURE_PARALLEL_SCHEMA_VERSION,
    profiles,
    insight: {
      schemaVersion: STRUCTURE_INSIGHT_SCHEMA_VERSION,
      observations,
      ruleCandidates: [],
      suggestions: [],
      confirmedExceptions: [],
    },
  };
}

function buildProfile(
  memberNodeId: string,
  memberName: string,
  memberRelativePath: string,
  comparisonContextId: string,
  distributionByParentId: ReadonlyMap<string, { typeCounts: FileTypeCount[] }>,
  formSignaturesByParentId: ReadonlyMap<string, string[]>,
  fileNameEvaluableByParentId: ReadonlyMap<string, boolean>,
): ParallelStructureProfile {
  const distribution = distributionByParentId.get(memberNodeId);
  const fileTypeEvaluable = distribution !== undefined;
  const fileNameEvaluable = fileNameEvaluableByParentId.get(memberNodeId) === true;

  let fileTypeBucketSignature: string | null = null;
  let fileTypeCountsJson: string | null = null;
  if (fileTypeEvaluable && distribution !== undefined) {
    fileTypeBucketSignature = buildFileTypeBucketSignature(
      distribution.typeCounts.map((entry) => entry.extensionKey),
    );
    fileTypeCountsJson = JSON.stringify(distribution.typeCounts);
  }

  let fileNameFormSetSignature: string | null = null;
  if (fileNameEvaluable) {
    fileNameFormSetSignature = buildFileNameFormSetSignature(
      formSignaturesByParentId.get(memberNodeId) ?? [],
    );
  }

  return {
    member: nodeRef(memberNodeId, { name: memberName, relativePath: memberRelativePath }),
    comparisonContextId,
    evaluableByFamily: {
      fileType: fileTypeEvaluable,
      fileName: fileNameEvaluable,
    },
    fileTypeBucketSignature,
    fileTypeCountsJson,
    fileNameFormSetSignature,
    provenance: PARALLEL_PROVENANCE,
  };
}

function observationsForContext(
  context: StructureComparisonContext,
  profiles: readonly ParallelStructureProfile[],
): StructureInsightObservation[] {
  const comparisonGroup = context.members.map((member) =>
    nodeRef(member.nodeId, { name: member.name, relativePath: member.relativePath }),
  );
  const observations: StructureInsightObservation[] = [];

  observations.push(
    ...groupObservations(
      context,
      profiles,
      comparisonGroup,
      "fileType",
      PARALLEL_FILE_TYPE_BUCKET_OBSERVATION_TYPE,
      "fileTypeBucket",
      "other",
      (profile) => profile.fileTypeBucketSignature,
    ),
  );
  observations.push(
    ...groupObservations(
      context,
      profiles,
      comparisonGroup,
      "fileName",
      PARALLEL_FILE_NAME_FORM_SET_OBSERVATION_TYPE,
      "fileNameFormSet",
      "fileNamePattern",
      (profile) => profile.fileNameFormSetSignature,
    ),
  );

  return observations;
}

function groupObservations(
  context: StructureComparisonContext,
  profiles: readonly ParallelStructureProfile[],
  comparisonGroup: readonly StructureInsightNodeRef[],
  family: keyof ParallelEvaluability,
  observationType: string,
  featureKind: ParallelFeatureKind,
  category: "other" | "fileNamePattern",
  signatureOf: (profile: ParallelStructureProfile) => string | null,
): StructureInsightObservation[] {
  const evaluable = profiles.filter((profile) => profile.evaluableByFamily[family]);
  const evaluableCount = evaluable.length;
  const totalCount = context.memberCount;

  const signatureToProfiles = new Map<string, ParallelStructureProfile[]>();
  for (const profile of evaluable) {
    const signature = signatureOf(profile);
    if (signature === null) {
      continue;
    }
    const list = signatureToProfiles.get(signature);
    if (list === undefined) {
      signatureToProfiles.set(signature, [profile]);
    } else {
      list.push(profile);
    }
  }

  const sortedGroups = [...signatureToProfiles.entries()].sort(([left], [right]) =>
    compareParallelText(left, right),
  );

  const observations: StructureInsightObservation[] = [];
  let groupIndex = 0;
  for (const [signature, group] of sortedGroups) {
    groupIndex += 1;
    const qualifier = `group-${String(groupIndex).padStart(4, "0")}`;
    if (group.length < 2) {
      continue;
    }

    const matchedProfiles = group
      .slice()
      .sort((left, right) => compareParallelText(left.member.nodeId, right.member.nodeId));

    const patternFeatures: Record<string, string | number | boolean | null> = {
      pattern: observationType,
      featureKind,
      signature,
      matchedCount: matchedProfiles.length,
      evaluableCount,
      totalCount,
      claimsMissingElements: false,
      comparisonContextId: context.id,
      groupQualifier: qualifier,
    };
    if (featureKind === "fileTypeBucket") {
      patternFeatures.bucketKeysJson = signature;
    }

    observations.push({
      id: observationId(observationType, context.id, qualifier),
      category,
      observationType,
      scope: { kind: "comparisonSet", nodeIds: context.members.map((member) => member.nodeId) },
      comparisonGroup: comparisonGroup.slice(),
      supportingEvidence: matchedProfiles.map((profile) => {
        const attributes: Record<string, string | number | boolean | null> = {
          featureKind,
          signature,
        };
        if (featureKind === "fileTypeBucket" && profile.fileTypeCountsJson !== null) {
          attributes.fileTypeCountsJson = profile.fileTypeCountsJson;
        }
        return evidence(profile.member, "supports", attributes);
      }),
      counterEvidence: [],
      matchedCount: matchedProfiles.length,
      totalCount,
      provenance: {
        detectorId: STRUCTURE_PARALLEL_DETECTOR_ID,
        detectorVersion: STRUCTURE_PARALLEL_DETECTOR_VERSION,
      },
      patternFeatures,
    });
  }

  return observations;
}

function observationId(observationType: string, contextId: string, groupQualifier: string): string {
  return `obs:${STRUCTURE_PARALLEL_DETECTOR_ID}:${observationType}:${contextId}:${groupQualifier}`;
}

function indexFileTypeDistributions(
  fileType: StructureFileTypeInsightResult,
): Map<string, { typeCounts: FileTypeCount[] }> {
  const index = new Map<string, { typeCounts: FileTypeCount[] }>();
  for (const distribution of fileType.distributions) {
    if (!distribution.evaluable) {
      continue;
    }
    index.set(distribution.parent.nodeId, { typeCounts: distribution.typeCounts });
  }
  return index;
}

function indexFileNameFormSignatures(
  fileName: StructureFileNameInsightResult,
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const feature of fileName.features) {
    const parentId = feature.parent.nodeId;
    const list = index.get(parentId);
    if (list === undefined) {
      index.set(parentId, [feature.formSignature]);
    } else {
      list.push(feature.formSignature);
    }
  }
  return index;
}

function indexFileNameEvaluable(fileName: StructureFileNameInsightResult): Map<string, boolean> {
  const index = new Map<string, boolean>();
  for (const context of fileName.contexts) {
    index.set(context.parent.nodeId, context.evaluable);
  }
  return index;
}

export function structureParallelResultHasForbiddenClaims(
  result: StructureParallelInsightResult,
): boolean {
  if (result.insight.ruleCandidates.length > 0) {
    return true;
  }
  if (result.insight.suggestions.length > 0) {
    return true;
  }
  if (result.insight.confirmedExceptions.length > 0) {
    return true;
  }
  if (result.insight.observations.some((observation) => observationClaimsMissingElements(observation))) {
    return true;
  }
  const serialized = JSON.stringify(result);
  if (/"confidenceScore"\s*:/.test(serialized)) {
    return true;
  }
  if (/"similarity"\s*:/.test(serialized)) {
    return true;
  }
  if (/"similarityScore"\s*:/.test(serialized)) {
    return true;
  }
  if (/"outlier"\s*:/.test(serialized)) {
    return true;
  }
  if (/"shouldRename"\s*:/.test(serialized)) {
    return true;
  }
  if (/"wrongType"\s*:/.test(serialized)) {
    return true;
  }
  if (/"requiredType"\s*:/.test(serialized)) {
    return true;
  }
  if (/"shouldConvert"\s*:/.test(serialized)) {
    return true;
  }
  if (/"missingToken"\s*:/.test(serialized)) {
    return true;
  }
  return false;
}

export function structureParallelInsightRoundTripEquals(
  result: StructureParallelInsightResult,
): boolean {
  const round = structureParallelInsightJsonRoundTrip(result);
  const insightRound = structureInsightJsonRoundTrip(result.insight);
  return (
    JSON.stringify(round) === JSON.stringify(result) &&
    JSON.stringify(insightRound) === JSON.stringify(result.insight)
  );
}
