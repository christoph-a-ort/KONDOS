/**
 * P2-K.3a virtual SOLL preview checks — synthetic fixtures only.
 * No private paths. No filesystem mutations. No UI mounting.
 */

import type { DirectoryNode, FileNode, ScanConfig, ScanResult } from "../model";
import {
  STRUCTURE_INSIGHT_VIEW_MODEL_SCHEMA_VERSION,
  type StructureInsightViewModel,
} from "./structureInsightViewModel";
import {
  VIRTUAL_PLAN_SCHEMA_VERSION,
  makeSnapshotBinding,
  type VirtualPlan,
} from "./virtualPlan";
import {
  assessDraftConflict,
  buildVirtualSollPreview,
  looksLikeTechnicalFeatureKey,
  mayPersistPreviewDraft,
  planIdForBinding,
  projectionHasStructuralChangeIntent,
  relativeVirtualPath,
  reviewFeatureLabel,
  reviewReasonLabel,
} from "./virtualPlanPreview";

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(label);
  }
}

const config: ScanConfig = {
  rootPath: "C:\\Fixture",
  maxDepth: 10,
  excludeHidden: true,
  extensions: [],
  includeSize: true,
  includeCreatedAt: false,
  includeModifiedAt: true,
};

function file(id: string, name: string, depth: number): FileNode {
  return { id, path: id, name, depth, kind: "file", sizeBytes: 1, modifiedAtMs: 1 };
}

function dir(
  id: string,
  name: string,
  depth: number,
  children: Array<DirectoryNode | FileNode>,
  listing: DirectoryNode["listing"] = "read",
): DirectoryNode {
  return { id, path: id, name, depth, kind: "directory", listing, children };
}

function fixture(): ScanResult {
  const root = dir("C:\\Fixture", "Fixture", 0, [
    dir("C:\\Fixture\\A", "A", 1, [
      file("C:\\Fixture\\A\\1.txt", "1.txt", 2),
      file("C:\\Fixture\\A\\2.txt", "2.txt", 2),
    ]),
    dir("C:\\Fixture\\B", "B", 1, [file("C:\\Fixture\\B\\1.txt", "1.txt", 2)]),
  ]);
  return {
    root,
    warnings: [],
    stats: { directoryCount: 3, fileCount: 3, skippedCount: 0, durationMs: 1 },
  };
}

