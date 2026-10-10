/**
 * P2-J-G filter / search helper checks.
 * Synthetic fixtures only. No filesystem. No UI mounting.
 */

import {
  DEFAULT_INSIGHT_FILTER_STATE,
  cardNeedsDetailOpenForSearch,
  countFilteredInsights,
  elementListNeedsShowAllForSearch,
  filterInsightLocationSections,
  filtersAreActive,
  formatInsightHitCount,
  insightMatchesFilters,
  insightMatchesSearch,
  normalizeInsightSearchQuery,
  resetInsightFilters,
  splitInsightHighlightSegments,
  type InsightFilterState,
} from "./structureInsightFilters";
import type {
  InsightCardModel,
  InsightLocationGroup,
  StructureInsightViewModel,
} from "./structureInsightViewModel";
import { STRUCTURE_INSIGHT_VIEW_MODEL_SCHEMA_VERSION } from "./structureInsightViewModel";

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(label);
  }
}

function card(partial: Partial<InsightCardModel> & Pick<InsightCardModel, "id" | "locationId">): InsightCardModel {
  return {
    id: partial.id,
    locationId: partial.locationId,
    principle: partial.principle ?? "p",
    category: partial.category ?? "file-names",
    categoryLabel: partial.categoryLabel ?? "Dateinamen",
    title: partial.title ?? "Titel",
    factLine: partial.factLine ?? "Fakt",
    evidenceLevel: partial.evidenceLevel ?? "high",
    evidenceLabel: partial.evidenceLabel ?? "Hoch",
    incompleteData: partial.incompleteData ?? false,
    explanationBullets: partial.explanationBullets ?? [],
    structureSummary: partial.structureSummary ?? { plainDescription: "", examples: [] },
    primaryElements: partial.primaryElements ?? [],
    secondaryRecurringGroups: partial.secondaryRecurringGroups ?? [],
    otherElements: partial.otherElements ?? [],
    searchText: partial.searchText ?? "",
  };
}

function loc(locationId: string, insightIds: string[]): InsightLocationGroup {
  return {
    locationId,
    kind: locationId === "root" ? "root" : "folder",
    insightIds,
    displayPathSegments:
      locationId === "root"
        ? []
        : [{ nodeId: locationId, displayName: locationId.split("/").pop() ?? locationId }],
    rootContextLabel: locationId === "root" ? "Eingelesener Hauptordner" : undefined,
  };
}

