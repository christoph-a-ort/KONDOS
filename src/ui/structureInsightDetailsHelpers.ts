/**
 * P2-J-E – Pure helpers for expanded insight-card details.
 * Presentation only. No H/I/J-A, no filesystem, no sorting of ViewModel lists.
 */

import type { InsightElementRef } from "./structureInsightViewModel";

export const INSIGHT_LIST_INITIAL_LIMIT = 6;

export const INSIGHT_PRIMARY_ELEMENTS_HEADING = "Elemente der erkannten Hauptstruktur";

export const INSIGHT_OTHER_ELEMENTS_HEADING = "Elemente mit anderer erkannter Struktur";

export const INSIGHT_SECONDARY_GROUPS_INTRO = "Weitere wiederkehrende Strukturen";

export const INSIGHT_STRUCTURE_EXAMPLES_LABEL = "Beispiele";

export const INSIGHT_STRUCTURE_PARTS_LABEL = "Erkannte Bestandteile";

export const INSIGHT_EXPLANATION_HEADING = "Erklärung";

export const INSIGHT_STRUCTURE_HEADING = "Erkannte Struktur";

export const INSIGHT_INCOMPLETE_DETAIL_NOTE =
  "Für diese Erkenntnis war die Datengrundlage eingeschränkt.";

export const INSIGHT_LIST_SHOW_MORE_LABEL = "Weitere Elemente anzeigen";

export const INSIGHT_LIST_SHOW_LESS_LABEL = "Weniger anzeigen";

/** Non-empty trimmed structural part labels suitable for display. */
export function displayableStructuralParts(parts: readonly string[] | undefined): string[] {
  if (parts === undefined || parts.length === 0) {
    return [];
  }
  const out: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length > 0) {
      out.push(trimmed);
    }
  }
  return out;
}

export function displayableExamples(examples: readonly string[]): string[] {
  const out: string[] = [];
  for (const example of examples) {
    const trimmed = example.trim();
    if (trimmed.length > 0) {
      out.push(trimmed);
    }
  }
  return out;
}

export function displayableExplanationBullets(bullets: readonly string[]): string[] {
  const out: string[] = [];
  for (const bullet of bullets) {
    const trimmed = bullet.trim();
    if (trimmed.length > 0) {
      out.push(trimmed);
    }
  }
  return out;
}

/**
 * ViewModel order preserved. No re-sort.
 * When collapsed and longer than limit, return the first `limit` items.
 */
export function visibleInsightElements(
  elements: readonly InsightElementRef[],
  showAll: boolean,
  limit: number = INSIGHT_LIST_INITIAL_LIMIT,
): InsightElementRef[] {
  if (showAll || elements.length <= limit) {
    return elements.slice();
  }
  return elements.slice(0, limit);
}

export function insightElementListHasMore(
  totalCount: number,
  limit: number = INSIGHT_LIST_INITIAL_LIMIT,
): boolean {
  return totalCount > limit;
}

export function insightElementDisplayLines(element: InsightElementRef): {
  name: string;
  path: string | null;
} {
  const name = element.displayName.trim();
  const path =
    element.relativePath !== undefined && element.relativePath.trim().length > 0
      ? element.relativePath.trim()
      : null;
  return { name: name.length > 0 ? name : "—", path };
}

/** Stable nested-list key for a card section (primary / other / secondary group). */
export function insightNestedListKey(
  cardId: string,
  section: "primary" | "other" | "secondary",
  groupKey?: string,
): string {
  if (section === "secondary") {
    return `${cardId}\u0001secondary\u0001${groupKey ?? ""}`;
  }
  return `${cardId}\u0001${section}`;
}

/**
 * ElementRef has no file/folder kind. Without a safe type signal, use the
 * neutral "Elemente …" heading (never invent "Dateien …").
 */
export function otherElementsHeading(
  _elements: readonly InsightElementRef[],
): string {
  return INSIGHT_OTHER_ELEMENTS_HEADING;
}
