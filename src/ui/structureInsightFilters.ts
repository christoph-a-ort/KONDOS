/**
 * P2-J-G – Pure helpers for insight search, filters, and hit presentation.
 * Presentation only. No H/I/J-A rebuild, no filesystem, no sort of ViewModel lists.
 */

import { listInsightLocationSections } from "./structureInsightCardsHelpers";
import { INSIGHT_LIST_INITIAL_LIMIT } from "./structureInsightDetailsHelpers";
import type {
  InsightCardModel,
  InsightElementRef,
  InsightEvidenceLevel,
  InsightLocationGroup,
  InsightUserCategoryKey,
  StructureInsightViewModel,
} from "./structureInsightViewModel";

export interface InsightLocationSection {
  location: InsightLocationGroup;
  cards: InsightCardModel[];
}

export type InsightEvidenceFilter = "all" | "high" | "medium" | "low";

export type InsightCategoryFilter = "all" | InsightUserCategoryKey;

export interface InsightFilterState {
  query: string;
  evidence: InsightEvidenceFilter;
  category: InsightCategoryFilter;
}

export interface InsightTextSegment {
  text: string;
  hit: boolean;
}

export const DEFAULT_INSIGHT_FILTER_STATE: InsightFilterState = {
  query: "",
  evidence: "all",
  category: "all",
};

export const INSIGHT_SEARCH_LABEL = "Erkenntnisse durchsuchen";
export const INSIGHT_SEARCH_PLACEHOLDER = "Dateiname, Ordner, Muster …";
export const INSIGHT_EVIDENCE_FILTER_LABEL = "Evidenzstärke";
export const INSIGHT_CATEGORY_FILTER_LABEL = "Erkenntnistyp";
export const INSIGHT_FILTER_EMPTY_MESSAGE = "Keine passenden Erkenntnisse gefunden.";
export const INSIGHT_FILTER_RESET_LABEL = "Suche und Filter zurücksetzen";
export const INSIGHT_DETAILS_EXPAND_ALL_LABEL = "Alle Details anzeigen";
export const INSIGHT_DETAILS_COLLAPSE_ALL_LABEL = "Alle Details schließen";
export const INSIGHT_SEARCH_CLEAR_LABEL = "Suche löschen";

export const INSIGHT_EVIDENCE_FILTER_OPTIONS: readonly {
  value: InsightEvidenceFilter;
  label: string;
}[] = [
  { value: "all", label: "Alle" },
  { value: "high", label: "Hoch" },
  { value: "medium", label: "Mittel" },
  { value: "low", label: "Niedrig" },
];

export const INSIGHT_CATEGORY_FILTER_OPTIONS: readonly {
  value: InsightCategoryFilter;
  label: string;
}[] = [
  { value: "all", label: "Alle" },
  { value: "file-names", label: "Dateinamen" },
  { value: "folder-structure", label: "Ordnerstruktur" },
  { value: "time-years", label: "Zeit/Jahre" },
  { value: "file-distribution", label: "Dateiaufteilung" },
];

/** Normalize user query: trim, collapse whitespace, case-fold. No regex. */
export function normalizeInsightSearchQuery(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Presentation haystack: ViewModel searchText plus explanation bullets
 * (bullets are not in J-A searchText; added here without mutating the ViewModel).
 */
export function insightSearchHaystack(card: InsightCardModel): string {
  const bulletText = card.explanationBullets.join(" ");
  return normalizeInsightSearchQuery(`${card.searchText}\n${bulletText}`);
}

export function insightMatchesSearch(
  card: InsightCardModel,
  query: string,
): boolean {
  const normalizedQuery = normalizeInsightSearchQuery(query);
  if (normalizedQuery.length === 0) {
    return true;
  }
  return insightSearchHaystack(card).includes(normalizedQuery);
}

export function insightMatchesEvidenceFilter(
  card: InsightCardModel,
  evidence: InsightEvidenceFilter,
): boolean {
  if (evidence === "all") {
    return true;
  }
  return card.evidenceLevel === evidence;
}

/** "Alle" includes every evidence level, including unassessed. */
export function insightMatchesCategoryFilter(
  card: InsightCardModel,
  category: InsightCategoryFilter,
): boolean {
  if (category === "all") {
    return true;
  }
  return card.category === category;
}

export function insightMatchesFilters(
  card: InsightCardModel,
  filters: InsightFilterState,
): boolean {
  const normalizedQuery = normalizeInsightSearchQuery(filters.query);
  return (
    insightMatchesSearch(card, normalizedQuery) &&
    insightMatchesEvidenceFilter(card, filters.evidence) &&
    insightMatchesCategoryFilter(card, filters.category)
  );
}

/**
 * Filter location sections. Preserves ViewModel location and card order.
 * Omits empty groups. No regrouping.
 */
export function filterInsightLocationSections(
  viewModel: StructureInsightViewModel,
  filters: InsightFilterState,
): InsightLocationSection[] {
  const sections = listInsightLocationSections(viewModel);
  const out: InsightLocationSection[] = [];
  for (const section of sections) {
    const cards = section.cards.filter((card) => insightMatchesFilters(card, filters));
    if (cards.length > 0) {
      out.push({ location: section.location, cards });
    }
  }
  return out;
}

export function countFilteredInsights(sections: readonly InsightLocationSection[]): number {
  let total = 0;
  for (const section of sections) {
    total += section.cards.length;
  }
  return total;
}

export function formatInsightHitCount(visible: number, total: number): string {
  return `${visible} von ${total} Erkenntnissen`;
}

export function filtersAreActive(filters: InsightFilterState): boolean {
  return (
    normalizeInsightSearchQuery(filters.query).length > 0 ||
    filters.evidence !== "all" ||
    filters.category !== "all"
  );
}

export function resetInsightFilters(): InsightFilterState {
  return { ...DEFAULT_INSIGHT_FILTER_STATE };
}

/** Closed-card surface fields (title / fact / meta). */
export function cardSurfaceSearchText(card: InsightCardModel): string {
  return normalizeInsightSearchQuery(
    [card.title, card.factLine, card.categoryLabel, card.evidenceLabel].join(" "),
  );
}

export function cardHasSurfaceSearchHit(
  card: InsightCardModel,
  normalizedQuery: string,
): boolean {
  if (normalizedQuery.length === 0) {
    return false;
  }
  return cardSurfaceSearchText(card).includes(normalizedQuery);
}

/**
 * Auto-open details when the only match is in detail/body content
 * (not visible on the closed card surface).
 */
export function cardNeedsDetailOpenForSearch(
  card: InsightCardModel,
  normalizedQuery: string,
): boolean {
  if (normalizedQuery.length === 0) {
    return false;
  }
  if (!insightMatchesSearch(card, normalizedQuery)) {
    return false;
  }
  return !cardHasSurfaceSearchHit(card, normalizedQuery);
}

export function textMatchesInsightQuery(text: string, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) {
    return false;
  }
  return normalizeInsightSearchQuery(text).includes(normalizedQuery);
}

