/**
 * P2-J-D – Insight cards / location-group helper checks.
 * Pure ViewModel rendering contracts. No filesystem. No UI mount.
 */

import {
  INSIGHT_DETAILS_HIDE_LABEL,
  INSIGHT_DETAILS_SHOW_LABEL,
  INSIGHT_INCOMPLETE_CARD_NOTE,
  INSIGHT_LOCATION_PATH_SEPARATOR,
  buildInsightCardLookup,
  formatInsightLocationHeading,
  insightCategoryClassName,
  insightEvidenceClassName,
  insightViewModelExpansionKey,
  listInsightLocationSections,
  resolveLocationInsightCards,
} from "./structureInsightCardsHelpers";
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

function emptyVm(overrides: Partial<StructureInsightViewModel> = {}): StructureInsightViewModel {
  return {
    schemaVersion: STRUCTURE_INSIGHT_VIEW_MODEL_SCHEMA_VERSION,
    locations: [],
    insights: [],
    countsByEvidence: { high: 0, medium: 0, low: 0, unassessed: 0, total: 0 },
    countsByCategory: {
      "file-names": 0,
      "folder-structure": 0,
      "time-years": 0,
      "file-distribution": 0,
    },
    globallyIncomplete: false,
    ...overrides,
  };
}

function card(
  overrides: Partial<InsightCardModel> & Pick<InsightCardModel, "id" | "locationId">,
): InsightCardModel {
  return {
    principle: "p",
    category: "file-names",
    categoryLabel: "Dateinamen",
    title: "Titel",
    factLine: "Faktzeile",
    evidenceLevel: "high",
    evidenceLabel: "Hoch",
    incompleteData: false,
    explanationBullets: ["bullet-must-not-leak"],
    structureSummary: {
      plainDescription: "Kurzbeschreibung nur für Expand",
      examples: ["example-must-not-leak"],
    },
    primaryElements: [{ nodeId: "n1", displayName: "primary-must-not-leak", role: "primary" }],
    secondaryRecurringGroups: [
      {
        groupKey: "sec-key",
        label: "secondary-must-not-leak",
        elements: [{ nodeId: "n2", displayName: "sec", role: "secondaryRecurring" }],
      },
    ],
    otherElements: [{ nodeId: "n3", displayName: "other-must-not-leak", role: "other" }],
    searchText: "search",
    ...overrides,
  };
}

function loc(
  overrides: Partial<InsightLocationGroup> &
    Pick<InsightLocationGroup, "locationId" | "kind" | "insightIds">,
): InsightLocationGroup {
  return {
    displayPathSegments: [],
    ...overrides,
  };
}

