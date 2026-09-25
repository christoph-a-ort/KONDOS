import { clampDepth, createDefaultScanConfig, DEFAULT_DEPTH, MAX_DEPTH, MIN_DEPTH, type DirectoryNode, type FileNode, type FsNode } from "../model";
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
import {
  canPersistWorkbenchPrefs,
  defaultWorkbenchPrefs,
  hadStoredWorkbenchPrefs,
  hydrateWorkbenchPrefs,
  loadWorkbenchPrefs,
  persistWorkbenchPrefs,
  prefsToScanConfig,
  sanitizeWorkbenchPrefs,
  saveWorkbenchPrefs,
  workbenchPrefsFromState,
  WORKBENCH_PREFS_KEY,
  LEGACY_WORKBENCH_PREFS_KEY,
  type WorkbenchPrefsJsonStore,
  type WorkbenchStorage,
} from "./workbenchPrefs";
import { DEFAULT_TREE_SORT } from "./treeSort";

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

export async function runP1cCheck(): Promise<void> {
  runPrefsCheck();
  await runPrefsHydrationCheck();
  runScanFromHereCheck();
  runDisplayFilterCheck();
}

class MemoryJsonStore implements WorkbenchPrefsJsonStore {
  file: string | null = null;
  failLoad: Error | null = null;
  failSave: Error | null = null;
  saveCount = 0;

  async load(): Promise<string | null> {
    if (this.failLoad) {
      throw this.failLoad;
    }
    return this.file;
  }

  async save(json: string): Promise<void> {
    if (this.failSave) {
      throw this.failSave;
    }
    this.saveCount += 1;
    this.file = json;
  }
}

