import { type DirectoryNode, type FileNode, type FsNode, type ScanResult, type ScanWarning } from "../model";
import { buildDisplayFilterView, emptyDisplayFilterDraft, NO_EXTENSION_KEY, NO_EXTENSION_LABEL } from "./displayFilter";
import { deriveVisibleRows } from "./treeRows";
import { DEFAULT_TREE_SORT } from "./treeSort";
import { collectViewWorkStats } from "./viewStats";
import { analyzeInventory, type InventoryAnalysis } from "./inventoryAnalysis";

function file(id: string, name: string, extras: Partial<FileNode> = {}): FileNode {
  return { id, name, path: id, depth: 1, kind: "file", ...extras };
}

function dir(
  id: string,
  name: string,
  children: FsNode[],
  extras: Partial<DirectoryNode> = {},
): DirectoryNode {
  return { id, name, path: id, depth: 0, kind: "directory", listing: "read", children, ...extras };
}

function warning(path: string, extras: Partial<ScanWarning> = {}): ScanWarning {
  return { path, code: "skipped", message: "Dateisystemverweis wird nicht gefolgt.", ...extras };
}

function resultOf(root: DirectoryNode, warnings: ScanWarning[] = []): ScanResult {
  return {
    root,
    warnings,
    stats: { directoryCount: 0, fileCount: 0, skippedCount: 0, durationMs: 0 },
  };
}

function assert(condition: boolean, label: string): asserts condition {
  if (!condition) {
    throw new Error(label);
  }
}

function serialized(analysis: InventoryAnalysis): string {
  return JSON.stringify(analysis);
}

