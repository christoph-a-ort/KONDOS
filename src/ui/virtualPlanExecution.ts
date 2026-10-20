/** P2-L.4b.1: real folder-create confirmation. No automatic execution. */
import type { DryRunOperationKind, VirtualDryRunOperation } from "./virtualPlanDryRun";
import type { BoundExecutionStatus, JournalOperationStatus, VirtualPlanJournal } from "./virtualPlanJournal";
import { absoluteScanPath } from "./virtualPlanPreflight";

export const REAL_FOLDER_CHANGE_NOTICE =
  "Jetzt erfolgt eine echte Dateisystemänderung. Es wird ausschließlich dieser eine Ordner angelegt.";

export type RealFolderOutcome = "created" | "blocked" | "failed" | "unverified";

export function shouldAutoExecuteNext(_journal: VirtualPlanJournal | null): false {
  return false;
}

export function shouldAutoResumeExecution(_status: BoundExecutionStatus, _journal: VirtualPlanJournal | null): false {
  return false;
}

export function realFolderOperationLabel(kind: DryRunOperationKind): string {
  if (kind === "createVirtualFolder") return "Ordner anlegen";
  return "Nicht zulässig";
}

export function isRealFolderCreateKind(kind: DryRunOperationKind): boolean {
  return kind === "createVirtualFolder";
}

export function operationWasReallyCreated(status: JournalOperationStatus | undefined): boolean {
  return status === "executed";
}

export function executionMustHalt(journal: VirtualPlanJournal | null): { halt: boolean; reason: string | null } {
  if (journal === null) return { halt: false, reason: null };
  if (journal.status === "executionHalted" || journal.status === "blocked" || journal.status === "recoveryRequired") {
    return { halt: true, reason: journal.reason ?? "Der Ablauf ist angehalten." };
  }
  for (const [id, status] of Object.entries(journal.operationStatus)) {
    if (status === "started" || status === "unverified") {
      return { halt: true, reason: `Die echte Ordneranlage ${id} ist nicht abgeschlossen. Keine automatische Wiederholung.` };
    }
    if (status === "failed") {
      return { halt: true, reason: journal.reason ?? "Eine echte Ordneranlage ist fehlgeschlagen. Ablauf angehalten." };
    }
  }
  return { halt: false, reason: null };
}

export function nextRealFolderOperation(
  operations: ReadonlyArray<VirtualDryRunOperation>,
  journal: VirtualPlanJournal | null,
): VirtualDryRunOperation | null {
  const remaining = operations.filter((operation) => operation.kind === "createVirtualFolder"
    && !operationWasReallyCreated(journal?.operationStatus[operation.id]));
  return remaining[0] ?? null;
}

export function confirmedTargetPath(scanRoot: string, operation: VirtualDryRunOperation): string {
  return absoluteScanPath(scanRoot, operation.targetPath);
}

export function canSubmitRealFolderCreate(options: {
  approvedTestRoot: boolean;
  explicitConfirm: boolean;
  halt: boolean;
  operation: VirtualDryRunOperation | null;
}): boolean {
  return options.approvedTestRoot
    && options.explicitConfirm
    && !options.halt
    && options.operation !== null
    && isRealFolderCreateKind(options.operation.kind);
}
