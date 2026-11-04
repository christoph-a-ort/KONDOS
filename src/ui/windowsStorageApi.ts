import { invoke } from "@tauri-apps/api/core";
import type { ScanResult } from "../model";
import {
  applyStorageClassification,
  existingStoragePathsForDryRun,
  parseStorageKind,
  type StorageKindView,
} from "./windowsStorage";
import type { VirtualDryRunReport } from "./virtualPlanDryRun";

export function inspectStorageKind(path: string): Promise<StorageKindView> {
  return invoke<StorageKindView>("inspect_storage_kind", { path });
}

export function inspectStorageKinds(paths: ReadonlyArray<string>): Promise<StorageKindView[]> {
  return invoke<StorageKindView[]>("inspect_storage_kinds", { paths });
}

export async function classifyDryRunReportStorage(
  scanRoot: string,
  scanResult: ScanResult,
  report: VirtualDryRunReport,
  inspect: (paths: ReadonlyArray<string>) => Promise<StorageKindView[]> = inspectStorageKinds,
): Promise<VirtualDryRunReport> {
  const paths = existingStoragePathsForDryRun(scanRoot, scanResult, report.operations);
  if (paths.length === 0) {
    return applyStorageClassification(report, ["unverifiable"]);
  }
  try {
    const views = await inspect(paths);
    if (!Array.isArray(views) || views.length === 0) {
      return applyStorageClassification(report, ["unverifiable"]);
    }
    return applyStorageClassification(report, views.map((view) => parseStorageKind(view?.kind)));
  } catch {
    return applyStorageClassification(report, ["unverifiable"]);
  }
}
