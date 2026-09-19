// Dev-side P1-C check. Mirrors prefs + display filter helpers. Not imported by the app.

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function isDirectory(node) {
  return node.kind === "directory";
}

function isFile(node) {
  return node.kind === "file";
}

function file(id, name, extras = {}) {
  return { id, name, path: id, depth: 1, kind: "file", ...extras };
}

function dir(id, name, children) {
  return { id, name, path: id, depth: 0, kind: "directory", listing: "read", children };
}

const NO_EXTENSION_KEY = "";
const NO_EXTENSION_LABEL = "Ohne Dateiendung";
const DEFAULT_TREE_SORT = { column: "name", direction: "asc" };
const WORKBENCH_PREFS_KEY = "kondos.workbench-prefs.v1";
const MAX_DEPTH = 8;
const DEFAULT_DEPTH = 8;
const MIN_DEPTH = 1;
const COLUMN_MIN_WIDTH = { name: 180, size: 88, modified: 140, created: 140 };
const DEFAULT_COLUMN_WIDTHS = { name: 280, size: 100, modified: 156, created: 156 };
const DEFAULT_COLUMN_VISIBILITY = { size: true, modified: true, created: false };

function clampDepth(value) {
  if (Number.isNaN(value)) return DEFAULT_DEPTH;
  return Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, Math.trunc(value)));
}

function normalizeExtension(value) {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed === ".") return null;
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function parseExtensionInput(input) {
  const extensions = [];
  for (const part of input.split(/[,;\s]+/)) {
    const normalized = normalizeExtension(part);
    if (normalized !== null && !extensions.includes(normalized)) extensions.push(normalized);
  }
  return extensions;
}

function formatExtensionInput(extensions) {
  return extensions.join(", ");
}

function defaultWorkbenchPrefs() {
  return {
    version: 1,
    rootPath: "",
    maxDepth: DEFAULT_DEPTH,
    excludeHidden: true,
    extensionInput: "",
    includeSize: true,
    includeCreatedAt: false,
    includeModifiedAt: true,
    columnVisibility: { ...DEFAULT_COLUMN_VISIBILITY },
    columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
    sort: { ...DEFAULT_TREE_SORT },
  };
}

function asRecord(value) {
  return value !== null && typeof value === "object" ? value : {};
}

function sanitizeWidth(column, value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(COLUMN_MIN_WIDTH[column], Math.round(value));
}

function sanitizeWorkbenchPrefs(raw) {
  const defaults = defaultWorkbenchPrefs();
  if (raw === null || typeof raw !== "object") return defaults;
  const value = raw;
  const visibility = asRecord(value.columnVisibility);
  const widths = asRecord(value.columnWidths);
  const sort = asRecord(value.sort);
  const extensionInput =
    typeof value.extensionInput === "string"
      ? formatExtensionInput(parseExtensionInput(value.extensionInput))
      : Array.isArray(value.extensions)
        ? formatExtensionInput(value.extensions.filter((item) => typeof item === "string"))
        : defaults.extensionInput;
  return {
    version: 1,
    rootPath: typeof value.rootPath === "string" ? value.rootPath : defaults.rootPath,
    maxDepth: clampDepth(typeof value.maxDepth === "number" ? value.maxDepth : defaults.maxDepth),
    excludeHidden: typeof value.excludeHidden === "boolean" ? value.excludeHidden : defaults.excludeHidden,
    extensionInput,
    includeSize: typeof value.includeSize === "boolean" ? value.includeSize : defaults.includeSize,
    includeCreatedAt: typeof value.includeCreatedAt === "boolean" ? value.includeCreatedAt : defaults.includeCreatedAt,
    includeModifiedAt: typeof value.includeModifiedAt === "boolean" ? value.includeModifiedAt : defaults.includeModifiedAt,
    columnVisibility: {
      size: typeof visibility.size === "boolean" ? visibility.size : defaults.columnVisibility.size,
      modified: typeof visibility.modified === "boolean" ? visibility.modified : defaults.columnVisibility.modified,
      created: typeof visibility.created === "boolean" ? visibility.created : defaults.columnVisibility.created,
    },
    columnWidths: {
      name: sanitizeWidth("name", widths.name, defaults.columnWidths.name),
      size: sanitizeWidth("size", widths.size, defaults.columnWidths.size),
      modified: sanitizeWidth("modified", widths.modified, defaults.columnWidths.modified),
      created: sanitizeWidth("created", widths.created, defaults.columnWidths.created),
    },
    sort: {
      column: ["name", "size", "modified", "created"].includes(sort.column) ? sort.column : defaults.sort.column,
      direction: sort.direction === "asc" || sort.direction === "desc" ? sort.direction : defaults.sort.direction,
    },
  };
}

