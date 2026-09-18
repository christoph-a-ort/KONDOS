// Dev-side P1-A check. Mirrors src/ui tree workbench helpers. Not imported by the app.

function isDirectory(node) {
  return node.kind === "directory";
}

function isFile(node) {
  return node.kind === "file";
}

const DEFAULT_TREE_SORT = { column: "name", direction: "asc" };

const DEFAULT_COLUMN_VISIBILITY = {
  size: true,
  modified: true,
  created: false,
};

function visibleColumns(visibility) {
  const columns = ["name"];
  if (visibility.size) columns.push("size");
  if (visibility.modified) columns.push("modified");
  if (visibility.created) columns.push("created");
  return columns;
}

function resizeTargetForBoundary(columns, index) {
  if (index < 0 || index >= columns.length - 1) return null;
  return columns[index];
}

const COLUMN_MIN_WIDTH = { name: 180, size: 88, modified: 140, created: 140 };
const DEFAULT_COLUMN_WIDTHS = { name: 280, size: 100, modified: 156, created: 156 };

function clampColumnWidth(column, width) {
  return Math.max(COLUMN_MIN_WIDTH[column], Math.round(width));
}

function effectiveColumnWidths(columns, stored, viewportWidth, nameAutoFill) {
  const clamped = {
    name: Math.max(COLUMN_MIN_WIDTH.name, stored.name),
    size: Math.max(COLUMN_MIN_WIDTH.size, stored.size),
    modified: Math.max(COLUMN_MIN_WIDTH.modified, stored.modified),
    created: Math.max(COLUMN_MIN_WIDTH.created, stored.created),
  };
  const otherWidth = columns
    .filter((column) => column !== "name")
    .reduce((sum, column) => sum + clamped[column], 0);
  if (!nameAutoFill || viewportWidth <= 0) return clamped;
  return { ...clamped, name: Math.max(clamped.name, viewportWidth - otherWidth) };
}

function resizeStartWidth(column, effective) {
  return effective[column];
}

function beginColumnResize(column, stored, effective) {
  return {
    nameAutoFill: false,
    widths: { ...stored, name: effective.name, [column]: effective[column] },
  };
}

function applyColumnResizeDelta(stored, column, startWidth, delta) {
  return { ...stored, [column]: clampColumnWidth(column, startWidth + delta) };
}

function directionFactor(direction) {
  return direction === "asc" ? 1 : -1;
}

