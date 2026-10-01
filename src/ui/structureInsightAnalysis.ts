/**
 * P2-J-B – Structure insight analysis orchestration (READ-ONLY).
 *
 * Productive pipeline: ScanResult → P2-H → P2-I → P2-J-A ViewModel.
 * No React, no filesystem, no backend, no UI, no mutation of inputs.
 */

import type { ScanResult } from "../model";
import {
  buildStructureConfidenceInsight,
  type StructureConfidenceInsightResult,
} from "./structureConfidenceAssessment";
import {
  buildStructureInsightViewModel,
  type StructureInsightViewModel,
} from "./structureInsightViewModel";
import {
  buildStructureRuleCandidateInsight,
  type StructureRuleCandidateInsightResult,
} from "./structureRuleCandidate";

export type InsightAnalysisPhase = "idle" | "running" | "ready" | "failed";

export interface InsightAnalysisError {
  /** Stable machine code for later UI mapping (J-H). Not a user-facing string. */
  code: "analysis-failed";
  /** Internal diagnostic detail; not wired as visible product copy in J-B. */
  detail: string;
}

export interface StructureInsightAnalysisDependencies {
  buildRuleCandidates?: (scanResult: ScanResult) => StructureRuleCandidateInsightResult;
  buildConfidence?: (
    input: StructureRuleCandidateInsightResult,
  ) => StructureConfidenceInsightResult;
  buildViewModel?: (
    scanResult: ScanResult,
    assessedCandidates: StructureConfidenceInsightResult["insight"]["ruleCandidates"],
  ) => StructureInsightViewModel;
}

/**
 * Synchronous H → I → J-A pipeline. Throws on unexpected builder failure.
 * Does not mutate scanResult.
 */
export function analyzeStructureInsights(
  scanResult: ScanResult,
  dependencies: StructureInsightAnalysisDependencies = {},
): StructureInsightViewModel {
  const buildRuleCandidates =
    dependencies.buildRuleCandidates ?? buildStructureRuleCandidateInsight;
  const buildConfidence = dependencies.buildConfidence ?? buildStructureConfidenceInsight;
  const buildViewModel = dependencies.buildViewModel ?? buildStructureInsightViewModel;

  const candidates = buildRuleCandidates(scanResult);
  const assessed = buildConfidence(candidates);
  return buildViewModel(scanResult, assessed.insight.ruleCandidates);
}

/** True only when the finished analysis still belongs to the current scan generation. */
export function shouldAcceptInsightAnalysisResult(
  expectedScanId: number,
  currentScanId: number | null,
  expectedGeneration: number,
  currentGeneration: number,
): boolean {
  return currentScanId === expectedScanId && expectedGeneration === currentGeneration;
}

export type InsightAnalysisScheduler = (task: () => void) => void;

/** Default: macrotask so React can commit/paint ScanResult before CPU-bound analysis. */
export function defaultInsightAnalysisScheduler(task: () => void): void {
  setTimeout(task, 0);
}

export interface ScheduleStructureInsightAnalysisOptions {
  scanResult: ScanResult;
  scanId: number;
  generation: number;
  getCurrentScanId: () => number | null;
  getCurrentGeneration: () => number;
  onReady: (viewModel: StructureInsightViewModel) => void;
  onFailed: (error: InsightAnalysisError) => void;
  schedule?: InsightAnalysisScheduler;
  dependencies?: StructureInsightAnalysisDependencies;
  analyze?: (
    scanResult: ScanResult,
    dependencies?: StructureInsightAnalysisDependencies,
  ) => StructureInsightViewModel;
}

/**
 * Schedule H→I→J-A after the current turn so ScanResult can render first.
 * Stale results (scanId/generation mismatch) are discarded silently.
 */
export function scheduleStructureInsightAnalysis(
  options: ScheduleStructureInsightAnalysisOptions,
): void {
  const schedule = options.schedule ?? defaultInsightAnalysisScheduler;
  const analyze = options.analyze ?? analyzeStructureInsights;
  const expectedScanId = options.scanId;
  const expectedGeneration = options.generation;

  schedule(() => {
    if (
      !shouldAcceptInsightAnalysisResult(
        expectedScanId,
        options.getCurrentScanId(),
        expectedGeneration,
        options.getCurrentGeneration(),
      )
    ) {
      return;
    }

    try {
      const viewModel = analyze(options.scanResult, options.dependencies);
      if (
        !shouldAcceptInsightAnalysisResult(
          expectedScanId,
          options.getCurrentScanId(),
          expectedGeneration,
          options.getCurrentGeneration(),
        )
      ) {
        return;
      }
      options.onReady(viewModel);
    } catch (cause) {
      if (
        !shouldAcceptInsightAnalysisResult(
          expectedScanId,
          options.getCurrentScanId(),
          expectedGeneration,
          options.getCurrentGeneration(),
        )
      ) {
        return;
      }
      options.onFailed(toInsightAnalysisError(cause));
    }
  });
}

export function toInsightAnalysisError(cause: unknown): InsightAnalysisError {
  const detail =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : "structure-insight-analysis-failed";
  return {
    code: "analysis-failed",
    detail,
  };
}
