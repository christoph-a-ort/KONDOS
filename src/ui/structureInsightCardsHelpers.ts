/**
 * P2-J-D – Pure helpers for insight cards / location groups.
 * No React, no filesystem, no H/I/J-A orchestration.
 */

import type {
  InsightCardModel,
  InsightEvidenceLevel,
  InsightLocationGroup,
  InsightUserCategoryKey,
  StructureInsightViewModel,
} from "./structureInsightViewModel";

export const INSIGHT_INCOMPLETE_CARD_NOTE = "Datengrundlage eingeschränkt";

export const INSIGHT_DETAILS_SHOW_LABEL = "Details anzeigen";
export const INSIGHT_DETAILS_HIDE_LABEL = "Details ausblenden";

/** Path / breadcrumb separator for location headings (display only). */
export const INSIGHT_LOCATION_PATH_SEPARATOR = " › ";

export function formatInsightLocationHeading(location: InsightLocationGroup): string {
  if (location.kind === "root") {
    return location.rootContextLabel ?? "Eingelesener Hauptordner";
  }
  if (location.displayPathSegments.length === 0) {
    return location.rootContextLabel ?? "Eingelesener Hauptordner";
  }
  return location.displayPathSegments.map((segment) => segment.displayName).join(INSIGHT_LOCATION_PATH_SEPARATOR);
}

export function buildInsightCardLookup(
  insights: readonly InsightCardModel[],
): ReadonlyMap<string, InsightCardModel> {
  const map = new Map<string, InsightCardModel>();
  for (const card of insights) {
    map.set(card.id, card);
  }
  return map;
}

/**
 * Resolve cards for a location in ViewModel insightIds order.
 * Missing IDs are skipped (no crash, no fake card).
 */
export function resolveLocationInsightCards(
  location: InsightLocationGroup,
  byId: ReadonlyMap<string, InsightCardModel>,
): InsightCardModel[] {
  const cards: InsightCardModel[] = [];
  for (const id of location.insightIds) {
    const card = byId.get(id);
    if (card !== undefined) {
      cards.push(card);
    }
  }
  return cards;
}

export function listInsightLocationSections(
  viewModel: StructureInsightViewModel,
): { location: InsightLocationGroup; cards: InsightCardModel[] }[] {
  const byId = buildInsightCardLookup(viewModel.insights);
  return viewModel.locations.map((location) => ({
    location,
    cards: resolveLocationInsightCards(location, byId),
  }));
}

export function insightCategoryClassName(category: InsightUserCategoryKey): string {
  switch (category) {
    case "file-names":
      return "insight-card--file-names";
    case "folder-structure":
      return "insight-card--folder-structure";
    case "time-years":
      return "insight-card--time-years";
    case "file-distribution":
      return "insight-card--file-distribution";
    default:
      return "insight-card--unknown";
  }
}

export function insightEvidenceClassName(level: InsightEvidenceLevel): string {
  switch (level) {
    case "high":
      return "insight-card-evidence--high";
    case "medium":
      return "insight-card-evidence--medium";
    case "low":
      return "insight-card-evidence--low";
    case "unassessed":
      return "insight-card-evidence--unassessed";
    default:
      return "insight-card-evidence--unassessed";
  }
}

export function insightCategoryIconLabel(category: InsightUserCategoryKey): string {
  switch (category) {
    case "file-names":
      return "Datei";
    case "folder-structure":
      return "Ordner";
    case "time-years":
      return "Zeit";
    case "file-distribution":
      return "Verteilung";
    default:
      return "Kategorie";
  }
}

/** Stable key for resetting expansion when the analysis result set changes. */
export function insightViewModelExpansionKey(viewModel: StructureInsightViewModel | null): string {
  if (viewModel === null) {
    return "";
  }
  return viewModel.insights.map((card) => card.id).join("\u0001");
}