function compareName(left, right) {
  if (left.name !== right.name) {
    return left.name < right.name ? -1 : 1;
  }
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function sortValue(node, column) {
  if (!isFile(node)) return undefined;
  if (column === "size") return node.sizeBytes;
  if (column === "modified") return node.modifiedAtMs;
  if (column === "created") return node.createdAtMs;
  return undefined;
}

function compareFileValues(left, right, sort) {
  if (sort.column === "name") {
    return compareName(left, right) * directionFactor(sort.direction);
  }
  const leftValue = sortValue(left, sort.column);
  const rightValue = sortValue(right, sort.column);
  if (leftValue === undefined && rightValue === undefined) return 0;
  if (leftValue === undefined) return 1;
  if (rightValue === undefined) return -1;
  if (leftValue === rightValue) return 0;
  const ordering = leftValue < rightValue ? -1 : 1;
  return ordering * directionFactor(sort.direction);
}

function compareSiblings(left, right, sort) {
  const leftDir = isDirectory(left);
  const rightDir = isDirectory(right);
  if (leftDir !== rightDir) return leftDir ? -1 : 1;
  if (leftDir && rightDir) {
    return compareName(left, right) * (sort.column === "name" ? directionFactor(sort.direction) : 1);
  }
  const directed = compareFileValues(left, right, sort);
  if (directed !== 0) return directed;
  return compareName(left, right);
}

function sortedChildren(children, sort) {
  return children.slice().sort((left, right) => compareSiblings(left, right, sort));
}

function canExpandDirectory(node) {
  return node.children.length > 0;
}

function listingHint(node) {
  if (!isDirectory(node)) return null;
  if (node.listing === "depthLimited") return "depthLimited";
  if (node.listing === "incomplete") return "incomplete";
  return null;
}

function collectExpandableDirectoryIds(root, into = new Set()) {
  if (isDirectory(root)) {
    if (canExpandDirectory(root)) into.add(root.id);
    for (const child of root.children) collectExpandableDirectoryIds(child, into);
  }
  return into;
}

function deriveVisibleRows(root, expandedIds, sort = DEFAULT_TREE_SORT) {
  const rows = [];
  function walk(node, depth) {
    const directory = isDirectory(node);
    rows.push({ id: node.id, node, depth, directory, expandable: directory && canExpandDirectory(node) });
    if (directory && expandedIds.has(node.id) && node.children.length > 0) {
      for (const child of sortedChildren(node.children, sort)) walk(child, depth + 1);
    }
  }
  walk(root, 0);
  return rows;
}

function findNodeById(root, id) {
  if (root.id === id) return root;
  if (isDirectory(root)) {
    for (const child of root.children) {
      const found = findNodeById(child, id);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function sortAfterHidingColumn(sort, hidden) {
  if (hidden !== "name" && sort.column === hidden) {
    return { ...DEFAULT_TREE_SORT };
  }
  return sort;
}

function selectedIdAfterClick(currentSelectedId, clickedId, keepCurrent) {
  return keepCurrent ? currentSelectedId : clickedId;
}

function selectedIdAfterCollapseAll(rootId) {
  return rootId;
}

function formatExtensionFilter(extensions) {
  return extensions
    .map((value) => value.replace(/^\./, "").toUpperCase())
    .filter((value) => value.length > 0)
    .join(", ");
}

function formatDateTime(ms) {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function createdColumnText(createdAtMs, directory) {
  if (directory) return "—";
  return createdAtMs === undefined ? "—" : formatDateTime(createdAtMs);
}

function formatTreeStatsLine(input) {
  const parts = [`${input.directoryCount} Ordner`, `${input.fileCount} Dateien`];
  if (input.skippedCount > 0) parts.push(`${input.skippedCount} übersprungen`);
  if (input.warningCount > 0) parts.push(`${input.warningCount} Warnungen`);
  parts.push(`${input.durationMs} ms`);
  return parts.join(" · ");
}

function shouldClearScanResultOnError(error) {
  const kind = error && typeof error === "object" ? error.kind : null;
  if (kind === "invalidConfig" || kind === "invalidPath") return false;
  return true;
}

function createDefaultScanConfig() {
  return {
    includeSize: true,
    includeCreatedAt: false,
    includeModifiedAt: true,
  };
}

function file(id, name, extras = {}) {
  return { id, name, path: id, depth: 1, kind: "file", ...extras };
}

function dir(id, name, children, listing = "read") {
  return { id, name, path: id, depth: 0, kind: "directory", listing, children };
}

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function ids(nodes) {
  return nodes.map((node) => node.name).join(",");
}

function visibleIds(root, expanded, sort = DEFAULT_TREE_SORT) {
  return deriveVisibleRows(root, new Set(expanded), sort)
    .map((row) => row.id)
    .join(",");
}

const visibility = { ...DEFAULT_COLUMN_VISIBILITY };
assert(visibleColumns(visibility).join(",") === "name,size,modified", "default columns");
visibility.created = true;
visibility.size = false;
assert(visibleColumns(visibility).join(",") === "name,modified,created", "toggle columns");
assert(visibleColumns({ size: false, modified: false, created: false }).join(",") === "name", "name remains");
assert(resizeTargetForBoundary(["name", "size", "modified"], 0) === "name", "name right edge resizes name");
assert(resizeTargetForBoundary(["name", "size", "modified"], 1) === "size", "size right edge resizes size");
assert(resizeTargetForBoundary(["name", "size", "modified"], 2) === null, "modified last has no resize");
assert(resizeTargetForBoundary(["name", "modified"], 0) === "name", "hidden size: name still resizes name");
assert(resizeTargetForBoundary(["name", "modified"], 1) === null, "hidden size: modified last has no resize");
assert(resizeTargetForBoundary(["name", "size", "created"], 1) === "size", "hidden modified: size resizes size");
assert(resizeTargetForBoundary(["name", "size", "created"], 2) === null, "hidden modified: created last has no resize");
assert(resizeTargetForBoundary(["name", "size", "modified", "created"], 2) === "modified", "four columns: modified");
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

mixed.sort((left, right) => compareSiblings(left, right, { column: "size", direction: "asc" }));
assert(ids(mixed) === "a-dir,b,z.txt,a.txt,m.txt", "size missing last folders first");

mixed.sort((left, right) => compareSiblings(left, right, { column: "size", direction: "desc" }));
assert(ids(mixed) === "a-dir,b,a.txt,z.txt,m.txt", "size desc missing still last");

mixed.sort((left, right) => compareSiblings(left, right, { column: "modified", direction: "asc" }));
assert(ids(mixed) === "a-dir,b,a.txt,z.txt,m.txt", "modified missing last");

mixed.sort((left, right) => compareSiblings(left, right, { column: "created", direction: "desc" }));
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

let sort = { column: "size", direction: "desc" };
sort = sortAfterHidingColumn(sort, "size");
assert(sort.column === "name" && sort.direction === "asc", "reset sort when hiding column");
sort = { column: "modified", direction: "desc" };
sort = sortAfterHidingColumn(sort, "size");
assert(sort.column === "modified", "hiding other column keeps sort");

const empty = dir("e", "empty", [], "read");
const limited = dir("l", "limited", [], "depthLimited");
const incomplete = dir("i", "incomplete", [], "incomplete");
const filled = dir("f", "filled", [file("f/1", "1")]);
assert(!canExpandDirectory(empty), "empty not expandable");
assert(!canExpandDirectory(limited), "depthLimited not expandable");
assert(!canExpandDirectory(incomplete), "incomplete empty not expandable");
assert(canExpandDirectory(filled), "filled expandable");
assert(listingHint(limited) === "depthLimited", "depthLimited hint");
assert(listingHint(incomplete) === "incomplete", "incomplete hint");
assert(listingHint(empty) === null, "read has no listing hint");

const tree = dir("root", "root", [filled, empty]);
const all = collectExpandableDirectoryIds(tree);
assert(all.has("root") && all.has("f") && !all.has("e"), "expand all only expandable");
assert(selectedIdAfterCollapseAll("root") === "root", "collapse all selects root");
assert(visibleIds(tree, ["root"]) === "root,e,f", "collapse all keeps root children");
assert(selectedIdAfterClick("root", "f", true) === "root", "twist keeps selection");
assert(selectedIdAfterClick("root", "f", false) === "f", "row click selects");
assert(!visibleIds(nested, ["root"]).includes("root/A/a1"), "collapsed child not in visible rows");
assert(findNodeById(nested, "root/A/a1")?.path === "root/A/a1", "hidden selection path from full tree");
assert(selectedIdAfterClick("root/A/a1", "root/A", true) === "root/A/a1", "parent twist keeps child");

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

const afterSort = deriveVisibleRows(nested, new Set(["root", "root/A"]), {
  column: "name",
  direction: "desc",
});
assert(afterSort.some((row) => row.id === "root/A/a1"), "selection id remains after sort");

const defaults = createDefaultScanConfig();
assert(defaults.includeSize === true, "default size on");
assert(defaults.includeModifiedAt === true, "default modified on");
assert(defaults.includeCreatedAt === false, "default created off");
const stamped = new Date(2020, 0, 2, 3, 4).getTime();
assert(createdColumnText(stamped, false) === "02.01.2020 03:04", "E: file created displays datetime");
assert(createdColumnText(undefined, false) === "—", "E: file without created is dash");
assert(createdColumnText(stamped, true) === "—", "E: directory created stays dash");
assert(shouldClearScanResultOnError({ kind: "cancelled", message: "x" }), "cancel clears result");
assert(shouldClearScanResultOnError({ kind: "rootInaccessible", message: "x" }), "failed scan clears");
assert(!shouldClearScanResultOnError({ kind: "invalidPath", message: "x" }), "rejected begin");

console.log("tree workbench checks passed");
