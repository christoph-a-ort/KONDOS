import { prepareNameSuggestApply, shouldCloseNameSuggestAfterApply, workbenchRenameOccupancyBlockReason } from "./nameSuggestApply";
import { shouldPersistSenderMapping } from "./learnedSenders";
import { workbenchRenameApplyFromMoveResult } from "./treeWorkbenchRename";
import type { MoveFileResult } from "./virtualPlanExecutionApi";
import type { DirectoryNode, FileNode, FsNode } from "../model";

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(label);
  }
}

function file(id: string, name: string, extras: Partial<FileNode> = {}): FileNode {
  return { id, name, path: id, depth: 1, kind: "file", sizeBytes: 4, modifiedAtMs: 100, ...extras };
}

function dir(id: string, name: string, children: FsNode[] = []): DirectoryNode {
  return { id, name, path: id, depth: 0, kind: "directory", listing: "read", children };
}

function moveResult(partial: Partial<MoveFileResult> & Pick<MoveFileResult, "outcome" | "moved">): MoveFileResult {
  return {
    sourcePath: "C:/Dotty-Test/Probeordner/scan.pdf",
    targetPath: "C:/Dotty-Test/Probeordner/2026-01-01_HGZ_GEG-Beratungsnachweis.pdf",
    message: partial.message ?? "Die Datei wurde verschoben.",
    halted: false,
    bindingStatus: "",
    journalJson: null,
    reminder: "r",
    ...partial,
  };
}

export function runNameSuggestApplyCheck(): void {
  const root = dir("C:/Dotty-Test/Probeordner", "Probeordner", [
    file("C:/Dotty-Test/Probeordner/scan.pdf", "scan.pdf"),
    file("C:/Dotty-Test/Probeordner/keep.pdf", "keep.pdf"),
  ]);
  const source = root.children[0] as FileNode;

  const praxis = prepareNameSuggestApply(
    root.path,
    source,
    source.name,
    "2026-01-01_HGZ_GEG-Beratungsnachweis.pdf",
  );
  assert(praxis.status === "ready", "confirmed date and sender prepare a rename");
  if (praxis.status === "ready") {
    assert(praxis.fileName === "2026-01-01_HGZ_GEG-Beratungsnachweis.pdf", "expected GEG filename is passed through");
    assert(praxis.request.sourcePath === source.path, "source path is the scanned file");
    assert(
      praxis.request.targetPath === "C:/Dotty-Test/Probeordner/2026-01-01_HGZ_GEG-Beratungsnachweis.pdf",
      "target stays in the same folder",
    );
    assert(praxis.request.oldName === "scan.pdf" && praxis.request.newName === praxis.fileName, "names match the request");
    assert(praxis.request.scanRoot === root.path, "scan root is forwarded to the MOVE engine");
  }

  const manual = prepareNameSuggestApply(root.path, source, source.name, "2026-01-01_Notiz.pdf");
  assert(manual.status === "ready" && manual.fileName === "2026-01-01_Notiz.pdf", "a typed name is applied");

  const withoutSender = prepareNameSuggestApply(
    root.path,
    source,
    source.name,
    "2026-01-01_GEG-Beratungsnachweis.pdf",
  );
  assert(
    withoutSender.status === "ready",
    "missing absender does not block a valid typed name",
  );

  const cacheHitName = prepareNameSuggestApply(
    root.path,
    source,
    source.name,
    "2026-01-01_HGZ_GEG-Beratungsnachweis.pdf",
  );
  assert(cacheHitName.status === "ready", "KI or cache source is not required at apply time");

  const unchanged = prepareNameSuggestApply(root.path, source, source.name, "scan.pdf");
  assert(unchanged.status === "unchanged" && unchanged.reason.includes("unverändert"), "unchanged names do not rename");

  const invalid = prepareNameSuggestApply(root.path, source, source.name, "CON.pdf");
  assert(invalid.status === "blocked" && invalid.reason.includes("unzulässig"), "invalid names are reported");

  const busy = workbenchRenameOccupancyBlockReason({
    moveBusy: false,
    scanLocked: false,
    scanning: false,
    exportBusy: false,
    preparingContent: true,
  });
  assert(busy !== null && busy.includes("nicht ausgeführt"), "busy occupancy is reported instead of a silent skip");
  assert(
    workbenchRenameOccupancyBlockReason({
      moveBusy: false,
      scanLocked: false,
      scanning: false,
      exportBusy: false,
      preparingContent: false,
    }) === null,
    "idle occupancy allows the MOVE engine",
  );

  const moved = workbenchRenameApplyFromMoveResult(moveResult({ outcome: "moved", moved: true }));
  assert(moved.ok && shouldCloseNameSuggestAfterApply(moved), "successful MOVE closes the dialog");
  const blocked = workbenchRenameApplyFromMoveResult(
    moveResult({
      outcome: "blocked",
      moved: false,
      message: "Das Ziel ist bereits belegt. Vorhandene Dateien werden nicht überschrieben.",
    }),
  );
  assert(!blocked.ok && blocked.reason.includes("bereits belegt"), "existing target is reported");
  assert(!shouldCloseNameSuggestAfterApply(blocked), "a blocked MOVE keeps the dialog open");
  const claimed = workbenchRenameApplyFromMoveResult(moveResult({ outcome: "moved", moved: false, message: "Scheinbar verschoben." }));
  assert(!claimed.ok, "moved=false is not treated as success");
  const ioNt = workbenchRenameApplyFromMoveResult(
    moveResult({
      outcome: "blocked",
      moved: false,
      message:
        "Die Datei wird gerade verwendet und kann nicht umbenannt werden. Bitte schließen Sie die Datei in anderen Programmen. (NTSTATUS 0xC0000043).",
    }),
  );
  assert(!ioNt.ok, "NTSTATUS result is not success");
  if (!ioNt.ok) {
    assert(ioNt.reason.includes("0xC0000043"), "concrete NTSTATUS from the engine is shown in the dialog");
    assert(!ioNt.reason.endsWith("Die Dateiverschiebung ist fehlgeschlagen."), "generic IO is not the only remaining text");
  }

  assert(
    !shouldPersistSenderMapping({ remember: true, renameOk: false, from: "SHGZ KGZ", to: "HGZ" }),
    "learning does not run when the rename did not succeed",
  );
  assert(
    shouldPersistSenderMapping({ remember: true, renameOk: true, from: "SHGZ KGZ", to: "HGZ" }),
    "learning runs only after a successful rename and consent",
  );
  assert(
    !shouldPersistSenderMapping({ remember: true, renameOk: true, cancelled: true, from: "SHGZ KGZ", to: "HGZ" }),
    "cancel does not store a mapping",
  );
}