function loadWorkbenchPrefs(storage) {
  const raw = storage.getItem(WORKBENCH_PREFS_KEY);
  if (raw === null || raw.trim().length === 0) return defaultWorkbenchPrefs();
  try {
    return sanitizeWorkbenchPrefs(JSON.parse(raw));
  } catch {
    return defaultWorkbenchPrefs();
  }
}

function saveWorkbenchPrefs(prefs, storage) {
  storage.setItem(WORKBENCH_PREFS_KEY, JSON.stringify(sanitizeWorkbenchPrefs(prefs)));
  return true;
}

function fileExtensionKey(name) {
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === name.length - 1) return null;
  return name.slice(lastDot).toLocaleLowerCase();
}

function collectDisplayExtensionOptions(root) {
  const keys = new Set();
  function walk(node) {
    if (isFile(node)) keys.add(fileExtensionKey(node.name) ?? NO_EXTENSION_KEY);
    else if (isDirectory(node)) for (const child of node.children) walk(child);
  }
  walk(root);
  const named = [...keys]
    .filter((key) => key !== NO_EXTENSION_KEY)
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }))
    .map((key) => ({ key, label: key.slice(1).toLocaleUpperCase() }));
  if (keys.has(NO_EXTENSION_KEY)) named.push({ key: NO_EXTENSION_KEY, label: NO_EXTENSION_LABEL });
  return named;
}

function displayFilterHasConstraint(filter) {
  return filter.extensions.length > 0 || filter.modifiedFrom.length > 0 || filter.modifiedUntil.length > 0;
}

function parseYmd(ymd) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(year, month - 1, day);
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) return null;
  return { year, month, day };
}

function startOfLocalDay(ymd) {
  const parts = parseYmd(ymd);
  return parts === null ? null : new Date(parts.year, parts.month - 1, parts.day).getTime();
}

function endOfLocalDay(ymd) {
  const parts = parseYmd(ymd);
  return parts === null ? null : new Date(parts.year, parts.month - 1, parts.day, 23, 59, 59, 999).getTime();
}

function isDateRangeInvalid(from, until) {
  if (from.length === 0 || until.length === 0) return false;
  const start = startOfLocalDay(from);
  const end = startOfLocalDay(until);
  return start !== null && end !== null && start > end;
}

function extensionMatches(name, selected) {
  if (selected.length === 0) return true;
  return selected.includes(fileExtensionKey(name) ?? NO_EXTENSION_KEY);
}

function modifiedMatches(modifiedAtMs, from, until) {
  if (from.length === 0 && until.length === 0) return true;
  if (modifiedAtMs === undefined) return false;
  if (from.length > 0) {
    const start = startOfLocalDay(from);
    if (start !== null && modifiedAtMs < start) return false;
  }
  if (until.length > 0) {
    const end = endOfLocalDay(until);
    if (end !== null && modifiedAtMs > end) return false;
  }
  return true;
}

function fileMatchesDisplayFilter(node, filter) {
  return extensionMatches(node.name, filter.extensions) && modifiedMatches(node.modifiedAtMs, filter.modifiedFrom, filter.modifiedUntil);
}

