/**
 * P2-D – Recurring direct child-folder structures within P2-B peer contexts.
 *
 * Observes only. Does not decide which structure is correct.
 * No RuleCandidates, Suggestions, confirmedExceptions, or filesystem actions.
 *
 * Identity: scan-local nodeId. Paths are display/sort only.
 * Name identity key: locale-independent String.toLowerCase() (not toLocaleLowerCase).
 * Signature / ID sort: locale-independent code-unit order.
 *
 * Deviation ≠ missing element. claimsMissingElements is always false.
 */

import { isDirectory, type DirectoryListing, type DirectoryNode, type ScanResult } from "../model";
import { displayInventoryPath } from "./inventoryOverview";
import {
  buildStructureComparisonContexts,
  type StructureComparisonContext,
  type StructureComparisonResult,
} from "./structureComparisonContext";
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

export const STRUCTURE_FOLDER_PATTERN_SCHEMA_VERSION = 1 as const;
export const STRUCTURE_FOLDER_PATTERN_DETECTOR_ID = "folder-pattern-structure" as const;
export const STRUCTURE_FOLDER_PATTERN_DETECTOR_VERSION = 1 as const;

export const FOLDER_PATTERN_NAME_OBSERVATION_TYPE = "direct-child-folder-name-among-peers" as const;
export const FOLDER_PATTERN_SET_OBSERVATION_TYPE = "direct-child-folder-set-among-peers" as const;

export interface StructureFolderPatternProvenance {
  detectorId: typeof STRUCTURE_FOLDER_PATTERN_DETECTOR_ID;
  detectorVersion: typeof STRUCTURE_FOLDER_PATTERN_DETECTOR_VERSION;
}

export interface StructureFolderPatternChildRef {
  nodeId: string;
  name: string;
  relativePath: string;
  /** Locale-independent identity key: name.toLowerCase(). */
  nameKey: string;
}

/**
 * Direct child-folder structure of one P2-B member.
 * Non-evaluable members keep empty nameKeys/signature and evaluable=false.
 */
export interface DirectChildFolderStructureFeature {
  member: StructureInsightNodeRef;
  comparisonContextId: string;
  listing: DirectoryListing;
  /** True only when listing === "read" (children list is reliable). */
  evaluable: boolean;
  directChildDirectoryCount: number;
  /** Unique, deterministically sorted name keys. */
  normalizedNameKeys: string[];
  /** Display originals parallel to normalizedNameKeys (first by code-unit name order). */
  displayNames: string[];
  /** All direct directory children (may contain multiple refs sharing a nameKey). */
  childRefs: StructureFolderPatternChildRef[];
  /** Deterministic signature from unique sorted nameKeys (empty string = no dir children). */
  signature: string;
  provenance: StructureFolderPatternProvenance;
}

export interface StructureFolderPatternInsightResult {
  schemaVersion: typeof STRUCTURE_FOLDER_PATTERN_SCHEMA_VERSION;
  features: DirectChildFolderStructureFeature[];
  insight: StructureInsightResult;
}

const PATTERN_PROVENANCE: StructureFolderPatternProvenance = {
  detectorId: STRUCTURE_FOLDER_PATTERN_DETECTOR_ID,
  detectorVersion: STRUCTURE_FOLDER_PATTERN_DETECTOR_VERSION,
};

/** Locale-independent identity key for folder pattern comparison. */
export function folderPatternNameKey(name: string): string {
  return name.toLowerCase();
}

/** Locale-independent deterministic string order (UTF-16 code units). */
export function compareFolderPatternText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function createEmptyStructureFolderPatternInsightResult(): StructureFolderPatternInsightResult {
  return {
    schemaVersion: STRUCTURE_FOLDER_PATTERN_SCHEMA_VERSION,
    features: [],
    insight: createEmptyStructureInsightResult(),
  };
}

export function structureFolderPatternInsightJsonRoundTrip(
  result: StructureFolderPatternInsightResult,
): StructureFolderPatternInsightResult {
  return JSON.parse(JSON.stringify(result)) as StructureFolderPatternInsightResult;
}

