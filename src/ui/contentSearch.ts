import { isDirectory, type ContentProgress, type ContentSearchHit, type FsNode, type HighlightRange } from "../model";
import { toUserError } from "../scan";

export type SearchMode = "name" | "content";

export const DEFAULT_SEARCH_MODE: SearchMode = "name";
export const NAME_SEARCH_PLACEHOLDER = "Dateiname suchen …";
export const CONTENT_SEARCH_PLACEHOLDER = "In PDF-Inhalten suchen …";
export const CONTENT_STALE_SNAPSHOT_MESSAGE =
  "Bitte den Ordner erneut einlesen, bevor die Inhaltssuche genutzt wird.";
export const CONTENT_NO_PDFS_MESSAGE =
  "Im eingelesenen Bestand wurden keine PDF-Dateien gefunden.";
export const CONTENT_NO_HITS_MESSAGE = "Keine Treffer gefunden.";
export const CONTENT_FILTER_HIDES_HITS_MESSAGE =
  "Keine Treffer in der aktuellen Ansicht.\nWeitere Treffer sind durch den Anzeigefilter ausgeblendet.";
export const CONTENT_PREPARE_TITLE = "Dateiinhalte werden vorbereitet";

export function normalizeContentQuery(query: string): string {
  return query.trim();
}

export function hasContentQuery(query: string): boolean {
  return normalizeContentQuery(query).length > 0;
}

export function shouldPrepareContent(cacheComplete: boolean): boolean {
  return !cacheComplete;
}

export function collectNodeIds(root: FsNode | null): Set<string> {
  const ids = new Set<string>();
  function walk(node: FsNode): void {
    ids.add(node.id);
    if (isDirectory(node)) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }
  if (root !== null) {
    walk(root);
  }
  return ids;
}

export function visibleContentHits(
  hits: readonly ContentSearchHit[],
  visibleIds: ReadonlySet<string>,
): ContentSearchHit[] {
  return hits.filter((hit) => visibleIds.has(hit.nodeId));
}

export function formatMatchCount(count: number): string {
  return count === 1 ? "1 Treffer" : `${count} Treffer`;
}

export function formatContentHitSummary(options: {
  hasResult: boolean;
  filterActive: boolean;
  visibleCount: number;
  totalHitCount: number;
  returnedHitCount: number;
}): string | null {
  if (!options.hasResult) {
    return null;
  }
  if (options.filterActive) {
    return `${options.visibleCount} sichtbare Treffer · ${options.totalHitCount} im vorbereiteten Bestand`;
  }
  if (options.totalHitCount > options.returnedHitCount) {
    return `${options.returnedHitCount} von ${options.totalHitCount} Treffern`;
  }
  if (options.totalHitCount === 0) {
    return null;
  }
  return formatMatchCount(options.totalHitCount);
}

export function formatPartialCacheNotice(processed: number, total: number): string {
  return `Die Vorbereitung wurde abgebrochen.\nDie Suche berücksichtigt ${processed} von ${total} PDFs.`;
}

export function formatPartialNoHits(processed: number, total: number): string {
  return `Im bisher vorbereiteten Teilbestand wurden keine Treffer gefunden.\n${processed} von ${total} PDFs wurden berücksichtigt.`;
}

export function formatNoHitsExtras(noTextCount: number, problemCount: number): string[] {
  const lines: string[] = [];
  if (noTextCount > 0) {
    lines.push(`${noTextCount} PDFs ohne durchsuchbaren Text.`);
  }
  if (problemCount > 0) {
    lines.push(`${problemCount} PDFs konnten nicht durchsucht werden.`);
  }
  return lines;
}

export function formatPrepareCounts(processed: number, total: number): string {
  return `${processed} von ${total} PDFs`;
}

export function formatPrepareStats(
  searchableCount: number,
  noTextCount: number,
  problemCount: number,
): string {
  return `${searchableCount} durchsuchbar · ${noTextCount} ohne Text · ${problemCount} problematisch`;
}

export function hitFolderLabel(path: string, name: string): string {
  const unified = path.replace(/\//g, "\\");
  const suffix = `\\${name}`;
  if (unified.length > suffix.length && unified.toLocaleLowerCase().endsWith(suffix.toLocaleLowerCase())) {
    return unified.slice(0, unified.length - suffix.length);
  }
  const slash = Math.max(unified.lastIndexOf("\\"), unified.lastIndexOf("/"));
  return slash > 0 ? unified.slice(0, slash) : unified;
}

export interface SnippetPart {
  text: string;
  hit: boolean;
}

export function mergeHighlightRanges(ranges: readonly HighlightRange[]): HighlightRange[] {
  const sorted = ranges
    .filter((range) => range.end > range.start)
    .map((range) => ({ start: range.start, end: range.end }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: HighlightRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }
  return merged;
}

export function snippetHighlightParts(
  snippet: string,
  ranges: readonly HighlightRange[],
): SnippetPart[] {
  const length = snippet.length;
  const merged = mergeHighlightRanges(
    ranges.filter((range) => range.end > 0 && range.start < length),
  );
  const parts: SnippetPart[] = [];
  let cursor = 0;
  for (const range of merged) {
    const start = Math.max(0, Math.min(range.start, length));
    const end = Math.max(start, Math.min(range.end, length));
    if (start > cursor) {
      parts.push({ text: snippet.substring(cursor, start), hit: false });
    }
    if (end > start) {
      parts.push({ text: snippet.substring(start, end), hit: true });
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < length) {
    parts.push({ text: snippet.substring(cursor), hit: false });
  }
  return parts.filter((part) => part.text.length > 0);
}

export function isProgressForContent(
  activeScanId: number | null,
  incoming: ContentProgress,
): boolean {
  return activeScanId !== null && incoming.scanId === activeScanId;
}

export function contentSearchUserError(error: unknown): string {
  const message = toUserError(error);
  const lower = message.toLocaleLowerCase();
  if (
    lower.includes("analyseergebnis") ||
    lower.includes("inhaltscache") ||
    lower.includes("nicht mehr aktuell") ||
    lower.includes("erneut einlesen")
  ) {
    return CONTENT_STALE_SNAPSHOT_MESSAGE;
  }
  return message;
}

export function emptyContentStatus(options: {
  hasResult: boolean;
  cacheComplete: boolean;
  totalPdfCount: number;
  processedPdfCount: number;
  visibleCount: number;
  totalHitCount: number;
  filterActive: boolean;
  noTextCount: number;
  problemCount: number;
}): string | null {
  if (!options.hasResult) {
    return null;
  }
  if (options.totalPdfCount === 0) {
    return CONTENT_NO_PDFS_MESSAGE;
  }
  if (options.visibleCount > 0) {
    return null;
  }
  if (options.totalHitCount > 0 && options.filterActive) {
    return CONTENT_FILTER_HIDES_HITS_MESSAGE;
  }
  if (!options.cacheComplete) {
    return formatPartialNoHits(options.processedPdfCount, options.totalPdfCount);
  }
  const extras = formatNoHitsExtras(options.noTextCount, options.problemCount);
  if (extras.length === 0) {
    return CONTENT_NO_HITS_MESSAGE;
  }
  return [CONTENT_NO_HITS_MESSAGE, ...extras].join("\n");
}
