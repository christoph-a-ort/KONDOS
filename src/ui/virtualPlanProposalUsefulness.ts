/**
 * P2-K.3c – Conservative organizational-usefulness assessment for existing
 * virtual structure proposals. Pure/read-only: it neither changes a proposal
 * nor applies a structure.
 */

import type { SnapshotBinding } from "./virtualPlan";
import type {
  VirtualPreviewEntry,
  VirtualReorgProposal,
} from "./virtualPlanSuggestions";

export const VIRTUAL_PLAN_TARGET_DEPTH_SOFT_LIMIT = 5 as const;

export type VirtualProposalUsefulnessCategory =
  | "likelyHelpful"
  | "unclear"
  | "likelyNotHelpful"
  | "notAssessable";

export interface VirtualProposalUsefulnessMetrics {
  sourceDirectObjectCount: number;
  directObjectCountAfter: number;
  directObjectReduction: number;
  regroupedFileCount: number;
  unchangedObjectCount: number;
  newVirtualFolderCount: number;
  singleFileVirtualFolderCount: number;
  smallestGroupSize: number;
  largestGroupSize: number;
  sourceFolderDepth: number;
  resultingFolderDepth: number;
}

export interface VirtualProposalUsefulnessAssessment {
  proposalId: string;
  category: VirtualProposalUsefulnessCategory;
  categoryLabel: string;
  expectedBenefit: string;
  expectedDrawbacks: string[];
  observedFeatures: string[];
  uncertainties: string[];
  metrics: VirtualProposalUsefulnessMetrics;
  /** An assessment remains informational; it is never a user decision. */
  decisionRequired: true;
  overlapsWithProposalIds: string[];
}

export interface AssessVirtualProposalUsefulnessOptions {
  proposal: VirtualReorgProposal;
  binding: Pick<SnapshotBinding, "incomplete">;
  sourceFolderDepth: number;
  targetDepthSoftLimit?: number;
}

function categoryLabel(category: VirtualProposalUsefulnessCategory): string {
  switch (category) {
    case "likelyHelpful":
      return "Wahrscheinlich hilfreich";
    case "unclear":
      return "Nutzen unklar";
    case "likelyNotHelpful":
      return "Eher nicht hilfreich";
    case "notAssessable":
      return "Nicht bewertbar";
    default:
      return "Nutzen unklar";
  }
}

function virtualGroups(entry: VirtualPreviewEntry): VirtualPreviewEntry[] {
  const groups: VirtualPreviewEntry[] = [];
  const walk = (current: VirtualPreviewEntry): void => {
    if (current.role === "virtualGroup") {
      groups.push(current);
    }
    for (const child of current.children ?? []) {
      walk(child);
    }
  };
  walk(entry);
  return groups;
}

function groupSizes(proposal: VirtualReorgProposal): number[] {
  return virtualGroups(proposal.virtualTarget.tree)
    .map((group) =>
      (group.children ?? []).filter((child) => child.role === "regrouped").length,
    )
    .filter((size) => size > 0);
}

function metricsFor(
  proposal: VirtualReorgProposal,
  sourceFolderDepth: number,
): VirtualProposalUsefulnessMetrics {
  const sizes = groupSizes(proposal);
  const newVirtualFolderCount = sizes.length;
  const directObjectCountAfter =
    proposal.completeness.unchangedObjectCount + newVirtualFolderCount;

  return {
    sourceDirectObjectCount: proposal.completeness.sourceObjectCount,
    directObjectCountAfter,
    directObjectReduction:
      proposal.completeness.sourceObjectCount - directObjectCountAfter,
    regroupedFileCount: proposal.completeness.regroupedObjectCount,
    unchangedObjectCount: proposal.completeness.unchangedObjectCount,
    newVirtualFolderCount,
    singleFileVirtualFolderCount: sizes.filter((size) => size === 1).length,
    smallestGroupSize: sizes.length === 0 ? 0 : Math.min(...sizes),
    largestGroupSize: sizes.length === 0 ? 0 : Math.max(...sizes),
    sourceFolderDepth,
    resultingFolderDepth: sourceFolderDepth + 1,
  };
}

function countFeatures(metrics: VirtualProposalUsefulnessMetrics): string[] {
  return [
    `${metrics.sourceDirectObjectCount} direkte Objekte vor der virtuellen Gliederung`,
    `${metrics.directObjectCountAfter} direkte Objekte nach der virtuellen Gliederung`,
    `${metrics.newVirtualFolderCount} neue virtuelle Ordner`,
    `${metrics.regroupedFileCount} virtuell anders eingeordnete Dateien`,
    `${metrics.unchangedObjectCount} Objekte bleiben unverändert`,
    `${metrics.singleFileVirtualFolderCount} Einzeldatei-Ordner`,
    `zusätzliche virtuelle Ebene bis Tiefe ${metrics.resultingFolderDepth}`,
  ];
}

