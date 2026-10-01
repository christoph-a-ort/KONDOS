/**
 * P2-J-B structure insight analysis checks — synthetic fixtures only.
 * No private real paths. No filesystem mutations. No UI.
 */

import { type DirectoryNode, type FileNode, type FsNode, type ScanResult } from "../model";
import {
  analyzeStructureInsights,
  scheduleStructureInsightAnalysis,
  shouldAcceptInsightAnalysisResult,
  toInsightAnalysisError,
  type InsightAnalysisError,
  type InsightAnalysisPhase,
  type StructureInsightAnalysisDependencies,
} from "./structureInsightAnalysis";
import { buildStructureConfidenceInsight } from "./structureConfidenceAssessment";
import {
  STRUCTURE_INSIGHT_VIEW_MODEL_SCHEMA_VERSION,
  buildStructureInsightViewModel,
  type StructureInsightViewModel,
} from "./structureInsightViewModel";
import { buildStructureRuleCandidateInsight } from "./structureRuleCandidate";

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(label);
  }
}

function file(id: string, name: string, depth: number): FileNode {
  return { id, name, path: id, depth, kind: "file" };
}

function dir(id: string, name: string, depth: number, children: FsNode[] = []): DirectoryNode {
  return { id, name, path: id, depth, kind: "directory", listing: "read", children };
}

function resultOf(root: DirectoryNode): ScanResult {
  return {
    root,
    warnings: [],
    stats: { directoryCount: 0, fileCount: 0, skippedCount: 0, durationMs: 0 },
  };
}

function peerFolder(id: string, name: string, childNames: readonly string[]): DirectoryNode {
  return dir(
    id,
    name,
    1,
    childNames.map((childName) => dir(`${id}/${childName}`, childName, 2)),
  );
}

function filesFolder(id: string, name: string, fileNames: readonly string[]): DirectoryNode {
  return dir(
    id,
    name,
    1,
    fileNames.map((fileName, index) => file(`${id}/f${index}`, fileName, 2)),
  );
}

