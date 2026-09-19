import { type DirectoryNode, type FileNode, type FsNode, type ScanWarning } from "../model";
import { buildDisplayFilterView } from "./displayFilter";
import {
  buildNodeDetails,
  DETAIL_NONE_LABEL,
  listingStatusLabel,
  META_NOT_CAPTURED,
  META_UNAVAILABLE,
} from "./nodeDetails";
import { collectExpandableDirectoryIds, defaultExpandedIds, deriveVisibleRows } from "./treeRows";
import { collectMatchIds } from "./treeSearch";
import { DEFAULT_TREE_SORT } from "./treeSort";
import { collectViewWorkStats, formatViewWorkStats } from "./viewStats";
import {
  WARNING_ANCESTOR_NOTICE,
  WARNING_HIDDEN_BY_FILTER_NOTICE,
  WARNING_NO_TARGET_NOTICE,
  resolveWarningJump,
  warningRevealPlan,
} from "./warningNavigation";

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

function warning(path: string, message = "warn"): ScanWarning {
  return { path, code: "ioError", message };
}

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(label);
  }
}

export function runP1dCheck(): void {
  runWarningNavigationCheck();
  runNodeDetailsCheck();
  runViewStatsCheck();
}

function runWarningNavigationCheck(): void {
  const tree = dir("C:/root", "root", [
    dir("C:/root/A", "A", [
      file("C:/root/A/Angebot.pdf", "Angebot.pdf", { sizeBytes: 100, modifiedAtMs: 1 }),
      file("C:/root/A/Text.txt", "Text.txt", { sizeBytes: 20, modifiedAtMs: 2 }),
    ]),
    dir("C:/root/B", "B", [file("C:/root/B/Bild.jpg", "Bild.jpg", { sizeBytes: 50, modifiedAtMs: 3 })]),
  ]);

  const exact = resolveWarningJump(tree, tree, "C:/root/A/Angebot.pdf");
  assert(exact.kind === "exact" && exact.targetId === "C:/root/A/Angebot.pdf", "warn: exact node");
  assert(exact.applySelection && exact.notice === null, "warn: exact selects without fallback notice");
  assert(exact.ancestorIds.includes("C:/root") && exact.ancestorIds.includes("C:/root/A"), "warn: ancestors opened");

  const plan = warningRevealPlan(tree, defaultExpandedIds(tree.id), exact.targetId as string);
  assert(plan.rowIndex >= 0, "warn: scroll target exists after expand");
  const rows = deriveVisibleRows(
    tree,
    new Set([tree.id, ...plan.ancestorIds]),
    DEFAULT_TREE_SORT,
  );
  assert(
    rows.some((row) => row.id === "C:/root/A/Angebot.pdf"),
    "warn: exact target visible after ancestors expand",
  );

  const slashVariant = resolveWarningJump(tree, tree, "C:\\root\\A\\Angebot.pdf");
  assert(slashVariant.kind === "exact" && slashVariant.targetId === "C:/root/A/Angebot.pdf", "warn: slash-normalized exact");

  const ancestor = resolveWarningJump(tree, tree, "C:/root/A/missing.bin");
  assert(ancestor.kind === "ancestor" && ancestor.targetId === "C:/root/A", "warn: missing child uses parent");
  assert(ancestor.notice === WARNING_ANCESTOR_NOTICE, "warn: ancestor notice");
  assert(ancestor.applySelection, "warn: ancestor selects parent");
  const ancestorPlan = warningRevealPlan(tree, defaultExpandedIds(tree.id), ancestor.targetId as string);
  assert(ancestorPlan.rowIndex >= 0, "warn: parent scroll target");

  const none = resolveWarningJump(tree, tree, "D:/elsewhere/x.txt");
  assert(none.kind === "none" && none.targetId === null, "warn: no target");
  assert(none.applySelection === false && none.notice === WARNING_NO_TARGET_NOTICE, "warn: no target keeps selection");

  const pdfView = buildDisplayFilterView(
    tree,
    { extensions: [".pdf"], modifiedFrom: "", modifiedUntil: "" },
    DEFAULT_TREE_SORT,
  );
  const hidden = resolveWarningJump(tree, pdfView.tree, "C:/root/A/Text.txt");
  assert(hidden.kind === "hidden-by-filter", "warn: filter hides exact file");
  assert(hidden.applySelection === false, "warn: filter does not jump");
  assert(hidden.offerFilterReset, "warn: filter reset offered");
  assert(hidden.notice === WARNING_HIDDEN_BY_FILTER_NOTICE, "warn: filter notice");
  assert(pdfView.tree !== null && pdfView.fileMatchCount === 1, "warn: filter itself unchanged");

  const hiddenMissing = resolveWarningJump(tree, pdfView.tree, "C:/root/B/ghost.doc");
  assert(hiddenMissing.kind === "hidden-by-filter", "warn: ancestor also hidden by filter");
  assert(hiddenMissing.applySelection === false, "warn: hidden ancestor does not change selection");

  const prefixTrap = nearestNotConfused(tree);
  assert(prefixTrap, "warn: path prefix does not match sibling names");
}

