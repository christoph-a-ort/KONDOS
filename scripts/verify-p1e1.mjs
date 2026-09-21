// Dev-side P1-E1.5 check. Mirrors content-search helpers and greps UI wiring.
// Not imported by the app.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function isDirectory(node) {
  return node.kind === "directory";
}

function file(id, name) {
  return { id, name, path: id, depth: 1, kind: "file" };
}

function dir(id, name, children) {
  return { id, name, path: id, depth: 0, kind: "directory", listing: "read", children };
}

function hit(nodeId, name, extras = {}) {
  return {
    nodeId,
    path: nodeId,
    name,
    format: "pdf",
    matchCount: 1,
    snippet: "Brandschutzklappe",
    highlights: [{ start: 0, end: 17 }],
    ...extras,
  };
}

const DEFAULT_SEARCH_MODE = "name";
const NAME_SEARCH_PLACEHOLDER = "Dateiname suchen …";
const CONTENT_SEARCH_PLACEHOLDER = "In PDF-, Word- und Excel-Inhalten suchen …";
const CONTENT_STALE_SNAPSHOT_MESSAGE =
  "Bitte den Ordner erneut einlesen, bevor die Inhaltssuche genutzt wird.";
const CONTENT_NO_DOCUMENTS_MESSAGE =
  "Im eingelesenen Bestand wurden keine durchsuchbaren Dokumente gefunden.";
const CONTENT_NO_HITS_MESSAGE = "Keine Treffer gefunden.";
const CONTENT_FILTER_HIDES_HITS_MESSAGE =
  "Keine Treffer in der aktuellen Ansicht.\nWeitere Treffer sind durch den Anzeigefilter ausgeblendet.";

function normalizeContentQuery(query) {
  return query.trim();
}

function hasContentQuery(query) {
  return normalizeContentQuery(query).length > 0;
}

function shouldPrepareContent(cacheComplete) {
  return !cacheComplete;
}

function collectNodeIds(root) {
  const ids = new Set();
  function walk(node) {
    ids.add(node.id);
    if (isDirectory(node)) {
      for (const child of node.children) walk(child);
    }
  }
  if (root !== null) walk(root);
  return ids;
}

function visibleContentHits(hits, visibleIds) {
  return hits.filter((entry) => visibleIds.has(entry.nodeId));
}

function formatMatchCount(count) {
  return count === 1 ? "1 Treffer" : `${count} Treffer`;
}

function formatContentHitSummary(options) {
  if (!options.hasResult) return null;
  if (options.filterActive) {
    return `${options.visibleCount} sichtbare Treffer · ${options.totalHitCount} im vorbereiteten Bestand`;
  }
  if (options.totalHitCount > options.returnedHitCount) {
    return `${options.returnedHitCount} von ${options.totalHitCount} Treffern`;
  }
  if (options.totalHitCount === 0) return null;
  return formatMatchCount(options.totalHitCount);
}

function formatPartialCacheNotice(processed, total) {
  return `Die Vorbereitung wurde abgebrochen.\nDie Suche berücksichtigt ${processed} von ${total} Dokumenten.`;
}

function formatPartialNoHits(processed, total) {
  return `Im bisher vorbereiteten Teilbestand wurden keine Treffer gefunden.\n${processed} von ${total} Dokumenten wurden berücksichtigt.`;
}

function formatPrepareCounts(processed, total) {
  return `${processed} von ${total} Dokumenten`;
}

function formatPrepareStats(searchableCount, noTextCount, problemCount) {
  return `${searchableCount} durchsuchbar · ${noTextCount} ohne Text · ${problemCount} problematisch`;
}

function mergeHighlightRanges(ranges) {
  const sorted = ranges
    .filter((range) => range.end > range.start)
    .map((range) => ({ start: range.start, end: range.end }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ start: range.start, end: range.end });
  }
  return merged;
}

function snippetHighlightParts(snippet, ranges) {
  const length = snippet.length;
  const merged = mergeHighlightRanges(ranges.filter((range) => range.end > 0 && range.start < length));
  const parts = [];
  let cursor = 0;
  for (const range of merged) {
    const start = Math.max(0, Math.min(range.start, length));
    const end = Math.max(start, Math.min(range.end, length));
    if (start > cursor) parts.push({ text: snippet.substring(cursor, start), hit: false });
    if (end > start) parts.push({ text: snippet.substring(start, end), hit: true });
    cursor = Math.max(cursor, end);
  }
  if (cursor < length) parts.push({ text: snippet.substring(cursor), hit: false });
  return parts.filter((part) => part.text.length > 0);
}

