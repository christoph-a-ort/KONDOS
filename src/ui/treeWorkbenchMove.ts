/** P2-L.6: Explorer-like single-file drag-and-drop in the workbench tree. */
import { isDirectory, isFile, type FsNode } from "../model";
import {
  hasCompleteFileFingerprint,
  incompleteFileFingerprintReason,
} from "./virtualPlanPreflight";
import type { MoveFileResult } from "./virtualPlanExecutionApi";
import { realFileMoveWorkbenchEvent, type RealFileMoveWorkbenchEvent } from "./virtualPlanExecution";

export const WORKBENCH_FILE_DRAG_TYPE = "application/x-dottyfm-file";
export const WORKBENCH_TREE_ROW_ID_ATTR = "data-tree-row-id";
export const WORKBENCH_POINTER_DRAG_THRESHOLD_PX = 4;

export function workbenchPointerDragShouldStart(deltaX: number, deltaY: number): boolean {
  const threshold = WORKBENCH_POINTER_DRAG_THRESHOLD_PX;
  return deltaX * deltaX + deltaY * deltaY >= threshold * threshold;
}

export function workbenchRowIdFromPointTarget(target: EventTarget | null): string | null {
  if (target === null || typeof target !== "object" || !("closest" in target)) {
    return null;
  }
  const withClosest = target as { closest: (selector: string) => { getAttribute: (name: string) => string | null } | null };
  if (typeof withClosest.closest !== "function") {
    return null;
  }
  const row = withClosest.closest(`[${WORKBENCH_TREE_ROW_ID_ATTR}]`);
  if (row === null) {
    return null;
  }
  const id = row.getAttribute(WORKBENCH_TREE_ROW_ID_ATTR);
  return id !== null && id.length > 0 ? id : null;
}

export type WorkbenchDropKind = "valid" | "same-folder" | "not-folder" | "not-file" | "missing-fingerprint";

export interface WorkbenchMoveRequest {
  scanRoot: string;
  sourcePath: string;
  targetPath: string;
  fileName: string;
  folderName: string;
  expectedSizeBytes: number;
  expectedModifiedAtMs: number;
}

export function parentDirectoryPath(path: string): string {
  const unified = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = unified.lastIndexOf("/");
  if (index <= 0) return unified;
  const parent = unified.slice(0, index);
  return path.includes("\\") ? parent.replace(/\//g, "\\") : parent;
}

export function joinScanPath(base: string, name: string): string {
  const slash = base.includes("\\") ? "\\" : "/";
  return `${base.replace(/[\\/]+$/, "")}${slash}${name}`;
}

export function pathForCurrentScan(scanRoot: string, absolutePath: string): string {
  const slash = scanRoot.includes("\\") ? "\\" : "/";
  const other = slash === "\\" ? "/" : "\\";
  return absolutePath.split(other).join(slash);
}

export function sameDirectoryPath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return normalize(left) === normalize(right);
}

export function canDragWorkbenchFile(node: FsNode, occupancyIdle: boolean): boolean {
  return occupancyIdle && isFile(node);
}

export function workbenchDropKind(source: FsNode, destination: FsNode): WorkbenchDropKind {
  if (!isFile(source)) return "not-file";
  if (!isDirectory(destination)) return "not-folder";
  if (sameDirectoryPath(parentDirectoryPath(source.path), destination.path)) return "same-folder";
  if (!hasCompleteFileFingerprint(source.sizeBytes, source.modifiedAtMs)) return "missing-fingerprint";
  return "valid";
}

export function workbenchDropHighlight(kind: WorkbenchDropKind | null): "valid" | "none" {
  return kind === "valid" ? "valid" : "none";
}

export function workbenchMoveRequest(
  scanRoot: string,
  source: FsNode,
  destination: FsNode,
): { ok: true; request: WorkbenchMoveRequest } | { ok: false; reason: string } {
  const kind = workbenchDropKind(source, destination);
  if (kind === "not-file") return { ok: false, reason: "Nur einzelne Dateien können per Drag-and-Drop verschoben werden." };
  if (kind === "not-folder") return { ok: false, reason: "Dateien können nur auf vorhandene Ordner gezogen werden." };
  if (kind === "same-folder") return { ok: false, reason: "Die Datei liegt bereits in diesem Ordner." };
  if (kind === "missing-fingerprint") {
    return { ok: false, reason: incompleteFileFingerprintReason(source.sizeBytes, source.modifiedAtMs) };
  }
  if (!isFile(source) || !isDirectory(destination)) {
    return { ok: false, reason: "Diese Ablage ist nicht zulässig." };
  }
  return {
    ok: true,
    request: {
      scanRoot,
      sourcePath: source.path,
      targetPath: joinScanPath(destination.path, source.name),
      fileName: source.name,
      folderName: destination.name,
      expectedSizeBytes: source.sizeBytes ?? 0,
      expectedModifiedAtMs: source.modifiedAtMs ?? 0,
    },
  };
}

export function workbenchMoveSuccessMessage(fileName: string, folderName: string): string {
  return `„${fileName}“ wurde nach „${folderName}“ verschoben.`;
}

export function workbenchMoveEventFromResult(
  result: MoveFileResult,
  request: WorkbenchMoveRequest,
): RealFileMoveWorkbenchEvent {
  const event = realFileMoveWorkbenchEvent(result);
  if (result.moved && result.outcome === "moved") {
    return {
      ...event,
      message: workbenchMoveSuccessMessage(request.fileName, request.folderName),
    };
  }
  return event;
}
