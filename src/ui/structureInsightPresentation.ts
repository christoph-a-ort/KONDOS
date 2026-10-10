/**
 * P2-J-I – Pure presentation helpers for insight UI polish.
 * No H/I/J-A rebuild, no filesystem, no filter/search semantics changes.
 */

import type { InsightElementRef } from "./structureInsightViewModel";

/** UI-only initial example count; does not change ViewModel/analysis. */
export const INSIGHT_EXAMPLES_INITIAL_LIMIT = 3;

export interface InsightElementPathPresentation {
  name: string;
  /** Secondary path line; null when omitted as redundant or absent. */
  secondaryPath: string | null;
  /** Full relative path for tooltip / accessible name when present. */
  fullPathTitle: string | null;
}

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}

/** Directory portion of a relative path that ends with the file/folder name. */
export function insightElementDirectoryPath(
  relativePath: string,
  displayName: string,
): string {
  const path = normalizePathSeparators(relativePath.trim());
  const name = displayName.trim();
  if (path.length === 0) {
    return "";
  }
  if (name.length === 0) {
    const slash = path.lastIndexOf("/");
    return slash >= 0 ? path.slice(0, slash) : "";
  }
  const lowerPath = path.toLowerCase();
  const lowerName = name.toLowerCase();
  if (lowerPath === lowerName) {
    return "";
  }
  const suffix = `/${lowerName}`;
  if (lowerPath.endsWith(suffix)) {
    return path.slice(0, path.length - name.length - 1);
  }
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash) : "";
}

/**
 * True when the element's directory path is already expressed by the
 * fundort breadcrumb segments (same segment sequence).
 */
export function isElementPathCoveredByLocation(
  relativePath: string,
  displayName: string,
  locationSegmentNames: readonly string[],
): boolean {
  const directory = insightElementDirectoryPath(relativePath, displayName);
  if (directory.length === 0) {
    return true;
  }
  if (locationSegmentNames.length === 0) {
    return false;
  }
  const locationPath = normalizePathSeparators(locationSegmentNames.join("/")).toLowerCase();
  const dirLower = directory.toLowerCase();
  return dirLower === locationPath || dirLower.endsWith(`/${locationPath}`) || locationPath.endsWith(`/${dirLower}`);
}

export function countDisplayNames(
  elements: readonly InsightElementRef[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const element of elements) {
    const key = element.displayName.trim().toLowerCase();
    if (key.length === 0) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Compact path presentation for element rows.
 * Never invents paths. Full path stays available via title when present.
 */
export function insightElementPathPresentation(
  element: InsightElementRef,
  locationSegmentNames: readonly string[],
  nameCounts: ReadonlyMap<string, number>,
): InsightElementPathPresentation {
  const name = element.displayName.trim();
  const displayName = name.length > 0 ? name : "—";
  const rawPath =
    element.relativePath !== undefined && element.relativePath.trim().length > 0
      ? element.relativePath.trim()
      : null;
  if (rawPath === null) {
    return { name: displayName, secondaryPath: null, fullPathTitle: null };
  }
  const nameKey = displayName.toLowerCase();
  const duplicateName = (nameCounts.get(nameKey) ?? 0) > 1;
  const covered = isElementPathCoveredByLocation(rawPath, displayName, locationSegmentNames);
  const secondaryPath = duplicateName || !covered ? rawPath : null;
  return {
    name: displayName,
    secondaryPath,
    fullPathTitle: rawPath,
  };
}

/** ViewModel order preserved. UI-only collapse of example list. */
export function visibleInsightExamples(
  examples: readonly string[],
  showAll: boolean,
  limit: number = INSIGHT_EXAMPLES_INITIAL_LIMIT,
): string[] {
  if (showAll || examples.length <= limit) {
    return examples.slice();
  }
  return examples.slice(0, limit);
}

export function insightExamplesHaveMore(
  totalCount: number,
  limit: number = INSIGHT_EXAMPLES_INITIAL_LIMIT,
): boolean {
  return totalCount > limit;
}

export function formatInsightLocationCountLabel(count: number): string {
  if (count === 1) {
    return "1 Erkenntnis";
  }
  return `${count} Erkenntnisse`;
}