function benefitText(metrics: VirtualProposalUsefulnessMetrics): string {
  if (metrics.directObjectReduction >= 3 && metrics.newVirtualFolderCount > 0) {
    return `Möglicher struktureller Vorteil: Im Ausgangsordner würden ${metrics.directObjectReduction} direkte Einträge weniger angezeigt, ohne Objekte auszublenden.`;
  }
  if (metrics.directObjectReduction > 0) {
    return "Möglicher struktureller Vorteil: Im Ausgangsordner wären weniger direkte Einträge sichtbar; daraus folgt allein noch keine bessere Ablage.";
  }
  return "Möglicher struktureller Vorteil ist nicht klar erkennbar: Die Anzahl direkter Einträge verringert sich nicht wesentlich.";
}

function depthDrawback(
  metrics: VirtualProposalUsefulnessMetrics,
  softLimit: number,
): string | null {
  if (metrics.resultingFolderDepth >= softLimit) {
    return `Die zusätzliche Ebene führt bis Tiefe ${metrics.resultingFolderDepth} und erreicht oder überschreitet den weichen Richtwert von ${softLimit} Ebenen.`;
  }
  return `Die Vorschau fügt eine zusätzliche virtuelle Verzeichnisebene hinzu (bis Tiefe ${metrics.resultingFolderDepth}).`;
}

/**
 * Deterministically assesses observed structural effects only. No scoring,
 * no semantic assumptions, and no mutation of `proposal`.
 */
export function assessVirtualProposalUsefulness(
  options: AssessVirtualProposalUsefulnessOptions,
): VirtualProposalUsefulnessAssessment {
  const softLimit =
    options.targetDepthSoftLimit ?? VIRTUAL_PLAN_TARGET_DEPTH_SOFT_LIMIT;
  const metrics = metricsFor(options.proposal, options.sourceFolderDepth);
  const observedFeatures = countFeatures(metrics);
  const uncertainties = [...options.proposal.uncertainties];
  const expectedDrawbacks: string[] = [];
  const overlaps = [...options.proposal.overlapsWithProposalIds];

  const dataIncomplete =
    options.binding.incomplete ||
    !options.proposal.completeness.complete ||
    options.proposal.completeness.hasDuplicates ||
    options.proposal.completeness.lossDetected;

  if (dataIncomplete) {
    uncertainties.push(
      "Die beobachtete Datengrundlage reicht nicht für eine belastbare Nutzenbewertung aus.",
    );
    return {
      proposalId: options.proposal.id,
      category: "notAssessable",
      categoryLabel: categoryLabel("notAssessable"),
      expectedBenefit:
        "Ein möglicher struktureller Vorteil kann wegen eingeschränkter oder unvollständiger Daten nicht belastbar beurteilt werden.",
      expectedDrawbacks,
      observedFeatures,
      uncertainties,
      metrics,
      decisionRequired: true,
      overlapsWithProposalIds: overlaps,
    };
  }

  const depth = depthDrawback(metrics, softLimit);
  if (depth !== null) {
    expectedDrawbacks.push(depth);
  }
  if (metrics.singleFileVirtualFolderCount > 0) {
    expectedDrawbacks.push(
      `${metrics.singleFileVirtualFolderCount} neue virtuelle Ordner enthalten jeweils nur eine Datei.`,
    );
  }
  if (metrics.unchangedObjectCount > 0) {
    expectedDrawbacks.push(
      `${metrics.unchangedObjectCount} Objekte bleiben im Ausgangsordner; dessen Restbestand bleibt bei der Beurteilung sichtbar.`,
    );
  }
  if (overlaps.length > 0) {
    uncertainties.push(
      "Der Vorschlag überlappt mit einer Alternative und ist nicht unabhängig kombinierbar.",
    );
    return {
      proposalId: options.proposal.id,
      category: "unclear",
      categoryLabel: categoryLabel("unclear"),
      expectedBenefit: benefitText(metrics),
      expectedDrawbacks,
      observedFeatures,
      uncertainties,
      metrics,
      decisionRequired: true,
      overlapsWithProposalIds: overlaps,
    };
  }

  const allGroupsAreSingleFile =
    metrics.newVirtualFolderCount > 0 &&
    metrics.singleFileVirtualFolderCount === metrics.newVirtualFolderCount;
  const smallSourceScope = metrics.sourceDirectObjectCount <= 4;
  const partialCoverage =
    metrics.regroupedFileCount * 2 < metrics.sourceDirectObjectCount;
  const substantialConsolidation =
    metrics.directObjectReduction >= 3 &&
    metrics.newVirtualFolderCount > 0 &&
    metrics.singleFileVirtualFolderCount === 0 &&
    metrics.smallestGroupSize >= 3 &&
    !partialCoverage;

  let category: VirtualProposalUsefulnessCategory = "unclear";
  if (
    allGroupsAreSingleFile ||
    (metrics.directObjectReduction <= 0 && metrics.newVirtualFolderCount > 0)
  ) {
    category = "likelyNotHelpful";
  } else if (smallSourceScope || partialCoverage) {
    // A smaller visible list alone is never enough: adding a folder to a small
    // source area remains a trade-off and must not receive a positive category.
    category = "unclear";
  } else if (substantialConsolidation) {
    category = "likelyHelpful";
  }

  return {
    proposalId: options.proposal.id,
    category,
    categoryLabel: categoryLabel(category),
    expectedBenefit: benefitText(metrics),
    expectedDrawbacks,
    observedFeatures,
    uncertainties,
    metrics,
    decisionRequired: true,
    overlapsWithProposalIds: overlaps,
  };
}
