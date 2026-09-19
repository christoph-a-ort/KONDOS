import { createDefaultScanConfig, type DirectoryNode, type FileNode, type FsNode } from "../model";
import {
  buildDisplayFilterView,
  canScanFromHere,
  collectDisplayExtensionOptions,
  displayFilterApplyError,
  displayFilterHasConstraint,
  emptyDisplayFilterDraft,
  fileExtensionKey,
  fileMatchesDisplayFilter,
  formatActiveFilterSummary,
  isDateRangeInvalid,
  nodeVisibleInDisplayTree,
  NO_EXTENSION_KEY,
  snapshotHasModifiedTimestamps,
  withScanRootPath,
  type AppliedDisplayFilter,
} from "./displayFilter";
import { collectExpandableDirectoryIds, defaultExpandedIds, deriveVisibleRows, findNodeById, selectedIdAfterPointer } from "./treeRows";
import { collectMatchIds } from "./treeSearch";
import { DEFAULT_TREE_SORT } from "./treeSort";
import {
  defaultWorkbenchPrefs,
  hadStoredWorkbenchPrefs,
  loadWorkbenchPrefs,
  sanitizeWorkbenchPrefs,
  saveWorkbenchPrefs,
  WORKBENCH_PREFS_KEY,
  LEGACY_WORKBENCH_PREFS_KEY,
  type WorkbenchStorage,
} from "./workbenchPrefs";

function file(id: string, name: string, extras: Partial<FileNode> = {}): FileNode {
  return { id, name, path: id, depth: 1, kind: "file", ...extras };
}

function dir(id: string, name: string, children: FsNode[]): DirectoryNode {
  return { id, name, path: id, depth: 0, kind: "directory", listing: "read", children };
}

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(label);
  }
}

function visibleIds(root: FsNode, expanded: string[]): string {
  return deriveVisibleRows(root, new Set(expanded), DEFAULT_TREE_SORT)
    .map((row) => row.id)
    .join(",");
}

