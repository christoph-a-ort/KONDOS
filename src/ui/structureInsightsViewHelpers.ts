/**
 * P2-J-C – Pure presentation helpers for the insights ground view.
 * No React, no filesystem, no H/I/J-A orchestration.
 */

import type { InsightAnalysisPhase } from "./structureInsightAnalysis";
import type {
  InsightEvidenceCounts,
  StructureInsightViewModel,
} from "./structureInsightViewModel";

export type MainView = "structure" | "insights" | "planning";
export type MainNavSection = "files" | "autosort";

export const FILES_NAV_LABEL = "Dateien & Ordner";
export const AUTOSORT_NAV_LABEL = "Automatische Sortierung";
export const INSIGHTS_NAV_LABEL = "Erkenntnisse";
export const PLANNING_NAV_LABEL = "Planung";

/** Default and post-scan-start view — never auto-switches on analysis phase. */
export function defaultMainView(): MainView {
  return "structure";
}

export function mainViewAfterScanStart(): MainView {
  return "structure";
}

export function canSelectInsightsView(hasSuccessfulScanResult: boolean): boolean {
  return hasSuccessfulScanResult;
}

export function canSelectPlanningView(hasSuccessfulScanResult: boolean): boolean {
  return hasSuccessfulScanResult;
}

export function canSelectAutosortView(hasSuccessfulScanResult: boolean): boolean {
  return canSelectInsightsView(hasSuccessfulScanResult) || canSelectPlanningView(hasSuccessfulScanResult);
}

export function mainNavSection(view: MainView): MainNavSection {
  return view === "structure" ? "files" : "autosort";
}

export function isAutosortMainView(view: MainView): boolean {
  return view === "insights" || view === "planning";
}

export function selectMainNavSection(section: MainNavSection, current: MainView): MainView {
  if (section === "files") {
    return "structure";
  }
  return isAutosortMainView(current) ? current : "insights";
}

/** Contract helper: phase transitions must not change the main view. */
export function shouldAutoSwitchMainViewOnPhase(
  _phase: InsightAnalysisPhase,
): boolean {
  return false;
}

export function formatInsightReadyHeadline(count: number): string {
  if (count === 1) {
    return "Dotty hat im eingelesenen Bestand 1 strukturelles Muster erkannt.";
  }
  return `Dotty hat im eingelesenen Bestand ${count} strukturelle Muster erkannt.`;
}

export function formatInsightEvidenceSummary(counts: InsightEvidenceCounts): string {
  const parts: string[] = [];
  if (counts.high > 0) {
    parts.push(`${counts.high} Hoch`);
  }
  if (counts.medium > 0) {
    parts.push(`${counts.medium} Mittel`);
  }
  if (counts.low > 0) {
    parts.push(`${counts.low} Niedrig`);
  }
  if (counts.unassessed > 0) {
    parts.push(`${counts.unassessed} Noch nicht bewertet`);
  }
  return parts.join(" · ");
}

export const INSIGHT_EVIDENCE_INFO =
  "Die Evidenzstärke beschreibt, wie deutlich die vorhandenen Daten ein erkanntes Muster stützen. Sie ist keine Bewertung Ihrer Ablage.";

export function insightNavCountLabel(
  phase: InsightAnalysisPhase,
  viewModel: StructureInsightViewModel | null,
): string | null {
  if (phase === "ready" && viewModel !== null) {
    return String(viewModel.insights.length);
  }
  if (phase === "running") {
    return "…";
  }
  return null;
}
