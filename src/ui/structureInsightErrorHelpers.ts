/**
 * P2-J-H – Pure helpers for insight analysis error presentation and retry gates.
 * No React, no filesystem, no H/I/J-A rebuild.
 */

import type {
  InsightAnalysisError,
  InsightAnalysisPhase,
} from "./structureInsightAnalysis";

export const INSIGHT_RUNNING_MESSAGE = "Dotty untersucht die eingelesene Struktur …";

export const INSIGHT_FAILED_HEADLINE =
  "Die Erkenntnisanalyse konnte nicht abgeschlossen werden.";

export const INSIGHT_FAILED_STRUCTURE_NOTE =
  "Die eingelesene Ordnerstruktur bleibt weiterhin verfügbar.";

export const INSIGHT_RETRY_LABEL = "Erkenntnisanalyse erneut versuchen";

export const INSIGHT_TECH_DETAILS_SHOW_LABEL = "Technische Details anzeigen";

export const INSIGHT_TECH_DETAILS_HIDE_LABEL = "Technische Details schließen";

export const INSIGHT_ZERO_HEADLINE = "Keine strukturellen Muster erkannt.";

export const INSIGHT_ZERO_EXPLANATION =
  "Dotty konnte im eingelesenen Bestand keine ausreichend erkennbaren wiederkehrenden Strukturen feststellen.";

export const INSIGHT_ZERO_NEUTRAL_NOTE = "Das ist keine Bewertung der Ablage.";

export const INSIGHT_PARTIAL_GLOBAL_HEADLINE =
  "Die Erkenntnisse beruhen auf einer teilweise eingeschränkten Datengrundlage.";

export const INSIGHT_PARTIAL_GLOBAL_NOTE =
  "Einige Ordner oder Dateien konnten möglicherweise nicht vollständig berücksichtigt werden.";

export const INSIGHT_PARTIAL_ZERO_SUMMARY =
  "Es wurden keine strukturellen Muster ermittelt. Die Analyse war teilweise eingeschränkt.";

/** Whether Retry may start a new analysis for the current ScanResult. */
export function canRetryInsightAnalysis(input: {
  phase: InsightAnalysisPhase;
  hasScanResult: boolean;
  isScanning: boolean;
  analysisInFlight: boolean;
}): boolean {
  return (
    input.phase === "failed" &&
    input.hasScanResult &&
    !input.isScanning &&
    !input.analysisInFlight
  );
}

/**
 * Safe technical detail lines for display. No invented codes beyond the existing
 * machine `code`. No HTML. No dumping of arbitrary objects.
 */
export function formatInsightAnalysisErrorDetailLines(
  error: InsightAnalysisError | null,
): string[] {
  if (error === null) {
    return [];
  }
  const lines: string[] = [];
  const name = error.name?.trim();
  if (name !== undefined && name.length > 0) {
    lines.push(`Name: ${name}`);
  }
  const detail = error.detail.trim();
  lines.push(`Meldung: ${detail.length > 0 ? detail : "structure-insight-analysis-failed"}`);
  lines.push("Phase: failed");
  lines.push(`Kennung: ${error.code}`);
  return lines;
}

export function insightFailedDetailsRegionId(prefix = "insight-failed"): string {
  return `${prefix}-details`;
}