async function runPrefsHydrationCheck(): Promise<void> {
  assert(DEFAULT_DEPTH === 10, "hydrate: program default depth is 10");
  assert(!canPersistWorkbenchPrefs(false), "hydrate: persist blocked before ready");
  assert(canPersistWorkbenchPrefs(true), "hydrate: persist allowed after ready");

  const noJson = new MemoryJsonStore();
  const emptyStorage = new MemoryStorage();
  const missing = await hydrateWorkbenchPrefs(noJson, emptyStorage);
  assert(missing.source === "default", "hydrate: no file no LS → default");
  assert(missing.prefs.maxDepth === DEFAULT_DEPTH, "hydrate: default maxDepth 10");
  assert(missing.corruptedJson === false, "hydrate: missing is not corrupt");
  assert(noJson.saveCount === 0, "hydrate: missing does not write");

  const jsonTwo = new MemoryJsonStore();
  jsonTwo.file = JSON.stringify(sanitizeWorkbenchPrefs({ maxDepth: 2, rootPath: "X:/Fixture" }));
  const loadedTwo = await hydrateWorkbenchPrefs(jsonTwo, emptyStorage);
  assert(loadedTwo.source === "json", "hydrate: json source");
  assert(loadedTwo.prefs.maxDepth === 2, "hydrate: stored 2 remains 2");
  assert(loadedTwo.prefs.rootPath === "X:/Fixture", "hydrate: other fields kept");

  const jsonTen = new MemoryJsonStore();
  jsonTen.file = JSON.stringify(sanitizeWorkbenchPrefs({ maxDepth: 10 }));
  const loadedTen = await hydrateWorkbenchPrefs(jsonTen, emptyStorage);
  assert(loadedTen.prefs.maxDepth === 10, "hydrate: stored 10 remains 10");

  assert(sanitizeWorkbenchPrefs({ maxDepth: 0 }).maxDepth === MIN_DEPTH, "hydrate: invalid low clamps");
  assert(sanitizeWorkbenchPrefs({ maxDepth: 99 }).maxDepth === MAX_DEPTH, "hydrate: invalid high clamps");

  const migrateCurrent = new MemoryJsonStore();
  const currentLs = new MemoryStorage();
  currentLs.setItem(
    WORKBENCH_PREFS_KEY,
    JSON.stringify(sanitizeWorkbenchPrefs({ maxDepth: 7, rootPath: "X:/Current" })),
  );
  const fromCurrent = await hydrateWorkbenchPrefs(migrateCurrent, currentLs);
  assert(fromCurrent.source === "localStorage", "hydrate: current LS migration");
  assert(fromCurrent.prefs.maxDepth === 7, "hydrate: migrated depth 7");
  assert(migrateCurrent.file !== null && migrateCurrent.file.includes('"maxDepth":7'), "hydrate: wrote JSON from current");
  assert(currentLs.getItem(WORKBENCH_PREFS_KEY) !== null, "hydrate: LS not deleted after migration");

  const migrateLegacy = new MemoryJsonStore();
  const legacyLs = new MemoryStorage();
  legacyLs.setItem(
    LEGACY_WORKBENCH_PREFS_KEY,
    JSON.stringify(sanitizeWorkbenchPrefs({ maxDepth: 8, rootPath: "X:/Legacy" })),
  );
  const fromLegacy = await hydrateWorkbenchPrefs(migrateLegacy, legacyLs);
  assert(fromLegacy.source === "legacy", "hydrate: legacy migration");
  assert(fromLegacy.prefs.maxDepth === 8, "hydrate: legacy depth");
  assert(migrateLegacy.file !== null, "hydrate: wrote JSON from legacy");
  assert(legacyLs.getItem(LEGACY_WORKBENCH_PREFS_KEY) !== null, "hydrate: legacy key kept");

  const preferJson = new MemoryJsonStore();
  preferJson.file = JSON.stringify(sanitizeWorkbenchPrefs({ maxDepth: 10, rootPath: "X:/Json" }));
  const conflictingLs = new MemoryStorage();
  conflictingLs.setItem(
    WORKBENCH_PREFS_KEY,
    JSON.stringify(sanitizeWorkbenchPrefs({ maxDepth: 2, rootPath: "X:/LS" })),
  );
  const winner = await hydrateWorkbenchPrefs(preferJson, conflictingLs);
  assert(winner.source === "json", "hydrate: JSON wins over LS");
  assert(winner.prefs.maxDepth === 10, "hydrate: JSON 10 not overwritten by LS 2");
  assert(winner.prefs.rootPath === "X:/Json", "hydrate: JSON root wins");
  assert(preferJson.saveCount === 0, "hydrate: JSON authority does not rewrite on load");

  const full = sanitizeWorkbenchPrefs({
    rootPath: "X:/Full",
    maxDepth: 10,
    excludeHidden: false,
    extensionInput: ".pdf",
    includeSize: false,
    includeCreatedAt: true,
    includeModifiedAt: false,
    columnVisibility: { size: false, modified: true, created: true },
    columnWidths: { name: 300, size: 120, modified: 150, created: 150 },
    sort: { column: "size", direction: "desc" },
  });
  const fullStore = new MemoryJsonStore();
  fullStore.file = JSON.stringify(full);
  const fullHydrated = await hydrateWorkbenchPrefs(fullStore, emptyStorage);
  assert(fullHydrated.prefs.excludeHidden === false, "hydrate: excludeHidden kept");
  assert(fullHydrated.prefs.extensionInput.includes(".pdf"), "hydrate: extensionInput kept");
  assert(fullHydrated.prefs.includeCreatedAt === true, "hydrate: includeCreatedAt kept");
  assert(fullHydrated.prefs.columnVisibility.size === false, "hydrate: columnVisibility kept");
  assert(fullHydrated.prefs.columnWidths.name === 300, "hydrate: columnWidths kept");
  assert(fullHydrated.prefs.sort.column === "size", "hydrate: sort kept");

  const corrupt = new MemoryJsonStore();
  corrupt.failLoad = new Error("Die Workbench-Einstellungen sind kein gültiges JSON.");
  const broken = await hydrateWorkbenchPrefs(corrupt, currentLs);
  assert(broken.corruptedJson === true, "hydrate: corrupt flagged");
  assert(broken.prefs.maxDepth === DEFAULT_DEPTH, "hydrate: corrupt uses defaults");
  assert(broken.notice !== null, "hydrate: corrupt notice");
  assert(corrupt.saveCount === 0, "hydrate: corrupt does not overwrite");

  const change = workbenchPrefsFromState({
    config: { ...prefsToScanConfig(sanitizeWorkbenchPrefs({ maxDepth: 2 })), maxDepth: 10 },
    extensionInput: "",
    columnVisibility: defaultWorkbenchPrefs().columnVisibility,
    columnWidths: defaultWorkbenchPrefs().columnWidths,
    sort: DEFAULT_TREE_SORT,
  });
  assert(change.maxDepth === 10, "hydrate: 2→10 state yields 10");
  const persistStore = new MemoryJsonStore();
  await persistWorkbenchPrefs(change, persistStore, emptyStorage);
  assert(persistStore.file !== null && persistStore.file.includes('"maxDepth":10'), "hydrate: persist writes 10");
  assert(emptyStorage.getItem(WORKBENCH_PREFS_KEY) === null, "hydrate: tauri persist does not write LS");

  const browserOnly = await hydrateWorkbenchPrefs(null, currentLs);
  assert(browserOnly.prefs.maxDepth === 7, "hydrate: browser-only uses LS");
  await persistWorkbenchPrefs(sanitizeWorkbenchPrefs({ maxDepth: 10 }), null, currentLs);
  assert(
    JSON.parse(currentLs.getItem(WORKBENCH_PREFS_KEY) ?? "{}").maxDepth === 10,
    "hydrate: browser-only persist writes LS",
  );
}

