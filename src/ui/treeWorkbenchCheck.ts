import { createDefaultScanConfig, isDirectory, type DirectoryNode, type FileNode, type FsNode } from "../model";
import { shouldClearScanResultOnError } from "../scan";
import {
  DEFAULT_COLUMN_VISIBILITY,
  DEFAULT_COLUMN_WIDTHS,
  applyColumnResizeDelta,
  beginColumnResize,
  effectiveColumnWidths,
  resizeStartWidth,
  resizeTargetForBoundary,
  txtExportColumns,
  visibleColumns,
  type OptionalColumn,
} from "./treeColumns";
import {
  createdColumnText,
  formatByteSize,
  formatDateTime,
  formatExtensionFilter,
  formatTreeStatsLine,
} from "./treeFormat";
import {
  canExpandDirectory,
  collapseAllExpandedIds,
  collectExpandableDirectoryIds,
  deriveVisibleRows,
  findNodeById,
  listingHint,
  selectedIdAfterClick,
  selectedIdAfterCollapseAll,
} from "./treeRows";
import {
  ancestorDirectoryIds,
  clipboardPath,
  collectMatchIds,
  createMatchIdSet,
  emptySearchQuery,
  matchIndexAfterReorder,
  matchIndexForNewQuery,
  nextMatchIndex,
  normalizeSearchQuery,
  previousMatchIndex,
  searchCountLabel,
  withAncestorsExpanded,
} from "./treeSearch";
import {
  DEFAULT_TREE_SORT,
  compareSiblings,
  sortAfterHidingColumn,
  type TreeSort,
} from "./treeSort";

function file(id: string, name: string, extras: Partial<FileNode> = {}): FileNode {
  return { id, name, path: id, depth: 1, kind: "file", ...extras };
}

function dir(
  id: string,
  name: string,
  children: FsNode[],
  listing: DirectoryNode["listing"] = "read",
): DirectoryNode {
  return { id, name, path: id, depth: 0, kind: "directory", listing, children };
}

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(label);
  }
}

function ids(nodes: FsNode[]): string {
  return nodes.map((node) => node.name).join(",");
}

function visibleIds(root: FsNode, expanded: string[], sort: TreeSort = DEFAULT_TREE_SORT): string {
  return deriveVisibleRows(root, new Set(expanded), sort)
    .map((row) => row.id)
    .join(",");
}