export function runStructureInsightFiltersCheck(): void {
  assert(normalizeInsightSearchQuery("  Gasag   Gas  ") === "gasag gas", "normalize spaces");
  assert(normalizeInsightSearchQuery("Äpfel") === "äpfel", "normalize unicode");

  const titleCard = card({
    id: "t1",
    locationId: "root/A",
    title: "Wiederkehrende Dateinamen",
    searchText: "wiederkehrende dateinamen fakt",
  });
  assert(insightMatchesSearch(titleCard, "dateinamen"), "title-ish searchText hit");

  const factCard = card({
    id: "f1",
    locationId: "root/A",
    factLine: "12 Dateien mit Form",
    searchText: "titel 12 dateien mit form",
  });
  assert(insightMatchesSearch(factCard, "12 dateien"), "factLine searchText hit");

  const pathCard = card({
    id: "p1",
    locationId: "root/Gasag_Gas",
    searchText: "gasag_gas strom titel fakt",
  });
  assert(insightMatchesSearch(pathCard, "gasag"), "path searchText hit");

  const fileCard = card({
    id: "d1",
    locationId: "root/A",
    title: "Oberfläche",
    factLine: "sichtbar",
    searchText: "oberfläche sichtbar invoice_2020.pdf",
    primaryElements: [
      {
        nodeId: "root/A/invoice_2020.pdf",
        displayName: "invoice_2020.pdf",
        role: "primary",
      },
    ],
  });
  assert(insightMatchesSearch(fileCard, "invoice_2020"), "filename searchText hit");

  const exampleCard = card({
    id: "e1",
    locationId: "root/A",
    title: "Karte",
    factLine: "Fakt",
    searchText: "karte fakt beispieljahr 2019",
    structureSummary: { plainDescription: "Beschreibung", examples: ["Beispieljahr 2019"] },
  });
  assert(insightMatchesSearch(exampleCard, "2019"), "example searchText hit");

  const bulletOnly = card({
    id: "b1",
    locationId: "root/A",
    title: "Karte",
    factLine: "Fakt",
    searchText: "karte fakt",
    explanationBullets: ["Sonderbegriff Xylophon"],
  });
  assert(insightMatchesSearch(bulletOnly, "xylophon"), "bullet haystack hit");
  assert(cardNeedsDetailOpenForSearch(bulletOnly, "xylophon"), "detail-only needs open");
  assert(!cardNeedsDetailOpenForSearch(fileCard, "oberfläche"), "surface hit no forced open");

  const longList = Array.from({ length: 8 }, (_, index) => ({
    nodeId: `root/A/f${index}.txt`,
    displayName: index === 7 ? "TrefferDatei.txt" : `other_${index}.txt`,
    role: "primary" as const,
  }));
  assert(elementListNeedsShowAllForSearch(longList, "trefferdatei"), "hit beyond first six");
  assert(!elementListNeedsShowAllForSearch(longList, "other_0"), "early hit no show-all");

  const high = card({
    id: "h1",
    locationId: "root/A",
    evidenceLevel: "high",
    category: "file-names",
    searchText: "rechnung hoch dateinamen",
  });
  const medium = card({
    id: "m1",
    locationId: "root/B",
    evidenceLevel: "medium",
    category: "time-years",
    searchText: "rechnung mittel zeit",
  });
  const unassessed = card({
    id: "u1",
    locationId: "root/C",
    evidenceLevel: "unassessed",
    category: "folder-structure",
    searchText: "ordner unbewertet",
  });

  assert(
    insightMatchesFilters(unassessed, { ...DEFAULT_INSIGHT_FILTER_STATE }),
    "unassessed included in Alle",
  );
  assert(
    !insightMatchesFilters(unassessed, { ...DEFAULT_INSIGHT_FILTER_STATE, evidence: "low" }),
    "unassessed not forced into Niedrig",
  );

  const filters: InsightFilterState = {
    query: "  Rechnung  ",
    evidence: "high",
    category: "file-names",
  };
  assert(insightMatchesFilters(high, filters), "combined AND match");
  assert(!insightMatchesFilters(medium, filters), "combined AND reject evidence");
  assert(
    !insightMatchesFilters(
      card({
        id: "h2",
        locationId: "root/A",
        evidenceLevel: "high",
        category: "time-years",
        searchText: "rechnung hoch zeit",
      }),
      filters,
    ),
    "combined AND reject category",
  );

  const vm: StructureInsightViewModel = {
    schemaVersion: STRUCTURE_INSIGHT_VIEW_MODEL_SCHEMA_VERSION,
    locations: [loc("root/A", ["h1", "missing"]), loc("root/B", ["m1"]), loc("root/C", ["u1"])],
    insights: [high, medium, unassessed],
    countsByEvidence: { high: 1, medium: 1, low: 0, unassessed: 1, total: 3 },
    countsByCategory: {
      "file-names": 1,
      "folder-structure": 1,
      "time-years": 1,
      "file-distribution": 0,
    },
    globallyIncomplete: false,
  };

  const emptyQuerySections = filterInsightLocationSections(vm, DEFAULT_INSIGHT_FILTER_STATE);
  assert(countFilteredInsights(emptyQuerySections) === 3, "empty query keeps all");
  assert(emptyQuerySections[0]?.cards[0]?.id === "h1", "order stable first");
  assert(emptyQuerySections[1]?.cards[0]?.id === "m1", "order stable second");

  const filtered = filterInsightLocationSections(vm, {
    query: "rechnung",
    evidence: "all",
    category: "all",
  });
  assert(countFilteredInsights(filtered) === 2, "search filters cards");
  assert(filtered.length === 2, "empty groups hidden");
  assert(formatInsightHitCount(2, 3) === "2 von 3 Erkenntnissen", "hit count format");
  assert(formatInsightHitCount(0, 3) === "0 von 3 Erkenntnissen", "zero hit count");

  const none = filterInsightLocationSections(vm, {
    query: "zzzz-not-found",
    evidence: "all",
    category: "all",
  });
  assert(countFilteredInsights(none) === 0, "no matches");
  assert(none.length === 0, "no empty groups");

  assert(filtersAreActive(filters), "filters active");
  assert(!filtersAreActive(DEFAULT_INSIGHT_FILTER_STATE), "default inactive");
  assert(resetInsightFilters().query === "", "reset query");
  assert(resetInsightFilters().evidence === "all", "reset evidence");

  const segments = splitInsightHighlightSegments("Gasag_Gas Report", "gasag");
  assert(segments.some((segment) => segment.hit && segment.text.toLowerCase() === "gasag"), "highlight hit");
  assert(segments.every((segment) => typeof segment.text === "string"), "highlight safe text");
  assert(!JSON.stringify(segments).includes("<"), "highlight no html tags");

  assert(normalizeInsightSearchQuery("AbC") === "abc", "case fold");
  assert(insightMatchesSearch(pathCard, "GASAG"), "case insensitive via normalize");
}