export function elementMatchesInsightQuery(
  element: InsightElementRef,
  normalizedQuery: string,
): boolean {
  if (normalizedQuery.length === 0) {
    return false;
  }
  if (textMatchesInsightQuery(element.displayName, normalizedQuery)) {
    return true;
  }
  if (
    element.relativePath !== undefined &&
    textMatchesInsightQuery(element.relativePath, normalizedQuery)
  ) {
    return true;
  }
  return false;
}

export function elementListHasSearchHit(
  elements: readonly InsightElementRef[],
  normalizedQuery: string,
): boolean {
  if (normalizedQuery.length === 0) {
    return false;
  }
  for (const element of elements) {
    if (elementMatchesInsightQuery(element, normalizedQuery)) {
      return true;
    }
  }
  return false;
}

/** True when a matching element sits beyond the initial collapsed window. */
export function elementListNeedsShowAllForSearch(
  elements: readonly InsightElementRef[],
  normalizedQuery: string,
  limit: number = INSIGHT_LIST_INITIAL_LIMIT,
): boolean {
  if (normalizedQuery.length === 0 || elements.length <= limit) {
    return false;
  }
  for (let index = limit; index < elements.length; index += 1) {
    const element = elements[index];
    if (element !== undefined && elementMatchesInsightQuery(element, normalizedQuery)) {
      return true;
    }
  }
  return false;
}

export function cardDetailListKeysNeedingOpen(
  card: InsightCardModel,
  normalizedQuery: string,
): string[] {
  if (normalizedQuery.length === 0) {
    return [];
  }
  const keys: string[] = [];
  if (elementListHasSearchHit(card.primaryElements, normalizedQuery)) {
    keys.push(`${card.id}\u0001primary`);
  }
  for (const group of card.secondaryRecurringGroups) {
    if (elementListHasSearchHit(group.elements, normalizedQuery)) {
      keys.push(`${card.id}\u0001secondary\u0001${group.groupKey}`);
    }
  }
  if (elementListHasSearchHit(card.otherElements, normalizedQuery)) {
    keys.push(`${card.id}\u0001other`);
  }
  return keys;
}

/**
 * Split display text into safe segments for React rendering.
 * Matching uses case-insensitive substring search; output keeps original casing.
 * No HTML injection.
 */
export function splitInsightHighlightSegments(
  text: string,
  normalizedQuery: string,
): InsightTextSegment[] {
  if (normalizedQuery.length === 0 || text.length === 0) {
    return [{ text, hit: false }];
  }
  const lower = text.toLowerCase();
  const segments: InsightTextSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const foundAt = lower.indexOf(normalizedQuery, cursor);
    if (foundAt < 0) {
      segments.push({ text: text.slice(cursor), hit: false });
      break;
    }
    if (foundAt > cursor) {
      segments.push({ text: text.slice(cursor, foundAt), hit: false });
    }
    segments.push({
      text: text.slice(foundAt, foundAt + normalizedQuery.length),
      hit: true,
    });
    cursor = foundAt + normalizedQuery.length;
  }
  return segments.length > 0 ? segments : [{ text, hit: false }];
}

export function isInsightEvidenceFilter(value: string): value is InsightEvidenceFilter {
  return value === "all" || value === "high" || value === "medium" || value === "low";
}

export function isInsightCategoryFilter(value: string): value is InsightCategoryFilter {
  return (
    value === "all" ||
    value === "file-names" ||
    value === "folder-structure" ||
    value === "time-years" ||
    value === "file-distribution"
  );
}

/** Re-export evidence level type guard helper for selects. */
export function evidenceFilterIncludesUnassessed(evidence: InsightEvidenceFilter): boolean {
  return evidence === "all";
}

export type { InsightEvidenceLevel, InsightUserCategoryKey };
