/** P2-L.7 / P2-L.7a: Explorer-like inline file rename in the workbench tree. */
import { isFile, type FsNode } from "../model";
import {
  hasCompleteFileFingerprint,
  incompleteFileFingerprintReason,
} from "./virtualPlanPreflight";
import { isAllowedWindowsComponent } from "./windowsPathRules";
import type { MoveFileResult } from "./virtualPlanExecutionApi";
import { realFileMoveWorkbenchEvent, type RealFileMoveWorkbenchEvent } from "./virtualPlanExecution";
import { joinScanPath, parentDirectoryPath } from "./treeWorkbenchMove";

export interface WorkbenchRenameRequest {
  scanRoot: string;
  sourcePath: string;
  targetPath: string;
  oldName: string;
  newName: string;
  expectedSizeBytes: number;
  expectedModifiedAtMs: number;
}

export function fileNameEditSelection(name: string): { start: number; end: number } {
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0) {
    return { start: 0, end: name.length };
  }
  return { start: 0, end: lastDot };
}

export function normalizeWorkbenchRenameName(name: string): string {
  return name.trim();
}

export function isUnchangedWorkbenchRename(oldName: string, newName: string): boolean {
  const left = normalizeWorkbenchRenameName(oldName);
  const right = normalizeWorkbenchRenameName(newName);
  return left.length > 0 && left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

export function canRenameWorkbenchFile(node: FsNode, occupancyIdle: boolean): boolean {
  return occupancyIdle && isFile(node);
}

export function isWorkbenchRenameShortcut(event: {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}): boolean {
  if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) {
    return false;
  }
  return event.key === "u" || event.key === "U" || event.code === "KeyU";
}

export function isWorkbenchRenameTypingTarget(target: unknown): boolean {
  if (target == null || typeof target !== "object") {
    return false;
  }
  const candidate = target as { tagName?: unknown; isContentEditable?: unknown };
  const tag = typeof candidate.tagName === "string" ? candidate.tagName : "";
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || candidate.isContentEditable === true;
}

export function workbenchRenameRequest(
  scanRoot: string,
  source: FsNode,
  typedName: string,
): { ok: true; request: WorkbenchRenameRequest } | { ok: false; reason: string; unchanged: boolean } {
  if (!isFile(source)) {
    return { ok: false, reason: "Nur einzelne Dateien können umbenannt werden.", unchanged: false };
  }
  const newName = normalizeWorkbenchRenameName(typedName);
  if (newName.length === 0) {
    return { ok: false, reason: "Der Dateiname darf nicht leer sein.", unchanged: false };
  }
  if (isUnchangedWorkbenchRename(source.name, newName)) {
    return { ok: false, reason: "Der Dateiname ist unverändert.", unchanged: true };
  }
  if (!isAllowedWindowsComponent(newName)) {
    return { ok: false, reason: "Der Dateiname ist unzulässig.", unchanged: false };
  }
  if (!hasCompleteFileFingerprint(source.sizeBytes, source.modifiedAtMs)) {
    return {
      ok: false,
      reason: incompleteFileFingerprintReason(source.sizeBytes, source.modifiedAtMs),
      unchanged: false,
    };
  }
  return {
    ok: true,
    request: {
      scanRoot,
      sourcePath: source.path,
      targetPath: joinScanPath(parentDirectoryPath(source.path), newName),
      oldName: source.name,
      newName,
      expectedSizeBytes: source.sizeBytes ?? 0,
      expectedModifiedAtMs: source.modifiedAtMs ?? 0,
    },
  };
}

export function workbenchRenameSuccessMessage(oldName: string, newName: string): string {
  return `„${oldName}“ wurde in „${newName}“ umbenannt.`;
}

export function workbenchRenameEventFromResult(
  result: MoveFileResult,
  request: WorkbenchRenameRequest,
): RealFileMoveWorkbenchEvent {
  const event = realFileMoveWorkbenchEvent(result);
  if (result.moved && result.outcome === "moved") {
    return {
      ...event,
      message: workbenchRenameSuccessMessage(request.oldName, request.newName),
    };
  }
  return event;
}
