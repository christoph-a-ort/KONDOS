import { isDirectory, type DirectoryNode, type FileNode, type FsNode } from "../model";
import type { MoveFileResult } from "./virtualPlanExecutionApi";
import {
  WORKBENCH_POINTER_DRAG_THRESHOLD_PX,
  WORKBENCH_TREE_ROW_ID_ATTR,
  canDragWorkbenchFile,
  joinScanPath,
  parentDirectoryPath,
  pathForCurrentScan,
  sameDirectoryPath,
  workbenchDropHighlight,
  workbenchDropKind,
  workbenchMoveEventFromResult,
  workbenchMoveRequest,
  workbenchMoveSuccessMessage,
  workbenchPointerDragShouldStart,
  workbenchRowIdFromPointTarget,
} from "./treeWorkbenchMove";

function file(id: string, name: string, extras: Partial<FileNode> = {}): FileNode {
  return { id, name, path: id, depth: 1, kind: "file", sizeBytes: 4, modifiedAtMs: 100, ...extras };
}

function dir(id: string, name: string, children: FsNode[] = []): DirectoryNode {
  return { id, name, path: id, depth: 0, kind: "directory", listing: "read", children };
}

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
}

export function runTreeWorkbenchMoveCheck(): void {
  const root = dir("C:/Dotty-Test/Probeordner", "Probeordner", [
    file("C:/Dotty-Test/Probeordner/a.txt", "a.txt"),
    dir("C:/Dotty-Test/Probeordner/ziel", "ziel"),
  ]);
  const source = root.children[0];
  const dest = root.children[1];
  assert(!isDirectory(source), "fixture file");
  assert(isDirectory(dest), "fixture folder");

  assert(WORKBENCH_TREE_ROW_ID_ATTR === "data-tree-row-id", "row identity attribute");
  assert(!workbenchPointerDragShouldStart(0, 0), "click without movement is not a drag");
  assert(!workbenchPointerDragShouldStart(WORKBENCH_POINTER_DRAG_THRESHOLD_PX - 1, 0), "below threshold stays a click");
  assert(workbenchPointerDragShouldStart(WORKBENCH_POINTER_DRAG_THRESHOLD_PX, 0), "threshold starts a drag");
  assert(workbenchRowIdFromPointTarget(null) === null, "no point target");

  assert(canDragWorkbenchFile(source, true), "idle file can be dragged");
  assert(!canDragWorkbenchFile(source, false), "busy file cannot be dragged");
  assert(!canDragWorkbenchFile(dest, true), "folders cannot be dragged");

  assert(parentDirectoryPath("C:/Dotty-Test/Probeordner/a.txt") === "C:/Dotty-Test/Probeordner", "parent of file");
  assert(
    parentDirectoryPath("C:\\Dotty-Test\\Probeordner\\a.txt") === "C:\\Dotty-Test\\Probeordner",
    "parent keeps backslash",
  );
  assert(joinScanPath("C:\\Dotty-Test\\Probeordner\\ziel", "a.txt") === "C:\\Dotty-Test\\Probeordner\\ziel\\a.txt", "join native");
  assert(pathForCurrentScan("C:\\Scan", "C:/Scan/ziel/a.txt") === "C:\\Scan\\ziel\\a.txt", "reveal path uses scan separators");
  assert(sameDirectoryPath("C:/Scan/ziel", "C:\\Scan\\ziel\\"), "same folder ignores slash and trailing");

  assert(workbenchDropKind(source, dest) === "valid", "file onto other folder is valid");
  assert(workbenchDropKind(source, root) === "same-folder", "file onto current folder is rejected");
  assert(workbenchDropKind(source, source) === "not-folder", "file onto file is rejected");
  assert(workbenchDropKind(dest, dest) === "not-file", "folder drag is rejected");
  assert(
    workbenchDropKind(file("C:/Dotty-Test/Probeordner/b.txt", "b.txt", { sizeBytes: undefined, modifiedAtMs: undefined }), dest)
      === "missing-fingerprint",
    "incomplete identity is not dropped",
  );
  assert(workbenchDropHighlight("valid") === "valid", "valid target is highlighted");
  assert(workbenchDropHighlight("same-folder") === "none", "same folder is not highlighted");
  assert(workbenchDropHighlight(null) === "none", "no hover is not highlighted");

  const prepared = workbenchMoveRequest(root.path, source, dest);
  assert(prepared.ok, "valid drop builds a request");
  if (prepared.ok) {
    assert(prepared.request.targetPath === "C:/Dotty-Test/Probeordner/ziel/a.txt", "target keeps file name");
    assert(prepared.request.expectedSizeBytes === 4 && prepared.request.expectedModifiedAtMs === 100, "fingerprint copied");
  }
  const same = workbenchMoveRequest(root.path, source, root);
  assert(!same.ok && same.reason.includes("bereits in diesem Ordner"), "same-folder reason");

  assert(
    workbenchMoveSuccessMessage("a.txt", "ziel") === "„a.txt“ wurde nach „ziel“ verschoben.",
    "success names file and folder",
  );
  const moved: MoveFileResult = {
    outcome: "moved",
    sourcePath: "C:/Dotty-Test/Probeordner/a.txt",
    targetPath: "C:/Dotty-Test/Probeordner/ziel/a.txt",
    message: "Die Datei wurde verschoben.",
    moved: true,
    halted: false,
    bindingStatus: "",
    journalJson: null,
    reminder: "r",
  };
  if (prepared.ok) {
    const event = workbenchMoveEventFromResult(moved, prepared.request);
    assert(event.refreshWorkbench, "successful DnD refreshes the tree");
    assert(event.message.includes("ziel"), "success notice is short and names the folder");
    assert(event.outcome === "moved", "outcome stays moved");
  }
  const blocked: MoveFileResult = {
    ...moved,
    outcome: "blocked",
    moved: false,
    halted: true,
    message: "Das Ziel ist bereits belegt. Vorhandene Dateien werden nicht überschrieben.",
  };
  if (prepared.ok) {
    const event = workbenchMoveEventFromResult(blocked, prepared.request);
    assert(!event.refreshWorkbench, "failed DnD does not refresh");
    assert(event.message.includes("nicht überschrieben"), "backend overwrite message is shown");
  }
}