export function runTreeWorkbenchCheck(): void {
  const visibility = { ...DEFAULT_COLUMN_VISIBILITY };
  assert(visibleColumns(visibility).join(",") === "name,size,modified", "default columns");
  visibility.created = true;
  visibility.size = false;
  assert(visibleColumns(visibility).join(",") === "name,modified,created", "toggle columns");
  assert(visibleColumns({ size: false, modified: false, created: false }).join(",") === "name", "name remains");
  const txtCols = txtExportColumns({ size: false, modified: true, created: false });
  assert(txtCols.size === false && txtCols.modified === true && txtCols.created === false, "txt columns follow visibility");
  assert(resizeTargetForBoundary(["name", "size", "modified"], 0) === "name", "name right edge resizes name");
  assert(resizeTargetForBoundary(["name", "size", "modified"], 1) === "size", "size right edge resizes size");
  assert(resizeTargetForBoundary(["name", "size", "modified"], 2) === null, "modified last has no resize");
  assert(resizeTargetForBoundary(["name", "modified"], 0) === "name", "hidden size: name still resizes name");
  assert(resizeTargetForBoundary(["name", "modified"], 1) === null, "hidden size: modified last has no resize");
  assert(resizeTargetForBoundary(["name", "size", "created"], 1) === "size", "hidden modified: size resizes size");
  assert(resizeTargetForBoundary(["name", "size", "created"], 2) === null, "hidden modified: created last has no resize");
  assert(
    resizeTargetForBoundary(["name", "size", "modified", "created"], 2) === "modified",
    "four columns: modified resizes modified",
  );
  assert(resizeTargetForBoundary(["name", "size", "modified", "created"], 3) === null, "created last has no resize");

  const defaultVisible = visibleColumns(DEFAULT_COLUMN_VISIBILITY);
  const stored = { ...DEFAULT_COLUMN_WIDTHS };
  const filledLayout = effectiveColumnWidths(defaultVisible, stored, 800, true);
  assert(filledLayout.name === 544, "A: leftover name fills viewport remainder");
  assert(filledLayout.size === 100 && filledLayout.modified === 156, "A: metadata keeps stored widths");
  assert(resizeStartWidth("name", filledLayout) === 544, "B: name resize starts from effective width");
  assert(resizeStartWidth("name", filledLayout) !== stored.name, "B: name start is not stored 280");

  const nameDrag = beginColumnResize("name", stored, filledLayout);
  assert(nameDrag.nameAutoFill === false, "C: name drag disables leftover fill");
  const afterNameLeft = applyColumnResizeDelta(nameDrag.widths, "name", filledLayout.name, -40);
  const visibleAfterName = effectiveColumnWidths(defaultVisible, afterNameLeft, 800, false);
  assert(visibleAfterName.name === 504, "C: name drag is immediately visible");
  assert(visibleAfterName.size === 100 && visibleAfterName.modified === 156, "C: name drag leaves metadata");

  const sizeBegin = beginColumnResize("size", stored, filledLayout);
  const afterSize = applyColumnResizeDelta(sizeBegin.widths, "size", filledLayout.size, 20);
  const visibleAfterSize = effectiveColumnWidths(defaultVisible, afterSize, 800, false);
  assert(visibleAfterSize.size === 120, "D: size drag changes size");
  assert(visibleAfterSize.name === 544, "D: size drag does not change name");

  let sequential = applyColumnResizeDelta(nameDrag.widths, "name", filledLayout.name, -40);
  sequential = applyColumnResizeDelta(sequential, "name", 504, -40);
  sequential = applyColumnResizeDelta(sequential, "name", 464, 20);
  sequential = applyColumnResizeDelta(sequential, "name", 484, 40);
  const visibleSequential = effectiveColumnWidths(defaultVisible, sequential, 800, false);
  assert(visibleSequential.name === 524, "E: consecutive name drags stay consistent");

  const nameOnlyModified = visibleColumns({ size: false, modified: true, created: false });
  assert(resizeTargetForBoundary(nameOnlyModified, 0) === "name", "G: hidden size name|modified resizes name");
  assert(resizeTargetForBoundary(nameOnlyModified, 1) === null, "F: last visible column has no resize");
  const hiddenSizeFilled = effectiveColumnWidths(nameOnlyModified, stored, 800, true);
  assert(hiddenSizeFilled.name === 644, "G: leftover uses visible columns only");
  const fourCols = visibleColumns({ size: true, modified: true, created: true });
  assert(resizeTargetForBoundary(fourCols, 2) === "modified", "G: four columns modified|created resizes modified");
  assert(resizeTargetForBoundary(fourCols, 3) === null, "F: created last has no resize");
  const fourFilled = effectiveColumnWidths(fourCols, stored, 800, true);
  assert(fourFilled.name === 388, "G: leftover with created visible");

  const files = [
    file("z", "z.txt", { sizeBytes: 10, modifiedAtMs: 30, createdAtMs: 30 }),
    file("m", "m.txt"),
    file("a", "a.txt", { sizeBytes: 50, modifiedAtMs: 10, createdAtMs: 50 }),
  ];
  const folders = [dir("b", "b", []), dir("a-dir", "a-dir", [])];
  const mixed = [...files, ...folders];
  mixed.sort((left, right) => compareSiblings(left, right, DEFAULT_TREE_SORT));
  assert(ids(mixed) === "a-dir,b,a.txt,m.txt,z.txt", "name asc folders first");

  mixed.sort((left, right) =>
    compareSiblings(left, right, { column: "size", direction: "asc" }),
  );
  assert(ids(mixed) === "a-dir,b,z.txt,a.txt,m.txt", "size missing last folders first");

  mixed.sort((left, right) =>
    compareSiblings(left, right, { column: "size", direction: "desc" }),
  );
  assert(ids(mixed) === "a-dir,b,a.txt,z.txt,m.txt", "size desc missing still last");

  mixed.sort((left, right) =>
    compareSiblings(left, right, { column: "modified", direction: "asc" }),
  );
  assert(ids(mixed) === "a-dir,b,a.txt,z.txt,m.txt", "modified missing last");

  mixed.sort((left, right) =>
    compareSiblings(left, right, { column: "created", direction: "desc" }),
  );
  assert(ids(mixed) === "a-dir,b,a.txt,z.txt,m.txt", "created desc missing last");

  const nested = dir("root", "root", [
    dir("root/C", "C", [file("root/C/c1", "c1")]),
    file("root/B", "B"),
    dir("root/A", "A", [file("root/A/a2", "a2"), file("root/A/a1", "a1")]),
  ]);
  assert(
    visibleIds(nested, ["root", "root/A"]) === "root,root/A,root/A/a1,root/A/a2,root/C,root/B",
    "sort stays inside folder",
  );

  let sort: TreeSort = { column: "size", direction: "desc" };
  const hide = (column: OptionalColumn) => {
    sort = sortAfterHidingColumn(sort, column);
  };
  hide("size");
  assert(sort.column === "name" && sort.direction === "asc", "reset sort when hiding column");
  sort = { column: "modified", direction: "desc" };
  hide("size");
  assert(sort.column === "modified", "hiding other column keeps sort");

  const empty = dir("e", "empty", [], "read");
  const limited = dir("l", "limited", [], "depthLimited");
  const incomplete = dir("i", "incomplete", [], "incomplete");
  const filled = dir("f", "filled", [file("f/1", "1")]);
  const incompletePartial = dir("p", "partial", [file("p/1", "1")], "incomplete");
  assert(!canExpandDirectory(empty), "empty not expandable");
  assert(!canExpandDirectory(limited), "depthLimited not expandable");
  assert(!canExpandDirectory(incomplete), "incomplete empty not expandable");
  assert(canExpandDirectory(filled), "filled expandable");
  assert(canExpandDirectory(incompletePartial), "incomplete with children expandable");
  assert(listingHint(empty) === null, "read has no listing hint");
  assert(listingHint(limited) === "depthLimited", "depthLimited hint");
  assert(listingHint(incomplete) === "incomplete", "incomplete hint");
  assert(listingHint(file("x", "x.txt")) === null, "files have no listing hint");

  const tree = dir("root", "root", [filled, empty]);
  const all = collectExpandableDirectoryIds(tree);
  assert(all.has("root") && all.has("f") && !all.has("e"), "expand all only expandable");
  const collapsed = collapseAllExpandedIds();
  assert(collapsed.size === 0, "collapse all does not keep root expanded");
  assert(selectedIdAfterCollapseAll("root") === "root", "collapse all selects root");
  assert(visibleIds(tree, [...collapsed]) === "root", "collapse all shows only root");
  assert(findNodeById(tree, selectedIdAfterCollapseAll(tree.id))?.path === tree.path, "root path remains after collapse all");

  assert(selectedIdAfterClick("root", "f", true) === "root", "twist keeps selection");
  assert(selectedIdAfterClick("root", "f", false) === "f", "row click selects");

  const collapsedParent = deriveVisibleRows(nested, new Set(["root"]));
  assert(
    !collapsedParent.some((row) => row.id === "root/A/a1"),
    "collapsed child not in visible rows",
  );
  assert(findNodeById(nested, "root/A/a1")?.path === "root/A/a1", "hidden selection path from full tree");
  assert(findNodeById(nested, "missing") === undefined, "unknown id");
  assert(selectedIdAfterClick("root/A/a1", "root/A", true) === "root/A/a1", "parent twist keeps child");

  assert(formatByteSize(842) === "842 B", "size B");
  assert(formatByteSize(25_190) === "24,6 KB", "size KB");
  const stamped = new Date(2020, 0, 2, 3, 4).getTime();
  assert(formatDateTime(stamped) === "02.01.2020 03:04", "datetime format");
  assert(createdColumnText(stamped, false) === "02.01.2020 03:04", "E: file created displays datetime");
  assert(createdColumnText(undefined, false) === "—", "E: file without created is dash");
  assert(createdColumnText(stamped, true) === "—", "E: directory created stays dash");
  assert(formatExtensionFilter([".pdf", ".docx"]) === "PDF, DOCX", "filter label");
  assert(
    formatTreeStatsLine({
      directoryCount: 104,
      fileCount: 394,
      skippedCount: 2,
      warningCount: 0,
      durationMs: 18,
    }) === "104 Ordner · 394 Dateien · 2 übersprungen · 18 ms",
    "skipped stats without filter text",
  );
  assert(
    formatTreeStatsLine({
      directoryCount: 1,
      fileCount: 1,
      skippedCount: 0,
      warningCount: 0,
      durationMs: 3,
    }) === "1 Ordner · 1 Dateien · 3 ms",
    "no skipped suffix",
  );

  const selected = "root/A/a1";
  const afterSort = deriveVisibleRows(nested, new Set(["root", "root/A"]), {
    column: "name",
    direction: "desc",
  });
  assert(
    afterSort.some((row) => row.id === selected),
    "selection id remains after sort",
  );

  const defaults = createDefaultScanConfig();
  assert(defaults.includeSize === true, "default size on");
  assert(defaults.includeModifiedAt === true, "default modified on");
  assert(defaults.includeCreatedAt === false, "default created off");

  assert(shouldClearScanResultOnError({ kind: "cancelled", message: "x" }), "cancel clears result");
  assert(shouldClearScanResultOnError({ kind: "rootInaccessible", message: "x" }), "failed scan clears");
  assert(
    !shouldClearScanResultOnError({ kind: "invalidPath", message: "x" }),
    "rejected begin keeps previous only if never started",
  );

  assert(isDirectory(nested), "root directory");
  runTreeSearchCheck(nested);
}