function emptyContentStatus(options) {
  if (!options.hasResult) return null;
  if (options.totalDocumentCount === 0) return CONTENT_NO_DOCUMENTS_MESSAGE;
  if (options.visibleCount > 0) return null;
  if (options.totalHitCount > 0 && options.filterActive) return CONTENT_FILTER_HIDES_HITS_MESSAGE;
  if (!options.cacheComplete) return formatPartialNoHits(options.processedDocumentCount, options.totalDocumentCount);
  const extras = [];
  if (options.noTextCount > 0) extras.push(`${options.noTextCount} Dokumente ohne durchsuchbaren Text.`);
  if (options.problemCount > 0) extras.push(`${options.problemCount} Dokumente konnten nicht durchsucht werden.`);
  return extras.length === 0 ? CONTENT_NO_HITS_MESSAGE : [CONTENT_NO_HITS_MESSAGE, ...extras].join("\n");
}

function stepMatchIndex(currentIndex, matchCount, delta) {
  const start = currentIndex < 0 ? 0 : currentIndex;
  return (start + delta + matchCount * 8) % matchCount;
}

function nextMatchIndex(currentIndex, matchCount, jumped) {
  if (matchCount <= 0) return -1;
  if (!jumped) return currentIndex < 0 ? 0 : currentIndex;
  return stepMatchIndex(currentIndex, matchCount, 1);
}

function previousMatchIndex(currentIndex, matchCount, jumped) {
  if (matchCount <= 0) return -1;
  if (!jumped) return currentIndex < 0 ? 0 : currentIndex;
  return stepMatchIndex(currentIndex, matchCount, -1);
}

assert(DEFAULT_SEARCH_MODE === "name", "A: default mode is Dateiname");
assert(NAME_SEARCH_PLACEHOLDER === "Dateiname suchen …", "A: name placeholder");
assert(CONTENT_SEARCH_PLACEHOLDER === "In PDF-, Word- und Excel-Inhalten suchen …", "content placeholder names PDF, Word and Excel");
assert(!hasContentQuery(""), "B: empty query is not a search");
assert(!hasContentQuery("   \t"), "B: whitespace query is not a search");
assert(hasContentQuery("Brandschutz"), "B: real query can start search");
assert(shouldPrepareContent(false), "E: incomplete cache prepares");
assert(!shouldPrepareContent(true), "D/F: complete cache skips prepare");

const partial = formatPartialCacheNotice(142, 800);
assert(partial.includes("142 von 800"), "H: partial cache counts");
assert(partial.includes("abgebrochen"), "H: cancelled wording");
assert(formatPrepareCounts(142, 800) === "142 von 800 Dokumenten", "I: progress counts");
assert(
  formatPrepareStats(118, 19, 5) === "118 durchsuchbar · 19 ohne Text · 5 problematisch",
  "I: progress groups",
);

const hits = [hit("C:/root/A/a.pdf", "a.pdf"), hit("C:/root/B/b.pdf", "b.pdf", { matchCount: 4 })];
assert(hits.length === 2 && hits[1].matchCount === 4, "J: hit list keeps entries");
assert(formatMatchCount(4) === "4 Treffer", "J: per-hit count");
assert(
  formatContentHitSummary({
    hasResult: true,
    filterActive: false,
    visibleCount: 200,
    totalHitCount: 847,
    returnedHitCount: 200,
  }) === "200 von 847 Treffern",
  "K: 200 of X",
);

