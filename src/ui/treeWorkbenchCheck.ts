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
  const collapsed = collapseAllExpandedIds("root");
  assert([...collapsed].join(",") === "root", "collapse all keeps root");
  assert(selectedIdAfterCollapseAll("root") === "root", "collapse all selects root");
  assert(visibleIds(tree, [...collapsed]) === "root,e,f", "collapse all keeps root children");

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
}