class MemoryStorage implements WorkbenchStorage {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

export function runP1cCheck(): void {
  runPrefsCheck();
  runScanFromHereCheck();
  runDisplayFilterCheck();
}

function runPrefsCheck(): void {
  const defaults = defaultWorkbenchPrefs();
  const empty = loadWorkbenchPrefs({
    getItem: () => null,
    setItem: () => {},
  });
  assert(empty.rootPath === defaults.rootPath, "prefs: empty storage uses defaults");
  assert(empty.maxDepth === createDefaultScanConfig().maxDepth, "prefs: default depth");
  assert(empty.includeSize === true && empty.includeModifiedAt === true, "prefs: default metadata");
  assert(empty.includeCreatedAt === false, "prefs: created off by default");
  assert(empty.columnVisibility.created === false, "prefs: created column off");
  assert(empty.sort.column === "name", "prefs: default sort");

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
  assert(hadStoredWorkbenchPrefs(storage), "prefs: storage considered present");
  const loaded = loadWorkbenchPrefs(storage);
  assert(loaded.rootPath === "C:/Hausverwaltung", "prefs: root path");
  assert(loaded.maxDepth === 4, "prefs: depth");
  assert(loaded.excludeHidden === false, "prefs: hidden");
  assert(loaded.extensionInput.includes(".pdf"), "prefs: scan extensions normalized");
  assert(loaded.includeSize === false && loaded.includeCreatedAt === true, "prefs: metadata");
  assert(loaded.columnVisibility.size === false && loaded.columnVisibility.created === true, "prefs: columns");
  assert(loaded.columnWidths.name === 320, "prefs: widths");
  assert(loaded.sort.column === "modified" && loaded.sort.direction === "desc", "prefs: sort");
  const persisted = JSON.parse(storage.getItem(WORKBENCH_PREFS_KEY) ?? "{}") as Record<string, unknown>;
  assert(!("searchQuery" in persisted) && !("selectedId" in persisted), "prefs: search/selection not written");
  assert(!("appliedFilter" in persisted) && !("expandedIds" in persisted), "prefs: filter/expand not written");

  const fallback = sanitizeWorkbenchPrefs({
    maxDepth: 99,
    includeSize: "yes",
    columnVisibility: { size: "no" },
    columnWidths: { name: 12 },
    sort: { column: "owner", direction: "sideways" },
    searchQuery: "secret",
    selectedId: "keep-me",
  });
  assert(fallback.maxDepth === 8, "prefs: invalid depth falls back");
  assert(fallback.includeSize === true, "prefs: invalid boolean falls back");
  assert(fallback.columnVisibility.size === true, "prefs: invalid column falls back");
  assert(fallback.columnWidths.name >= 180, "prefs: width clamped");
  assert(fallback.sort.column === "name", "prefs: invalid sort falls back");
  assert(!("searchQuery" in fallback), "prefs: session-only search not stored");
  assert(loadWorkbenchPrefs({ getItem: () => "{not json", setItem: () => {} }).maxDepth === defaults.maxDepth, "prefs: broken json");
  assert(WORKBENCH_PREFS_KEY === "dottyfm.workbench-prefs.v1", "prefs: current namespaced key");
  assert(LEGACY_WORKBENCH_PREFS_KEY === "kondos.workbench-prefs.v1", "prefs: legacy key kept for migration");

  const legacyOnly = new MemoryStorage();
  legacyOnly.setItem(LEGACY_WORKBENCH_PREFS_KEY, JSON.stringify(saved));
  assert(hadStoredWorkbenchPrefs(legacyOnly), "prefs: legacy storage counts as present");
  const migrated = loadWorkbenchPrefs(legacyOnly);
  assert(migrated.rootPath === "C:/Hausverwaltung", "prefs: legacy root migrated");
  assert(migrated.columnWidths.name === 320, "prefs: legacy widths migrated");
  const afterMigrate = JSON.parse(legacyOnly.getItem(WORKBENCH_PREFS_KEY) ?? "{}") as Record<string, unknown>;
  assert(afterMigrate.rootPath === "C:/Hausverwaltung", "prefs: legacy copied to new key");
  assert(legacyOnly.getItem(LEGACY_WORKBENCH_PREFS_KEY) !== null, "prefs: legacy key is not deleted");

  const both = new MemoryStorage();
  both.setItem(LEGACY_WORKBENCH_PREFS_KEY, JSON.stringify(saved));
  const newer = sanitizeWorkbenchPrefs({ ...saved, rootPath: "C:/DottyFM" });
  both.setItem(WORKBENCH_PREFS_KEY, JSON.stringify(newer));
  const winner = loadWorkbenchPrefs(both);
  assert(winner.rootPath === "C:/DottyFM", "prefs: current key wins over legacy");
  assert(JSON.parse(both.getItem(LEGACY_WORKBENCH_PREFS_KEY) ?? "{}").rootPath === "C:/Hausverwaltung", "prefs: legacy left unchanged when current exists");

  const brokenLegacy = new MemoryStorage();
  brokenLegacy.setItem(LEGACY_WORKBENCH_PREFS_KEY, "{not json");
  assert(loadWorkbenchPrefs(brokenLegacy).rootPath === defaults.rootPath, "prefs: invalid legacy does not break start");
  assert(brokenLegacy.getItem(WORKBENCH_PREFS_KEY) === null, "prefs: invalid legacy is not copied");
}

function runScanFromHereCheck(): void {
  const folder = dir("C:/A", "A", [file("C:/A/x.pdf", "x.pdf")]);
  const pdf = file("C:/A/x.pdf", "x.pdf");
  assert(!canScanFromHere(undefined), "scan-from: none disabled");
  assert(!canScanFromHere(pdf), "scan-from: file disabled");
  assert(canScanFromHere(folder), "scan-from: folder enabled");
  assert(folder.path === "C:/A", "scan-from: uses node.path");
  const config = {
    rootPath: "C:/old",
    maxDepth: 3,
    excludeHidden: true,
    extensions: [".pdf"],
    includeSize: true,
    includeCreatedAt: false,
    includeModifiedAt: true,
  };
  const next = withScanRootPath(config, folder.path);
  assert(next.rootPath === "C:/A", "scan-from: adopts exact folder path");
  assert(next.maxDepth === 3 && next.extensions[0] === ".pdf" && next.excludeHidden === true, "scan-from: scan settings kept");
  assert(config.rootPath === "C:/old", "scan-from: does not mutate previous config");
  assert(withScanRootPath(next, folder.path) === next, "scan-from: same path is identity");

  let selectedId: string | null = null;
  selectedId = selectedIdAfterPointer(selectedId, folder.id, "twist");
  assert(selectedId === null, "twist does not select folder");
  assert(!canScanFromHere(undefined), "scan-from stays off after twist");
  selectedId = selectedIdAfterPointer(selectedId, folder.id, "row");
  assert(selectedId === folder.id, "first row click after twist selects folder");
  const selected = findNodeById(folder, folder.id);
  assert(selected !== undefined && selected.path === folder.path, "path follows selected folder");
  assert(canScanFromHere(selected), "scan-from enabled after first row click");
  assert(!canScanFromHere(pdf), "scan-from stays off for a file");
}

function runDisplayFilterCheck(): void {
  const day = (year: number, month: number, date: number, hour = 0, minute = 0): number =>
    new Date(year, month - 1, date, hour, minute).getTime();

  const tree = dir("root", "root", [
    dir("root/A", "A", [
      file("root/A/Angebot.pdf", "Angebot.pdf", { modifiedAtMs: day(2026, 1, 15, 10, 0) }),
      file("root/A/Text.txt", "Text.txt", { modifiedAtMs: day(2026, 2, 1) }),
      file("root/A/README", "README", { modifiedAtMs: day(2026, 1, 20) }),
    ]),
    dir("root/B", "B", [
      file("root/B/Bild.JPG", "Bild.JPG", { modifiedAtMs: day(2025, 12, 31, 23, 30) }),
    ]),
    dir("root/C", "C", [dir("root/C/empty", "empty", [])]),
  ]);
  const originalChildCount = tree.children.length;

  assert(fileExtensionKey("Angebot.pdf") === ".pdf", "ext: pdf");
  assert(fileExtensionKey("Bild.JPG") === ".jpg", "ext: case fold");
  assert(fileExtensionKey("README") === null, "ext: none");
  assert(fileExtensionKey(".gitignore") === null, "ext: dotfile");

  const options = collectDisplayExtensionOptions(tree);
  assert(options.some((item) => item.key === ".pdf" && item.label === "PDF"), "options: pdf");
  assert(options.some((item) => item.key === ".jpg" && item.label === "JPG"), "options: jpg folded");
  assert(options.some((item) => item.key === NO_EXTENSION_KEY && item.label === "Ohne Dateiendung"), "options: none");
  assert(!options.some((item) => item.key === ".PDF"), "options: no duplicate case");

  const none = emptyDisplayFilterDraft();
  assert(!displayFilterHasConstraint(none), "filter: empty has no constraint");
  const unconstrained = buildDisplayFilterView(tree, none, DEFAULT_TREE_SORT);
  assert(unconstrained.tree === tree, "filter: unconstrained reuses snapshot");
  assert(tree.children.length === originalChildCount, "filter: snapshot children unchanged");
  const draftPdfTxt: AppliedDisplayFilter = { extensions: [".pdf", ".txt"], modifiedFrom: "", modifiedUntil: "" };
  const appliedPdf: AppliedDisplayFilter = { extensions: [".pdf"], modifiedFrom: "", modifiedUntil: "" };
  assert(buildDisplayFilterView(tree, appliedPdf, DEFAULT_TREE_SORT).fileMatchCount === 1, "filter: applied pdf only");
  assert(buildDisplayFilterView(tree, draftPdfTxt, DEFAULT_TREE_SORT).fileMatchCount === 2, "filter: unapplied draft would be wider");

  const pdfOnly: AppliedDisplayFilter = { extensions: [".pdf"], modifiedFrom: "", modifiedUntil: "" };
  const pdfView = buildDisplayFilterView(tree, pdfOnly, DEFAULT_TREE_SORT);
  assert(pdfView.fileMatchCount === 1, "filter: one pdf");
  assert(pdfView.tree !== null && pdfView.tree !== tree, "filter: pruned copy");
  const pdfTree = pdfView.tree as FsNode;
  assert(tree.children.length === originalChildCount, "filter: snapshot still intact");
  assert(visibleIds(pdfTree, ["root", "root/A"]) === "root,root/A,root/A/Angebot.pdf", "filter: variant B pdf");

  const pdfExpanded = deriveVisibleRows(pdfTree, collectExpandableDirectoryIds(pdfTree), DEFAULT_TREE_SORT)
    .map((row) => row.id)
    .join(",");
  assert(pdfExpanded === "root,root/A,root/A/Angebot.pdf", "filter: empty branches gone");
  assert(findNodeById(tree, "root/B/Bild.JPG") !== undefined, "filter: hidden file still in snapshot");

  const multi: AppliedDisplayFilter = { extensions: [".pdf", ".txt"], modifiedFrom: "", modifiedUntil: "" };
  const multiView = buildDisplayFilterView(tree, multi, DEFAULT_TREE_SORT);
  assert(multiView.fileMatchCount === 2, "filter: OR extensions");

  const noneExt: AppliedDisplayFilter = { extensions: [NO_EXTENSION_KEY], modifiedFrom: "", modifiedUntil: "" };
  const noneView = buildDisplayFilterView(tree, noneExt, DEFAULT_TREE_SORT);
  assert(noneView.fileMatchCount === 1, "filter: files without extension");
  assert(deriveVisibleRows(noneView.tree as FsNode, collectExpandableDirectoryIds(noneView.tree as FsNode), DEFAULT_TREE_SORT).some((row) => row.id === "root/A/README"), "filter: README visible");

  const fromOnly: AppliedDisplayFilter = { extensions: [], modifiedFrom: "2026-01-01", modifiedUntil: "" };
  const fromView = buildDisplayFilterView(tree, fromOnly, DEFAULT_TREE_SORT);
  assert(fromView.fileMatchCount === 3, "filter: from date excludes 2025 jpg");

  const untilOnly: AppliedDisplayFilter = { extensions: [], modifiedFrom: "", modifiedUntil: "2025-12-31" };
  const untilView = buildDisplayFilterView(tree, untilOnly, DEFAULT_TREE_SORT);
  assert(untilView.fileMatchCount === 1, "filter: until includes 23:30 same day");
  assert(
    deriveVisibleRows(untilView.tree as FsNode, collectExpandableDirectoryIds(untilView.tree as FsNode), DEFAULT_TREE_SORT).some(
      (row) => row.id === "root/B/Bild.JPG",
    ),
    "filter: jpg on until day",
  );

  const range: AppliedDisplayFilter = { extensions: [".pdf", ".txt"], modifiedFrom: "2026-01-01", modifiedUntil: "2026-01-31" };
  const rangeView = buildDisplayFilterView(tree, range, DEFAULT_TREE_SORT);
  assert(rangeView.fileMatchCount === 1, "filter: AND date with OR extensions");
  assert(
    deriveVisibleRows(rangeView.tree as FsNode, collectExpandableDirectoryIds(rangeView.tree as FsNode), DEFAULT_TREE_SORT)
      .map((row) => row.id)
      .includes("root/A/Angebot.pdf"),
    "filter: pdf in January",
  );

  const noDateFile = dir("r", "r", [file("r/x.pdf", "x.pdf"), file("r/y.pdf", "y.pdf", { modifiedAtMs: day(2026, 3, 1) })]);
  const dated: AppliedDisplayFilter = { extensions: [], modifiedFrom: "2026-01-01", modifiedUntil: "" };
  assert(fileMatchesDisplayFilter(file("r/x.pdf", "x.pdf"), dated) === false, "filter: missing modified excluded when dated");
  assert(buildDisplayFilterView(noDateFile, emptyDisplayFilterDraft(), DEFAULT_TREE_SORT).fileMatchCount === 2, "filter: missing modified visible without date filter");

  const noMeta = dir("m", "m", [file("m/a.pdf", "a.pdf"), file("m/b.txt", "b.txt")]);
  assert(snapshotHasModifiedTimestamps(noMeta) === false, "filter: no modified in snapshot");
  assert(snapshotHasModifiedTimestamps(tree) === true, "filter: snapshot has modified");

  const emptyView = buildDisplayFilterView(tree, { extensions: [".dwg"], modifiedFrom: "", modifiedUntil: "" }, DEFAULT_TREE_SORT);
  assert(emptyView.tree === null && emptyView.fileMatchCount === 0, "filter: zero matches hide tree");
  assert(formatActiveFilterSummary({ extensions: [".pdf", ".docx"], modifiedFrom: "2026-01-01", modifiedUntil: "2026-03-31" }, collectDisplayExtensionOptions(tree)) === "Filter aktiv · PDF, DOCX · 01.01.2026–31.03.2026", "filter: summary range");
  assert(formatActiveFilterSummary({ extensions: [".pdf"], modifiedFrom: "2026-01-01", modifiedUntil: "" }, options)?.includes("ab 01.01.2026") === true, "filter: summary from");

  assert(isDateRangeInvalid("2026-02-01", "2026-01-01") === true, "filter: from > until invalid");
  assert(isDateRangeInvalid("2026-01-01", "2026-02-01") === false, "filter: valid range");
  assert(isDateRangeInvalid("", "2026-02-01") === false, "filter: open start ok");

  const searchTree = pdfTree;
  const hits = collectMatchIds(searchTree, "text", DEFAULT_TREE_SORT);
  assert(hits.length === 0, "search: filtered-out txt is not a hit");
  const pdfHits = collectMatchIds(searchTree, "angebot", DEFAULT_TREE_SORT);
  assert(pdfHits.join(",") === "root/A/Angebot.pdf", "search: hit inside filtered view");
  const allHits = collectMatchIds(tree, "text", DEFAULT_TREE_SORT);
  assert(allHits.join(",") === "root/A/Text.txt", "search: unfiltered still finds txt");

  assert(defaultExpandedIds("root").has("root"), "reset expand: root open only");
  assert(!canScanFromHere(findNodeById(pdfTree, "root/A/Angebot.pdf")), "selection: file still not scan-from");
  assert(canScanFromHere(findNodeById(pdfTree, "root/A")), "selection: visible folder scan-from");
  assert(nodeVisibleInDisplayTree(pdfTree, "root/A/Angebot.pdf"), "selection: visible hit remains");
  assert(!nodeVisibleInDisplayTree(pdfTree, "root/B/Bild.JPG"), "selection: hidden file is not visible");
  assert(!nodeVisibleInDisplayTree(null, "root"), "selection: empty filter has no selection");
  const remaining = collectExpandableDirectoryIds(pdfTree);
  assert(remaining.has("root") && remaining.has("root/A") && !remaining.has("root/B"), "filter: expand remaining match paths");
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
    deriveVisibleRows(sizeSorted.tree as FsNode, new Set(["s"]), { column: "size", direction: "desc" })
      .map((row) => row.id)
      .join(",") === "s,s/a.pdf,s/b.pdf",
    "filter: tree sort remains folders-first size desc",
  );
  assert(displayFilterApplyError({ extensions: [".pdf"], modifiedFrom: "2026-02-01", modifiedUntil: "2026-01-01" }, true) !== null, "filter: von>bis blocks apply");
  assert(displayFilterApplyError({ extensions: [], modifiedFrom: "2026-01-01", modifiedUntil: "" }, false) !== null, "filter: date without metadata blocks apply");
  assert(displayFilterApplyError({ extensions: [".pdf"], modifiedFrom: "", modifiedUntil: "" }, false) === null, "filter: extension-only apply without metadata ok");
}