function runTreeSearchCheck(nested: DirectoryNode): void {
  const searchRoot = dir("C:/Hausverwaltung", "Hausverwaltung", [
    dir("C:/Hausverwaltung/Herrsching", "Herrsching", [
      file("C:/Hausverwaltung/Herrsching/Rechnung 2025.pdf", "Rechnung 2025.pdf"),
      file("C:/Hausverwaltung/Herrsching/Notiz.txt", "Notiz.txt"),
    ]),
    dir("C:/Hausverwaltung/Weßling", "Weßling", [
      file("C:/Hausverwaltung/Weßling/Schlussrechnung.docx", "Schlussrechnung.docx"),
    ]),
  ]);

  assert(normalizeSearchQuery("  ") === "", "whitespace-only is empty");
  assert(collectMatchIds(searchRoot, "   ", DEFAULT_TREE_SORT).length === 0, "whitespace-only has no matches");
  assert(searchCountLabel("   ", 0, -1) === null, "empty search hides count");

  const byName = collectMatchIds(searchRoot, "rechnung", DEFAULT_TREE_SORT);
  assert(
    byName.join(",") ===
      "C:/Hausverwaltung/Herrsching/Rechnung 2025.pdf,C:/Hausverwaltung/Weßling/Schlussrechnung.docx",
    "substring in name is case-insensitive",
  );

  const byPath = collectMatchIds(searchRoot, "herrsching", DEFAULT_TREE_SORT);
  assert(byPath.join(",") === "C:/Hausverwaltung/Herrsching", "folder name itself is a match");
  assert(!byPath.includes("C:/Hausverwaltung/Herrsching/Notiz.txt"), "path-only child is not a match");
  assert(!byPath.includes("C:/Hausverwaltung/Herrsching/Rechnung 2025.pdf"), "other child in matching folder is not a match");

  const kuendigung = dir("C:/root/Kündigung", "Kündigung", [
    file("C:/root/Kündigung/2023_Kündigung_EON.pdf", "2023_Kündigung_EON.pdf"),
    file("C:/root/Kündigung/Start_Umbenennen.bat", "Start_Umbenennen.bat"),
    file("C:/root/Kündigung/ZeichenEntfernen_PDF.ps1", "ZeichenEntfernen_PDF.ps1"),
  ]);
  const kuendigungMatches = collectMatchIds(kuendigung, "Kündigung", DEFAULT_TREE_SORT);
  assert(kuendigungMatches.includes("C:/root/Kündigung"), "A/C: folder name match");
  assert(kuendigungMatches.includes("C:/root/Kündigung/2023_Kündigung_EON.pdf"), "A/F: substring in file name");
  assert(!kuendigungMatches.includes("C:/root/Kündigung/Start_Umbenennen.bat"), "B/D: path-only bat is not a match");
  assert(
    !kuendigungMatches.includes("C:/root/Kündigung/ZeichenEntfernen_PDF.ps1"),
    "B/D: path-only ps1 is not a match",
  );
  assert(collectMatchIds(kuendigung, "kündigung", DEFAULT_TREE_SORT).join(",") === kuendigungMatches.join(","), "E: case-insensitive");

  assert(collectMatchIds(searchRoot, "xyz-none", DEFAULT_TREE_SORT).length === 0, "0 matches");
  assert(searchCountLabel("xyz-none", 0, -1) === "0 Treffer", "0 Treffer label");
  assert(searchCountLabel("rechnung", 2, 0) === "1 von 2", "1 von n label");

  const collapsedMatches = collectMatchIds(searchRoot, "notiz", DEFAULT_TREE_SORT);
  assert(collapsedMatches.join(",") === "C:/Hausverwaltung/Herrsching/Notiz.txt", "match in closed branch stays listed");
  assert(
    !visibleIds(searchRoot, ["C:/Hausverwaltung"]).includes("C:/Hausverwaltung/Herrsching/Notiz.txt"),
    "closed branch not in visible rows",
  );

  const nameDesc = collectMatchIds(searchRoot, "rechnung", { column: "name", direction: "desc" });
  assert(
    nameDesc[0] === "C:/Hausverwaltung/Weßling/Schlussrechnung.docx",
    "sibling sort changes match order",
  );

  const fullyExpanded = deriveVisibleRows(
    searchRoot,
    new Set(["C:/Hausverwaltung", "C:/Hausverwaltung/Herrsching", "C:/Hausverwaltung/Weßling"]),
  );
  const preorder = fullyExpanded
    .filter((row) => byName.includes(row.id))
    .map((row) => row.id);
  assert(preorder.join(",") === byName.join(","), "match order is fully expanded preorder");

  const ancestors = ancestorDirectoryIds(searchRoot, "C:/Hausverwaltung/Herrsching/Notiz.txt");
  assert(
    ancestors.join(",") === "C:/Hausverwaltung,C:/Hausverwaltung/Herrsching",
    "ancestors of nested file",
  );
  const expanded = withAncestorsExpanded(new Set(["C:/Hausverwaltung", "C:/Hausverwaltung/Weßling"]), ancestors);
  assert(expanded.has("C:/Hausverwaltung/Herrsching"), "needed ancestor added");
  assert(expanded.has("C:/Hausverwaltung/Weßling"), "other open branch kept");
  assert(expanded.size === 3, "only necessary ancestors added");

  assert(nextMatchIndex(0, 17, true) === 1, "next from first");
  assert(nextMatchIndex(16, 17, true) === 0, "wrap 17 → 1");
  assert(previousMatchIndex(0, 17, true) === 16, "wrap 1 → 17");
  assert(nextMatchIndex(0, 17, false) === 0, "first next reveals current");
  assert(previousMatchIndex(0, 17, false) === 0, "first previous reveals current");
  assert(matchIndexForNewQuery(byName) === 0, "new query starts at first");
  assert(matchIndexForNewQuery([]) === -1, "new query with 0 matches");

  const resorted = collectMatchIds(searchRoot, "rechnung", { column: "name", direction: "desc" });
  const kept = matchIndexAfterReorder(resorted, "C:/Hausverwaltung/Herrsching/Rechnung 2025.pdf");
  assert(resorted[kept] === "C:/Hausverwaltung/Herrsching/Rechnung 2025.pdf", "sort keeps current id");
  assert(matchIndexAfterReorder(resorted, "missing") === 0, "missing id falls back to first");

  const selectedBeforeQuery = "C:/Hausverwaltung/Weßling";
  collectMatchIds(searchRoot, "rechnung", DEFAULT_TREE_SORT);
  assert(selectedBeforeQuery === "C:/Hausverwaltung/Weßling", "query collection does not change selection");

  assert(emptySearchQuery() === "", "new scan resets query");
  assert(collectMatchIds(nested, emptySearchQuery(), DEFAULT_TREE_SORT).length === 0, "reset query has no matches");

  const matchSet = createMatchIdSet(byName);
  assert(matchSet.has(byName[0]) && !matchSet.has("missing"), "row lookup is set membership");
  assert(clipboardPath(file("C:/Pfad mit Leerzeichen/Äpfel.txt", "Äpfel.txt")) === "C:/Pfad mit Leerzeichen/Äpfel.txt", "clipboard uses node.path");

  const queryAfterCollapse = "notiz";
  const matchesAfterCollapse = collectMatchIds(searchRoot, queryAfterCollapse, DEFAULT_TREE_SORT);
  const collapsedAll = collapseAllExpandedIds();
  assert(visibleIds(searchRoot, [...collapsedAll]) === "C:/Hausverwaltung", "collapse all with search shows only root");
  assert(matchesAfterCollapse.join(",") === "C:/Hausverwaltung/Herrsching/Notiz.txt", "search hits remain after collapse all");
  const afterCollapseAncestors = ancestorDirectoryIds(
    searchRoot,
    "C:/Hausverwaltung/Herrsching/Notiz.txt",
  );
  const revealed = withAncestorsExpanded(collapsedAll, afterCollapseAncestors);
  assert(revealed.has("C:/Hausverwaltung"), "navigation opens root");
  assert(revealed.has("C:/Hausverwaltung/Herrsching"), "navigation opens needed ancestors");
  assert(!revealed.has("C:/Hausverwaltung/Weßling"), "other branches stay closed");
  assert(
    visibleIds(searchRoot, [...revealed]).includes("C:/Hausverwaltung/Herrsching/Notiz.txt"),
    "revealed match becomes visible",
  );
}