function emptyViewModel(
  overrides: Partial<StructureInsightViewModel> = {},
): StructureInsightViewModel {
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

export function runVirtualPlanPreviewCheck(): void {
  const result = fixture();
  const preview = buildVirtualSollPreview({
    scanResult: result,
    scanConfig: config,
    sourceScanId: 11,
  });

  assert(preview.nodes.length === preview.observedNodeCount, "count matches");
  assert(preview.observedNodeCount === 6, "fixture node count");
  assert(!projectionHasStructuralChangeIntent(preview), "no structural intent");
  assert(Array.isArray(preview.proposals), "proposals array present");
  assert(Array.isArray(preview.proposalUsefulness), "usefulness array present");
  assert(
    preview.proposalUsefulness.length === preview.proposals.length,
    "every proposal has an assessment",
  );
  assert(preview.proposals.length === 0, "plain fixture has no proposals");
  assert(
    preview.proposals.every((proposal) => proposal.adopted === false),
    "proposals never adopted",
  );
  assert(
    preview.nodes.every((node) => node.changeKind === "unchanged"),
    "all unchanged",
  );
  assert(preview.flags.identityLimited, "identity limited");
  assert(
    !preview.reviewCases.some((c) => c.id === "case_identity_scan_local"),
    "identity is status flag not list spam",
  );
  assert(
    reviewReasonLabel("identityUnavailable").includes("Scan"),
    "identity reason German",
  );
  assert(
    reviewReasonLabel("similarStructure").includes("Ähnliche"),
    "similar reason German",
  );
  assert(
    !looksLikeTechnicalFeatureKey(reviewFeatureLabel("identityStatus.scanLocalOnly")),
    "feature label not technical",
  );
  assert(
    reviewFeatureLabel("evidence:medium").includes("Mittel"),
    "evidence medium German",
  );

  const again = buildVirtualSollPreview({
    scanResult: result,
    scanConfig: config,
    sourceScanId: 11,
  });
  assert(JSON.stringify(preview) === JSON.stringify(again), "deterministic");

  const incomplete = buildVirtualSollPreview({
    scanResult: result,
    scanConfig: { ...config, extensions: [".txt"] },
    sourceScanId: 12,
  });
  assert(incomplete.flags.incomplete, "filtered incomplete");
  assert(
    !incomplete.reviewCases.some((c) => c.id === "case_incomplete_snapshot"),
    "incomplete is status flag not list spam",
  );
  assert(!mayPersistPreviewDraft(assessDraftConflict(incomplete.binding, null, false), true), "no persist incomplete");

  const withInsight = buildVirtualSollPreview({
    scanResult: result,
    scanConfig: config,
    sourceScanId: 11,
    insightViewModel: emptyViewModel({
      insights: [
        {
          id: "ins-1",
          locationId: "C:\\Fixture\\A",
          principle: "recurring-child-folder-name",
          category: "folder-structure",
          categoryLabel: "Ordnerstruktur",
          title: "Wiederkehrende Ordnernamen",
          factLine: "Zwei Geschwisterordner teilen Namensmuster.",
          evidenceLevel: "medium",
          evidenceLabel: "Mittel",
          incompleteData: false,
          explanationBullets: [],
          structureSummary: { plainDescription: "", examples: [] },
          primaryElements: [],
          secondaryRecurringGroups: [],
          otherElements: [],
          searchText: "",
        },
      ],
      countsByEvidence: { high: 0, medium: 1, low: 0, unassessed: 0, total: 1 },
    }),
  });
  assert(withInsight.hints.length === 1, "one structure hint");
  assert(withInsight.hints[0]!.kind === "structureHint", "hint kind");
  assert(
    withInsight.hints[0]!.rationale === "Zwei Geschwisterordner teilen Namensmuster.",
    "hint fact once",
  );
  assert(
    !withInsight.hints[0]!.evidenceBasis.includes(withInsight.hints[0]!.rationale),
    "evidence does not repeat fact",
  );
  assert(
    withInsight.hints[0]!.evidenceBasis.includes("Evidenzstärke: Mittel"),
    "evidence strength shown when assessed",
  );
  assert(
    withInsight.reviewCases.length === 0,
    "recurring pattern is hint only — zero review cases",
  );
  assert(
    !withInsight.reviewCases.some((c) => c.reason === "similarStructure"),
    "no auto merge review from recurring",
  );
  assert(
    !JSON.stringify(withInsight.reviewCases).toLowerCase().includes("zusammengeführt"),
    "no merge suggestion wording",
  );
  const nodeA = withInsight.nodes.find((n) => n.nodeId === "C:\\Fixture\\A");
  assert(nodeA !== undefined && nodeA.hintIds.length === 1, "hint attached");
  assert(nodeA!.suggestionKind === "structureHint", "node marked as hint");
  assert(nodeA!.changeKind === "unchanged", "hint does not change path");

  // Incomplete observation → one concrete review case; hint still present.
  const withIncomplete = buildVirtualSollPreview({
    scanResult: result,
    scanConfig: config,
    sourceScanId: 11,
    insightViewModel: emptyViewModel({
      insights: [
        {
          id: "ins-incomplete",
          locationId: "C:\\Fixture\\A",
          principle: "recurring-file-name-form",
          category: "file-names",
          categoryLabel: "Dateinamen",
          title: "Wiederkehrendes Dateinamenmuster",
          factLine: "9 von 10 Dateien folgen demselben Namensmuster.",
          evidenceLevel: "high",
          evidenceLabel: "Hoch",
          incompleteData: true,
          explanationBullets: [],
          structureSummary: { plainDescription: "", examples: [] },
          primaryElements: [],
          secondaryRecurringGroups: [],
          otherElements: [],
          searchText: "",
        },
      ],
      countsByEvidence: { high: 1, medium: 0, low: 0, unassessed: 0, total: 1 },
    }),
  });
  assert(withIncomplete.hints.length === 1, "incomplete still has hint");
  assert(withIncomplete.reviewCases.length === 1, "incomplete yields one review case");
  assert(
    withIncomplete.reviewCases[0]!.rationale.includes("Unklar"),
    "incomplete names uncertainty",
  );
  assert(
    !withIncomplete.reviewCases[0]!.rationale.toLowerCase().includes("zusammengeführt"),
    "incomplete no merge wording",
  );

  // Unassessed evidence: no evidence-strength line in hint basis.
  const withUnassessed = buildVirtualSollPreview({
    scanResult: result,
    scanConfig: config,
    sourceScanId: 11,
    insightViewModel: emptyViewModel({
      insights: [
        {
          id: "ins-u",
          locationId: "C:\\Fixture\\B",
          principle: "recurring-year",
          category: "time-years",
          categoryLabel: "Zeit/Jahre",
          title: "Wiederkehrende Jahresgliederung",
          factLine: "Mehrere Ordner tragen Jahreszahlen.",
          evidenceLevel: "unassessed",
          evidenceLabel: "Noch nicht bewertet",
          incompleteData: false,
          explanationBullets: [],
          structureSummary: { plainDescription: "", examples: [] },
          primaryElements: [],
          secondaryRecurringGroups: [],
          otherElements: [],
          searchText: "",
        },
      ],
      countsByEvidence: { high: 0, medium: 0, low: 0, unassessed: 1, total: 1 },
    }),
  });
  assert(withUnassessed.hints.length === 1, "unassessed hint kept");
  assert(withUnassessed.reviewCases.length === 0, "unassessed no review case");
  assert(
    !withUnassessed.hints[0]!.evidenceBasis.includes("Evidenzstärke"),
    "unassessed hides strength line",
  );

  const binding = makeSnapshotBinding(result, config, 11);
  const plan: VirtualPlan = {
    schemaVersion: VIRTUAL_PLAN_SCHEMA_VERSION,
    planId: planIdForBinding(binding),
    builderVersion: 1,
    revision: 1,
    status: "draft",
    scope: { kind: "scanRoot", rootNodeId: result.root.id },
    binding,
    items: [],
    openCases: [{ id: "kept", reason: "ambiguous" }],
    decisions: [],
    preferences: [],
  };
  const withDraft = buildVirtualSollPreview({
    scanResult: result,
    scanConfig: config,
    sourceScanId: 11,
    existingDraft: plan,
  });
  assert(withDraft.flags.draftPresent, "draft present");
  assert(!withDraft.flags.draftStale, "draft fresh");
  assert(
    withDraft.reviewCases.some((c) => c.id === "case_draft_kept"),
    "draft open case carried",
  );

  const staleDraft: VirtualPlan = {
    ...plan,
    binding: { ...binding, snapshotFingerprint: "vp1-deadbeef" },
  };
  const stalePreview = buildVirtualSollPreview({
    scanResult: result,
    scanConfig: config,
    sourceScanId: 11,
    existingDraft: staleDraft,
  });
  assert(stalePreview.flags.draftStale, "stale fingerprint");
  assert(
    !stalePreview.reviewCases.some((c) => c.id === "case_draft_kept"),
    "stale draft cases not applied as structure",
  );
  assert(
    assessDraftConflict(binding, staleDraft, false).kind === "stale",
    "conflict stale",
  );

  const blockedPreview = buildVirtualSollPreview({
    scanResult: result,
    scanConfig: config,
    sourceScanId: 11,
    draftBlocked: true,
  });
  assert(blockedPreview.flags.draftBlocked, "blocked draft flag");

  assert(relativeVirtualPath("C:\\Fixture", "C:\\Fixture\\A\\1.txt") === "a/1.txt", "relative");
  assert(planIdForBinding(binding).startsWith("vp_"), "plan id");

  // Large-ish synthetic tree: projection length equals walk; no drops.
  const manyChildren = Array.from({ length: 40 }, (_, index) =>
    file(`C:\\Fixture\\bulk\\f${index}.txt`, `f${index}.txt`, 2),
  );
  const large: ScanResult = {
    root: dir("C:\\Fixture", "Fixture", 0, [
      dir("C:\\Fixture\\bulk", "bulk", 1, manyChildren),
    ]),
    warnings: [],
    stats: { directoryCount: 2, fileCount: 40, skippedCount: 0, durationMs: 1 },
  };
  const largePreview = buildVirtualSollPreview({
    scanResult: large,
    scanConfig: config,
    sourceScanId: 99,
  });
  assert(largePreview.nodes.length === 42, "large tree complete");
  assert(!projectionHasStructuralChangeIntent(largePreview), "large no changes");
  assert(
    largePreview.nodes.every((node) => node.changeKind === "unchanged"),
    "large soll unchanged with proposals field",
  );
  assert(
    largePreview.proposals.every((proposal) => proposal.adopted === false),
    "large proposals not adopted into soll",
  );
}