export function runInventoryAnalysisCheck(): void {
  const emptyRoot = dir("C:/leer", "leer", []);
  const empty = analyzeInventory(resultOf(emptyRoot));
  assert(empty.fileCount === 0, "empty: no files");
  assert(empty.directoryCount === 1, "empty: root directory counted");
  assert(empty.knownSizeBytes === 0, "empty: no size");
  assert(empty.filesWithoutKnownSize === 0, "empty: no unknown size");
  assert(empty.maxObservedDepth === 0, "empty: depth 0");
  assert(empty.depthLimitedFolderCount === 0, "empty: no depthLimited");
  assert(empty.fileTypes.length === 0, "empty: no types");
  assert(empty.emptyFolders.length === 1 && empty.emptyFolders[0]?.path === "C:/leer", "empty: root is empty folder");
  assert(empty.repeatedFileNames.length === 0 && empty.repeatedFolderNames.length === 0, "empty: no repeated names");

  const mixed = dir("C:/bestand", "bestand", [
    dir("C:/bestand/Vertraege", "Vertraege", [
      file("C:/bestand/Vertraege/Angebot.PDF", "Angebot.PDF", { depth: 2, sizeBytes: 100 }),
      file("C:/bestand/Vertraege/Protokoll.pdf", "Protokoll.pdf", { depth: 2, sizeBytes: 40 }),
      file("C:/bestand/Vertraege/README", "README", { depth: 2 }),
      file("C:/bestand/Vertraege/Bild.JPG", "Bild.JPG", { depth: 2, sizeBytes: 10 }),
    ], { depth: 1 }),
    dir("C:/bestand/Fotos", "Fotos", [
      file("C:/bestand/Fotos/Bild.jpg", "Bild.jpg", { depth: 2, sizeBytes: 20 }),
      file("C:/bestand/Fotos/Urlaub.png", "Urlaub.png", { depth: 2, sizeBytes: 5 }),
    ], { depth: 1 }),
    dir("C:/bestand/leer", "leer", [], { depth: 1 }),
    dir("C:/bestand/grenze", "grenze", [], { depth: 1, listing: "depthLimited" }),
    dir("C:/bestand/einzeln", "einzeln", [
      file("C:/bestand/einzeln/allein.txt", "allein.txt", { depth: 2, sizeBytes: 3 }),
    ], { depth: 1 }),
    dir("C:/bestand/viele", "viele", [
      file("C:/bestand/viele/a.txt", "a.txt", { depth: 2, sizeBytes: 1 }),
      file("C:/bestand/viele/b.txt", "b.txt", { depth: 2, sizeBytes: 1 }),
      file("C:/bestand/viele/c.txt", "c.txt", { depth: 2, sizeBytes: 1 }),
    ], { depth: 1 }),
    dir("C:/bestand/vertraege", "vertraege", [
      file("C:/bestand/vertraege/Notiz.txt", "Notiz.txt", { depth: 2, sizeBytes: 2 }),
    ], { depth: 1 }),
  ]);

  const mixedResult = resultOf(mixed);
  const analysis = analyzeInventory(mixedResult);
  const view = collectViewWorkStats(mixed);
  assert(analysis.fileCount === view.fileCount, "mixed: file count matches viewStats");
  assert(analysis.directoryCount === view.directoryCount, "mixed: directory count matches viewStats");
  assert(analysis.knownSizeBytes === view.sizeBytes, "mixed: known size matches viewStats");
  assert(analysis.filesWithoutKnownSize === 1, "mixed: README has no size");
  assert(analysis.maxObservedDepth === 2, "mixed: observed depth 2");
  assert(analysis.depthLimitedFolderCount === 1, "mixed: one depthLimited folder");

  const pdf = analysis.fileTypes.find((item) => item.extension === ".pdf");
  assert(pdf !== undefined && pdf.fileCount === 2 && pdf.knownSizeBytes === 140, "types: PDF/pdf merged");
  const jpg = analysis.fileTypes.find((item) => item.extension === ".jpg");
  assert(jpg !== undefined && jpg.fileCount === 2 && jpg.knownSizeBytes === 30, "types: JPG/jpg merged");
  const none = analysis.fileTypes.find((item) => item.extension === NO_EXTENSION_KEY);
  assert(none !== undefined && none.label === NO_EXTENSION_LABEL && none.fileCount === 1, "types: no extension group");
  assert(none.knownSizeBytes === 0, "types: unknown size not added");
  assert(analysis.fileTypes[0]?.fileCount >= analysis.fileTypes[1]?.fileCount, "types: sorted by count desc");
  const typeOrder = analysis.fileTypes.map((item) => item.extension);
  assert(typeOrder.indexOf(".jpg") < typeOrder.indexOf(".pdf"), "types: equal count sorted by extension");

  const limited = analysis.folderOccupancy.find((item) => item.path === "C:/bestand/grenze");
  assert(limited?.listing === "depthLimited", "depthLimited occupancy recorded");
  assert(!analysis.emptyFolders.some((item) => item.path === "C:/bestand/grenze"), "depthLimited not listed as empty");
  assert(analysis.emptyFolders.some((item) => item.path === "C:/bestand/leer"), "true empty folder listed");

  const einzeln = analysis.singleDirectFileFolders.find((item) => item.path === "C:/bestand/einzeln");
  assert(einzeln !== undefined, "single direct file folder listed");
  assert(!analysis.singleDirectFileFolders.some((item) => item.path === "C:/bestand/viele"), "many-file folder not single");

  assert(analysis.foldersByDirectFileCount[0]?.path === "C:/bestand/Vertraege", "rank: most direct files first");
  assert(analysis.foldersByDirectFileCount[1]?.path === "C:/bestand/viele", "rank: second by file count");
  const vertraege = analysis.folderOccupancy.find((item) => item.path === "C:/bestand/Vertraege");
  assert(vertraege?.directFileCount === 4 && vertraege.directDirectoryCount === 0, "occupancy: direct files only");
  assert(vertraege.directKnownSizeBytes === 150, "occupancy: README size omitted, nested not included");
  const rootOcc = analysis.folderOccupancy.find((item) => item.path === "C:/bestand");
  assert(rootOcc?.directFileCount === 0 && rootOcc.directDirectoryCount === 7, "occupancy: root has only subfolders");
  assert(rootOcc.directKnownSizeBytes === 0, "occupancy: nested file sizes not rolled up");

  const folderGroup = analysis.repeatedFolderNames.find((item) => item.name.toLocaleLowerCase() === "vertraege");
  assert(folderGroup !== undefined && folderGroup.count === 2, "repeated folders: Vertraege/vertraege");
  assert(folderGroup.paths.length === 2, "repeated folders: two paths");
  const fileGroup = analysis.repeatedFileNames.find((item) => item.name.toLocaleLowerCase() === "bild.jpg");
  assert(fileGroup !== undefined && fileGroup.count === 2, "repeated files: Bild.JPG / Bild.jpg");
  assert(
    !serialized(analysis).toLocaleLowerCase().includes("duplikat") &&
      !serialized(analysis).toLowerCase().includes("duplicate"),
    "repeated names are not labeled as duplicates",
  );

  const warnedJunction = dir("C:/links", "links", [
    dir("C:/links/loop", "loop", [], { depth: 1 }),
    dir("C:/links/echt-leer", "echt-leer", [], { depth: 1 }),
  ]);
  const junctionAnalysis = analyzeInventory(
    resultOf(warnedJunction, [warning("C:/links/loop")]),
  );
  assert(
    !junctionAnalysis.emptyFolders.some((item) => item.path === "C:/links/loop"),
    "junction-like warned folder is not empty",
  );
  assert(
    junctionAnalysis.unconfirmedEmptyLookingFolders.some((item) => item.path === "C:/links/loop"),
    "junction-like warned folder is unconfirmed",
  );
  assert(
    junctionAnalysis.emptyFolders.some((item) => item.path === "C:/links/echt-leer"),
    "unwarned empty folder remains empty",
  );

  const indistinguishable = analyzeInventory(resultOf(dir("C:/x", "x", [dir("C:/x/loop", "loop", [], { depth: 1 })])));
  assert(
    indistinguishable.emptyFolders.some((item) => item.path === "C:/x/loop"),
    "limitation: unfollowed reparse without warning currently looks empty",
  );

  const incomplete = analyzeInventory(
    resultOf(dir("C:/inc", "inc", [dir("C:/inc/denied", "denied", [], { depth: 1, listing: "incomplete" })])),
  );
  assert(
    !incomplete.emptyFolders.some((item) => item.path === "C:/inc/denied"),
    "incomplete listing is not empty",
  );

  const filtered = buildDisplayFilterView(mixed, { ...emptyDisplayFilterDraft(), extensions: [".pdf"] }, DEFAULT_TREE_SORT);
  assert(filtered.constrained, "filter: display filter is constrained");
  assert(filtered.fileMatchCount === 2, "filter: display shows only pdfs");
  const again = analyzeInventory(mixedResult);
  assert(again.fileCount === analysis.fileCount, "filter: analysis ignores display filter");
  assert(again.fileCount !== filtered.fileMatchCount, "filter: inventory is not the visible subset");
  const collapsed = deriveVisibleRows(mixed, new Set(["C:/bestand"]));
  assert(collapsed.length < analysis.fileCount + analysis.directoryCount, "expand: collapsed view hides nodes");
  assert(analyzeInventory(mixedResult).directoryCount === analysis.directoryCount, "expand: analysis ignores expand state");

  const stableA = serialized(analyzeInventory(mixedResult));
  const stableB = serialized(analyzeInventory(mixedResult));
  assert(stableA === stableB, "sort: analysis is deterministic");

  const tieRoot = dir("C:/t", "t", [
    dir("C:/t/B", "B", [file("C:/t/B/1.txt", "1.txt", { depth: 2, sizeBytes: 1 })], { depth: 1 }),
    dir("C:/t/A", "A", [file("C:/t/A/1.txt", "1.txt", { depth: 2, sizeBytes: 1 })], { depth: 1 }),
  ]);
  const tied = analyzeInventory(resultOf(tieRoot));
  assert(tied.foldersByDirectFileCount[0]?.path === "C:/t/A", "rank: equal file count uses path");
  assert(tied.repeatedFileNames[0]?.paths[0] === "C:/t/A/1.txt", "repeated files: paths sorted");
}