export function runStructureInsightAnalysisCheck(): void {
  // Guard helpers
  assert(shouldAcceptInsightAnalysisResult(3, 3, 7, 7) === true, "accept current");
  assert(shouldAcceptInsightAnalysisResult(3, 4, 7, 7) === false, "reject other scan");
  assert(shouldAcceptInsightAnalysisResult(3, null, 7, 7) === false, "reject null scan");
  assert(shouldAcceptInsightAnalysisResult(3, 3, 7, 8) === false, "reject other generation");
  assert(toInsightAnalysisError(new Error("boom")).code === "analysis-failed", "error code");
  assert(toInsightAnalysisError(new Error("boom")).detail === "boom", "error detail");

  // 1–3 Successful path + zero insights + view model shape
  const tiny = resultOf(dir("X:/Tiny", "Tiny", 0, [file("X:/Tiny/a.txt", "a.txt", 1)]));
  const tinySnap = JSON.stringify(tiny);
  const zeroVm = analyzeStructureInsights(tiny);
  assert(zeroVm.schemaVersion === STRUCTURE_INSIGHT_VIEW_MODEL_SCHEMA_VERSION, "vm schema");
  assert(Array.isArray(zeroVm.insights), "vm insights array");
  assert(zeroVm.insights.length === 0, "zero insights ready-output");
  assert(zeroVm.countsByEvidence.total === 0, "zero total");
  assert(JSON.stringify(tiny) === tinySnap, "tiny immutable");

  // Deterministic pipeline
  const again = analyzeStructureInsights(tiny);
  assert(JSON.stringify(zeroVm) === JSON.stringify(again), "determinism");

  // Productive builders used (integration over a pattern-rich synthetic tree)
  const rich = resultOf(
    dir("X:/Root", "Root", 0, [
      filesFolder("X:/Root/Alpha", "Alpha", [
        "20111124_gasag_jahresrechnung.pdf",
        "20121122_gasag_jahresrechnung.pdf",
        "20131120_gasag_jahresrechnung.pdf",
        "20141125_gasag_jahresrechnung.pdf",
      ]),
      peerFolder("X:/Root/2021", "2021", []),
      peerFolder("X:/Root/2022", "2022", []),
      peerFolder("X:/Root/2023", "2023", []),
      peerFolder("X:/Root/PeerA", "PeerA", ["Rechnungen"]),
      peerFolder("X:/Root/PeerB", "PeerB", ["Rechnungen"]),
      peerFolder("X:/Root/PeerC", "PeerC", ["Rechnungen"]),
    ]),
  );
  const richSnap = JSON.stringify(rich);
  const candidates = buildStructureRuleCandidateInsight(rich);
  const candidatesSnap = JSON.stringify(candidates);
  const assessed = buildStructureConfidenceInsight(candidates);
  const assessedSnap = JSON.stringify(assessed);
  const viaPublic = analyzeStructureInsights(rich);
  const manual = buildStructureInsightViewModel(rich, assessed.insight.ruleCandidates);
  assert(JSON.stringify(viaPublic) === JSON.stringify(manual), "pipeline equals manual H→I→J");
  assert(JSON.stringify(rich) === richSnap, "rich immutable");
  assert(JSON.stringify(candidates) === candidatesSnap, "candidates immutable");
  assert(JSON.stringify(assessed) === assessedSnap, "assessed immutable");

  // 4 Partial/incomplete remains successful output (inject view model builder)
  const partialDeps: StructureInsightAnalysisDependencies = {
    buildViewModel: () => ({
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
      globallyIncomplete: true,
    }),
  };
  const partialVm = analyzeStructureInsights(tiny, partialDeps);
  assert(partialVm.globallyIncomplete === true, "partial flag");

  // 5–6 Analysis failure does not mutate scan; failed ≠ scan failure
  const scanForFail = resultOf(dir("X:/Fail", "Fail", 0, [file("X:/Fail/a.txt", "a.txt", 1)]));
  const failSnap = JSON.stringify(scanForFail);
  let threw = false;
  try {
    analyzeStructureInsights(scanForFail, {
      buildRuleCandidates: () => {
        throw new Error("injected-h-failure");
      },
    });
  } catch (cause) {
    threw = true;
    assert(cause instanceof Error && cause.message === "injected-h-failure", "injected throw");
  }
  assert(threw, "must throw");
  assert(JSON.stringify(scanForFail) === failSnap, "scan survives analysis throw");

  // 7–8 Retry uses same ScanResult — same analyze entry, no startScan
  const retryVm = analyzeStructureInsights(tiny);
  assert(JSON.stringify(retryVm) === JSON.stringify(zeroVm), "retry same scan same output");

  // 9 Stale result discarded (deterministic deferred, no wall-clock wait)
  let currentScanId: number | null = 1;
  let currentGeneration = 10;
  let readyCount = 0;
  let failedCount = 0;
  let readyVm: StructureInsightViewModel | null = null;
  let failedErr: InsightAnalysisError | null = null;

  {
    const tasks: Array<() => void> = [];
    scheduleStructureInsightAnalysis({
      scanResult: tiny,
      scanId: 1,
      generation: 10,
      getCurrentScanId: () => currentScanId,
      getCurrentGeneration: () => currentGeneration,
      onReady: (viewModel) => {
        readyCount += 1;
        readyVm = viewModel;
      },
      onFailed: (error) => {
        failedCount += 1;
        failedErr = error;
      },
      schedule: (task) => {
        tasks.push(task);
      },
      analyze: () => zeroVm,
    });
    assert(tasks.length === 1, "task scheduled");
    currentScanId = 2;
    currentGeneration = 11;
    tasks[0]!();
    assert(readyCount === 0, "stale ready discarded");
    assert(failedCount === 0, "stale failed discarded");
    assert(readyVm === null && failedErr === null, "no stale apply");
  }

  // Fresh accept path
  readyCount = 0;
  failedCount = 0;
  readyVm = null;
  failedErr = null;
  currentScanId = 5;
  currentGeneration = 20;
  {
    const tasks: Array<() => void> = [];
    scheduleStructureInsightAnalysis({
      scanResult: tiny,
      scanId: 5,
      generation: 20,
      getCurrentScanId: () => currentScanId,
      getCurrentGeneration: () => currentGeneration,
      onReady: (viewModel) => {
        readyCount += 1;
        readyVm = viewModel;
      },
      onFailed: (error) => {
        failedCount += 1;
        failedErr = error;
      },
      schedule: (task) => {
        tasks.push(task);
      },
      analyze: () => zeroVm,
    });
    assert(tasks.length === 1, "fresh task scheduled");
    tasks[0]!();
    assert(readyCount === 1, "fresh ready accepted");
    assert(readyVm !== null, "fresh vm set");
  }

  // Stale after compute but before onReady
  readyCount = 0;
  readyVm = null;
  failedCount = 0;
  {
    const tasks: Array<() => void> = [];
    let analyzeCalls = 0;
    scheduleStructureInsightAnalysis({
      scanResult: tiny,
      scanId: 8,
      generation: 30,
      getCurrentScanId: () => currentScanId,
      getCurrentGeneration: () => currentGeneration,
      onReady: (viewModel) => {
        readyCount += 1;
        readyVm = viewModel;
      },
      onFailed: () => {
        failedCount += 1;
      },
      schedule: (task) => {
        tasks.push(task);
      },
      analyze: () => {
        analyzeCalls += 1;
        currentScanId = 9;
        currentGeneration = 31;
        return zeroVm;
      },
    });
    currentScanId = 8;
    currentGeneration = 30;
    assert(tasks.length === 1, "post-compute task scheduled");
    tasks[0]!();
    assert(analyzeCalls === 1, "analyze ran");
    assert(readyCount === 0, "post-compute stale discarded");
  }

  // Scheduled failure path
  failedCount = 0;
  failedErr = null;
  readyCount = 0;
  currentScanId = 12;
  currentGeneration = 40;
  {
    const tasks: Array<() => void> = [];
    scheduleStructureInsightAnalysis({
      scanResult: tiny,
      scanId: 12,
      generation: 40,
      getCurrentScanId: () => currentScanId,
      getCurrentGeneration: () => currentGeneration,
      onReady: () => {
        readyCount += 1;
      },
      onFailed: (error) => {
        failedCount += 1;
        failedErr = error;
      },
      schedule: (task) => {
        tasks.push(task);
      },
      analyze: () => {
        throw new Error("scheduled-fail");
      },
    });
    assert(tasks.length === 1, "fail task scheduled");
    tasks[0]!();
    assert(failedCount === 1, "failed accepted");
    assert(failedErr !== null, "failed present");
    assert(failedErr!.code === "analysis-failed", "failed code");
    assert(failedErr!.detail === "scheduled-fail", "failed detail");
  }

  // 10 New scan generation model
  assert(shouldAcceptInsightAnalysisResult(1, 1, 1, 2) === false, "new scan bumps generation");

  // 11 Race: Ref still null (pre-render) while expected scanId is N — WITHOUT sync discard
  {
    let mirroredScanIdRef: number | null = null;
    let analyzeCalls = 0;
    readyCount = 0;
    failedCount = 0;
    const tasks: Array<() => void> = [];
    scheduleStructureInsightAnalysis({
      scanResult: tiny,
      scanId: 70,
      generation: 70,
      getCurrentScanId: () => mirroredScanIdRef,
      getCurrentGeneration: () => 70,
      onReady: () => {
        readyCount += 1;
      },
      onFailed: () => {
        failedCount += 1;
      },
      schedule: (task) => {
        tasks.push(task);
      },
      analyze: () => {
        analyzeCalls += 1;
        return zeroVm;
      },
    });
    // Simulate App bug window: setState(scanId) queued, Ref not yet updated, task runs now.
    assert(mirroredScanIdRef === null, "race start: ref still null");
    tasks[0]!();
    assert(analyzeCalls === 0, "race without sync: analyze not run");
    assert(readyCount === 0 && failedCount === 0, "race without sync: silent discard");
  }

  // 12 Race fix contract: sync Ref to N before schedule → ready without React render
  {
    let mirroredScanIdRef: number | null = null;
    let analyzeCalls = 0;
    const phaseBox: { value: InsightAnalysisPhase } = { value: "idle" };
    readyCount = 0;
    failedCount = 0;
    const tasks: Array<() => void> = [];
    const newScanId = 71;
    const generation = 71;

    // App contract: assignResultScanId(N) before beginInsightAnalysisForScan
    mirroredScanIdRef = newScanId;
    phaseBox.value = "running";
    scheduleStructureInsightAnalysis({
      scanResult: tiny,
      scanId: newScanId,
      generation,
      getCurrentScanId: () => mirroredScanIdRef,
      getCurrentGeneration: () => generation,
      onReady: () => {
        readyCount += 1;
        phaseBox.value = "ready";
      },
      onFailed: () => {
        failedCount += 1;
        phaseBox.value = "failed";
      },
      schedule: (task) => {
        tasks.push(task);
      },
      analyze: () => {
        analyzeCalls += 1;
        return zeroVm;
      },
    });
    assert(mirroredScanIdRef === newScanId, "fix: ref already N before task");
    tasks[0]!();
    assert(analyzeCalls === 1, "fix: analyze runs without React render");
    assert(readyCount === 1, "fix: onReady reached");
    assert(failedCount === 0, "fix: no failed");
    assert(String(phaseBox.value) === "ready", "fix: lifecycle reaches ready");
  }

  // 13 Reset: Ref invalidated to null → previous scanId no longer accepted
  {
    let mirroredScanIdRef: number | null = 5;
    readyCount = 0;
    failedCount = 0;
    const tasks: Array<() => void> = [];
    scheduleStructureInsightAnalysis({
      scanResult: tiny,
      scanId: 5,
      generation: 80,
      getCurrentScanId: () => mirroredScanIdRef,
      getCurrentGeneration: () => 80,
      onReady: () => {
        readyCount += 1;
      },
      onFailed: () => {
        failedCount += 1;
      },
      schedule: (task) => {
        tasks.push(task);
      },
      analyze: () => zeroVm,
    });
    // New scan start: invalidate Ref synchronously (assignResultScanId(null))
    mirroredScanIdRef = null;
    tasks[0]!();
    assert(readyCount === 0 && failedCount === 0, "reset invalidates prior scheduled run");
  }

  // 14 Restore: Ref restored to previousScanId; no auto analysis started here
  {
    let mirroredScanIdRef: number | null = null;
    const previousScanId = 3;
    // Error path restore contract (assignResultScanId(previousScanId))
    mirroredScanIdRef = previousScanId;
    assert(mirroredScanIdRef === previousScanId, "restore: ref matches previousScanId");
    assert(
      shouldAcceptInsightAnalysisResult(previousScanId, mirroredScanIdRef, 1, 1) === true,
      "restore: guard accepts restored id",
    );
    // No scheduleStructureInsightAnalysis call on restore — contract preserved
  }

  // Public builders present
  assert(typeof buildStructureRuleCandidateInsight === "function", "H export");
  assert(typeof buildStructureConfidenceInsight === "function", "I export");
  assert(typeof buildStructureInsightViewModel === "function", "J-A export");
}
