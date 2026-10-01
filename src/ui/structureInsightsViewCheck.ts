/**
 * P2-J-C structure insights ground-view checks — presentation helpers only.
 * No private paths. No filesystem. No UI mounting.
 */

import {
  INSIGHT_EVIDENCE_INFO,
  canSelectInsightsView,
  defaultMainView,
  formatInsightEvidenceSummary,
  formatInsightReadyHeadline,
  insightNavCountLabel,
  mainViewAfterScanStart,
  shouldAutoSwitchMainViewOnPhase,
} from "./structureInsightsViewHelpers";
import type { InsightCardModel, StructureInsightViewModel } from "./structureInsightViewModel";
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

function stubInsight(): InsightCardModel {
  return {
    id: "stub",
    locationId: "loc",
    principle: "p",
    category: "file-names",
    categoryLabel: "Dateinamen",
    title: "t",
    factLine: "f",
    evidenceLevel: "high",
    evidenceLabel: "Hoch",
    incompleteData: false,
    explanationBullets: [],
    structureSummary: { plainDescription: "", examples: [] },
    primaryElements: [],
    secondaryRecurringGroups: [],
    otherElements: [],
    searchText: "",
  };
}

export function runStructureInsightsViewCheck(): void {
  assert(defaultMainView() === "structure", "default main view");
  assert(mainViewAfterScanStart() === "structure", "scan start main view");
  assert(!canSelectInsightsView(false), "insights blocked without scan");
  assert(canSelectInsightsView(true), "insights allowed with scan");
  assert(!shouldAutoSwitchMainViewOnPhase("running"), "no auto on running");
  assert(!shouldAutoSwitchMainViewOnPhase("ready"), "no auto on ready");
  assert(!shouldAutoSwitchMainViewOnPhase("failed"), "no auto on failed");
  assert(!shouldAutoSwitchMainViewOnPhase("idle"), "no auto on idle");

  assert(formatInsightReadyHeadline(1).includes("1 strukturelles Muster"), "headline singular");
  assert(formatInsightReadyHeadline(11).includes("11 strukturelle Muster"), "headline plural");
  assert(!formatInsightReadyHeadline(11).includes("%"), "no percent headline");

  const summary = formatInsightEvidenceSummary({
    high: 5,
    medium: 5,
    low: 1,
    unassessed: 0,
    total: 11,
  });
  assert(summary === "5 Hoch · 5 Mittel · 1 Niedrig", "evidence summary order");
  assert(!summary.toLowerCase().includes("low"), "no english low");
  assert(!summary.includes("unassessed"), "no raw unassessed");

  const withUnassessed = formatInsightEvidenceSummary({
    high: 0,
    medium: 0,
    low: 0,
    unassessed: 2,
    total: 2,
  });
  assert(withUnassessed === "2 Noch nicht bewertet", "unassessed label");
  assert(!withUnassessed.includes("Niedrig"), "unassessed not low");

  assert(insightNavCountLabel("ready", emptyVm({ insights: [] })) === "0", "nav zero");
  assert(
    insightNavCountLabel("ready", emptyVm({ insights: [stubInsight()] })) === "1",
    "nav one",
  );
  assert(insightNavCountLabel("running", null) === "…", "nav running");
  assert(insightNavCountLabel("failed", null) === null, "nav failed no count");
  assert(insightNavCountLabel("idle", null) === null, "nav idle no count");

  assert(INSIGHT_EVIDENCE_INFO.includes("keine Bewertung"), "evidence info");
  assert(!INSIGHT_EVIDENCE_INFO.toLowerCase().includes("score"), "no score");
  assert(!/%/.test(INSIGHT_EVIDENCE_INFO), "no percent info");

  const zeroCopy: string =
    "Dotty hat im eingelesenen Bestand keine strukturellen Muster erkannt.";
  const partialZeroCopy: string =
    "Es wurden keine strukturellen Muster ermittelt. Die Analyse war teilweise eingeschränkt.";
  assert(zeroCopy !== partialZeroCopy, "zero != partial-zero");
  assert(!zeroCopy.toLowerCase().includes("problem"), "zero no problem wording");
  assert(!zeroCopy.toLowerCase().includes("ordnung"), "zero no ok wording");
  assert(partialZeroCopy.includes("eingeschränkt"), "partial-zero restricted");
}