function compareName(left, right) {
  if (left.name !== right.name) return left.name < right.name ? -1 : 1;
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function directionFactor(direction) {
  return direction === "asc" ? 1 : -1;
}

function sortValue(node, column) {
  if (!isFile(node)) return undefined;
  if (column === "size") return node.sizeBytes;
  if (column === "modified") return node.modifiedAtMs;
  if (column === "created") return node.createdAtMs;
  return undefined;
}

function compareFileValues(left, right, sort) {
  if (sort.column === "name") return compareName(left, right) * directionFactor(sort.direction);
  const leftValue = sortValue(left, sort.column);
  const rightValue = sortValue(right, sort.column);
  if (leftValue === undefined && rightValue === undefined) return 0;
  if (leftValue === undefined) return 1;
  if (rightValue === undefined) return -1;
  if (leftValue === rightValue) return 0;
  return (leftValue < rightValue ? -1 : 1) * directionFactor(sort.direction);
}

function compareSiblings(left, right, sort) {
  const leftDir = isDirectory(left);
  const rightDir = isDirectory(right);
  if (leftDir !== rightDir) return leftDir ? -1 : 1;
  if (leftDir && rightDir) {
    return compareName(left, right) * (sort.column === "name" ? directionFactor(sort.direction) : 1);
  }
  const directed = compareFileValues(left, right, sort);
  return directed !== 0 ? directed : compareName(left, right);
}

function sortedChildren(children, sort) {
  return children.slice().sort((left, right) => compareSiblings(left, right, sort));
}

function pruneNode(node, filter, sort, isRoot) {
  if (isFile(node)) {
    return fileMatchesDisplayFilter(node, filter) ? { node, fileMatchCount: 1 } : { node: null, fileMatchCount: 0 };
  }
  let fileMatchCount = 0;
  const kept = [];
  for (const child of sortedChildren(node.children, sort)) {
    const pruned = pruneNode(child, filter, sort, false);
    fileMatchCount += pruned.fileMatchCount;
    if (pruned.node !== null) kept.push(pruned.node);
  }
  if (fileMatchCount === 0) return { node: isRoot ? null : null, fileMatchCount: 0 };
  return { node: { ...node, children: kept }, fileMatchCount };
}

function countFiles(root) {
  let count = 0;
  function walk(node) {
    if (isFile(node)) count += 1;
    else if (isDirectory(node)) for (const child of node.children) walk(child);
  }
  walk(root);
  return count;
}

function buildDisplayFilterView(root, filter, sort) {
  if (filter === null || !displayFilterHasConstraint(filter)) {
    return { tree: root, fileMatchCount: countFiles(root), constrained: false };
  }
  const pruned = pruneNode(root, filter, sort, true);
  return { tree: pruned.node, fileMatchCount: pruned.fileMatchCount, constrained: true };
}

function nodeVisibleInDisplayTree(root, id) {
  if (root === null) return false;
  function find(node) {
    if (node.id === id) return true;
    return isDirectory(node) && node.children.some(find);
  }
  return find(root);
}

function collectMatchIds(root, query, sort) {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0) return [];
  const matches = [];
  function walk(node) {
    if (node.name.toLocaleLowerCase().includes(needle)) matches.push(node.id);
    if (isDirectory(node) && node.children.length > 0) {
      for (const child of sortedChildren(node.children, sort)) walk(child);
    }
  }
  walk(root);
  return matches;
}

function deriveVisibleRows(root, expandedIds, sort = DEFAULT_TREE_SORT) {
  const rows = [];
  function walk(node, depth) {
    const directory = isDirectory(node);
    rows.push({ id: node.id, node, depth, directory });
    if (directory && expandedIds.has(node.id) && node.children.length > 0) {
      for (const child of sortedChildren(node.children, sort)) walk(child, depth + 1);
    }
  }
  walk(root, 0);
  return rows;
}

function visibleIds(root, expanded, sort = DEFAULT_TREE_SORT) {
  return deriveVisibleRows(root, new Set(expanded), sort).map((row) => row.id).join(",");
}

function canScanFromHere(node) {
  return node !== undefined && isDirectory(node);
}

function selectedIdAfterPointer(currentSelectedId, rowId, target) {
  return target === "row" ? rowId : currentSelectedId;
}

function withScanRootPath(config, path) {
  if (config.rootPath === path) return config;
  return { ...config, rootPath: path };
}

function snapshotHasModifiedTimestamps(root) {
  function walk(node) {
    if (isFile(node) && node.modifiedAtMs !== undefined) return true;
    return isDirectory(node) && node.children.some(walk);
  }
  return walk(root);
}

function displayFilterApplyError(draft, hasModifiedTimestamps) {
  if (isDateRangeInvalid(draft.modifiedFrom, draft.modifiedUntil)) {
    return "Das Von-Datum darf nicht nach dem Bis-Datum liegen.";
  }
  if ((draft.modifiedFrom.length > 0 || draft.modifiedUntil.length > 0) && !hasModifiedTimestamps) {
    return "Datumsfilter benötigt Änderungsdaten. Beim Einlesen „Geändert“ aktivieren.";
  }
  return null;
}

class MemoryStorage {
  constructor() {
    this.data = new Map();
  }
  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }
  setItem(key, value) {
    this.data.set(key, value);
  }
}