const tree = dir("C:/root", "root", [
  dir("C:/root/A", "A", [file("C:/root/A/a.pdf", "a.pdf"), file("C:/root/A/note.txt", "note.txt")]),
  dir("C:/root/B", "B", [file("C:/root/B/b.pdf", "b.pdf")]),
]);
const pdfOnly = dir("C:/root", "root", [dir("C:/root/A", "A", [file("C:/root/A/a.pdf", "a.pdf")])]);
assert(visibleContentHits(hits, collectNodeIds(pdfOnly)).length === 1, "L: display filter uses nodeId");
assert(visibleContentHits(hits, collectNodeIds(tree)).length === 2, "L: unfiltered keeps backend hits");
assert(
  emptyContentStatus({
    hasResult: true,
    cacheComplete: true,
    totalDocumentCount: 2,
    processedDocumentCount: 2,
    visibleCount: 0,
    totalHitCount: 84,
    filterActive: true,
    noTextCount: 0,
    problemCount: 0,
  }) === CONTENT_FILTER_HIDES_HITS_MESSAGE,
  "M: filter hides backend hits",
);
assert(collectNodeIds(tree).has("C:/root/A/a.pdf"), "N: reveal target id exists");
assert(nextMatchIndex(2, 3, true) === 0, "O: next wraps");
assert(previousMatchIndex(0, 3, true) === 2, "O: prev wraps");
assert(!hasContentQuery(""), "P: escape-cleared query is empty");
assert(shouldPrepareContent(true) === false, "P: cache complete flag is independent of query");

const umlautParts = snippetHighlightParts("Änderung Straße", [{ start: 0, end: 8 }]);
assert(umlautParts[0]?.hit === true && umlautParts[0].text === "Änderung", "Q: umlaut range");
assert(snippetHighlightParts("Straße", [{ start: 4, end: 5 }]).some((part) => part.hit && part.text === "ß"), "Q: ß");
const withEmoji = "Hi 😀 Brand";
const emojiParts = snippetHighlightParts(withEmoji, [{ start: "Hi 😀 ".length, end: withEmoji.length }]);
assert(
  emojiParts.some((part) => part.hit && part.text === "Brand") &&
    emojiParts.some((part) => !part.hit && part.text.includes("😀")),
  "Q: emoji before hit uses UTF-16 substring",
);
assert(
  emptyContentStatus({
    hasResult: true,
    cacheComplete: true,
    totalDocumentCount: 0,
    processedDocumentCount: 0,
    visibleCount: 0,
    totalHitCount: 0,
    filterActive: false,
    noTextCount: 0,
    problemCount: 0,
  }) === CONTENT_NO_DOCUMENTS_MESSAGE,
  "U: zero documents",
);
assert(
  emptyContentStatus({
    hasResult: true,
    cacheComplete: false,
    totalDocumentCount: 800,
    processedDocumentCount: 142,
    visibleCount: 0,
    totalHitCount: 0,
    filterActive: false,
    noTextCount: 0,
    problemCount: 0,
  }) === formatPartialNoHits(142, 800),
  "G/H: partial no-hits",
);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

const treeView = read("src/ui/TreeView.tsx");
const results = read("src/ui/ContentSearchResults.tsx");
const hook = read("src/ui/useContentSearch.ts");
const helpers = read("src/ui/contentSearch.ts");
const fileOpen = read("src/ui/fileOpen.ts");
const app = read("src/App.tsx");
const rows = read("src/ui/treeRows.ts");
const css = read("src/App.css");
const api = read("src/scan/api.ts");
const sources = [treeView, results, hook, helpers, fileOpen, app, rows, css, api].join("\n");

