/** P2-L.10b.7b: name-suggestion apply uses the existing workbench rename/MOVE path. */
import { isFile, type FsNode } from "../model";
import { applySuggestedFileName } from "./namingRules";
import { workbenchNameSuggestRequest } from "./treeWorkbenchNameSuggest";
import {
  workbenchRenameApplyFromMoveResult,
  type WorkbenchRenameApplyResult,
  type WorkbenchRenameRequest,
} from "./treeWorkbenchRename";
import type { MoveFileResult } from "./virtualPlanExecutionApi";

export type NameSuggestPrepareResult =
  | { status: "ready"; request: WorkbenchRenameRequest; fileName: string }
  | { status: "unchanged"; reason: string }
  | { status: "blocked"; reason: string };

export function prepareNameSuggestApply(
  scanRoot: string,
  source: FsNode,
  originalName: string,
  typedName: string,
): NameSuggestPrepareResult {
  if (!isFile(source)) {
    return { status: "blocked", reason: "Nur einzelne Dateien können umbenannt werden." };
  }
  const preparedName = applySuggestedFileName(originalName, typedName);
  if (!preparedName.ok) {
    return {
      status: preparedName.unchanged ? "unchanged" : "blocked",
      reason: preparedName.reason,
    };
  }
  const prepared = workbenchNameSuggestRequest(scanRoot, source, preparedName.fileName);
  if (!prepared.ok) {
    return {
      status: prepared.unchanged ? "unchanged" : "blocked",
      reason: prepared.reason,
    };
  }
  return { status: "ready", request: prepared.request, fileName: preparedName.fileName };
}

export function workbenchRenameOccupancyBlockReason(busy: {
  moveBusy: boolean;
  scanLocked: boolean;
  scanning: boolean;
  exportBusy: boolean;
  preparingContent: boolean;
}): string | null {
  if (busy.moveBusy || busy.scanLocked || busy.scanning || busy.exportBusy || busy.preparingContent) {
    return "Die Arbeitsfläche ist gerade beschäftigt. Die Umbenennung wurde nicht ausgeführt.";
  }
  return null;
}

export function nameSuggestApplyFromMoveResult(result: MoveFileResult): WorkbenchRenameApplyResult {
  return workbenchRenameApplyFromMoveResult(result);
}

export function shouldCloseNameSuggestAfterApply(result: WorkbenchRenameApplyResult): boolean {
  return result.ok;
}