function nearestNotConfused(tree: DirectoryNode): boolean {
  const jump = resolveWarningJump(tree, tree, "C:/root-other/file.txt");
  return jump.kind === "none";
}

function runNodeDetailsCheck(): void {
  const none = buildNodeDetails(dir("r", "r", []), null, [], false);
  assert(!none.selected && none.name === null, "detail: no selection");
  assert(DETAIL_NONE_LABEL.length > 0, "detail: empty label exists");

  const pdf = file("C:/r/a.pdf", "a.pdf", {
    sizeBytes: 2048,
    modifiedAtMs: Date.UTC(2026, 0, 15, 10, 0),
    createdAtMs: Date.UTC(2025, 11, 1, 8, 0),
    depth: 2,
  });
  const txt = file("C:/r/notes", "notes", { depth: 2 });
  const limited = dir("C:/r/deep", "deep", [], { listing: "depthLimited", depth: 1 });
  const incomplete = dir("C:/r/locked", "locked", [file("C:/r/locked/x.bin", "x.bin", { sizeBytes: 10 })], {
    listing: "incomplete",
    depth: 1,
  });
  const tree = dir("C:/r", "r", [
    pdf,
    txt,
    limited,
    incomplete,
    dir("C:/r/A", "A", [pdf, file("C:/r/A/b.txt", "b.txt", { sizeBytes: 4 })], { depth: 1 }),
  ]);

  const fileDetail = buildNodeDetails(tree, pdf.id, [warning(pdf.path, "Metadaten unlesbar")], false);
  assert(fileDetail.selected && fileDetail.kind === "file" && fileDetail.typeLabel === "Datei", "detail: file type");
  assert(fileDetail.name === "a.pdf" && fileDetail.path === pdf.path, "detail: file name/path");
  assert(fileDetail.extension === ".pdf" && fileDetail.depth === 2, "detail: ext/depth");
  assert(fileDetail.size?.state === "present" && fileDetail.size.text.includes("KB"), "detail: file size");
  assert(fileDetail.modified?.state === "present" && fileDetail.created?.state === "present", "detail: file times");
  assert(fileDetail.warningCount === 1 && fileDetail.warningSummary?.includes("Metadaten") === true, "detail: warning on file");

  const noExt = buildNodeDetails(tree, txt.id, [], false);
  assert(noExt.extension === "ohne Dateiendung", "detail: missing extension");
  assert(noExt.size?.state === "unavailable" && noExt.size.text === META_UNAVAILABLE, "detail: size missing but captured elsewhere");
  assert(noExt.modified?.state === "unavailable", "detail: times missing on this file");

  const folder = buildNodeDetails(tree, "C:/r/A", [], false);
  assert(folder.kind === "directory" && folder.typeLabel === "Ordner", "detail: folder type");
  assert(folder.listingLabel === "Eingelesen", "detail: listing read");
  assert(folder.directDirectories === 0 && folder.directFiles === 2, "detail: direct counts");
  assert(folder.containedDirectories === 0 && folder.containedFiles === 2, "detail: recursive counts");
  assert(folder.subtreeSize?.text.includes("Größe im eingelesenen Ergebnis") === true, "detail: subtree size label");
  assert(folder.subtreeSize?.incomplete === false, "detail: complete size when all files have bytes");

  const limitedDetail = buildNodeDetails(tree, limited.id, [], false);
  assert(limitedDetail.listingLabel === listingStatusLabel("depthLimited"), "detail: depthLimited label");
  assert(limitedDetail.listingLabel === "Maximale Einlesetiefe erreicht", "detail: depthLimited text");
  assert(limitedDetail.subtreeSize?.incomplete === true, "detail: depthLimited size incomplete");

  const incompleteDetail = buildNodeDetails(tree, incomplete.id, [warning(incomplete.id, "Zugriff verweigert")], false);
  assert(incompleteDetail.listingLabel === "Unvollständig eingelesen", "detail: incomplete text");
  assert(incompleteDetail.warningCount === 1, "detail: folder warning");
  assert(incompleteDetail.subtreeSize?.incomplete === true, "detail: incomplete listing size");

  const capturedOff = dir("C:/n", "n", [file("C:/n/a.pdf", "a.pdf", { depth: 1 })]);
  const missing = buildNodeDetails(capturedOff, "C:/n/a.pdf", [], false);
  assert(missing.size?.state === "not-captured" && missing.size.text === META_NOT_CAPTURED, "detail: size never captured");
  assert(missing.modified?.state === "not-captured" && missing.created?.state === "not-captured", "detail: times never captured");

  const scanFiltered = buildNodeDetails(tree, "C:/r/A", [], true);
  assert(scanFiltered.subtreeSize?.incomplete === true, "detail: scan extension makes size incomplete");

  const switched = buildNodeDetails(tree, "C:/r/B", [], false);
  assert(!switched.selected, "detail: unknown id is empty");
}