const empty = loadWorkbenchPrefs({ getItem: () => null, setItem() {} });
assert(empty.rootPath === "" && empty.maxDepth === DEFAULT_DEPTH, "prefs: empty storage uses defaults");
assert(empty.includeCreatedAt === false && empty.columnVisibility.created === false, "prefs: created off");

const storage = new MemoryStorage();
const saved = sanitizeWorkbenchPrefs({
  rootPath: "C:/Hausverwaltung",
  maxDepth: 4,
  excludeHidden: false,
  extensionInput: "PDF, docx",
  includeSize: false,
  includeCreatedAt: true,
  includeModifiedAt: false,
  columnVisibility: { size: false, modified: true, created: true },
  columnWidths: { name: 320, size: 110, modified: 160, created: 160 },
  sort: { column: "modified", direction: "desc" },
});
assert(saveWorkbenchPrefs(saved, storage), "prefs: save ok");
const loaded = loadWorkbenchPrefs(storage);
assert(loaded.rootPath === "C:/Hausverwaltung", "prefs: root");
assert(loaded.maxDepth === 4 && loaded.excludeHidden === false, "prefs: depth/hidden");
assert(loaded.extensionInput.includes(".pdf"), "prefs: scan extensions");
assert(loaded.includeSize === false && loaded.includeCreatedAt === true, "prefs: metadata");
assert(loaded.columnVisibility.size === false && loaded.columnWidths.name === 320, "prefs: columns/widths");
assert(loaded.sort.column === "modified", "prefs: sort");
const persisted = JSON.parse(storage.getItem(WORKBENCH_PREFS_KEY));
assert(!("searchQuery" in persisted) && !("appliedFilter" in persisted), "prefs: session-only omitted");

const fallback = sanitizeWorkbenchPrefs({
  maxDepth: 99,
  includeSize: "yes",
  columnVisibility: { size: "no" },
  columnWidths: { name: 12 },
  sort: { column: "owner", direction: "sideways" },
  searchQuery: "secret",
});
assert(fallback.maxDepth === 8, "prefs: invalid depth");
assert(fallback.includeSize === true && fallback.sort.column === "name", "prefs: invalid fields fallback");
assert(!("searchQuery" in fallback), "prefs: search not stored");
assert(loadWorkbenchPrefs({ getItem: () => "{not json", setItem() {} }).maxDepth === DEFAULT_DEPTH, "prefs: broken json");

const folder = dir("C:/A", "A", [file("C:/A/x.pdf", "x.pdf")]);
assert(!canScanFromHere(undefined) && !canScanFromHere(file("C:/A/x.pdf", "x.pdf")), "scan-from: none/file off");
assert(canScanFromHere(folder), "scan-from: folder on");
const config = { rootPath: "C:/old", maxDepth: 3, extensions: [".pdf"], excludeHidden: true };
const next = withScanRootPath(config, folder.path);
assert(next.rootPath === "C:/A" && next.maxDepth === 3 && config.rootPath === "C:/old", "scan-from: path only");
let selectedId = null;
selectedId = selectedIdAfterPointer(selectedId, folder.id, "twist");
assert(selectedId === null, "twist does not select folder");
selectedId = selectedIdAfterPointer(selectedId, folder.id, "row");
assert(selectedId === folder.id, "first row click after twist selects folder");
assert(canScanFromHere(folder) && !canScanFromHere(file("C:/A/x.pdf", "x.pdf")), "scan-from follows node kind");

const day = (year, month, date, hour = 0, minute = 0) => new Date(year, month - 1, date, hour, minute).getTime();
const tree = dir("root", "root", [
  dir("root/A", "A", [
    file("root/A/Angebot.pdf", "Angebot.pdf", { modifiedAtMs: day(2026, 1, 15, 10, 0) }),
    file("root/A/Text.txt", "Text.txt", { modifiedAtMs: day(2026, 2, 1) }),
    file("root/A/README", "README", { modifiedAtMs: day(2026, 1, 20) }),
  ]),
  dir("root/B", "B", [file("root/B/Bild.JPG", "Bild.JPG", { modifiedAtMs: day(2025, 12, 31, 23, 30) })]),
  dir("root/C", "C", [dir("root/C/empty", "empty", [])]),
]);
const originalChildCount = tree.children.length;
const options = collectDisplayExtensionOptions(tree);
assert(options.some((item) => item.key === ".pdf" && item.label === "PDF"), "options: pdf");
assert(options.some((item) => item.key === ".jpg"), "options: jpg folded");
assert(options.some((item) => item.key === NO_EXTENSION_KEY), "options: none");

