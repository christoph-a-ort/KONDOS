import type { ContentSearchHit, ContentSearchResult, DirectoryNode, FileNode, FsNode } from "../model";
import { canOpenWithDefault, FILE_OPEN_LABEL, isOccupancyIdle } from "./fileOpen";
import { OVERSCAN, ROW_HEIGHT } from "./treeRows";
import { nextMatchIndex, previousMatchIndex } from "./treeSearch";
import {
  CONTENT_FILTER_HIDES_HITS_MESSAGE,
  CONTENT_NO_PDFS_MESSAGE,
  CONTENT_SEARCH_PLACEHOLDER,
  CONTENT_STALE_SNAPSHOT_MESSAGE,
  DEFAULT_SEARCH_MODE,
  NAME_SEARCH_PLACEHOLDER,
  collectNodeIds,
  contentSearchUserError,
  emptyContentStatus,
  formatContentHitSummary,
  formatMatchCount,
  formatPartialCacheNotice,
  formatPartialNoHits,
  formatPrepareCounts,
  formatPrepareStats,
  hasContentQuery,
  hitFolderLabel,
  isProgressForContent,
  mergeHighlightRanges,
  shouldPrepareContent,
  snippetHighlightParts,
  visibleContentHits,
} from "./contentSearch";

function file(id: string, name: string): FileNode {
  return { id, name, path: id, depth: 1, kind: "file" };
}

function dir(id: string, name: string, children: FsNode[]): DirectoryNode {
  return { id, name, path: id, depth: 0, kind: "directory", listing: "read", children };
}

function hit(nodeId: string, name: string, extras: Partial<ContentSearchHit> = {}): ContentSearchHit {
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

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(label);
  }
}

