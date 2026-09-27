/**
 * P2-E – Local file-name structure insights (direct files under one parent).
 *
 * Observes recurring stem token forms. Does not decide naming rules or renames.
 * No RuleCandidates, Suggestions, confirmedExceptions, or filesystem actions.
 *
 * Identity: scan-local nodeId. Paths are display/sort only.
 * Text compare: toLowerCase() (not toLocaleLowerCase). Sort: UTF-16 code units.
 * Extension is stored on features but is NOT part of the form signature (→ P2-F).
 * No date/year semantics (→ later / P2-C). No cross-parent analysis (→ P2-G).
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

export const STRUCTURE_FILE_NAME_SCHEMA_VERSION = 1 as const;
export const STRUCTURE_FILE_NAME_DETECTOR_ID = "file-name-structure" as const;
export const STRUCTURE_FILE_NAME_DETECTOR_VERSION = 1 as const;
export const FILE_NAME_FORM_OBSERVATION_TYPE = "file-name-form-among-peers" as const;

export type FileNameTokenKind = "text" | "digits" | "separator" | "whitespace";

export interface FileNameToken {
  kind: FileNameTokenKind;
  value: string;
  /** Present for text tokens: locale-independent lower case. */
  normalizedValue?: string;
  /** Present for digits tokens. */
  length?: number;
}

export interface StructureFileNameProvenance {
  detectorId: typeof STRUCTURE_FILE_NAME_DETECTOR_ID;
  detectorVersion: typeof STRUCTURE_FILE_NAME_DETECTOR_VERSION;
}

export interface FileNameStructureFeature {
  file: StructureInsightNodeRef;
  parent: StructureInsightNodeRef;
  comparisonContextId: string;
  originalName: string;
  stem: string;
  hasExtension: boolean;
  extensionKey: string | null;
  tokens: FileNameToken[];
  formSignature: string;
  provenance: StructureFileNameProvenance;
}

export interface FileNameComparisonContext {
  id: string;
  parent: StructureInsightNodeRef;
  members: StructureInsightNodeRef[];
  memberCount: number;
  listing: DirectoryListing;
  /** True only when listing === "read". */
  evaluable: boolean;
  evaluableCount: number;
  totalCount: number;
  comparisonPossible: boolean;
}

export interface FileNameFormPositionAnalysis {
  index: number;
  kind: FileNameTokenKind;
  constant: boolean;
  constantValue: string | null;
  constantDisplay: string | null;
  distinctValueCount: number;
  digitsLength: number | null;
}

export interface StructureFileNameInsightResult {
  schemaVersion: typeof STRUCTURE_FILE_NAME_SCHEMA_VERSION;
  contexts: FileNameComparisonContext[];
  features: FileNameStructureFeature[];
  insight: StructureInsightResult;
}

const FILE_NAME_PROVENANCE: StructureFileNameProvenance = {
  detectorId: STRUCTURE_FILE_NAME_DETECTOR_ID,
  detectorVersion: STRUCTURE_FILE_NAME_DETECTOR_VERSION,
};

/** Locale-independent deterministic string order (UTF-16 code units). */
export function compareFileNameText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function createEmptyStructureFileNameInsightResult(): StructureFileNameInsightResult {
  return {
    schemaVersion: STRUCTURE_FILE_NAME_SCHEMA_VERSION,
    contexts: [],
    features: [],
    insight: createEmptyStructureInsightResult(),
  };
}

export function structureFileNameInsightJsonRoundTrip(
  result: StructureFileNameInsightResult,
): StructureFileNameInsightResult {
  return JSON.parse(JSON.stringify(result)) as StructureFileNameInsightResult;
}

export function fileNameContextId(parentNodeId: string): string {
  return `files:${parentNodeId}`;
}

/**
 * Mechanical stem/extension split (last-dot rule).
 * Does not import inventory/report helpers.
 */
export function splitFileName(originalName: string): {
  stem: string;
  hasExtension: boolean;
  extensionKey: string | null;
} {
  const lastDot = originalName.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === originalName.length - 1) {
    return { stem: originalName, hasExtension: false, extensionKey: null };
  }
  return {
    stem: originalName.slice(0, lastDot),
    hasExtension: true,
    extensionKey: originalName.slice(lastDot).toLowerCase(),
  };
}

/** ASCII punctuation treated as separator (not letter/digit, not whitespace). */
export function isFileNameAsciiSeparatorChar(character: string): boolean {
  if (character.length !== 1) {
    return false;
  }
  const code = character.charCodeAt(0);
  if (code < 33 || code > 126) {
    return false;
  }
  if (code >= 48 && code <= 57) {
    return false;
  }
  if (code >= 65 && code <= 90) {
    return false;
  }
  if (code >= 97 && code <= 122) {
    return false;
  }
  return true;
}

export function isFileNameAsciiDigitChar(character: string): boolean {
  if (character.length !== 1) {
    return false;
  }
  const code = character.charCodeAt(0);
  return code >= 48 && code <= 57;
}

export function isFileNameWhitespaceChar(character: string): boolean {
  if (character.length !== 1) {
    return false;
  }
  return /\s/.test(character);
}

