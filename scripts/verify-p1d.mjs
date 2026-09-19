// Dev-side P1-D check. Mirrors warning navigation, details, and view stats. Not imported by the app.

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

function dir(id, name, children, extras = {}) {
  return { id, name, path: id, depth: 0, kind: "directory", listing: "read", children, ...extras };
}

function warning(path, message = "warn") {
  return { path, code: "ioError", message };
}

const DEFAULT_TREE_SORT = { column: "name", direction: "asc" };
const WARNING_ANCESTOR_NOTICE =
  "Das betroffene Element ist nicht im eingelesenen Ergebnis enthalten. Der zugehörige Ordner wurde ausgewählt.";
const WARNING_HIDDEN_BY_FILTER_NOTICE =
  "Das betroffene Element ist durch den aktuellen Anzeigefilter ausgeblendet.";
const WARNING_NO_TARGET_NOTICE =
  "Zum betroffenen Pfad ist im eingelesenen Ergebnis kein Element auffindbar.";
const META_NOT_CAPTURED = "nicht beim Einlesen erfasst";
const META_UNAVAILABLE = "nicht verfügbar";

function normalizeFsPath(path) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isStrictPathAncestor(ancestorPath, descendantPath) {
  const ancestor = normalizeFsPath(ancestorPath);
  const descendant = normalizeFsPath(descendantPath);
  if (ancestor.length === 0 || descendant.length === 0 || ancestor === descendant) return false;
  return descendant.startsWith(`${ancestor}/`);
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

function findByNormalizedPath(node, needle) {
  if (normalizeFsPath(node.path) === needle || normalizeFsPath(node.id) === needle) return node;
  if (isDirectory(node)) {
    for (const child of node.children) {
      const found = findByNormalizedPath(child, needle);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function findNodeByStoredOrNormalizedPath(root, path) {
  const exact = findNodeById(root, path);
  if (exact !== undefined) return exact;
  const needle = normalizeFsPath(path);
  return needle.length === 0 ? undefined : findByNormalizedPath(root, needle);
}

function nearestExistingAncestorDirectory(root, path) {
  let best;
  let bestLength = -1;
  function walk(node) {
    if (isDirectory(node) && isStrictPathAncestor(node.path, path)) {
      const length = normalizeFsPath(node.path).length;
      if (length > bestLength) {
        best = node;
        bestLength = length;
      }
    }
    if (isDirectory(node)) for (const child of node.children) walk(child);
  }
  walk(root);
  return best;
}

function ancestorDirectoryIds(root, targetId) {
  const chain = [];
  function walk(node, ancestors) {
    if (node.id === targetId) {
      chain.push(...ancestors);
      return true;
    }
    if (!isDirectory(node)) return false;
    const next = [...ancestors, node.id];
    return node.children.some((child) => walk(child, next));
  }
  walk(root, []);
  return chain;
}

function withAncestorsExpanded(expandedIds, ancestorIds) {
  const next = new Set(expandedIds);
  for (const id of ancestorIds) next.add(id);
  return next;
}

function compareName(left, right) {
  if (left.name !== right.name) return left.name < right.name ? -1 : 1;
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function sortedChildren(children) {
  return children.slice().sort((left, right) => {
    const leftDir = isDirectory(left);
    const rightDir = isDirectory(right);
    if (leftDir !== rightDir) return leftDir ? -1 : 1;
    return compareName(left, right);
  });
}

function deriveVisibleRows(root, expandedIds) {
  const rows = [];
  function walk(node, depth) {
    const directory = isDirectory(node);
    rows.push({ id: node.id, node, depth, directory });
    if (directory && expandedIds.has(node.id) && node.children.length > 0) {
      for (const child of sortedChildren(node.children)) walk(child, depth + 1);
    }
  }
  walk(root, 0);
  return rows;
}

function resolveWarningJump(snapshotRoot, viewRoot, warningPath) {
  const exact = findNodeByStoredOrNormalizedPath(snapshotRoot, warningPath);
  if (exact !== undefined) {
    if (viewRoot === null || findNodeByStoredOrNormalizedPath(viewRoot, exact.id) === undefined) {
      return {
        kind: "hidden-by-filter",
        targetId: exact.id,
        applySelection: false,
        offerFilterReset: true,
        notice: WARNING_HIDDEN_BY_FILTER_NOTICE,
        ancestorIds: [],
      };
    }
    return {
      kind: "exact",
      targetId: exact.id,
      applySelection: true,
      offerFilterReset: false,
      notice: null,
      ancestorIds: ancestorDirectoryIds(viewRoot, exact.id),
    };
  }
  const ancestor = nearestExistingAncestorDirectory(snapshotRoot, warningPath);
  if (ancestor === undefined) {
    return {
      kind: "none",
      targetId: null,
      applySelection: false,
      offerFilterReset: false,
      notice: WARNING_NO_TARGET_NOTICE,
      ancestorIds: [],
    };
  }
  if (viewRoot === null || findNodeByStoredOrNormalizedPath(viewRoot, ancestor.id) === undefined) {
    return {
      kind: "hidden-by-filter",
      targetId: ancestor.id,
      applySelection: false,
      offerFilterReset: true,
      notice: WARNING_HIDDEN_BY_FILTER_NOTICE,
      ancestorIds: [],
    };
  }
  return {
    kind: "ancestor",
    targetId: ancestor.id,
    applySelection: true,
    offerFilterReset: false,
    notice: WARNING_ANCESTOR_NOTICE,
    ancestorIds: ancestorDirectoryIds(viewRoot, ancestor.id),
  };
}

function warningRevealPlan(viewRoot, expandedIds, targetId) {
  const ancestorIds = ancestorDirectoryIds(viewRoot, targetId);
  const rows = deriveVisibleRows(viewRoot, withAncestorsExpanded(expandedIds, ancestorIds));
  return { ancestorIds, rowIndex: rows.findIndex((row) => row.id === targetId) };
}

function fileExtensionKey(name) {
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === name.length - 1) return null;
  return name.slice(lastDot).toLocaleLowerCase();
}

function fileMatchesDisplayFilter(node, filter) {
  if (filter.extensions.length > 0 && !filter.extensions.includes(fileExtensionKey(node.name) ?? "")) {
    return false;
  }
  return true;
}

function pruneNode(node, filter) {
  if (isFile(node)) {
    return fileMatchesDisplayFilter(node, filter) ? { node, fileMatchCount: 1 } : { node: null, fileMatchCount: 0 };
  }
  let fileMatchCount = 0;
  const kept = [];
  for (const child of sortedChildren(node.children)) {
    const pruned = pruneNode(child, filter);
    fileMatchCount += pruned.fileMatchCount;
    if (pruned.node !== null) kept.push(pruned.node);
  }
  return fileMatchCount === 0 ? { node: null, fileMatchCount: 0 } : { node: { ...node, children: kept }, fileMatchCount };
}

function buildDisplayFilterView(root, filter) {
  if (filter === null || filter.extensions.length === 0) return { tree: root, fileMatchCount: 0, constrained: false };
  const pruned = pruneNode(root, filter);
  return { tree: pruned.node, fileMatchCount: pruned.fileMatchCount, constrained: true };
}

function collectViewWorkStats(root) {
  const stats = { directoryCount: 0, fileCount: 0, filesWithSize: 0, sizeBytes: 0 };
  if (root === null) return stats;
  function walk(node) {
    if (isFile(node)) {
      stats.fileCount += 1;
      if (node.sizeBytes !== undefined) {
        stats.filesWithSize += 1;
        stats.sizeBytes += node.sizeBytes;
      }
      return;
    }
    if (isDirectory(node)) {
      stats.directoryCount += 1;
      for (const child of node.children) walk(child);
    }
  }
  walk(root);
  return stats;
}

function formatViewWorkStats(stats) {
  const parts = [`${stats.directoryCount} Ordner`, `${stats.fileCount} Dateien`];
  if (stats.fileCount === 0 || stats.filesWithSize === 0) return `Aktuelle Ansicht: ${parts.join(" · ")}`;
  const sizeText = `${stats.sizeBytes} B`;
  parts.push(stats.filesWithSize < stats.fileCount ? `${sizeText} (unvollständig)` : sizeText);
  return `Aktuelle Ansicht: ${parts.join(" · ")}`;
}

function listingStatusLabel(listing) {
  if (listing === "read") return "Eingelesen";
  if (listing === "depthLimited") return "Maximale Einlesetiefe erreicht";
  return "Unvollständig eingelesen";
}

function snapshotHasField(root, field) {
  function walk(node) {
    if (node[field] !== undefined) return true;
    return isDirectory(node) && node.children.some(walk);
  }
  return walk(root);
}

function collectMatchIds(root, query) {
  const needle = query.trim().toLocaleLowerCase();
  const matches = [];
  function walk(node) {
    if (node.name.toLocaleLowerCase().includes(needle)) matches.push(node.id);
    if (isDirectory(node)) for (const child of node.children) walk(child);
  }
  walk(root);
  return matches;
}

function defaultExpandedIds(rootId) {
  return new Set([rootId]);
}

function collectExpandableDirectoryIds(root, into = new Set()) {
  if (isDirectory(root)) {
    if (root.children.length > 0) into.add(root.id);
    for (const child of root.children) collectExpandableDirectoryIds(child, into);
  }
  return into;
}

const tree = dir("C:/root", "root", [
  dir("C:/root/A", "A", [
    file("C:/root/A/Angebot.pdf", "Angebot.pdf", { sizeBytes: 100, modifiedAtMs: 1 }),
    file("C:/root/A/Text.txt", "Text.txt", { sizeBytes: 20, modifiedAtMs: 2 }),
  ]),
  dir("C:/root/B", "B", [file("C:/root/B/Bild.jpg", "Bild.jpg", { sizeBytes: 50, modifiedAtMs: 3 })]),
  dir("C:/root/C", "C", []),
]);

const exact = resolveWarningJump(tree, tree, "C:/root/A/Angebot.pdf");
assert(exact.kind === "exact" && exact.targetId === "C:/root/A/Angebot.pdf", "warn: exact node");
assert(exact.applySelection && exact.notice === null, "warn: exact selects");
assert(exact.ancestorIds.includes("C:/root") && exact.ancestorIds.includes("C:/root/A"), "warn: ancestors");
const plan = warningRevealPlan(tree, defaultExpandedIds(tree.id), exact.targetId);
assert(plan.rowIndex >= 0, "warn: scroll target");

const slashVariant = resolveWarningJump(tree, tree, "C:\\root\\A\\Angebot.pdf");
assert(slashVariant.kind === "exact" && slashVariant.targetId === "C:/root/A/Angebot.pdf", "warn: slash-normalized exact");

const ancestor = resolveWarningJump(tree, tree, "C:/root/A/missing.bin");
assert(ancestor.kind === "ancestor" && ancestor.targetId === "C:/root/A", "warn: parent fallback");
assert(ancestor.notice === WARNING_ANCESTOR_NOTICE && ancestor.applySelection, "warn: ancestor notice");

const none = resolveWarningJump(tree, tree, "D:/elsewhere/x.txt");
assert(none.kind === "none" && none.applySelection === false && none.notice === WARNING_NO_TARGET_NOTICE, "warn: no target");
assert(resolveWarningJump(tree, tree, "C:/root-other/file.txt").kind === "none", "warn: prefix trap");

const pdfView = buildDisplayFilterView(tree, { extensions: [".pdf"], modifiedFrom: "", modifiedUntil: "" });
const hidden = resolveWarningJump(tree, pdfView.tree, "C:/root/A/Text.txt");
assert(hidden.kind === "hidden-by-filter" && hidden.applySelection === false, "warn: filter hides target");
assert(hidden.notice === WARNING_HIDDEN_BY_FILTER_NOTICE && hidden.offerFilterReset, "warn: filter notice");
assert(pdfView.fileMatchCount === 1, "warn: filter unchanged");
assert(resolveWarningJump(tree, pdfView.tree, "C:/root/B/ghost.doc").applySelection === false, "warn: hidden ancestor");

assert(listingStatusLabel("read") === "Eingelesen", "detail: listing read");
assert(listingStatusLabel("depthLimited") === "Maximale Einlesetiefe erreicht", "detail: listing depth");
assert(listingStatusLabel("incomplete") === "Unvollständig eingelesen", "detail: listing incomplete");
assert(findNodeById(tree, "C:/root/A/Angebot.pdf").name === "Angebot.pdf", "detail: file lookup");
assert(snapshotHasField(tree, "sizeBytes") === true, "detail: size captured");
assert(snapshotHasField(dir("n", "n", [file("n/a.pdf", "a.pdf")]), "sizeBytes") === false, "detail: size not captured");
assert(META_NOT_CAPTURED.length > 0 && META_UNAVAILABLE.length > 0, "detail: missing labels");
assert(findNodeById(tree, null) === undefined, "detail: no selection");

const full = collectViewWorkStats(tree);
assert(full.directoryCount === 4 && full.fileCount === 3, "stats: unfiltered");
assert(full.filesWithSize === 3 && full.sizeBytes === 170, "stats: unfiltered sizes in this fixture");
const filtered = collectViewWorkStats(pdfView.tree);
assert(filtered.fileCount === 1 && filtered.directoryCount === 2, "stats: filter ancestors");
assert(filtered.sizeBytes === 100, "stats: filtered size");

const collapsed = deriveVisibleRows(tree, defaultExpandedIds(tree.id)).length;
const expanded = deriveVisibleRows(tree, collectExpandableDirectoryIds(tree)).length;
assert(collapsed < expanded, "stats: expand changes rows");
assert(collectViewWorkStats(tree).fileCount === 3, "stats: expand does not change work numbers");
assert(collectMatchIds(tree, "angebot").length === 1, "stats: search finds");
assert(collectViewWorkStats(tree).fileCount === 3, "stats: search does not change work numbers");

const noSizes = collectViewWorkStats(dir("C:/z", "z", [file("C:/z/a.pdf", "a.pdf"), file("C:/z/b.txt", "b.txt")]));
assert(noSizes.filesWithSize === 0 && !formatViewWorkStats(noSizes).includes("0 B"), "stats: no fake zero size");
assert(formatViewWorkStats(full).startsWith("Aktuelle Ansicht:"), "stats: label");

const emptyFilter = buildDisplayFilterView(tree, { extensions: [".dwg"] });
assert(collectViewWorkStats(emptyFilter.tree).fileCount === 0, "stats: empty filter");

const partialTree = dir("C:/p", "p", [
  file("C:/p/a.pdf", "a.pdf", { sizeBytes: 100 }),
  file("C:/p/b.txt", "b.txt"),
]);
const partial = collectViewWorkStats(partialTree);
assert(partial.filesWithSize === 1 && formatViewWorkStats(partial).includes("(unvollständig)"), "stats: partial sizes");

console.log("p1-d checks passed");
