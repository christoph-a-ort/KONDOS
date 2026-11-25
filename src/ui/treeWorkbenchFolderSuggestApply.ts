/** P2-L.11d: apply a folder suggestion with one mkdir and the workbench MOVE engine. */
import { isDirectory, isFile, type DirectoryNode, type FsNode } from "../model";
import {
  hasCompleteFileFingerprint,
  incompleteFileFingerprintReason,
} from "./virtualPlanPreflight";
import type { CreateFolderResult, MoveFileResult } from "./virtualPlanExecutionApi";
import {
  FOLDER_SUGGEST_UNCLEAR,
  FOLDER_SUGGEST_YEAR_UNKNOWN,
  folderIsInsideScanRoot,
  isAcceptableNewFolderName,
  type FolderSuggestOutcome,
} from "./treeWorkbenchFolderSuggest";
import { joinScanPath, parentDirectoryPath, sameDirectoryPath, type WorkbenchMoveRequest } from "./treeWorkbenchMove";

export const FOLDER_SUGGEST_MOVE = "Datei verschieben";
export const FOLDER_SUGGEST_CREATE_AND_MOVE = "Ordner anlegen und Datei verschieben";
export const FOLDER_SUGGEST_PICK_TARGET = "Bitte einen konkreten Zielordner wählen.";
export const FOLDER_SUGGEST_MKDIR_FAILED =
  "Der Ordner konnte nicht angelegt werden. Die Datei wurde nicht verschoben.";
export const FOLDER_SUGGEST_MOVE_AFTER_CREATE_FAILED =
  "Der Ordner wurde angelegt, die Datei konnte nicht verschoben werden. Die Quelldatei ist unverändert. Der neue Ordner bleibt bestehen.";
export const FOLDER_SUGGEST_MOVE_AFTER_EXISTS_FAILED =
  "Der Zielordner ist vorhanden, die Datei konnte nicht verschoben werden. Die Quelldatei ist unverändert.";

export type FolderSuggestExecuteKind = "move" | "createAndMove";

export interface FolderSuggestExecutePlan {
  kind: FolderSuggestExecuteKind;
  scanRoot: string;
  folderPath: string;
  fileTargetPath: string;
  folderName: string;
  createFolder: boolean;
  label: string;
}

export type FolderSuggestApplyResult =
  | { ok: true; created: boolean; moved: true; targetPath: string; message: string }
  | { ok: false; created: boolean; moved: false; reason: string };

export function folderSuggestCanExecute(outcome: FolderSuggestOutcome): boolean {
  return outcome.status === "suggestions" || outcome.status === "newFolder";
}

export function folderSuggestNeedsTargetChoice(outcome: FolderSuggestOutcome): boolean {
  return outcome.status === "suggestions" && outcome.suggestions.length > 1;
}

export function folderSuggestExecutePlan(options: {
  outcome: FolderSuggestOutcome;
  source: FsNode;
  scanRoot: string;
  selectedFolderPath: string | null;
}): { ok: true; plan: FolderSuggestExecutePlan } | { ok: false; reason: string | null } {
  const { outcome, source, scanRoot, selectedFolderPath } = options;
  if (outcome.status === "alreadyHere") {
    return { ok: false, reason: null };
  }
  if (outcome.status === "yearUnknown") {
    return { ok: false, reason: FOLDER_SUGGEST_YEAR_UNKNOWN };
  }
  if (outcome.status === "unclear" || outcome.status === "blocked") {
    return { ok: false, reason: outcome.reason.length > 0 ? outcome.reason : FOLDER_SUGGEST_UNCLEAR };
  }
  if (!isFile(source)) {
    return { ok: false, reason: "Nur einzelne Dateien können verschoben werden." };
  }
  if (!hasCompleteFileFingerprint(source.sizeBytes, source.modifiedAtMs)) {
    return { ok: false, reason: incompleteFileFingerprintReason(source.sizeBytes, source.modifiedAtMs) };
  }
  if (outcome.status === "newFolder") {
    return planNewFolder(outcome.newFolder.path, outcome.newFolder.folderName, source, scanRoot);
  }
  if (folderSuggestNeedsTargetChoice(outcome) && (selectedFolderPath === null || selectedFolderPath.length === 0)) {
    return { ok: false, reason: FOLDER_SUGGEST_PICK_TARGET };
  }
  const chosen =
    selectedFolderPath !== null
      ? outcome.suggestions.find((item) => sameDirectoryPath(item.path, selectedFolderPath))
      : outcome.suggestions[0];
  if (chosen === undefined) {
    return { ok: false, reason: FOLDER_SUGGEST_PICK_TARGET };
  }
  return planExistingFolder(chosen.path, chosen.name, source, scanRoot);
}