export function runStructureInsightCardsCheck(): void {
  assert(INSIGHT_INCOMPLETE_CARD_NOTE === "Datengrundlage eingeschränkt", "incomplete wording");
  assert(INSIGHT_DETAILS_SHOW_LABEL === "Details anzeigen", "details show label");
  assert(INSIGHT_DETAILS_HIDE_LABEL === "Details ausblenden", "details hide label");
  assert(INSIGHT_LOCATION_PATH_SEPARATOR === " › ", "path separator");

  const rootLoc = loc({
    locationId: "root-1",
    kind: "root",
    rootContextLabel: "Eingelesener Hauptordner",
    insightIds: ["a"],
  });
  assert(
    formatInsightLocationHeading(rootLoc) === "Eingelesener Hauptordner",
    "root uses rootContextLabel",
  );

  const pathLoc = loc({
    locationId: "loc-path",
    kind: "folder",
    displayPathSegments: [
      { nodeId: "s1", displayName: "Strom" },
      { nodeId: "s2", displayName: "Stadtwerke Hamm" },
    ],
    insightIds: ["b"],
  });
  assert(
    formatInsightLocationHeading(pathLoc) === "Strom › Stadtwerke Hamm",
    "folder uses displayPathSegments",
  );
  assert(!formatInsightLocationHeading(pathLoc).includes("/"), "no slash root invent");

  const c1 = card({
    id: "c1",
    locationId: "L1",
    title: "EXACT-TITLE-1",
    factLine: "EXACT-FACT-1",
    category: "file-names",
    categoryLabel: "Dateinamen",
    evidenceLevel: "high",
    evidenceLabel: "Hoch",
  });
  const c2 = card({
    id: "c2",
    locationId: "L1",
    title: "EXACT-TITLE-2",
    factLine: "EXACT-FACT-2",
    category: "time-years",
    categoryLabel: "Zeit/Jahre",
    evidenceLevel: "medium",
    evidenceLabel: "Mittel",
  });
  const c3 = card({
    id: "c3",
    locationId: "L2",
    title: "EXACT-TITLE-3",
    factLine: "EXACT-FACT-3",
    category: "folder-structure",
    categoryLabel: "Ordnerstruktur",
    evidenceLevel: "low",
    evidenceLabel: "Niedrig",
    incompleteData: true,
  });
  const c4 = card({
    id: "c4",
    locationId: "root-1",
    category: "file-distribution",
    categoryLabel: "Dateiaufteilung",
    evidenceLevel: "unassessed",
    evidenceLabel: "Noch nicht bewertet",
  });

  // Locations ordered L1 → L2 → root; insightIds order within L1 is c2 then c1 (VM order).
  const vm = emptyVm({
    locations: [
      loc({ locationId: "L1", kind: "folder", insightIds: ["c2", "c1", "missing-id"], displayPathSegments: pathLoc.displayPathSegments }),
      loc({
        locationId: "L2",
        kind: "folder",
        insightIds: ["c3"],
        displayPathSegments: [{ nodeId: "r", displayName: "Rechnungen" }],
      }),
      loc({
        locationId: "root-1",
        kind: "root",
        rootContextLabel: "Eingelesener Hauptordner",
        insightIds: ["c4"],
      }),
    ],
    insights: [c1, c2, c3, c4],
  });

  const sections = listInsightLocationSections(vm);
  assert(sections.length === 3, "location order length");
  assert(sections[0]!.location.locationId === "L1", "location order 0");
  assert(sections[1]!.location.locationId === "L2", "location order 1");
  assert(sections[2]!.location.locationId === "root-1", "location order 2 / root equal");

  assert(sections[0]!.cards.length === 2, "missing insightId skipped");
  assert(sections[0]!.cards[0]!.id === "c2", "insightIds order preserved first");
  assert(sections[0]!.cards[1]!.id === "c1", "insightIds order preserved second");
  assert(!sections[0]!.cards.some((x) => x.id === "missing-id"), "no fake card for missing id");

  assert(sections[0]!.cards[0]!.title === "EXACT-TITLE-2", "title unchanged");
  assert(sections[0]!.cards[0]!.factLine === "EXACT-FACT-2", "factLine unchanged");
  assert(sections[0]!.cards[0]!.categoryLabel === "Zeit/Jahre", "categoryLabel present");
  assert(sections[0]!.cards[0]!.evidenceLabel === "Mittel", "evidenceLabel present");
  assert(sections[1]!.cards[0]!.incompleteData === true, "incomplete flag preserved");

  const byId = buildInsightCardLookup(vm.insights);
  const missingOnly = resolveLocationInsightCards(
    loc({ locationId: "ghost", kind: "folder", insightIds: ["nope", "also-nope"] }),
    byId,
  );
  assert(missingOnly.length === 0, "all-missing yields empty, no crash");

  assert(insightCategoryClassName("file-names") === "insight-card--file-names", "cat blue class");
  assert(insightCategoryClassName("time-years") === "insight-card--time-years", "cat green class");
  assert(
    insightCategoryClassName("folder-structure") === "insight-card--folder-structure",
    "cat orange class",
  );
  assert(
    insightCategoryClassName("file-distribution") === "insight-card--file-distribution",
    "cat yellow class",
  );

  assert(insightEvidenceClassName("high") === "insight-card-evidence--high", "ev high");
  assert(insightEvidenceClassName("medium") === "insight-card-evidence--medium", "ev medium");
  assert(insightEvidenceClassName("low") === "insight-card-evidence--low", "ev low");
  assert(
    insightEvidenceClassName("unassessed") === "insight-card-evidence--unassessed",
    "ev unassessed",
  );

  const keyA = insightViewModelExpansionKey(vm);
  const keyB = insightViewModelExpansionKey(vm);
  assert(keyA === keyB, "expansion key stable");
  assert(keyA.includes("c1") && keyA.includes("c4"), "expansion key uses card ids");
  assert(insightViewModelExpansionKey(null) === "", "null expansion key empty");

  // Detail boundary: helpers never surface J-E fields as presentation strings.
  const helperSrcJoined = [
    INSIGHT_INCOMPLETE_CARD_NOTE,
    INSIGHT_DETAILS_SHOW_LABEL,
    formatInsightLocationHeading(pathLoc),
  ].join("|");
  assert(!helperSrcJoined.includes("bullet-must-not-leak"), "helpers no bullets");
  assert(!helperSrcJoined.includes("example-must-not-leak"), "helpers no examples");
  assert(!helperSrcJoined.includes("primary-must-not-leak"), "helpers no primary");
  assert(!helperSrcJoined.includes("%"), "no percent in labels");
  assert(!helperSrcJoined.toLowerCase().includes("score"), "no score in labels");
}
