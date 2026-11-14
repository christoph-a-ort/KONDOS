import { isDirectory, type DirectoryNode, type FileNode, type FsNode } from "../model";
import type { MoveFileResult } from "./virtualPlanExecutionApi";
import {
  canRenameWorkbenchFile,
  fileNameEditSelection,
  isUnchangedWorkbenchRename,
  isWorkbenchRenameShortcut,
  isWorkbenchRenameTypingTarget,
  workbenchRenameEventFromResult,
  workbenchRenameRequest,
  workbenchRenameSuccessMessage,
} from "./treeWorkbenchRename";
import { canDragWorkbenchFile, workbenchDropKind, workbenchMoveRequest } from "./treeWorkbenchMove";

function file(id: string, name: string, extras: Partial<FileNode> = {}): FileNode {
  return { id, name, path: id, depth: 1, kind: "file", sizeBytes: 4, modifiedAtMs: 100, ...extras };
}

function dir(id: string, name: string, children: FsNode[] = []): DirectoryNode {
  return { id, name, path: id, depth: 0, kind: "directory", listing: "read", children };
}

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
}

export function runTreeWorkbenchRenameCheck(): void {
  const root = dir("C:/Dotty-Test/Probeordner", "Probeordner", [
    file("C:/Dotty-Test/Probeordner/Rechnung_alt.pdf", "Rechnung_alt.pdf"),
    dir("C:/Dotty-Test/Probeordner/ziel", "ziel"),
    file("C:/Dotty-Test/Probeordner/keep.txt", "keep.txt"),
  ]);
  const source = root.children[0];
  const dest = root.children[1];
  assert(!isDirectory(source), "fixture file");
  assert(isDirectory(dest), "fixture folder");

  assert(fileNameEditSelection("Rechnung_alt.pdf").start === 0, "stem starts at 0");
  assert(fileNameEditSelection("Rechnung_alt.pdf").end === "Rechnung_alt".length, "stem excludes extension");
  assert(fileNameEditSelection("notiz").end === 5, "name without extension is fully selected");
  assert(fileNameEditSelection(".gitignore").end === ".gitignore".length, "dotfile is fully selected");
  assert(fileNameEditSelection("archive.tar.gz").end === "archive.tar".length, "last extension stays unselected");

  assert(
    isWorkbenchRenameShortcut({ key: "u", ctrlKey: true, shiftKey: true }),
    "Ctrl+Shift+U starts rename",
  );
  assert(
    isWorkbenchRenameShortcut({ key: "U", code: "KeyU", ctrlKey: true, shiftKey: true }),
    "Ctrl+Shift+U uppercase starts rename",
  );
  assert(!isWorkbenchRenameShortcut({ key: "F2" }), "F2 does not start rename");
  assert(
    !isWorkbenchRenameShortcut({ key: "F2", ctrlKey: true, shiftKey: true }),
    "F2 with modifiers does not start rename",
  );
  assert(
    !isWorkbenchRenameShortcut({ key: "u", ctrlKey: true }),
    "Ctrl+U does not start rename",
  );
  assert(
    !isWorkbenchRenameShortcut({ key: "u", shiftKey: true }),
    "Shift+U does not start rename",
  );
  assert(
    !isWorkbenchRenameShortcut({ key: "u", ctrlKey: true, shiftKey: true, altKey: true }),
    "Ctrl+Alt+Shift+U does not start rename",
  );
  assert(
    !isWorkbenchRenameShortcut({ key: "u", ctrlKey: true, shiftKey: true, metaKey: true }),
    "Meta+Ctrl+Shift+U does not start rename",
  );
  assert(
    !isWorkbenchRenameShortcut({ key: "Enter", ctrlKey: true, shiftKey: true }),
    "Enter stays a commit key, not the rename chord",
  );
  assert(
    !isWorkbenchRenameShortcut({ key: "Escape", ctrlKey: true, shiftKey: true }),
    "Esc stays a cancel key, not the rename chord",
  );
  assert(!isWorkbenchRenameTypingTarget(undefined), "tree focus is not a typing target");
  assert(!isWorkbenchRenameTypingTarget({ tagName: "DIV" }), "tree rows are not typing targets");
  assert(isWorkbenchRenameTypingTarget({ tagName: "INPUT" }), "inputs keep their own keyboard handling");
  assert(isWorkbenchRenameTypingTarget({ tagName: "TEXTAREA" }), "textareas keep their own keyboard handling");
  assert(isWorkbenchRenameTypingTarget({ tagName: "SELECT" }), "selects keep their own keyboard handling");
  assert(
    isWorkbenchRenameTypingTarget({ tagName: "DIV", isContentEditable: true }),
    "contenteditable keeps its own keyboard handling",
  );

  assert(canRenameWorkbenchFile(source, true), "idle file can be renamed");
  assert(!canRenameWorkbenchFile(source, false), "busy file cannot be renamed");
  assert(!canRenameWorkbenchFile(dest, true), "folders cannot be renamed");
  assert(canDragWorkbenchFile(source, true), "rename does not disable file drag");

  assert(isUnchangedWorkbenchRename("Rechnung_alt.pdf", "Rechnung_alt.pdf"), "identical name is unchanged");
  assert(isUnchangedWorkbenchRename("Rechnung_alt.pdf", "  Rechnung_alt.pdf  "), "trimmed identical name is unchanged");
  assert(isUnchangedWorkbenchRename("Rechnung_alt.pdf", "rechnung_alt.pdf"), "Windows case-only is unchanged");
  assert(!isUnchangedWorkbenchRename("Rechnung_alt.pdf", "Rechnung_neu.pdf"), "different stem is a rename");

  const unchanged = workbenchRenameRequest(root.path, source, "Rechnung_alt.pdf");
  assert(!unchanged.ok && unchanged.unchanged, "unchanged name does not build a request");

  const empty = workbenchRenameRequest(root.path, source, "   ");
  assert(!empty.ok && !empty.unchanged && empty.reason.includes("leer"), "empty name is rejected");

  const invalid = workbenchRenameRequest(root.path, source, "CON.pdf");
  assert(!invalid.ok && invalid.reason.includes("unzulässig"), "reserved name is rejected");
  const slash = workbenchRenameRequest(root.path, source, "a/b.pdf");
  assert(!slash.ok && slash.reason.includes("unzulässig"), "path separator is rejected");

  const prepared = workbenchRenameRequest(root.path, source, "Rechnung_neu.pdf");
  assert(prepared.ok, "valid rename builds a request");
  if (prepared.ok) {
    assert(prepared.request.targetPath === "C:/Dotty-Test/Probeordner/Rechnung_neu.pdf", "target stays in the same folder");
    assert(prepared.request.oldName === "Rechnung_alt.pdf" && prepared.request.newName === "Rechnung_neu.pdf", "names copied");
  }

  const folderAttempt = workbenchRenameRequest(root.path, dest, "anders");
  assert(!folderAttempt.ok, "folder rename is not offered");

  assert(
    workbenchRenameSuccessMessage("Rechnung_alt.pdf", "Rechnung_neu.pdf")
      === "„Rechnung_alt.pdf“ wurde in „Rechnung_neu.pdf“ umbenannt.",
    "success names old and new",
  );
  const moved: MoveFileResult = {
    outcome: "moved",
    sourcePath: "C:/Dotty-Test/Probeordner/Rechnung_alt.pdf",
    targetPath: "C:/Dotty-Test/Probeordner/Rechnung_neu.pdf",
    message: "Die Datei wurde verschoben.",
    moved: true,
    halted: false,
    bindingStatus: "",
    journalJson: null,
    reminder: "r",
  };
  if (prepared.ok) {
    const event = workbenchRenameEventFromResult(moved, prepared.request);
    assert(event.refreshWorkbench, "successful rename refreshes the tree");
    assert(event.message.includes("Rechnung_neu.pdf"), "success notice names the new file");
  }

  assert(workbenchDropKind(source, dest) === "valid", "rename helpers do not change drop validity");
  const drag = workbenchMoveRequest(root.path, source, dest);
  assert(drag.ok, "drag-and-drop request still builds");
}