/**
 * Build direct child-folder pattern features and observations from P2-B contexts.
 * Pure: does not mutate ScanResult or comparison contexts.
 */
export function buildStructureFolderPatternInsight(
  result: ScanResult,
  comparison: StructureComparisonResult = buildStructureComparisonContexts(result),
): StructureFolderPatternInsightResult {
  const rootPath = result.root.path;
  const nodeById = indexDirectories(result.root);
  const features: DirectChildFolderStructureFeature[] = [];
  const observations: StructureInsightObservation[] = [];

  for (const context of comparison.contexts) {
    const contextFeatures = context.members.map((member) =>
      buildMemberFeature(member.nodeId, member.name, member.relativePath, context.id, nodeById, rootPath),
    );
    features.push(...contextFeatures);
    if (context.comparisonPossible) {
      observations.push(...observationsForContext(context, contextFeatures));
    }
  }

  features.sort((left, right) => {
    const byContext = compareFolderPatternText(left.comparisonContextId, right.comparisonContextId);
    if (byContext !== 0) {
      return byContext;
    }
    return compareFolderPatternText(left.member.nodeId, right.member.nodeId);
  });
  observations.sort((left, right) => compareFolderPatternText(left.id, right.id));

  return {
    schemaVersion: STRUCTURE_FOLDER_PATTERN_SCHEMA_VERSION,
    features,
    insight: {
      schemaVersion: STRUCTURE_INSIGHT_SCHEMA_VERSION,
      observations,
      ruleCandidates: [],
      suggestions: [],
      confirmedExceptions: [],
    },
  };
}

function buildMemberFeature(
  memberNodeId: string,
  memberName: string,
  memberRelativePath: string,
  comparisonContextId: string,
  nodeById: ReadonlyMap<string, DirectoryNode>,
  rootPath: string,
): DirectChildFolderStructureFeature {
  const node = nodeById.get(memberNodeId);
  const listing: DirectoryListing = node?.listing ?? "incomplete";
  const evaluable = node !== undefined && node.listing === "read";
  const childRefs: StructureFolderPatternChildRef[] = [];

  if (evaluable && node !== undefined) {
    const dirs = node.children.filter(isDirectory).slice();
    dirs.sort((left, right) => {
      const byName = compareFolderPatternText(left.name, right.name);
      if (byName !== 0) {
        return byName;
      }
      return compareFolderPatternText(left.id, right.id);
    });
    for (const child of dirs) {
      childRefs.push({
        nodeId: child.id,
        name: child.name,
        relativePath: displayInventoryPath(rootPath, child.path),
        nameKey: folderPatternNameKey(child.name),
      });
    }
  }

  const { normalizedNameKeys, displayNames } = uniqueNameKeysAndDisplays(childRefs);
  return {
    member: nodeRef(memberNodeId, { name: memberName, relativePath: memberRelativePath }),
    comparisonContextId,
    listing,
    evaluable,
    directChildDirectoryCount: childRefs.length,
    normalizedNameKeys,
    displayNames,
    childRefs,
    signature: buildSignature(normalizedNameKeys),
    provenance: PATTERN_PROVENANCE,
  };
}

function uniqueNameKeysAndDisplays(
  childRefs: readonly StructureFolderPatternChildRef[],
): { normalizedNameKeys: string[]; displayNames: string[] } {
  const bestDisplay = new Map<string, string>();
  for (const child of childRefs) {
    const existing = bestDisplay.get(child.nameKey);
    if (existing === undefined || compareFolderPatternText(child.name, existing) < 0) {
      bestDisplay.set(child.nameKey, child.name);
    }
  }
  const normalizedNameKeys = [...bestDisplay.keys()].sort(compareFolderPatternText);
  const displayNames = normalizedNameKeys.map((key) => bestDisplay.get(key) ?? key);
  return { normalizedNameKeys, displayNames };
}

function buildSignature(normalizedNameKeys: readonly string[]): string {
  return normalizedNameKeys.join("\n");
}

