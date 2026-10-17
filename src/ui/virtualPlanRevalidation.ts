/** P2-K.5a – Read-only comparison of a persisted plan against the current scan. */

import type { ScanResult } from "../model";
import type { SnapshotBinding, VirtualPlan } from "./virtualPlan";
import { validateVirtualPlan } from "./virtualPlanEditor";

export type VirtualPlanRevalidationKind = "current" | "stale" | "blocked" | "notComparable";

export interface VirtualPlanRevalidation {
  kind: VirtualPlanRevalidationKind;
  label: string;
  reasons: string[];
}

function sameConfig(left: SnapshotBinding["scanConfig"], right: SnapshotBinding["scanConfig"]): boolean {
  return (
    left.maxDepth === right.maxDepth &&
    left.excludeHidden === right.excludeHidden &&
    left.includeSize === right.includeSize &&
    left.includeCreatedAt === right.includeCreatedAt &&
    left.includeModifiedAt === right.includeModifiedAt &&
    left.extensions.join("|") === right.extensions.join("|")
  );
}

export function revalidateVirtualPlan(options: {
  plan: VirtualPlan | null;
  blocked: boolean;
  scanResult: ScanResult;
  currentBinding: SnapshotBinding;
}): VirtualPlanRevalidation {
  if (options.blocked || options.plan === null) {
    return {
      kind: "blocked",
      label: "Blockiert / beschädigt",
      reasons: ["Der gespeicherte Plan ist beschädigt, unbekannt oder gesperrt."],
    };
  }
  const { plan, currentBinding } = options;
  if (plan.binding.normalizedRootPath !== currentBinding.normalizedRootPath) {
    return {
      kind: "notComparable",
      label: "Nicht vergleichbar",
      reasons: ["Der Plan gehört zu einer anderen Scanwurzel."],
    };
  }
  const reasons: string[] = [];
  if (plan.binding.sourceScanId !== currentBinding.sourceScanId) {
    reasons.push("Die Scan-ID hat sich geändert.");
  }
  if (plan.binding.snapshotFingerprint !== currentBinding.snapshotFingerprint) {
    reasons.push("Der Snapshot-Fingerprint hat sich geändert.");
  }
  if (!sameConfig(plan.binding.scanConfig, currentBinding.scanConfig)) {
    reasons.push("Die Scan-Konfiguration hat sich geändert.");
  }
  if (plan.binding.incomplete || currentBinding.incomplete) {
    reasons.push("Mindestens einer der Snapshots ist unvollständig oder gefiltert.");
  }
  // validateVirtualPlan intentionally accepts only drafts; historical approvals
  // are checked structurally without changing their persisted status.
  const structural = validateVirtualPlan(
    plan.status === "draft" ? plan : { ...plan, status: "draft" },
    options.scanResult,
    currentBinding,
  );
  reasons.push(...structural.errors.filter((error) => error !== "Nur ein virtueller Entwurf kann bearbeitet werden."));
  if (reasons.length > 0) {
    return {
      kind: "stale",
      label: "Veraltet / erneute Prüfung erforderlich",
      reasons: [...new Set(reasons)],
    };
  }
  return { kind: "current", label: "Aktuell und gültig", reasons: [] };
}