/**
 * Loss-free stem tokenization: tokens.map(t => t.value).join("") === stem.
 */
export function tokenizeFileNameStem(stem: string): FileNameToken[] {
  const tokens: FileNameToken[] = [];
  let index = 0;
  while (index < stem.length) {
    const character = stem[index];
    if (isFileNameWhitespaceChar(character)) {
      let end = index + 1;
      while (end < stem.length && isFileNameWhitespaceChar(stem[end])) {
        end += 1;
      }
      tokens.push({ kind: "whitespace", value: stem.slice(index, end) });
      index = end;
      continue;
    }
    if (isFileNameAsciiDigitChar(character)) {
      let end = index + 1;
      while (end < stem.length && isFileNameAsciiDigitChar(stem[end])) {
        end += 1;
      }
      const value = stem.slice(index, end);
      tokens.push({ kind: "digits", value, length: value.length });
      index = end;
      continue;
    }
    if (isFileNameAsciiSeparatorChar(character)) {
      let end = index + 1;
      while (end < stem.length && stem[end] === character) {
        end += 1;
      }
      tokens.push({ kind: "separator", value: stem.slice(index, end) });
      index = end;
      continue;
    }
    let end = index + 1;
    while (
      end < stem.length &&
      !isFileNameWhitespaceChar(stem[end]) &&
      !isFileNameAsciiDigitChar(stem[end]) &&
      !isFileNameAsciiSeparatorChar(stem[end])
    ) {
      end += 1;
    }
    const value = stem.slice(index, end);
    tokens.push({ kind: "text", value, normalizedValue: value.toLowerCase() });
    index = end;
  }
  return tokens;
}

export function formSignatureFromTokens(tokens: readonly FileNameToken[]): string {
  return tokens
    .map((token) => {
      switch (token.kind) {
        case "text":
          return "text";
        case "digits":
          return `digits:${token.length ?? token.value.length}`;
        case "separator":
          return `sep:${JSON.stringify(token.value)}`;
        case "whitespace":
          return `ws:${JSON.stringify(token.value)}`;
      }
    })
    .join("|");
}

export function tokensReconstructStem(tokens: readonly FileNameToken[]): string {
  return tokens.map((token) => token.value).join("");
}

/**
 * Build local file-name structure contexts, features, and form observations.
 * Pure: does not mutate ScanResult.
 */