function observationsForContext(
  context: StructureComparisonContext,
  features: readonly DirectChildFolderStructureFeature[],
): StructureInsightObservation[] {
  const observations: StructureInsightObservation[] = [];
  const evaluable = features.filter((feature) => feature.evaluable);
  const evaluableCount = evaluable.length;
  const totalCount = context.memberCount;
  const comparisonGroup = context.members.map((member) =>
    nodeRef(member.nodeId, { name: member.name, relativePath: member.relativePath }),
  );

  // Name observations
  const nameKeyToFeatures = new Map<string, DirectChildFolderStructureFeature[]>();
  const displayByKey = new Map<string, string>();
  for (const feature of evaluable) {
    for (let index = 0; index < feature.normalizedNameKeys.length; index += 1) {
      const nameKey = feature.normalizedNameKeys[index];
      const displayName = feature.displayNames[index] ?? nameKey;
      const list = nameKeyToFeatures.get(nameKey);
      if (list === undefined) {
        nameKeyToFeatures.set(nameKey, [feature]);
      } else if (!list.some((item) => item.member.nodeId === feature.member.nodeId)) {
        list.push(feature);
      }
      const existingDisplay = displayByKey.get(nameKey);
      if (existingDisplay === undefined || compareFolderPatternText(displayName, existingDisplay) < 0) {
        displayByKey.set(nameKey, displayName);
      }
    }
  }

  const nameKeys = [...nameKeyToFeatures.keys()].sort(compareFolderPatternText);
  for (const nameKey of nameKeys) {
    const matchedFeatures = (nameKeyToFeatures.get(nameKey) ?? [])
      .slice()
      .sort((left, right) => compareFolderPatternText(left.member.nodeId, right.member.nodeId));
    if (matchedFeatures.length === 0) {
      continue;
    }
    const matchedIds = new Set(matchedFeatures.map((feature) => feature.member.nodeId));
    const counterFeatures = evaluable
      .filter((feature) => !matchedIds.has(feature.member.nodeId))
      .sort((left, right) => compareFolderPatternText(left.member.nodeId, right.member.nodeId));

    observations.push({
      id: observationIdName(context.id, nameKey),
      category: "folderStructure",
      observationType: FOLDER_PATTERN_NAME_OBSERVATION_TYPE,
      scope: { kind: "comparisonSet", nodeIds: context.members.map((member) => member.nodeId) },
      comparisonGroup,
      supportingEvidence: matchedFeatures.map((feature) => {
        const child = feature.childRefs.find((ref) => ref.nameKey === nameKey);
        return evidence(feature.member, "supports", {
          nameKey,
          childNodeId: child?.nodeId ?? null,
          childDisplayName: child?.name ?? displayByKey.get(nameKey) ?? nameKey,
        });
      }),
      counterEvidence: counterFeatures.map((feature) =>
        evidence(feature.member, "counter", {
          nameKey,
          nameObserved: false,
        }),
      ),
      matchedCount: matchedFeatures.length,
      totalCount,
      provenance: {
        detectorId: STRUCTURE_FOLDER_PATTERN_DETECTOR_ID,
        detectorVersion: STRUCTURE_FOLDER_PATTERN_DETECTOR_VERSION,
      },
      patternFeatures: {
        pattern: FOLDER_PATTERN_NAME_OBSERVATION_TYPE,
        nameKey,
        displayName: displayByKey.get(nameKey) ?? nameKey,
        matchedCount: matchedFeatures.length,
        evaluableCount,
        totalCount,
        claimsMissingElements: false,
        comparisonContextId: context.id,
      },
    });
  }

  // Set observations: signatures with ≥2 evaluable peers
  const signatureToFeatures = new Map<string, DirectChildFolderStructureFeature[]>();
  for (const feature of evaluable) {
    const list = signatureToFeatures.get(feature.signature);
    if (list === undefined) {
      signatureToFeatures.set(feature.signature, [feature]);
    } else {
      list.push(feature);
    }
  }

  const repeatedSignatures = [...signatureToFeatures.entries()]
    .filter(([, group]) => group.length >= 2)
    .sort(([left], [right]) => compareFolderPatternText(left, right));

  let setIndex = 0;
  for (const [signature, group] of repeatedSignatures) {
    setIndex += 1;
    const qualifier = `set-${String(setIndex).padStart(4, "0")}`;
    const matchedFeatures = group
      .slice()
      .sort((left, right) => compareFolderPatternText(left.member.nodeId, right.member.nodeId));
    const matchedIds = new Set(matchedFeatures.map((feature) => feature.member.nodeId));
    const counterFeatures = evaluable
      .filter((feature) => !matchedIds.has(feature.member.nodeId))
      .sort((left, right) => compareFolderPatternText(left.member.nodeId, right.member.nodeId));
    const sample = matchedFeatures[0];
    const nameKeys = sample?.normalizedNameKeys ?? [];
    const displayNames = sample?.displayNames ?? [];

    observations.push({
      id: observationIdSet(context.id, qualifier),
      category: "folderStructure",
      observationType: FOLDER_PATTERN_SET_OBSERVATION_TYPE,
      scope: { kind: "comparisonSet", nodeIds: context.members.map((member) => member.nodeId) },
      comparisonGroup,
      supportingEvidence: matchedFeatures.map((feature) =>
        evidence(feature.member, "supports", {
          signature,
          signatureChildCount: feature.normalizedNameKeys.length,
        }),
      ),
      counterEvidence: counterFeatures.map((feature) =>
        evidence(feature.member, "counter", {
          signature: feature.signature,
          sameSignature: false,
        }),
      ),
      matchedCount: matchedFeatures.length,
      totalCount,
      provenance: {
        detectorId: STRUCTURE_FOLDER_PATTERN_DETECTOR_ID,
        detectorVersion: STRUCTURE_FOLDER_PATTERN_DETECTOR_VERSION,
      },
      patternFeatures: {
        pattern: FOLDER_PATTERN_SET_OBSERVATION_TYPE,
        signature,
        nameKeys: nameKeys.join("\n"),
        displayNames: displayNames.join("\n"),
        nameKeyCount: nameKeys.length,
        setQualifier: qualifier,
        matchedCount: matchedFeatures.length,
        evaluableCount,
        totalCount,
        claimsMissingElements: false,
        comparisonContextId: context.id,
      },
    });
  }

  return observations;
}