const unconstrained = buildDisplayFilterView(tree, { extensions: [], modifiedFrom: "", modifiedUntil: "" }, DEFAULT_TREE_SORT);
assert(unconstrained.tree === tree && tree.children.length === originalChildCount, "filter: unconstrained snapshot");

const pdfView = buildDisplayFilterView(tree, { extensions: [".pdf"], modifiedFrom: "", modifiedUntil: "" }, DEFAULT_TREE_SORT);
assert(pdfView.fileMatchCount === 1 && pdfView.tree !== tree, "filter: pdf prune copy");
assert(tree.children.length === originalChildCount, "filter: snapshot intact");
assert(visibleIds(pdfView.tree, ["root", "root/A"]) === "root,root/A,root/A/Angebot.pdf", "filter: variant B");
assert(nodeVisibleInDisplayTree(pdfView.tree, "root/A/Angebot.pdf"), "visible hit");
assert(!nodeVisibleInDisplayTree(pdfView.tree, "root/B/Bild.JPG"), "hidden file");
assert(collectMatchIds(pdfView.tree, "text", DEFAULT_TREE_SORT).length === 0, "search in filtered view");
assert(collectMatchIds(tree, "text", DEFAULT_TREE_SORT).join(",") === "root/A/Text.txt", "search unfiltered");

const multiView = buildDisplayFilterView(tree, { extensions: [".pdf", ".txt"], modifiedFrom: "", modifiedUntil: "" }, DEFAULT_TREE_SORT);
assert(multiView.fileMatchCount === 2, "filter: OR");
assert(buildDisplayFilterView(tree, { extensions: [NO_EXTENSION_KEY], modifiedFrom: "", modifiedUntil: "" }, DEFAULT_TREE_SORT).fileMatchCount === 1, "filter: no ext");
assert(buildDisplayFilterView(tree, { extensions: [], modifiedFrom: "2026-01-01", modifiedUntil: "" }, DEFAULT_TREE_SORT).fileMatchCount === 3, "filter: from");
assert(buildDisplayFilterView(tree, { extensions: [], modifiedFrom: "", modifiedUntil: "2025-12-31" }, DEFAULT_TREE_SORT).fileMatchCount === 1, "filter: until inclusive time");
assert(
  buildDisplayFilterView(tree, { extensions: [".pdf", ".txt"], modifiedFrom: "2026-01-01", modifiedUntil: "2026-01-31" }, DEFAULT_TREE_SORT)
    .fileMatchCount === 1,
  "filter: AND",
);
assert(fileMatchesDisplayFilter(file("r/x.pdf", "x.pdf"), { extensions: [], modifiedFrom: "2026-01-01", modifiedUntil: "" }) === false, "missing date excluded");
assert(snapshotHasModifiedTimestamps(dir("m", "m", [file("m/a.pdf", "a.pdf")])) === false, "no modified metadata");
assert(buildDisplayFilterView(tree, { extensions: [".dwg"], modifiedFrom: "", modifiedUntil: "" }, DEFAULT_TREE_SORT).tree === null, "zero hits hide tree");
assert(isDateRangeInvalid("2026-02-01", "2026-01-01") === true, "von > bis");
assert(displayFilterApplyError({ extensions: [".pdf"], modifiedFrom: "2026-02-01", modifiedUntil: "2026-01-01" }, true) !== null, "apply blocked");
assert(displayFilterApplyError({ extensions: [".pdf"], modifiedFrom: "", modifiedUntil: "" }, false) === null, "ext filter without dates ok");

const sizeSorted = buildDisplayFilterView(
  dir("s", "s", [
    file("s/b.pdf", "b.pdf", { sizeBytes: 10, modifiedAtMs: day(2026, 1, 1) }),
    file("s/a.pdf", "a.pdf", { sizeBytes: 50, modifiedAtMs: day(2026, 1, 1) }),
    file("s/z.txt", "z.txt", { sizeBytes: 99, modifiedAtMs: day(2026, 1, 1) }),
  ]),
  { extensions: [".pdf"], modifiedFrom: "", modifiedUntil: "" },
  { column: "size", direction: "desc" },
);
assert(
  visibleIds(sizeSorted.tree, ["s"], { column: "size", direction: "desc" }) === "s,s/a.pdf,s/b.pdf",
  "filter keeps size sort",
);

console.log("p1-c checks passed");