assert(treeView.includes(">Dateiname</") || treeView.includes("Dateiname"), "A: Dateiname toggle");
assert(treeView.includes("Dateiinhalt"), "A: Dateiinhalt toggle");
assert(treeView.includes("aria-pressed"), "A: toggle semantics");
assert(helpers.includes('DEFAULT_SEARCH_MODE: SearchMode = "name"'), "A: default name mode");
assert(treeView.includes("setSearchMode"), "B: mode switch is local state");
assert(!treeView.includes("startPrepareContent("), "B: TreeView does not start prepare on toggle");
assert(hook.includes("hasContentQuery(queryRef.current)"), "B/E: prepare waits for a query");
assert(hook.includes("shouldPrepareContent(cacheComplete)"), "E: prepare only if cache incomplete");
assert(hook.includes("await searchCurrent(queryRef.current)"), "F: completed searches current query");
assert(hook.includes('outcome.status === "cancelled"'), "G: cancelled continues to search");
assert(helpers.includes("formatPartialCacheNotice"), "H: partial notice helper");
assert(results.includes("Abbrechen"), "I: cancel button");
assert(results.includes("formatPrepareCounts"), "I: progress counts rendered");
assert(results.includes("contentHitFormatLabel"), "format badge uses shared label helper");
assert(results.includes("content-hit-format"), "format badge class in hit row");
assert(results.includes("hit.name"), "J: hit filename");
assert(results.includes("snippetHighlightParts"), "J: snippet rendered");
assert(results.includes('<span className="content-hit-format">'), "format badge is text in the hit row");
assert(helpers.includes("von ${options.totalHitCount} Treffern"), "K: cap wording");
assert(helpers.includes("visibleContentHits"), "L: view filter helper");
assert(helpers.includes("CONTENT_FILTER_HIDES_HITS_MESSAGE"), "M: filter empty copy");
assert(treeView.includes("CONTENT_SEARCH_ARIA_LABEL"), "content search aria uses shared label");
assert(treeView.includes("revealTreeNode"), "N: hit reveal reuses tree navigation");
assert(treeView.includes('contentSearch.stepHit("next")'), "O: content prev/next");
assert(hook.includes("clearQueryAndHits"), "P: escape clears query/hits");
const clearStart = hook.indexOf("const clearQueryAndHits");
const clearEnd = hook.indexOf("}, []);", clearStart);
assert(clearStart >= 0 && clearEnd > clearStart, "P: clear helper present");
assert(!hook.slice(clearStart, clearEnd).includes("setCacheComplete"), "P: escape does not reset cache");
assert(hook.includes("}, [scanId, setBusy]);"), "S: new scanId resets content UI");
assert(helpers.includes("substring("), "Q: UTF-16 substring highlights");
assert(!sources.includes("dangerouslySetInnerHTML"), "R: no inner HTML");
assert(results.includes("<mark") && results.includes("{part.text}"), "R: React text nodes");
assert(app.includes("preparingContent"), "busy occupancy in App");
assert(app.includes("resultScanId={resultScanId}"), "scanId bound to tree");
assert(rows.includes("export const ROW_HEIGHT = 28;"), "V: ROW_HEIGHT");
assert(rows.includes("export const OVERSCAN = 12;"), "V: OVERSCAN");
assert(treeView.includes("ROW_HEIGHT"), "V: TreeView keeps windowing constant");
assert(!treeView.includes("react-window") && !treeView.includes("react-virtual"), "V: no virtualization library");
assert(helpers.includes(CONTENT_STALE_SNAPSHOT_MESSAGE), "T: stale snapshot wording");
assert(helpers.includes("von ${total} Dokumenten"), "document count wording");
assert(helpers.includes(CONTENT_NO_DOCUMENTS_MESSAGE), "empty documents copy");
assert(helpers.includes("Durchsucht werden PDF-, Word- (.docx) und Excel-Dateien (.xlsx)."), "empty stock names supported formats");
assert(!helpers.includes("von ${total} PDFs"), "no leftover PDF count wording");
assert(!helpers.includes("In PDF-Inhalten suchen"), "no leftover PDF-only content search copy");
assert(css.includes(".content-search-hits"), "21: separate hit list scroll");
assert(css.includes(".content-hit-mark"), "11: highlight token class");

assert(fileOpen.includes('FILE_OPEN_LABEL = "Datei öffnen"'), "K: open label");
assert(treeView.includes("{FILE_OPEN_LABEL}"), "K: open button in path bar");
assert(fileOpen.includes("isFileSelected") && fileOpen.includes("occupancyIdle"), "L/M/N: enable helper");
assert(treeView.includes("canOpenFile"), "L: open uses dedicated enable flag");
assert(treeView.includes("contentSearch.preparing"), "O: preparing feeds occupancy");
assert(results.includes("onClick={onActivate}"), "P: content hit click selects only");
assert(!results.includes("onClick={onOpen}"), "P: content hit click does not open");
assert(results.includes("onDoubleClick") && results.includes("onOpen()"), "Q: content hit double-click opens");
assert(treeView.includes("openWithDefault(resultScanId, nodeId)"), "Q: same open command");
assert(treeView.includes("openInFlightRef"), "Q: in-flight guard against double open");
assert(api.includes("open_with_default"), "open command wired");
assert(treeView.includes("Im Explorer öffnen"), "T: explorer action remains");
assert(treeView.includes("Pfad kopieren"), "T: copy path remains");
assert(treeView.includes("if (row.expandable)"), "13: folder double-click still expands");
assert(treeView.includes("void openFileByNodeId(row.id)"), "13: file double-click opens");

console.log("p1-e1 checks passed");
