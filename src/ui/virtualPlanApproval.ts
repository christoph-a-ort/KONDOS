/**
 * P2-K.4d – Pure approval gate for a persisted virtual plan.
 * This module has no filesystem or IPC access.
 */

import type { ScanResult } from "../model";
import type { DraftLoadResult, SnapshotBinding, VirtualPlan } from "./virtualPlan";
import { validateVirtualPlan } from "./virtualPlanEditor";

export interface VirtualPlanApprovalAssessment {
  eligible: boolean;
  blockers: string[];
  observedObjectCount: number;
  projectedObjectCount: number;
  openCaseCount: number;
}

export function assessVirtualPlanApproval(options: {
  plan: VirtualPlan;
  scanResult: ScanResult;
  binding: SnapshotBinding;
  draftLoad: DraftLoadResult | null;
}): VirtualPlanApprovalAssessment {
  const blockers: string[] = [];
  const validation = validateVirtualPlan(options.plan, options.scanResult, options.binding);
  blockers.push(...validation.errors);

  if (options.plan.status !== "draft") {
    blockers.push("Nur ein gespeicherter virtueller Entwurf kann bestätigt werden.");
  }
  if (options.binding.incomplete || options.plan.binding.incomplete) {
    blockers.push("Ein unvollständiger oder gefilterter Scan ist nicht virtuell freigabefähig.");
  }
  if (options.binding.scanConfig.extensions.length > 0) {
    blockers.push("Ein gefilterter Scan ist nicht virtuell freigabefähig.");
  }
  if (options.draftLoad === null || options.draftLoad.kind === "missing") {
    blockers.push("Der Entwurf ist noch nicht gespeichert.");
  } else if (options.draftLoad.kind === "blocked") {
    blockers.push("Der gespeicherte Entwurf ist beschädigt oder gesperrt.");
  } else {
    if (options.draftLoad.plan.planId !== options.plan.planId) {
      blockers.push("Der gespeicherte Entwurf gehört nicht zu diesem Plan.");
    }
    if (options.draftLoad.plan.revision !== options.plan.revision) {
      blockers.push("Es gibt lokale, noch nicht gespeicherte Änderungen.");
    }
    if (JSON.stringify(options.draftLoad.plan) !== JSON.stringify(options.plan)) {
      blockers.push("Der lokale Entwurf entspricht nicht dem gespeicherten Stand.");
    }
  }
  if (options.plan.openCases.length > 0) {
    blockers.push("Es bestehen noch ungeklärte Zuordnungskonflikte oder Prüffälle.");
  }

  return {
    eligible: blockers.length === 0,
    blockers: [...new Set(blockers)],
    observedObjectCount: validation.observedObjectCount,
    projectedObjectCount: validation.projectedObjectCount,
    openCaseCount: options.plan.openCases.length,
  };
}

export function prepareVirtualPlanApproval(plan: VirtualPlan, expectedRevision: number): VirtualPlan {
  const revision = expectedRevision + 1;
  return {
    ...plan,
    revision,
    status: "virtuallyApproved",
    items: plan.items.map((item) => ({
      ...item,
      observed: { ...item.observed, metadata: { ...item.observed.metadata } },
    })),
    virtualFolders: (plan.virtualFolders ?? []).map((folder) => ({ ...folder })),
    decisions: [
      ...plan.decisions.map((decision) => ({ ...decision, revision })),
      {
        id: `vpd_${revision}_${plan.decisions.length + 1}_approval`,
        revision,
        planId: plan.planId,
        kind: "approveVirtual",
        origin: "user",
        createdAtMs: Date.now(),
      },
    ],
  };
}
