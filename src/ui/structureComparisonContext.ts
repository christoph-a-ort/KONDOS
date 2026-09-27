/**
 * P2-B – Local structural comparison contexts (sibling folders).
 *
 * Answers only: which folders share a local structural comparison context,
 * and which deterministic structure features do they have?
 *
 * Does NOT decide: sameness of purpose, correctness, rules, or suggestions.
 * Divergent siblings stay in the group — features only, no culling.
 *
 * Node ids are scan-local (same semantics as P2-A).
 */

import { isDirectory, isFile, type DirectoryNode, type ScanResult } from "../model";
import { displayInventoryPath } from "./inventoryOverview";
import type { StructureInsightNodeRef } from "./structureInsightModel";

export const STRUCTURE_COMPARISON_SCHEMA_VERSION = 1 as const;
export const STRUCTURE_COMPARISON_BUILDER_ID = "sibling-folder-comparison" as const;
export const STRUCTURE_COMPARISON_BUILDER_VERSION = 1 as const;

/** Why a context with members still cannot support a real peer comparison. */
export type StructureComparisonIneligibilityReason = "singleDirectDirectory";

export interface StructureComparisonBuilderProvenance {
  builderId: typeof STRUCTURE_COMPARISON_BUILDER_ID;
  builderVersion: typeof STRUCTURE_COMPARISON_BUILDER_VERSION;
}

/**
 * Deterministic structure features for one comparison member (a folder).
 * Display fields are aids only — not join keys.
 */
export interface StructureComparisonMemberFeatures {
  nodeId: string;
  name: string;
  relativePath: string;
  depth: number;
  directDirectoryCount: number;
  directFileCount: number;
  /** Directories in the subtree excluding the member itself. */
  subtreeDirectoryCount: number;
  /** Files anywhere under the member. */
  subtreeFileCount: number;
  /**
   * Max depth of any descendant relative to this folder (0 = no children).
   * Files and directories both count as depth levels.
   */
  maxRelativeSubtreeDepth: number;
  isEmpty: boolean;
  hasDirectFiles: boolean;
  hasDirectDirectories: boolean;
}

/**
 * Sibling-folder comparison context under one parent directory.
 * Members are always the full set of direct child directories (never culled for dissimilarity).
 */
export interface StructureComparisonContext {
  /** Deterministic, scan-local id: `siblings:<parentNodeId>`. */
  id: string;
  parent: StructureInsightNodeRef;
  members: StructureComparisonMemberFeatures[];
  memberCount: number;
  /** True when at least two sibling folders exist. */
  comparisonPossible: boolean;
  /** Set when members exist but comparison is not possible (e.g. only one sibling). */
  ineligibilityReason: StructureComparisonIneligibilityReason | null;
  provenance: StructureComparisonBuilderProvenance;
}

export interface StructureComparisonResult {
  schemaVersion: typeof STRUCTURE_COMPARISON_SCHEMA_VERSION;
  contexts: StructureComparisonContext[];
}

export function createEmptyStructureComparisonResult(): StructureComparisonResult {
  return {
    schemaVersion: STRUCTURE_COMPARISON_SCHEMA_VERSION,
    contexts: [],
  };
}

export function structureComparisonJsonRoundTrip(
  result: StructureComparisonResult,
): StructureComparisonResult {
  return JSON.parse(JSON.stringify(result)) as StructureComparisonResult;
}

/**
 * Build sibling-folder comparison contexts for every directory in the scan that
 * has at least one direct subdirectory.
 *
 * - 0 direct directories → no context
 * - 1 direct directory → context with comparisonPossible=false
 * - 2+ → comparisonPossible=true
 *
 * Pure: does not mutate ScanResult.
 */
export function buildStructureComparisonContexts(result: ScanResult): StructureComparisonResult {
  const rootPath = result.root.path;
  const contexts: StructureComparisonContext[] = [];

  function visit(parent: DirectoryNode): void {
    const childDirectories = parent.children.filter(isDirectory).slice();
    childDirectories.sort((left, right) => compareText(left.path, right.path));

    if (childDirectories.length >= 1) {
      const members = childDirectories.map((child) => buildMemberFeatures(child, rootPath));
      const comparisonPossible = members.length >= 2;
      contexts.push({
        id: siblingContextId(parent.id),
        parent: {
          nodeId: parent.id,
          name: parent.name,
          relativePath: displayInventoryPath(rootPath, parent.path),
        },
        members,
        memberCount: members.length,
        comparisonPossible,
        ineligibilityReason: comparisonPossible ? null : "singleDirectDirectory",
        provenance: {
          builderId: STRUCTURE_COMPARISON_BUILDER_ID,
          builderVersion: STRUCTURE_COMPARISON_BUILDER_VERSION,
        },
      });
    }

    for (const child of childDirectories) {
      visit(child);
    }
  }

  visit(result.root);
  contexts.sort((left, right) => compareText(left.parent.nodeId, right.parent.nodeId));

  return {
    schemaVersion: STRUCTURE_COMPARISON_SCHEMA_VERSION,
    contexts,
  };
}

export function siblingContextId(parentNodeId: string): string {
  return `siblings:${parentNodeId}`;
}

function buildMemberFeatures(node: DirectoryNode, rootPath: string): StructureComparisonMemberFeatures {
  const directDirectories = node.children.filter(isDirectory);
  const directFiles = node.children.filter(isFile);
  const subtree = measureSubtree(node);
  const directDirectoryCount = directDirectories.length;
  const directFileCount = directFiles.length;
  return {
    nodeId: node.id,
    name: node.name,
    relativePath: displayInventoryPath(rootPath, node.path),
    depth: node.depth,
    directDirectoryCount,
    directFileCount,
    subtreeDirectoryCount: subtree.directoryCount,
    subtreeFileCount: subtree.fileCount,
    maxRelativeSubtreeDepth: subtree.maxRelativeDepth,
    isEmpty: directDirectoryCount === 0 && directFileCount === 0,
    hasDirectFiles: directFileCount > 0,
    hasDirectDirectories: directDirectoryCount > 0,
  };
}

function measureSubtree(node: DirectoryNode): {
  directoryCount: number;
  fileCount: number;
  maxRelativeDepth: number;
} {
  let directoryCount = 0;
  let fileCount = 0;
  let maxRelativeDepth = 0;

  function walk(current: DirectoryNode, relativeDepth: number): void {
    for (const child of current.children) {
      const childRelative = relativeDepth + 1;
      if (childRelative > maxRelativeDepth) {
        maxRelativeDepth = childRelative;
      }
      if (isDirectory(child)) {
        directoryCount += 1;
        walk(child, childRelative);
      } else if (isFile(child)) {
        fileCount += 1;
      }
    }
  }

  walk(node, 0);
  return { directoryCount, fileCount, maxRelativeDepth };
}

function compareText(left: string, right: string): number {
  const order = left.localeCompare(right, undefined, { sensitivity: "base" });
  if (order !== 0) {
    return order;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}
