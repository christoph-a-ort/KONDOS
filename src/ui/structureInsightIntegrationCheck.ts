/**
 * P2-J-J.2 – Integration checks for scan-failure insight restore,
 * insight→tree reveal under Anzeigefilter, and pending-reveal commit policy.
 *
 * Synthetic fixtures only. No filesystem. No React mount.
 */

import type { DirectoryNode, FileNode, FsNode } from "../model";
import { buildDisplayFilterView } from "./displayFilter";
import {
  INSIGHT_TREE_HIDDEN_BY_FILTER_NOTICE,
  canCommitPendingTreeReveal,
  captureInsightAnalysisUiSnapshot,
  resolveInsightTreeReveal,
  shouldRestorePreviousScanAndInsightsOnError,
  type InsightAnalysisUiSnapshot,
} from "./structureInsightIntegration";
import type { InsightCardModel, StructureInsightViewModel } from "./structureInsightViewModel";
import { STRUCTURE_INSIGHT_VIEW_MODEL_SCHEMA_VERSION } from "./structureInsightViewModel";
import { DEFAULT_TREE_SORT } from "./treeSort";
import { WARNING_HIDDEN_BY_FILTER_NOTICE } from "./warningNavigation";

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(label);
  }
}

function file(id: string, name: string, depth = 2): FileNode {
  return { id, name, path: id, depth, kind: "file" };
}

function dir(id: string, name: string, depth: number, children: FsNode[]): DirectoryNode {
  return { id, name, path: id, depth, kind: "directory", listing: "read", children };
}

function stubVm(): StructureInsightViewModel {
  const card: InsightCardModel = {
    id: "i1",
    locationId: "root/A",
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
  return {
    schemaVersion: STRUCTURE_INSIGHT_VIEW_MODEL_SCHEMA_VERSION,
    locations: [
      {
        locationId: "root/A",
        kind: "folder",
        insightIds: ["i1"],
        displayPathSegments: [{ nodeId: "root/A", displayName: "A" }],
      },
    ],
    insights: [card],
    countsByEvidence: { high: 1, medium: 0, low: 0, unassessed: 0, total: 1 },
    countsByCategory: {
      "file-names": 1,
      "folder-structure": 0,
      "time-years": 0,
      "file-distribution": 0,
    },
    globallyIncomplete: false,
  };
}

export function runStructureInsightIntegrationCheck(): void {
  // A – rejected begin keeps previous scan + insights; hard failures clear.
  assert(
    shouldRestorePreviousScanAndInsightsOnError({ kind: "invalidPath", message: "x" }),
    "invalidPath restores previous insights",
  );
  assert(
    shouldRestorePreviousScanAndInsightsOnError({ kind: "invalidConfig", message: "x" }),
    "invalidConfig restores previous insights",
  );
  assert(
    !shouldRestorePreviousScanAndInsightsOnError({ kind: "cancelled", message: "x" }),
    "cancelled does not restore previous insights",
  );
  assert(
    !shouldRestorePreviousScanAndInsightsOnError({ kind: "rootInaccessible", message: "x" }),
    "rootInaccessible does not restore previous insights",
  );

  const readySnapshot: InsightAnalysisUiSnapshot = {
    phase: "ready",
    viewModel: stubVm(),
    error: null,
    analysisScanId: 7,
    mainView: "insights",
  };
  const captured = captureInsightAnalysisUiSnapshot(readySnapshot);
  assert(captured.phase === "ready", "snapshot phase");
  assert(captured.viewModel?.insights.length === 1, "snapshot viewModel");
  assert(captured.analysisScanId === 7, "snapshot analysisScanId");
  assert(captured.mainView === "insights", "snapshot mainView");
  // Immutability of capture (shallow copy of fields)
  assert(captured !== readySnapshot, "snapshot is a new object");
  assert(captured.viewModel === readySnapshot.viewModel, "snapshot keeps viewModel ref");

  // B – insight reveal vs Anzeigefilter
  const tree = dir("root", "Root", 0, [
    dir("root/A", "A", 1, [
      file("root/A/doc.pdf", "doc.pdf", 2),
      file("root/A/note.txt", "note.txt", 2),
    ]),
  ]);
  const visible = resolveInsightTreeReveal(tree, tree, "root/A/note.txt");
  assert(visible.kind === "reveal", "unfiltered: reveal");
  assert(visible.applyReveal && !visible.offerFilterReset, "unfiltered: apply, no reset offer");

  const pdfOnly = buildDisplayFilterView(
    tree,
    { extensions: [".pdf"], modifiedFrom: "", modifiedUntil: "" },
    DEFAULT_TREE_SORT,
  );
  const hidden = resolveInsightTreeReveal(tree, pdfOnly.tree, "root/A/note.txt");
  assert(hidden.kind === "hidden-by-filter", "filtered: hidden-by-filter");
  assert(!hidden.applyReveal, "filtered: do not apply reveal");
  assert(hidden.offerFilterReset, "filtered: offer filter reset");
  assert(hidden.notice === INSIGHT_TREE_HIDDEN_BY_FILTER_NOTICE, "filtered: notice");
  assert(hidden.notice === WARNING_HIDDEN_BY_FILTER_NOTICE, "filtered: same wording as warnings");
  assert(hidden.nodeId === "root/A/note.txt", "filtered: remember target id");
  // Filter itself must not be mutated by the plan helper
  assert(pdfOnly.fileMatchCount === 1, "filtered: display filter unchanged by resolve");

  const missing = resolveInsightTreeReveal(tree, tree, "root/missing");
  assert(missing.kind === "missing", "missing node");
  assert(!missing.applyReveal && !missing.offerFilterReset, "missing: no reveal/reset");

  // After filter cleared, same target becomes revealable again
  const afterReset = resolveInsightTreeReveal(tree, tree, "root/A/note.txt");
  assert(afterReset.kind === "reveal" && afterReset.applyReveal, "after filter reset: reveal");

  // C – pending reveal commit policy
  assert(
    !canCommitPendingTreeReveal({ pendingNodeId: "a", rowIndex: 3, viewportClientHeight: 0 }),
    "pending: hold while viewport height 0",
  );
  assert(
    !canCommitPendingTreeReveal({ pendingNodeId: "a", rowIndex: -1, viewportClientHeight: 400 }),
    "pending: hold while row not in rows",
  );
  assert(
    !canCommitPendingTreeReveal({ pendingNodeId: null, rowIndex: 3, viewportClientHeight: 400 }),
    "pending: nothing to commit",
  );
  assert(
    canCommitPendingTreeReveal({ pendingNodeId: "a", rowIndex: 3, viewportClientHeight: 400 }),
    "pending: commit when measurable and row present",
  );
}
