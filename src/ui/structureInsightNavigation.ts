/**
 * P2-J-F – Pure helpers for insight ↔ tree navigation and folder markers.
 * No React, no filesystem, no H/I/J-A orchestration.
 */

import type { FsNode } from "../model";
import { findNodeById } from "./treeRows";
import type { StructureInsightViewModel } from "./structureInsightViewModel";

/** Request TreeView to reveal a scan node (virtualization-safe). */
export interface TreeRevealRequest {
  id: number;
  scanId: number;
  nodeId: string;
}

/** Request StructureInsightsView to show/highlight a location's insights. */
export interface InsightFocusRequest {
  id: number;
  scanId: number;
  locationId: string;
  firstInsightId: string;
}

export const INSIGHT_SHOW_IN_TREE_LABEL = "Im Strukturbaum anzeigen";

/**
 * Map folder/root locationId → insight IDs in ViewModel order.
 * Counts only insights whose fundort is that location (no child aggregation).
 */
export function buildFolderInsightIdsByLocation(
  viewModel: StructureInsightViewModel | null,
): ReadonlyMap<string, readonly string[]> {
  const map = new Map<string, readonly string[]>();
  if (viewModel === null) {
    return map;
  }
  for (const location of viewModel.locations) {
    if (location.insightIds.length === 0) {
      continue;
    }
    map.set(location.locationId, location.insightIds);
  }
  return map;
}

export function insightCountForFolder(
  folderInsightIdsByLocation: ReadonlyMap<string, readonly string[]>,
  folderNodeId: string,
): number {
  return folderInsightIdsByLocation.get(folderNodeId)?.length ?? 0;
}

export function insightMarkerTooltip(count: number): string {
  if (count === 1) {
    return "1 Erkenntnis von Dotty";
  }
  return `${count} Erkenntnisse von Dotty`;
}

export function insightMarkerAriaLabel(count: number, folderName: string): string {
  const name = folderName.trim().length > 0 ? folderName.trim() : "Ordner";
  if (count === 1) {
    return `1 Erkenntnis von Dotty für ${name}`;
  }
  return `${count} Erkenntnisse von Dotty für ${name}`;
}

export function insightMarkerCountLabel(count: number): string {
  if (count <= 1) {
    return "";
  }
  return String(count);
}

/** True only when the node exists in the current scan tree. */
export function canNavigateToScanNode(root: FsNode, nodeId: string): boolean {
  return findNodeById(root, nodeId) !== undefined;
}

export function firstInsightIdForLocation(
  viewModel: StructureInsightViewModel,
  locationId: string,
): string | null {
  for (const location of viewModel.locations) {
    if (location.locationId === locationId && location.insightIds.length > 0) {
      return location.insightIds[0] ?? null;
    }
  }
  return null;
}

export function shouldAcceptTreeRevealRequest(
  request: TreeRevealRequest | null,
  currentScanId: number | null,
): request is TreeRevealRequest {
  return request !== null && currentScanId !== null && request.scanId === currentScanId;
}

export function shouldAcceptInsightFocusRequest(
  request: InsightFocusRequest | null,
  currentScanId: number | null,
): request is InsightFocusRequest {
  return request !== null && currentScanId !== null && request.scanId === currentScanId;
}