export function runP1e1Check(): void {
  assert(DEFAULT_SEARCH_MODE === "name", "A: default mode is Dateiname");
  assert(NAME_SEARCH_PLACEHOLDER === "Dateiname suchen …", "A: name placeholder");
  assert(CONTENT_SEARCH_PLACEHOLDER === "In PDF-Inhalten suchen …", "content placeholder is honest");
  assert(!hasContentQuery(""), "B: empty query is not a search");
  assert(!hasContentQuery("   \t"), "B: whitespace query is not a search");
  assert(hasContentQuery("Brandschutz"), "B: real query can start search");
  assert(shouldPrepareContent(false), "E: incomplete cache prepares");
  assert(!shouldPrepareContent(true), "D: complete cache skips prepare");

  const completedThenSearch = shouldPrepareContent(true);
  assert(completedThenSearch === false, "F: after complete only search");
  assert(shouldPrepareContent(false), "G: cancelled/incomplete still prepares later");

  const partial = formatPartialCacheNotice(142, 800);
  assert(partial.includes("142 von 800"), "H: partial cache counts");
  assert(partial.includes("abgebrochen"), "H: cancelled wording");
  assert(formatPrepareCounts(142, 800) === "142 von 800 PDFs", "I: progress counts");
  assert(
    formatPrepareStats(118, 19, 5) === "118 durchsuchbar · 19 ohne Text · 5 problematisch",
    "I: progress groups",
  );

  const hits = [
    hit("C:/root/A/a.pdf", "a.pdf"),
    hit("C:/root/B/b.pdf", "b.pdf", { matchCount: 4 }),
  ];
  assert(hits.length === 2 && hits[1].matchCount === 4, "J: hit list keeps entries");
  assert(formatMatchCount(4) === "4 Treffer", "J: per-hit count");

  const capped = formatContentHitSummary({
    hasResult: true,
    filterActive: false,
    visibleCount: 200,
    totalHitCount: 847,
    returnedHitCount: 200,
  });
  assert(capped === "200 von 847 Treffern", "K: 200 of X");
  assert(
    formatContentHitSummary({
      hasResult: true,
      filterActive: false,
      visibleCount: 23,
      totalHitCount: 23,
      returnedHitCount: 23,
    }) === "23 Treffer",
    "K: all hits returned",
  );

  const tree = dir("C:/root", "root", [
    dir("C:/root/A", "A", [file("C:/root/A/a.pdf", "a.pdf"), file("C:/root/A/note.txt", "note.txt")]),
    dir("C:/root/B", "B", [file("C:/root/B/b.pdf", "b.pdf")]),
  ]);
  const pdfOnly = dir("C:/root", "root", [
    dir("C:/root/A", "A", [file("C:/root/A/a.pdf", "a.pdf")]),
  ]);
  const visible = visibleContentHits(hits, collectNodeIds(pdfOnly));
  assert(visible.length === 1 && visible[0].nodeId === "C:/root/A/a.pdf", "L: display filter uses nodeId");
  assert(visibleContentHits(hits, collectNodeIds(tree)).length === 2, "L: unfiltered keeps backend hits");

  const filterStatus = emptyContentStatus({
    hasResult: true,
    cacheComplete: true,
    totalPdfCount: 2,
    processedPdfCount: 2,
    visibleCount: 0,
    totalHitCount: 84,
    filterActive: true,
    noTextCount: 0,
    problemCount: 0,
  });
  assert(filterStatus === CONTENT_FILTER_HIDES_HITS_MESSAGE, "M: filter hides backend hits");

  const ancestorsNeeded = collectNodeIds(tree).has("C:/root/A/a.pdf");
  assert(ancestorsNeeded, "N: reveal target id exists in snapshot");
  assert(nextMatchIndex(0, 3, true) === 1, "O: next steps through hits");
  assert(nextMatchIndex(2, 3, true) === 0, "O: next wraps");
  assert(previousMatchIndex(0, 3, true) === 2, "O: prev wraps");

  assert(
    formatContentHitSummary({
      hasResult: true,
      filterActive: true,
      visibleCount: 37,
      totalHitCount: 84,
      returnedHitCount: 84,
    }) === "37 sichtbare Treffer · 84 im vorbereiteten Bestand",
    "filter summary distinguishes backend vs view",
  );

  const queryCleared = hasContentQuery("");
  assert(!queryCleared, "P: escape-cleared query is empty");
  assert(shouldPrepareContent(true) === false, "P: cache complete flag is independent of query");

  const umlaut = "Änderung Straße";
  const umlautParts = snippetHighlightParts(umlaut, [{ start: 0, end: 8 }]);
  assert(umlautParts[0]?.hit === true && umlautParts[0].text === "Änderung", "Q: umlaut range");
  const eszett = snippetHighlightParts("Straße", [{ start: 4, end: 5 }]);
  assert(eszett.some((part) => part.hit && part.text === "ß"), "Q: ß range");
  const withEmoji = "Hi 😀 Brand";
  const emojiPrefixUnits = "Hi 😀 ".length;
  const emojiParts = snippetHighlightParts(withEmoji, [
    { start: emojiPrefixUnits, end: withEmoji.length },
  ]);
  assert(
    emojiParts.some((part) => part.hit && part.text === "Brand") &&
      emojiParts.some((part) => !part.hit && part.text.includes("😀")),
    "Q: emoji before hit uses UTF-16 substring",
  );
  const multi = snippetHighlightParts("Brandschutz Nachtrag", [
    { start: 0, end: 11 },
    { start: 12, end: 20 },
  ]);
  assert(multi.filter((part) => part.hit).length === 2, "Q: several marks in one snippet");
  const merged = mergeHighlightRanges([
    { start: 0, end: 4 },
    { start: 3, end: 8 },
  ]);
  assert(merged.length === 1 && merged[0].end === 8, "Q: overlapping ranges merge");

  const result: ContentSearchResult = {
    scanId: 3,
    query: "alt",
    cacheComplete: true,
    processedPdfCount: 2,
    totalPdfCount: 2,
    totalHitCount: 2,
    returnedHitCount: 2,
    hits,
  };
  assert(result.scanId === 3, "S: results are scan-bound");
  const stale = contentSearchUserError({
    kind: "invalidConfig",
    message: "Das Analyseergebnis ist nicht mehr aktuell.",
  });
  assert(stale === CONTENT_STALE_SNAPSHOT_MESSAGE, "T: stale snapshot wording");

  const noPdfs = emptyContentStatus({
    hasResult: true,
    cacheComplete: true,
    totalPdfCount: 0,
    processedPdfCount: 0,
    visibleCount: 0,
    totalHitCount: 0,
    filterActive: false,
    noTextCount: 0,
    problemCount: 0,
  });
  assert(noPdfs === CONTENT_NO_PDFS_MESSAGE, "U: zero PDFs");
  const partialNone = emptyContentStatus({
    hasResult: true,
    cacheComplete: false,
    totalPdfCount: 800,
    processedPdfCount: 142,
    visibleCount: 0,
    totalHitCount: 0,
    filterActive: false,
    noTextCount: 0,
    problemCount: 0,
  });
  assert(partialNone === formatPartialNoHits(142, 800), "G/H: partial no-hits");
  const completeNone = emptyContentStatus({
    hasResult: true,
    cacheComplete: true,
    totalPdfCount: 20,
    processedPdfCount: 20,
    visibleCount: 0,
    totalHitCount: 0,
    filterActive: false,
    noTextCount: 18,
    problemCount: 3,
  });
  assert(
    completeNone !== null &&
      completeNone.includes("Keine Treffer gefunden.") &&
      completeNone.includes("18 PDFs ohne durchsuchbaren Text.") &&
      completeNone.includes("3 PDFs konnten nicht durchsucht werden."),
    "no-hit extras",
  );

  assert(ROW_HEIGHT === 28, "V: ROW_HEIGHT");
  assert(OVERSCAN === 12, "V: OVERSCAN");
  assert(hitFolderLabel("C:\\root\\DOKUMENTE\\Angebot.pdf", "Angebot.pdf") === "C:\\root\\DOKUMENTE", "folder label");
  assert(isProgressForContent(7, {
    scanId: 7,
    totalPdfCount: 1,
    processedPdfCount: 1,
    searchableCount: 1,
    noTextCount: 0,
    problemCount: 0,
    currentFileName: "a.pdf",
    status: "running",
  }), "progress belongs to scan");
  assert(!isProgressForContent(7, {
    scanId: 8,
    totalPdfCount: 1,
    processedPdfCount: 1,
    searchableCount: 0,
    noTextCount: 0,
    problemCount: 0,
    currentFileName: "",
    status: "running",
  }), "foreign progress ignored");

  assert(FILE_OPEN_LABEL === "Datei öffnen", "K: open button label");
  assert(
    !canOpenWithDefault({ hasCurrentScan: true, isFileSelected: false, occupancyIdle: true }),
    "L: no selection cannot open",
  );
  assert(
    !canOpenWithDefault({ hasCurrentScan: true, isFileSelected: false, occupancyIdle: true }),
    "M: folder selection cannot open",
  );
  assert(
    canOpenWithDefault({ hasCurrentScan: true, isFileSelected: true, occupancyIdle: true }),
    "N: file + idle can open",
  );
  assert(
    !isOccupancyIdle({ scanning: false, exportBusy: false, preparingContent: true }),
    "O: preparing is not idle",
  );
  assert(
    !canOpenWithDefault({
      hasCurrentScan: true,
      isFileSelected: true,
      occupancyIdle: isOccupancyIdle({ scanning: false, exportBusy: false, preparingContent: true }),
    }),
    "O: preparing disables open",
  );
}