function planExistingFolder(
  folderPath: string,
  folderName: string,
  source: FsNode,
  scanRoot: string,
): { ok: true; plan: FolderSuggestExecutePlan } | { ok: false; reason: string | null } {
  if (!folderIsInsideScanRoot(scanRoot, folderPath)) {
    return { ok: false, reason: "Das Ziel liegt außerhalb der aktuellen Scanwurzel." };
  }
  if (sameDirectoryPath(parentDirectoryPath(source.path), folderPath)) {
    return { ok: false, reason: null };
  }
  const fileTargetPath = joinScanPath(folderPath, source.name);
  if (!folderIsInsideScanRoot(scanRoot, fileTargetPath)) {
    return { ok: false, reason: "Das Ziel liegt außerhalb der aktuellen Scanwurzel." };
  }
  return {
    ok: true,
    plan: {
      kind: "move",
      scanRoot,
      folderPath,
      fileTargetPath,
      folderName,
      createFolder: false,
      label: FOLDER_SUGGEST_MOVE,
    },
  };
}

function planNewFolder(
  folderPath: string,
  folderName: string,
  source: FsNode,
  scanRoot: string,
): { ok: true; plan: FolderSuggestExecutePlan } | { ok: false; reason: string | null } {
  if (!isAcceptableNewFolderName(folderName)) {
    return { ok: false, reason: "Der Zielordnername ist unzulässig." };
  }
  if (!folderIsInsideScanRoot(scanRoot, folderPath)) {
    return { ok: false, reason: "Das Ziel liegt außerhalb der aktuellen Scanwurzel." };
  }
  const parent = parentDirectoryPath(folderPath);
  if (!folderIsInsideScanRoot(scanRoot, parent)) {
    return { ok: false, reason: "Der Elternordner liegt außerhalb der aktuellen Scanwurzel." };
  }
  const fileTargetPath = joinScanPath(folderPath, source.name);
  if (!folderIsInsideScanRoot(scanRoot, fileTargetPath)) {
    return { ok: false, reason: "Das Ziel liegt außerhalb der aktuellen Scanwurzel." };
  }
  return {
    ok: true,
    plan: {
      kind: "createAndMove",
      scanRoot,
      folderPath,
      fileTargetPath,
      folderName,
      createFolder: true,
      label: FOLDER_SUGGEST_CREATE_AND_MOVE,
    },
  };
}

export function folderSuggestDestCollision(root: DirectoryNode, fileTargetPath: string): boolean {
  return findNodeAt(root, fileTargetPath) !== null;
}

function findNodeAt(node: FsNode, path: string): FsNode | null {
  if (sameDirectoryPath(node.path, path)) {
    return node;
  }
  if (!isDirectory(node)) {
    return null;
  }
  for (const child of node.children) {
    const found = findNodeAt(child, path);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

export function workbenchMoveRequestForFolderPlan(
  scanRoot: string,
  source: FsNode,
  plan: FolderSuggestExecutePlan,
): WorkbenchMoveRequest {
  return {
    scanRoot,
    sourcePath: source.path,
    targetPath: plan.fileTargetPath,
    fileName: source.name,
    folderName: plan.folderName,
    expectedSizeBytes: source.sizeBytes ?? 0,
    expectedModifiedAtMs: source.modifiedAtMs ?? 0,
  };
}

export function folderSuggestApplyFromResults(
  mkdir: CreateFolderResult | null,
  move: MoveFileResult | null,
  plan: FolderSuggestExecutePlan,
  fileName: string,
): FolderSuggestApplyResult {
  if (plan.createFolder) {
    if (mkdir === null) {
      return { ok: false, created: false, moved: false, reason: FOLDER_SUGGEST_MKDIR_FAILED };
    }
    const folderReady = mkdir.outcome === "created" || mkdir.outcome === "exists";
    if (!folderReady) {
      const detail = mkdir.message.trim();
      return {
        ok: false,
        created: false,
        moved: false,
        reason: detail.length > 0 ? `${FOLDER_SUGGEST_MKDIR_FAILED} ${detail}` : FOLDER_SUGGEST_MKDIR_FAILED,
      };
    }
  }
  if (move === null || !move.moved || move.outcome !== "moved") {
    const detail = move?.message.trim() ?? "";
    const created = mkdir?.outcome === "created";
    const reason =
      created
        ? detail.length > 0
          ? `${FOLDER_SUGGEST_MOVE_AFTER_CREATE_FAILED} ${detail}`
          : FOLDER_SUGGEST_MOVE_AFTER_CREATE_FAILED
        : plan.createFolder
          ? detail.length > 0
            ? `${FOLDER_SUGGEST_MOVE_AFTER_EXISTS_FAILED} ${detail}`
            : FOLDER_SUGGEST_MOVE_AFTER_EXISTS_FAILED
          : detail.length > 0
            ? detail
            : "Die Datei konnte nicht verschoben werden.";
    return { ok: false, created: created === true, moved: false, reason };
  }
  return {
    ok: true,
    created: mkdir?.outcome === "created",
    moved: true,
    targetPath: move.targetPath,
    message: folderSuggestApplySuccessMessage(fileName, plan.folderName),
  };
}

export function folderSuggestApplySuccessMessage(fileName: string, folderName: string): string {
  return `„${fileName}“ wurde nach „${folderName}“ verschoben.`;
}