function runPrefsCheck(): void {
  const defaults = defaultWorkbenchPrefs();
  const empty = loadWorkbenchPrefs({
    getItem: () => null,
    setItem: () => {},
  });
  assert(empty.rootPath === defaults.rootPath, "prefs: empty storage uses defaults");
  assert(empty.maxDepth === createDefaultScanConfig().maxDepth, "prefs: default depth");
  assert(createDefaultScanConfig().maxDepth === DEFAULT_DEPTH, "prefs: default depth constant");
  assert(DEFAULT_DEPTH === 10 && MAX_DEPTH === 32 && MIN_DEPTH === 1, "prefs: depth bounds");
  assert(clampDepth(0) === MIN_DEPTH, "prefs: clamp 0 to min");
  assert(clampDepth(10) === 10, "prefs: clamp 10");
  assert(clampDepth(16) === 16, "prefs: clamp 16");
  assert(clampDepth(32) === 32, "prefs: clamp 32");
  assert(clampDepth(33) === MAX_DEPTH, "prefs: clamp 33 to max");
  assert(clampDepth(99) === MAX_DEPTH, "prefs: clamp 99 to max");
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
  assert(fallback.maxDepth === MAX_DEPTH, "prefs: invalid depth falls back");
  assert(fallback.includeSize === true, "prefs: invalid boolean falls back");
  assert(fallback.columnVisibility.size === true, "prefs: invalid column falls back");
  assert(fallback.columnWidths.name >= 180, "prefs: width clamped");
  assert(fallback.sort.column === "name", "prefs: invalid sort falls back");
  assert(!("searchQuery" in fallback), "prefs: session-only search not stored");
  assert(loadWorkbenchPrefs({ getItem: () => "{not json", setItem: () => {} }).maxDepth === defaults.maxDepth, "prefs: broken json");
  assert(WORKBENCH_PREFS_KEY === "dottyfm.workbench-prefs.v1", "prefs: current namespaced key");
  assert(LEGACY_WORKBENCH_PREFS_KEY === "kondos.workbench-prefs.v1", "prefs: legacy key kept for migration");

  const keepEight = sanitizeWorkbenchPrefs({ maxDepth: 8 });
  assert(keepEight.maxDepth === 8, "prefs: stored 8 remains 8");
  for (const depth of [2, 8, 10, 16, 32] as const) {
    assert(sanitizeWorkbenchPrefs({ maxDepth: depth }).maxDepth === depth, `prefs: stored ${depth} remains ${depth}`);
    const stored = new MemoryStorage();
    stored.setItem(WORKBENCH_PREFS_KEY, JSON.stringify(sanitizeWorkbenchPrefs({ maxDepth: depth })));
    assert(loadWorkbenchPrefs(stored).maxDepth === depth, `prefs: load ${depth} remains ${depth}`);
  }
  assert(sanitizeWorkbenchPrefs({ maxDepth: 0 }).maxDepth === MIN_DEPTH, "prefs: stored 0 clamps to min");
  assert(sanitizeWorkbenchPrefs({ maxDepth: 33 }).maxDepth === MAX_DEPTH, "prefs: stored 33 clamps to max");
  assert(loadWorkbenchPrefs({ getItem: () => null, setItem: () => {} }).maxDepth === DEFAULT_DEPTH, "prefs: missing uses default 10");

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