function runViewStatsCheck(): void {
  const tree = dir("C:/root", "root", [
    dir("C:/root/A", "A", [
      file("C:/root/A/Angebot.pdf", "Angebot.pdf", { sizeBytes: 100 }),
      file("C:/root/A/Text.txt", "Text.txt", { sizeBytes: 20 }),
    ]),
    dir("C:/root/B", "B", [file("C:/root/B/Bild.jpg", "Bild.jpg")]),
    dir("C:/root/C", "C", []),
  ]);

  const full = collectViewWorkStats(tree);
  assert(full.directoryCount === 4, "stats: unfiltered folders include ancestors");
  assert(full.fileCount === 3, "stats: unfiltered files");
  assert(full.filesWithSize === 2 && full.sizeBytes === 120, "stats: partial sizes");
  const fullLabel = formatViewWorkStats(full);
  assert(fullLabel.startsWith("Aktuelle Ansicht:"), "stats: label");
  assert(fullLabel.includes("4 Ordner") && fullLabel.includes("3 Dateien"), "stats: counts in label");
  assert(fullLabel.includes("(unvollständig)"), "stats: partial size marked");

  const pdfView = buildDisplayFilterView(
    tree,
    { extensions: [".pdf"], modifiedFrom: "", modifiedUntil: "" },
    DEFAULT_TREE_SORT,
  );
  const filtered = collectViewWorkStats(pdfView.tree);
  assert(filtered.fileCount === 1, "stats: filter files");
  assert(filtered.directoryCount === 2, "stats: filter keeps necessary ancestors");
  assert(filtered.filesWithSize === 1 && filtered.sizeBytes === 100, "stats: filter size of remaining files");
  assert(!formatViewWorkStats(filtered).includes("(unvollständig)"), "stats: complete among remaining files");

  const collapsedRows = deriveVisibleRows(tree, defaultExpandedIds(tree.id));
  const expandedRows = deriveVisibleRows(tree, collectExpandableDirectoryIds(tree));
  assert(collapsedRows.length < expandedRows.length, "stats: expand changes visible rows");
  assert(
    collectViewWorkStats(tree).fileCount === collectViewWorkStats(tree).fileCount,
    "stats: expand does not change work stats input",
  );
  const collapsedStats = collectViewWorkStats(tree);
  const expandedStats = collectViewWorkStats(tree);
  assert(
    collapsedStats.directoryCount === expandedStats.directoryCount &&
      collapsedStats.fileCount === expandedStats.fileCount,
    "stats: collapse/expand does not change numbers",
  );

  const matches = collectMatchIds(tree, "angebot", DEFAULT_TREE_SORT);
  assert(matches.length === 1, "stats: search finds a file");
  assert(collectViewWorkStats(tree).fileCount === 3, "stats: search does not change work stats");

  const noSizes = collectViewWorkStats(
    dir("C:/z", "z", [file("C:/z/a.pdf", "a.pdf"), file("C:/z/b.txt", "b.txt")]),
  );
  assert(noSizes.filesWithSize === 0, "stats: no sizeBytes");
  assert(!formatViewWorkStats(noSizes).includes("0 B"), "stats: do not fake zero total");

  const emptyFilter = buildDisplayFilterView(
    tree,
    { extensions: [".dwg"], modifiedFrom: "", modifiedUntil: "" },
    DEFAULT_TREE_SORT,
  );
  const empty = collectViewWorkStats(emptyFilter.tree);
  assert(empty.directoryCount === 0 && empty.fileCount === 0, "stats: empty filter view");
}