export function buildStructureFileNameInsight(result: ScanResult): StructureFileNameInsightResult {
  const rootPath = result.root.path;
  const contexts: FileNameComparisonContext[] = [];
  const features: FileNameStructureFeature[] = [];
  const observations: StructureInsightObservation[] = [];

  function visit(parent: DirectoryNode): void {
    const directFiles = parent.children.filter(isFile).slice();
    directFiles.sort((left, right) => {
      const byName = compareFileNameText(left.name, right.name);
      if (byName !== 0) {
        return byName;
      }
      return compareFileNameText(left.id, right.id);
    });

    const contextId = fileNameContextId(parent.id);
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
    });

    if (evaluable) {
      const contextFeatures: FileNameStructureFeature[] = [];
      for (const file of directFiles) {
        const feature = buildFileFeature(file, parentRef, contextId, rootPath);
        contextFeatures.push(feature);
        features.push(feature);
      }
      if (comparisonPossible) {
        observations.push(...observationsForContext(contextId, members, contextFeatures, totalCount, evaluableCount));
      }
    }

    for (const child of parent.children) {
      if (isDirectory(child)) {
        visit(child);
      }
    }
  }

  visit(result.root);

  contexts.sort((left, right) => compareFileNameText(left.id, right.id));
  features.sort((left, right) => {
    const byContext = compareFileNameText(left.comparisonContextId, right.comparisonContextId);
    if (byContext !== 0) {
      return byContext;
    }
    return compareFileNameText(left.file.nodeId, right.file.nodeId);
  });
  observations.sort((left, right) => compareFileNameText(left.id, right.id));

  return {
    schemaVersion: STRUCTURE_FILE_NAME_SCHEMA_VERSION,
    contexts,
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

function buildFileFeature(
  file: FileNode,
  parent: StructureInsightNodeRef,
  comparisonContextId: string,
  rootPath: string,
): FileNameStructureFeature {
  const split = splitFileName(file.name);
  const tokens = tokenizeFileNameStem(split.stem);
  return {
    file: nodeRef(file.id, {
      name: file.name,
      relativePath: displayInventoryPath(rootPath, file.path),
    }),
    parent,
    comparisonContextId,
    originalName: file.name,
    stem: split.stem,
    hasExtension: split.hasExtension,
    extensionKey: split.extensionKey,
    tokens,
    formSignature: formSignatureFromTokens(tokens),
    provenance: FILE_NAME_PROVENANCE,
  };
}

function observationsForContext(
  contextId: string,
  members: readonly StructureInsightNodeRef[],
  contextFeatures: readonly FileNameStructureFeature[],
  totalCount: number,
  evaluableCount: number,
): StructureInsightObservation[] {
  const bySignature = new Map<string, FileNameStructureFeature[]>();
  for (const feature of contextFeatures) {
    const list = bySignature.get(feature.formSignature);
    if (list === undefined) {
      bySignature.set(feature.formSignature, [feature]);
    } else {
      list.push(feature);
    }
  }

  const sortedGroups = [...bySignature.entries()].sort(([left], [right]) =>
    compareFileNameText(left, right),
  );

  const observations: StructureInsightObservation[] = [];
  let formIndex = 0;
  for (const [formSignature, group] of sortedGroups) {
    formIndex += 1;
    const qualifier = `form-${String(formIndex).padStart(4, "0")}`;
    if (group.length < 2) {
      continue;
    }

    const matchedFeatures = group
      .slice()
      .sort((left, right) => compareFileNameText(left.file.nodeId, right.file.nodeId));
    const matchedIds = new Set(matchedFeatures.map((feature) => feature.file.nodeId));
    const counterFeatures = contextFeatures
      .filter((feature) => !matchedIds.has(feature.file.nodeId))
      .sort((left, right) => compareFileNameText(left.file.nodeId, right.file.nodeId));

    const positions = analyzePositions(matchedFeatures);
    const sample = matchedFeatures[0];

    observations.push({
      id: observationId(contextId, qualifier),
      category: "fileNamePattern",
      observationType: FILE_NAME_FORM_OBSERVATION_TYPE,
      scope: { kind: "comparisonSet", nodeIds: members.map((member) => member.nodeId) },
      comparisonGroup: members.slice(),
      supportingEvidence: matchedFeatures.map((feature) =>
        evidence(feature.file, "supports", {
          formSignature: feature.formSignature,
          stem: feature.stem,
          tokenCount: feature.tokens.length,
          extensionKey: feature.extensionKey,
        }),
      ),
      counterEvidence: counterFeatures.map((feature) =>
        evidence(feature.file, "counter", {
          formSignature: feature.formSignature,
          sameForm: false,
        }),
      ),
      matchedCount: matchedFeatures.length,
      totalCount,
      provenance: {
        detectorId: STRUCTURE_FILE_NAME_DETECTOR_ID,
        detectorVersion: STRUCTURE_FILE_NAME_DETECTOR_VERSION,
      },
      patternFeatures: {
        pattern: FILE_NAME_FORM_OBSERVATION_TYPE,
        formSignature,
        matchedCount: matchedFeatures.length,
        evaluableCount,
        totalCount,
        tokenCount: sample?.tokens.length ?? 0,
        positionsJson: JSON.stringify(positions),
        claimsMissingElements: false,
        comparisonContextId: contextId,
        formQualifier: qualifier,
      },
    });
  }

  return observations;
}

function analyzePositions(
  matchedFeatures: readonly FileNameStructureFeature[],
): FileNameFormPositionAnalysis[] {
  const sample = matchedFeatures[0];
  if (sample === undefined) {
    return [];
  }
  const positions: FileNameFormPositionAnalysis[] = [];
  for (let index = 0; index < sample.tokens.length; index += 1) {
    const kind = sample.tokens[index].kind;
    const values = matchedFeatures.map((feature) => positionCompareValue(feature.tokens[index]));
    const distinct = new Set(values);
    const constant = distinct.size === 1;
    const token = sample.tokens[index];
    positions.push({
      index,
      kind,
      constant,
      constantValue: constant ? values[0] ?? null : null,
      constantDisplay: constant ? token.value : null,
      distinctValueCount: distinct.size,
      digitsLength: kind === "digits" ? (token.length ?? token.value.length) : null,
    });
  }
  return positions;
}

function positionCompareValue(token: FileNameToken): string {
  switch (token.kind) {
    case "text":
      return token.normalizedValue ?? token.value.toLowerCase();
    case "digits":
    case "separator":
    case "whitespace":
      return token.value;
  }
}

function observationId(contextId: string, formQualifier: string): string {
  return `obs:${STRUCTURE_FILE_NAME_DETECTOR_ID}:${FILE_NAME_FORM_OBSERVATION_TYPE}:${contextId}:${formQualifier}`;
}

export function structureFileNameResultHasForbiddenClaims(
  result: StructureFileNameInsightResult,
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
  if (/"missingToken"\s*:/.test(serialized)) {
    return true;
  }
  if (/"shouldRename"\s*:/.test(serialized)) {
    return true;
  }
  if (/"wrongName"\s*:/.test(serialized)) {
    return true;
  }
  if (/"requiredPattern"\s*:/.test(serialized)) {
    return true;
  }
  if (/"expectedPattern"\s*:/.test(serialized)) {
    return true;
  }
  return false;
}

export function structureFileNameInsightRoundTripEquals(
  result: StructureFileNameInsightResult,
): boolean {
  const round = structureFileNameInsightJsonRoundTrip(result);
  const insightRound = structureInsightJsonRoundTrip(result.insight);
  return (
    JSON.stringify(round) === JSON.stringify(result) &&
    JSON.stringify(insightRound) === JSON.stringify(result.insight)
  );
}