function observationIdName(contextId: string, nameKey: string): string {
  return `obs:${STRUCTURE_FOLDER_PATTERN_DETECTOR_ID}:${FOLDER_PATTERN_NAME_OBSERVATION_TYPE}:${contextId}:${nameKey}`;
}

function observationIdSet(contextId: string, setQualifier: string): string {
  return `obs:${STRUCTURE_FOLDER_PATTERN_DETECTOR_ID}:${FOLDER_PATTERN_SET_OBSERVATION_TYPE}:${contextId}:${setQualifier}`;
}

function indexDirectories(root: DirectoryNode): Map<string, DirectoryNode> {
  const index = new Map<string, DirectoryNode>();
  function walk(node: DirectoryNode): void {
    index.set(node.id, node);
    for (const child of node.children) {
      if (isDirectory(child)) {
        walk(child);
      }
    }
  }
  walk(root);
  return index;
}

/** Guard helper for tests / verifiers. */
export function structureFolderPatternResultHasForbiddenClaims(
  result: StructureFolderPatternInsightResult,
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
  if (/"missingFolder"\s*:/.test(serialized)) {
    return true;
  }
  if (/"missingChild"\s*:/.test(serialized)) {
    return true;
  }
  if (/"missingElement"\s*:/.test(serialized)) {
    return true;
  }
  if (/"requiredFolder"\s*:/.test(serialized)) {
    return true;
  }
  if (/"expectedFolder"\s*:/.test(serialized)) {
    return true;
  }
  if (/"shouldExist"\s*:/.test(serialized)) {
    return true;
  }
  if (/"shouldCreate"\s*:/.test(serialized)) {
    return true;
  }
  return false;
}

export function structureFolderPatternInsightRoundTripEquals(
  result: StructureFolderPatternInsightResult,
): boolean {
  const round = structureFolderPatternInsightJsonRoundTrip(result);
  const insightRound = structureInsightJsonRoundTrip(result.insight);
  return (
    JSON.stringify(round) === JSON.stringify(result) &&
    JSON.stringify(insightRound) === JSON.stringify(result.insight)
  );
}
