/**
 * P2-J-J.2 – Pure integration helpers for scan-failure recovery,
 * insight→tree reveal under display filters, and pending-reveal commit policy.
 *
 * No React, no filesystem, no H/I/J-A orchestration.
 */

import type { FsNode } from "../model";
import { shouldClearScanResultOnError } from "../scan";
import { nodeVisibleInDisplayTree } from "./displayFilter";
import type { InsightAnalysisError, InsightAnalysisPhase } from "./structureInsightAnalysis";
import type { MainView } from "./structureInsightsViewHelpers";
import type { StructureInsightViewModel } from "./structureInsightViewModel";
import { findNodeById } from "./treeRows";
import { WARNING_HIDDEN_BY_FILTER_NOTICE } from "./warningNavigation";

/** Snapshot of insight analysis UI state to restore after a rejected scan begin. */
export interface InsightAnalysisUiSnapshot {
  phase: InsightAnalysisPhase;
  viewModel: StructureInsightViewModel | null;
  error: InsightAnalysisError | null;
  analysisScanId: number | null;
  mainView: MainView;
}

export type InsightTreeRevealKind = "reveal" | "hidden-by-filter" | "missing";

export interface InsightTreeRevealPlan {
  kind: InsightTreeRevealKind;
  nodeId: string | null;
  notice: string | null;
  applyReveal: boolean;
  offerFilterReset: boolean;
}

/** Same wording as warning navigation – target exists but Anzeigefilter hides it. */
export const INSIGHT_TREE_HIDDEN_BY_FILTER_NOTICE = WARNING_HIDDEN_BY_FILTER_NOTICE;

/**
 * After a scan attempt fails: keep the previous ScanResult (and its analysis)
 * only when the begin was rejected without consuming the prior successful scan.
 */
export function shouldRestorePreviousScanAndInsightsOnError(error: unknown): boolean {
  return !shouldClearScanResultOnError(error);
}

export function captureInsightAnalysisUiSnapshot(input: InsightAnalysisUiSnapshot): InsightAnalysisUiSnapshot {
  return {
    phase: input.phase,
    viewModel: input.viewModel,
    error: input.error,
    analysisScanId: input.analysisScanId,
    mainView: input.mainView,
  };
}

/**
 * Decide how insight→tree navigation should behave given the current display tree.
 * Does not mutate filters; when hidden, offers an explicit filter reset.
 */
export function resolveInsightTreeReveal(
  snapshotRoot: FsNode,
  viewRoot: FsNode | null,
  nodeId: string,
): InsightTreeRevealPlan {
  if (findNodeById(snapshotRoot, nodeId) === undefined) {
    return {
      kind: "missing",
      nodeId: null,
      notice: null,
      applyReveal: false,
      offerFilterReset: false,
    };
  }
  if (viewRoot === null || !nodeVisibleInDisplayTree(viewRoot, nodeId)) {
    return {
      kind: "hidden-by-filter",
      nodeId,
      notice: INSIGHT_TREE_HIDDEN_BY_FILTER_NOTICE,
      applyReveal: false,
      offerFilterReset: true,
    };
  }
  return {
    kind: "reveal",
    nodeId,
    notice: null,
    applyReveal: true,
    offerFilterReset: false,
  };
}

/**
 * Pending reveal must stay open until the viewport is measurable.
 * Clearing early while display:none (clientHeight 0) loses the scroll after show.
 */
export function canCommitPendingTreeReveal(input: {
  pendingNodeId: string | null;
  rowIndex: number;
  viewportClientHeight: number;
}): boolean {
  if (input.pendingNodeId === null) {
    return false;
  }
  if (input.rowIndex < 0) {
    return false;
  }
  return input.viewportClientHeight > 0;
}
