/**
 * P2-F – Local file-type distribution insights (direct files under one parent).
 *
 * Observes which normalized extensions occur among direct files of one folder.
 * Does not decide correctness, rules, moves, or conversions.
 * No RuleCandidates, Suggestions, confirmedExceptions, or filesystem actions.
 *
 * Identity: scan-local nodeId. Paths are display/sort only.
 * Extension: last-dot rule + toLowerCase() (not toLocaleLowerCase). Sort: UTF-16.
 * No MIME/magic/content analysis. No recursive subtree aggregation.
 * No cross-parent / P2-B peer analysis (→ P2-G). No rule candidates (→ P2-H).
 */

import { isDirectory, isFile, type DirectoryListing, type DirectoryNode, type FileNode, type ScanResult } from "../model";
import { displayInventoryPath } from "./inventoryOverview";
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

export const STRUCTURE_FILE_TYPE_SCHEMA_VERSION = 1 as const;
export const STRUCTURE_FILE_TYPE_DETECTOR_ID = "file-type-structure" as const;
export const STRUCTURE_FILE_TYPE_DETECTOR_VERSION = 1 as const;
export const FILE_TYPE_DISTRIBUTION_OBSERVATION_TYPE = "local-direct-file-type-distribution" as const;

export interface StructureFileTypeProvenance {
  detectorId: typeof STRUCTURE_FILE_TYPE_DETECTOR_ID;
  detectorVersion: typeof STRUCTURE_FILE_TYPE_DETECTOR_VERSION;
}

export interface FileTypeFeature {
  file: StructureInsightNodeRef;
  parent: StructureInsightNodeRef;
  comparisonContextId: string;
  originalName: string;
  hasExtension: boolean;
  extensionKey: string | null;
  provenance: StructureFileTypeProvenance;
}

export interface FileTypeCount {
  extensionKey: string | null;
  count: number;
}

export interface FileTypeLocalContext {
  id: string;
  parent: StructureInsightNodeRef;
  members: StructureInsightNodeRef[];
  memberCount: number;
  listing: DirectoryListing;
  /** True only when listing === "read". */
  evaluable: boolean;
  evaluableCount: number;
  totalCount: number;
  /** evaluable && totalCount >= 2 */
  comparisonPossible: boolean;
  provenance: StructureFileTypeProvenance;
}

export interface FileTypeDistribution {
  comparisonContextId: string;
  parent: StructureInsightNodeRef;
  evaluable: boolean;
  evaluableCount: number;
  totalCount: number;
  distinctTypeCount: number;
  typeCounts: FileTypeCount[];
  provenance: StructureFileTypeProvenance;
}

export interface StructureFileTypeInsightResult {
  schemaVersion: typeof STRUCTURE_FILE_TYPE_SCHEMA_VERSION;
  contexts: FileTypeLocalContext[];
  features: FileTypeFeature[];
  distributions: FileTypeDistribution[];
  insight: StructureInsightResult;
}

const FILE_TYPE_PROVENANCE: StructureFileTypeProvenance = {
  detectorId: STRUCTURE_FILE_TYPE_DETECTOR_ID,
  detectorVersion: STRUCTURE_FILE_TYPE_DETECTOR_VERSION,
};

/** Locale-independent deterministic string order (UTF-16 code units). */
export function compareFileTypeText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * Sort extension keys: all string keys by UTF-16, then null last.
 */
export function compareFileTypeExtensionKeys(left: string | null, right: string | null): number {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return compareFileTypeText(left, right);
}

export function createEmptyStructureFileTypeInsightResult(): StructureFileTypeInsightResult {
  return {
    schemaVersion: STRUCTURE_FILE_TYPE_SCHEMA_VERSION,
    contexts: [],
    features: [],
    distributions: [],
    insight: createEmptyStructureInsightResult(),
  };
}

export function structureFileTypeInsightJsonRoundTrip(
  result: StructureFileTypeInsightResult,
): StructureFileTypeInsightResult {
  return JSON.parse(JSON.stringify(result)) as StructureFileTypeInsightResult;
}

export function fileTypeContextId(parentNodeId: string): string {
  return `files:${parentNodeId}`;
}

/**
 * Mechanical extension classification (last-dot rule).
 * Aligns with P2-E stem/extension contract; does not import P2-E or displayFilter.
 */
export function classifyFileTypeExtension(originalName: string): {
  hasExtension: boolean;
  extensionKey: string | null;
} {
  const lastDot = originalName.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === originalName.length - 1) {
    return { hasExtension: false, extensionKey: null };
  }
  return {
    hasExtension: true,
    extensionKey: originalName.slice(lastDot).toLowerCase(),
  };
}

/**
 * Build local file-type contexts, features, distributions, and observations.
 * Pure: does not mutate ScanResult.
 */
