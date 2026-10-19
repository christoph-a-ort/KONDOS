import { invoke } from "@tauri-apps/api/core";
import type { BoundExecutionStatus } from "./virtualPlanJournal";

export interface BoundExecutionView {
  status: BoundExecutionStatus;
  journalId: string | null;
  ownerRunId: string | null;
  journalRevision: number | null;
  journalJson: string | null;
  message: string;
}

export function inspectBoundExecution(scanRoot: string): Promise<BoundExecutionView> {
  return invoke<BoundExecutionView>("inspect_bound_execution", { scanRoot });
}

export function startBoundExecution(
  scanRoot: string,
  ownerRunId: string,
  journalId: string,
  expectedRevision: number,
  journalJson: string,
): Promise<BoundExecutionView> {
  return invoke<BoundExecutionView>("start_bound_execution", {
    scanRoot, ownerRunId, journalId, expectedRevision, journalJson,
  });
}

export function progressBoundExecution(
  scanRoot: string,
  ownerRunId: string,
  journalId: string,
  expectedRevision: number,
  journalJson: string,
): Promise<BoundExecutionView> {
  return invoke<BoundExecutionView>("progress_bound_execution", {
    scanRoot, ownerRunId, journalId, expectedRevision, journalJson,
  });
}

export function prepareBoundRelease(
  scanRoot: string,
  ownerRunId: string,
  journalId: string,
  expectedRevision: number,
  journalJson: string,
): Promise<BoundExecutionView> {
  return invoke<BoundExecutionView>("prepare_bound_release", {
    scanRoot, ownerRunId, journalId, expectedRevision, journalJson,
  });
}

export function releaseBoundExecution(
  scanRoot: string,
  ownerRunId: string,
  journalId: string,
  expectedRevision: number,
  journalJson: string,
): Promise<BoundExecutionView> {
  return invoke<BoundExecutionView>("release_bound_execution", {
    scanRoot, ownerRunId, journalId, expectedRevision, journalJson,
  });
}
