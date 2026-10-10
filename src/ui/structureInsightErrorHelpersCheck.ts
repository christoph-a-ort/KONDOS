/**
 * P2-J-H error / retry helper checks.
 * Synthetic fixtures only. No filesystem. No UI mounting.
 */

import type { InsightAnalysisError } from "./structureInsightAnalysis";
import { toInsightAnalysisError } from "./structureInsightAnalysis";
import {
  INSIGHT_FAILED_HEADLINE,
  INSIGHT_RETRY_LABEL,
  INSIGHT_RUNNING_MESSAGE,
  INSIGHT_ZERO_HEADLINE,
  canRetryInsightAnalysis,
  formatInsightAnalysisErrorDetailLines,
} from "./structureInsightErrorHelpers";

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(label);
  }
}

export function runStructureInsightErrorHelpersCheck(): void {
  assert(INSIGHT_RUNNING_MESSAGE.includes("untersucht"), "running copy");
  assert(INSIGHT_FAILED_HEADLINE.includes("nicht abgeschlossen"), "failed headline");
  assert(INSIGHT_RETRY_LABEL.includes("erneut versuchen"), "retry label");
  assert(INSIGHT_ZERO_HEADLINE.includes("Keine strukturellen Muster"), "zero headline");

  assert(
    canRetryInsightAnalysis({
      phase: "failed",
      hasScanResult: true,
      isScanning: false,
      analysisInFlight: false,
    }),
    "retry allowed from failed",
  );
  assert(
    !canRetryInsightAnalysis({
      phase: "running",
      hasScanResult: true,
      isScanning: false,
      analysisInFlight: false,
    }),
    "no retry while running phase",
  );
  assert(
    !canRetryInsightAnalysis({
      phase: "failed",
      hasScanResult: true,
      isScanning: false,
      analysisInFlight: true,
    }),
    "no retry while in flight",
  );
  assert(
    !canRetryInsightAnalysis({
      phase: "failed",
      hasScanResult: false,
      isScanning: false,
      analysisInFlight: false,
    }),
    "no retry without scan",
  );
  assert(
    !canRetryInsightAnalysis({
      phase: "failed",
      hasScanResult: true,
      isScanning: true,
      analysisInFlight: false,
    }),
    "no retry while scanning",
  );
  assert(
    !canRetryInsightAnalysis({
      phase: "ready",
      hasScanResult: true,
      isScanning: false,
      analysisInFlight: false,
    }),
    "no retry from ready",
  );

  const fromError = toInsightAnalysisError(new Error("boom"));
  assert(fromError.code === "analysis-failed", "error code");
  assert(fromError.detail === "boom", "error detail");
  assert(fromError.name === "Error", "error name");

  const fromString = toInsightAnalysisError("string-fail");
  assert(fromString.detail === "string-fail", "string detail");
  assert(fromString.name === undefined, "string no name");

  const fromNull = toInsightAnalysisError(null);
  assert(fromNull.detail === "structure-insight-analysis-failed", "null fallback");

  const fromUndef = toInsightAnalysisError(undefined);
  assert(fromUndef.detail === "structure-insight-analysis-failed", "undefined fallback");

  const fromObject = toInsightAnalysisError({ nested: { secret: "x" } });
  assert(fromObject.detail === "structure-insight-analysis-failed", "object not dumped");
  assert(!fromObject.detail.includes("secret"), "no secret leak");

  const lines = formatInsightAnalysisErrorDetailLines(fromError);
  assert(lines.some((line) => line.startsWith("Name:")), "details name line");
  assert(lines.some((line) => line.includes("boom")), "details message");
  assert(lines.some((line) => line === "Phase: failed"), "details phase");
  assert(lines.every((line) => !line.includes("<")), "details no html");

  const emptyLines = formatInsightAnalysisErrorDetailLines(null);
  assert(emptyLines.length === 0, "null error no lines");

  const named: InsightAnalysisError = {
    code: "analysis-failed",
    detail: "x",
    name: "TypeError",
  };
  assert(
    formatInsightAnalysisErrorDetailLines(named).some((line) => line.includes("TypeError")),
    "custom name",
  );
}