export function buildStructureFileTypeInsight(result: ScanResult): StructureFileTypeInsightResult {
  const rootPath = result.root.path;
  const contexts: FileTypeLocalContext[] = [];
  const features: FileTypeFeature[] = [];
  const distributions: FileTypeDistribution[] = [];
  const observations: StructureInsightObservation[] = [];

  function visit(parent: DirectoryNode): void {
    const directFiles = parent.children.filter(isFile).slice();
    directFiles.sort((left, right) => {
      const byName = compareFileTypeText(left.name, right.name);
      if (byName !== 0) {
        return byName;
      }
      return compareFileTypeText(left.id, right.id);
    });

    const contextId = fileTypeContextId(parent.id);
    const evaluable = parent.listing === "read";
    const totalCount = directFiles.length;
    const evaluableCount = evaluable ? totalCount : 0;
    const comparisonPossible = evaluable && totalCount >= 2;
    const parentRef = nodeRef(parent.id, {
      name: parent.name,
      relativePath: displayInventoryPath(rootPath, parent.path),
    });
    const members = directFiles.map((file) =>
      nodeRef(file.id, {
        name: file.name,
        relativePath: displayInventoryPath(rootPath, file.path),
      }),
    );

    contexts.push({
      id: contextId,
      parent: parentRef,
      members,
      memberCount: totalCount,
      listing: parent.listing,
      evaluable,
      evaluableCount,
      totalCount,
      comparisonPossible,
      provenance: FILE_TYPE_PROVENANCE,
    });

    if (evaluable) {
      const contextFeatures: FileTypeFeature[] = [];
      for (const file of directFiles) {
        const feature = buildFileFeature(file, parentRef, contextId, rootPath);
        contextFeatures.push(feature);
        features.push(feature);
      }

      const typeCounts = buildTypeCounts(contextFeatures);
      distributions.push({
        comparisonContextId: contextId,
        parent: parentRef,
        evaluable: true,
        evaluableCount,
        totalCount,
        distinctTypeCount: typeCounts.length,
        typeCounts,
        provenance: FILE_TYPE_PROVENANCE,
      });

      if (comparisonPossible) {
        observations.push(
          buildDistributionObservation(contextId, members, contextFeatures, typeCounts, totalCount, evaluableCount),
        );
      }
    }

    for (const child of parent.children) {
      if (isDirectory(child)) {
        visit(child);
      }
    }
  }

  visit(result.root);

  contexts.sort((left, right) => compareFileTypeText(left.id, right.id));
  features.sort((left, right) => {
    const byContext = compareFileTypeText(left.comparisonContextId, right.comparisonContextId);
    if (byContext !== 0) {
      return byContext;
    }
    return compareFileTypeText(left.file.nodeId, right.file.nodeId);
  });
  distributions.sort((left, right) =>
    compareFileTypeText(left.comparisonContextId, right.comparisonContextId),
  );
  observations.sort((left, right) => compareFileTypeText(left.id, right.id));

  return {
    schemaVersion: STRUCTURE_FILE_TYPE_SCHEMA_VERSION,
    contexts,
    features,
    distributions,
    insight: {
      schemaVersion: STRUCTURE_INSIGHT_SCHEMA_VERSION,
      observations,
      ruleCandidates: [],
      suggestions: [],
      confirmedExceptions: [],
    },
  };
}

function buildFileFeature(
  file: FileNode,
  parent: StructureInsightNodeRef,
  comparisonContextId: string,
  rootPath: string,
): FileTypeFeature {
  const classified = classifyFileTypeExtension(file.name);
  return {
    file: nodeRef(file.id, {
      name: file.name,
      relativePath: displayInventoryPath(rootPath, file.path),
    }),
    parent,
    comparisonContextId,
    originalName: file.name,
    hasExtension: classified.hasExtension,
    extensionKey: classified.extensionKey,
    provenance: FILE_TYPE_PROVENANCE,
  };
}

function buildTypeCounts(features: readonly FileTypeFeature[]): FileTypeCount[] {
  const counts = new Map<string | null, number>();
  for (const feature of features) {
    const key = feature.extensionKey;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => compareFileTypeExtensionKeys(left, right))
    .map(([extensionKey, count]) => ({ extensionKey, count }));
}

function buildDistributionObservation(
  contextId: string,
  members: readonly StructureInsightNodeRef[],
  contextFeatures: readonly FileTypeFeature[],
  typeCounts: readonly FileTypeCount[],
  totalCount: number,
  evaluableCount: number,
): StructureInsightObservation {
  const sortedFeatures = contextFeatures
    .slice()
    .sort((left, right) => compareFileTypeText(left.file.nodeId, right.file.nodeId));

  return {
    id: observationId(contextId),
    category: "other",
    observationType: FILE_TYPE_DISTRIBUTION_OBSERVATION_TYPE,
    scope: { kind: "comparisonSet", nodeIds: members.map((member) => member.nodeId) },
    comparisonGroup: members.slice(),
    supportingEvidence: sortedFeatures.map((feature) =>
      evidence(feature.file, "supports", {
        extensionKey: feature.extensionKey,
        hasExtension: feature.hasExtension,
      }),
    ),
    counterEvidence: [],
    matchedCount: totalCount,
    totalCount,
    provenance: {
      detectorId: STRUCTURE_FILE_TYPE_DETECTOR_ID,
      detectorVersion: STRUCTURE_FILE_TYPE_DETECTOR_VERSION,
    },
    patternFeatures: {
      pattern: FILE_TYPE_DISTRIBUTION_OBSERVATION_TYPE,
      comparisonContextId: contextId,
      distinctTypeCount: typeCounts.length,
      typeCountsJson: JSON.stringify(typeCounts),
      claimsMissingElements: false,
      evaluableCount,
      totalCount,
    },
  };
}

function observationId(contextId: string): string {
  return `obs:${STRUCTURE_FILE_TYPE_DETECTOR_ID}:${FILE_TYPE_DISTRIBUTION_OBSERVATION_TYPE}:${contextId}`;
}

export function structureFileTypeResultHasForbiddenClaims(
  result: StructureFileTypeInsightResult,
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
  if (/"mostFrequent/.test(serialized)) {
    return true;
  }
  if (/"dominantType"\s*:/.test(serialized)) {
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
  return false;
}

export function structureFileTypeInsightRoundTripEquals(
  result: StructureFileTypeInsightResult,
): boolean {
  const round = structureFileTypeInsightJsonRoundTrip(result);
  const insightRound = structureInsightJsonRoundTrip(result.insight);
  return (
    JSON.stringify(round) === JSON.stringify(result) &&
    JSON.stringify(insightRound) === JSON.stringify(result.insight)
  );
}
