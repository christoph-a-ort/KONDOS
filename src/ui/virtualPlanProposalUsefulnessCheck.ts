/**
 * P2-K.3c usefulness checks — synthetic proposals only, no filesystem access.
 */

import type { VirtualReorgProposal, VirtualPreviewEntry } from "./virtualPlanSuggestions";
import {
  assessVirtualProposalUsefulness,
  VIRTUAL_PLAN_TARGET_DEPTH_SOFT_LIMIT,
} from "./virtualPlanProposalUsefulness";

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(label);
  }
}

function fileEntry(id: string): VirtualPreviewEntry {
  return { entryId: id, name: `${id}.pdf`, kind: "file", role: "regrouped" };
}

function proposal(options: {
  sourceCount: number;
  groupSizes: number[];
  unchangedCount: number;
  overlapIds?: string[];
  complete?: boolean;
}): VirtualReorgProposal {
  const groups = options.groupSizes.map((size, groupIndex) => ({
    entryId: `virtual:group-${groupIndex}`,
    name: `Gruppe ${groupIndex + 1}`,
    kind: "virtualDirectory" as const,
    role: "virtualGroup" as const,
    children: Array.from({ length: size }, (_, fileIndex) =>
      fileEntry(`file-${groupIndex}-${fileIndex}`),
    ),
  }));
  const unchanged = Array.from({ length: options.unchangedCount }, (_, index) => ({
    entryId: `unchanged-${index}`,
    name: `Unverändert ${index + 1}`,
    kind: "file" as const,
    role: "unchanged" as const,
  }));
  const regroupedCount = options.groupSizes.reduce((total, size) => total + size, 0);

  return {
    id: "proposal-fixture",
    category: "virtualFolderGroup",
    categoryLabel: "Neuer virtueller Unterordner",
    actionKind: "createVirtualSubfolder",
    actionLabel: "Neuen virtuellen Unterordner anlegen",
    title: "Fixture",
    sourceFolderNodeId: "folder-fixture",
    sourceFolderDisplayPath: "Fixture",
    affectedFileNodeIds: Array.from({ length: regroupedCount }, (_, index) => `file-${index}`),
    affectedFileNames: [],
    unchangedObjectIds: unchanged.map((entry) => entry.entryId),
    unchangedObjectNames: [],
    completeness: {
      sourceObjectCount: options.sourceCount,
      regroupedObjectCount: regroupedCount,
      unchangedObjectCount: options.unchangedCount,
      previewLeafCount: options.sourceCount,
      complete: options.complete ?? true,
      hasDuplicates: false,
      lossDetected: false,
    },
    virtualTarget: {
      lines: ["Fixture"],
      tree: {
        entryId: "folder-fixture",
        name: "Fixture",
        kind: "directory",
        role: "sourceFolder",
        children: [...groups, ...unchanged],
      },
    },
    observedFeatures: [],
    rationale: "Fixture",
    uncertainties: [],
    adopted: false,
    sourceInsightIds: [],
    overlapGroupKey: "folder:fixture:prefix",
    overlapsWithProposalIds: options.overlapIds ?? [],
  };
}

function assess(
  proposalInput: VirtualReorgProposal,
  options: { incomplete?: boolean; depth?: number } = {},
) {
  return assessVirtualProposalUsefulness({
    proposal: proposalInput,
    binding: { incomplete: options.incomplete ?? false },
    sourceFolderDepth: options.depth ?? 1,
  });
}

export function runVirtualPlanProposalUsefulnessCheck(): void {
  // Gasag: nine new year folders with one file each and one remaining file.
  const gasag = assess(proposal({ sourceCount: 10, groupSizes: [1, 1, 1, 1, 1, 1, 1, 1, 1], unchangedCount: 1 }));
  assert(gasag.category === "likelyNotHelpful", "gasag nine singleton folders");
  assert(gasag.metrics.singleFileVirtualFolderCount === 9, "gasag singleton count");
  assert(gasag.metrics.directObjectReduction === 0, "gasag no direct reduction");
  assert(gasag.expectedDrawbacks.some((item) => item.includes("eine Datei")), "gasag drawback");

  // Three files in a single new folder: no automatic positive result.
  const small = assess(proposal({ sourceCount: 3, groupSizes: [3], unchangedCount: 0 }));
  assert(small.category === "unclear", "three files one folder unclear");

  // 100 files in five sizeable folders can be structurally useful.
  const large = assess(proposal({ sourceCount: 100, groupSizes: [20, 20, 20, 20, 20], unchangedCount: 0 }));
  assert(large.category === "likelyHelpful", "100 files five groups helpful");
  assert(large.metrics.directObjectReduction === 95, "large direct reduction");

  // Three grouped out of 20: the unchanged rest prevents a positive category.
  const partial = assess(proposal({ sourceCount: 20, groupSizes: [3], unchangedCount: 17 }));
  assert(partial.category === "unclear", "partial grouping unclear");
  assert(partial.expectedDrawbacks.some((item) => item.includes("17 Objekte")), "partial rest noted");

  const deep = assess(proposal({ sourceCount: 10, groupSizes: [10], unchangedCount: 0 }), {
    depth: VIRTUAL_PLAN_TARGET_DEPTH_SOFT_LIMIT - 1,
  });
  assert(
    deep.expectedDrawbacks.some((item) => item.includes("Richtwert")),
    "high depth downside",
  );

  const incomplete = assess(proposal({ sourceCount: 10, groupSizes: [10], unchangedCount: 0 }), {
    incomplete: true,
  });
  assert(incomplete.category === "notAssessable", "incomplete not assessable");

  const overlapping = assess(
    proposal({ sourceCount: 10, groupSizes: [10], unchangedCount: 0, overlapIds: ["other"] }),
  );
  assert(overlapping.category === "unclear", "overlap unclear");
  assert(overlapping.uncertainties.some((item) => item.includes("Alternative")), "overlap noted");

  const input = proposal({ sourceCount: 10, groupSizes: [9], unchangedCount: 1 });
  const before = JSON.stringify(input);
  const first = assess(input);
  const second = assess(input);
  assert(JSON.stringify(first) === JSON.stringify(second), "deterministic");
  assert(JSON.stringify(input) === before, "does not mutate proposal");
  assert(first.decisionRequired, "assessment is not a decision");
}
