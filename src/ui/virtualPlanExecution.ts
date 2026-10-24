/** P2-L.4b.1 / P2-L.4b.2: real folder-create and single-file-move confirmation. No automatic execution. */
import type { DryRunOperationKind, VirtualDryRunOperation } from "./virtualPlanDryRun";
import type { BoundExecutionStatus, JournalOperationStatus, VirtualPlanJournal } from "./virtualPlanJournal";
import type { PreflightDecision, PreflightStatus } from "./virtualPlanPreflight";
import { absoluteScanPath, hasCompleteFileFingerprint, incompleteFileFingerprintReason } from "./virtualPlanPreflight";
import type { SnapshotBinding, VirtualPlan } from "./virtualPlan";

export const REAL_FOLDER_CHANGE_NOTICE =
  "Jetzt erfolgt eine echte Dateisystemänderung. Es wird ausschließlich dieser eine Ordner angelegt.";

export const REAL_FILE_MOVE_NOTICE =
  "Jetzt erfolgt eine echte Dateisystemänderung. Es wird ausschließlich diese eine Datei verschoben.";

export type RealFolderOutcome = "created" | "blocked" | "failed" | "unverified";
export type RealFileMoveOutcome = "moved" | "blocked" | "failed" | "unverified";

export interface RealFileMoveConfirm {
  kind: DryRunOperationKind;
  sourcePath: string;
  targetPath: string;
  operationId: string;
  journalId: string;
}

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

export function realFileMoveOperationLabel(kind: DryRunOperationKind): string {
  if (kind === "moveFile") return "Datei verschieben";
  return "Nicht zulässig";
}

export function isRealFolderCreateKind(kind: DryRunOperationKind): boolean {
  return kind === "createVirtualFolder";
}

export function isRealFileMoveKind(kind: DryRunOperationKind): boolean {
  return kind === "moveFile";
}

function sameExecutionScanConfig(
  left: SnapshotBinding["scanConfig"],
  right: SnapshotBinding["scanConfig"],
): boolean {
  return (
    left.maxDepth === right.maxDepth
    && left.excludeHidden === right.excludeHidden
    && left.includeSize === right.includeSize
    && left.includeCreatedAt === right.includeCreatedAt
    && left.includeModifiedAt === right.includeModifiedAt
    && left.extensions.join("|") === right.extensions.join("|")
  );
}

/**
 * Prepared/executing reserved journal uniquely bound to this virtually-approved plan.
 * Ignores live sourceScanId so a rescan alone does not drop a safe continuation.
 * Does not treat an old journal as approval for a different plan/revision/fingerprint.
 */
export function journalBoundToApprovedPlan(
  journal: VirtualPlanJournal | null,
  plan: VirtualPlan | null,
): boolean {
  if (journal === null || plan === null) return false;
  if (plan.status !== "virtuallyApproved") return false;
  if (journal.planId !== plan.planId || journal.planRevision !== plan.revision) return false;
  if (journal.binding.normalizedRootPath !== plan.binding.normalizedRootPath) return false;
  if (journal.scanRoot !== plan.binding.normalizedRootPath) return false;
  if (journal.binding.snapshotFingerprint !== plan.binding.snapshotFingerprint) return false;
  if (journal.binding.incomplete || plan.binding.incomplete) return false;
  if (!sameExecutionScanConfig(journal.binding.scanConfig, plan.binding.scanConfig)) return false;
  if (journal.bindingStatus !== "reserved") return false;
  if (journal.status !== "prepared" && journal.status !== "executing") return false;
  return true;
}

/** New reservation still needs a current plan; continuation may use a matching journal. */
export function realExecutionUiOpen(
  plan: VirtualPlan | null,
  snapshotCurrent: boolean,
  journal: VirtualPlanJournal | null,
): boolean {
  if (plan?.status !== "virtuallyApproved") return false;
  return snapshotCurrent || journalBoundToApprovedPlan(journal, plan);
}

/** Prefer journal operations when bound; otherwise only a current dry-run list. */
export function realExecutionOperationsFrom(
  dryRunOperations: ReadonlyArray<VirtualDryRunOperation>,
  journal: VirtualPlanJournal | null,
  plan: VirtualPlan | null,
  snapshotCurrent: boolean,
): ReadonlyArray<VirtualDryRunOperation> {
  if (journalBoundToApprovedPlan(journal, plan) && journal !== null) {
    return journal.operations;
  }
  if (snapshotCurrent) return dryRunOperations;
  return [];
}

export function operationWasReallyCreated(status: JournalOperationStatus | undefined): boolean {
  return status === "executed";
}

export function operationWasReallyMoved(status: JournalOperationStatus | undefined): boolean {
  return status === "executed";
}

export function executionMustHalt(journal: VirtualPlanJournal | null): { halt: boolean; reason: string | null } {
  if (journal === null) return { halt: false, reason: null };
  if (journal.status === "executionHalted" || journal.status === "blocked" || journal.status === "recoveryRequired") {
    return { halt: true, reason: journal.reason ?? "Der Ablauf ist angehalten." };
  }
  for (const [id, status] of Object.entries(journal.operationStatus)) {
    if (status === "started" || status === "unverified") {
      return { halt: true, reason: `Die echte Dateioperation ${id} ist nicht abgeschlossen. Keine automatische Wiederholung.` };
    }
    if (status === "failed") {
      return { halt: true, reason: journal.reason ?? "Eine echte Dateioperation ist fehlgeschlagen. Ablauf angehalten." };
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

export function nextRealFileMoveOperation(
  operations: ReadonlyArray<VirtualDryRunOperation>,
  journal: VirtualPlanJournal | null,
): VirtualDryRunOperation | null {
  const remaining = operations.filter((operation) => operation.kind === "moveFile"
    && !operationWasReallyMoved(journal?.operationStatus[operation.id]));
  return remaining[0] ?? null;
}

export function nextRealExecutionOperation(
  operations: ReadonlyArray<VirtualDryRunOperation>,
  journal: VirtualPlanJournal | null,
): VirtualDryRunOperation | null {
  return nextRealFolderOperation(operations, journal) ?? nextRealFileMoveOperation(operations, journal);
}

export function confirmedSourcePath(scanRoot: string, operation: VirtualDryRunOperation): string {
  return absoluteScanPath(scanRoot, operation.sourcePath);
}

export function confirmedTargetPath(scanRoot: string, operation: VirtualDryRunOperation): string {
  return absoluteScanPath(scanRoot, operation.targetPath);
}

export function realExecutionConfirmKey(
  planId: string | undefined,
  planRevision: number | undefined,
  journal: VirtualPlanJournal | null,
  operation: VirtualDryRunOperation | null,
): string {
  return [
    planId ?? "",
    String(planRevision ?? ""),
    journal?.journalId ?? "",
    String(journal?.revision ?? ""),
    operation?.id ?? "",
    operation?.kind ?? "",
    operation?.sourcePath ?? "",
    operation?.targetPath ?? "",
  ].join("|");
}

export function bindRealFileMoveConfirm(operation: VirtualDryRunOperation, journalId: string): RealFileMoveConfirm {
  return {
    kind: operation.kind,
    sourcePath: operation.sourcePath,
    targetPath: operation.targetPath,
    operationId: operation.id,
    journalId,
  };
}

export function realFileMoveConfirmIsCurrent(
  confirm: RealFileMoveConfirm | null,
  operation: VirtualDryRunOperation | null,
  journalId: string | null,
): boolean {
  if (confirm === null || operation === null || journalId === null) return false;
  return confirm.kind === "moveFile"
    && operation.kind === "moveFile"
    && confirm.sourcePath === operation.sourcePath
    && confirm.targetPath === operation.targetPath
    && confirm.operationId === operation.id
    && confirm.journalId === journalId;
}

export function isReadyForRealExecution(status: PreflightStatus | null | undefined): boolean {
  return status === "ready";
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

export function canSubmitRealFileMove(options: {
  approvedTestRoot: boolean;
  explicitConfirm: boolean;
  halt: boolean;
  snapshotCurrent: boolean;
  journalBoundToPlan: boolean;
  operation: VirtualDryRunOperation | null;
  journalId: string | null;
  confirm: RealFileMoveConfirm | null;
  decisionStatus: PreflightStatus | null;
  expectedSizeBytes?: number;
  expectedModifiedAtMs?: number;
}): boolean {
  return options.approvedTestRoot
    && options.explicitConfirm
    && !options.halt
    && (options.snapshotCurrent || options.journalBoundToPlan)
    && options.operation !== null
    && options.journalId !== null
    && isRealFileMoveKind(options.operation.kind)
    && options.operation.kind !== "renameFile"
    && realFileMoveConfirmIsCurrent(options.confirm, options.operation, options.journalId)
    && isReadyForRealExecution(options.decisionStatus)
    && hasCompleteFileFingerprint(options.expectedSizeBytes, options.expectedModifiedAtMs);
}

export function realFileMoveDisableReason(options: {
  busy: boolean;
  locked: boolean;
  halt: boolean;
  haltReason: string | null;
  approvedTestRoot: boolean;
  explicitConfirm: boolean;
  snapshotCurrent: boolean;
  journalBoundToPlan: boolean;
  operation: VirtualDryRunOperation | null;
  journalId: string | null;
  confirm: RealFileMoveConfirm | null;
  decision: PreflightDecision | null;
  expectedSizeBytes?: number;
  expectedModifiedAtMs?: number;
}): string | null {
  if (options.busy) return "Die Dateioperation läuft noch.";
  if (options.halt) return options.haltReason ?? "Der Ablauf ist angehalten. Keine automatische Wiederholung.";
  if (options.locked) return "Der Ausführungszustand ist gesperrt.";
  if (!options.approvedTestRoot) return "Die Testwurzel ist nicht ausdrücklich freigegeben.";
  if (!options.snapshotCurrent && !options.journalBoundToPlan) {
    return "Der Scan-Snapshot ist nicht mehr aktuell.";
  }
  if (options.operation === null || !isRealFileMoveKind(options.operation.kind)) {
    return "Nur eine geprüfte Dateiverschiebung kann ausgeführt werden.";
  }
  if (options.journalId === null) return "Es liegt keine gebundene Reservierung vor.";
  if (options.decision === null) return "Zuerst in dieser Karte die Sicherheitsprüfung ausführen.";
  if (options.decision.status !== "ready" || !options.decision.canConfirm) {
    return options.decision.reason;
  }
  if (!hasCompleteFileFingerprint(options.expectedSizeBytes, options.expectedModifiedAtMs)) {
    return incompleteFileFingerprintReason(options.expectedSizeBytes, options.expectedModifiedAtMs);
  }
  if (!options.explicitConfirm || !realFileMoveConfirmIsCurrent(options.confirm, options.operation, options.journalId)) {
    return "Die Einzelbestätigung für genau diese Dateiverschiebung fehlt oder ist nicht mehr gültig.";
  }
  if (canSubmitRealFileMove({
    approvedTestRoot: options.approvedTestRoot,
    explicitConfirm: options.explicitConfirm,
    halt: options.halt,
    snapshotCurrent: options.snapshotCurrent,
    journalBoundToPlan: options.journalBoundToPlan,
    operation: options.operation,
    journalId: options.journalId,
    confirm: options.confirm,
    decisionStatus: options.decision.status,
    expectedSizeBytes: options.expectedSizeBytes,
    expectedModifiedAtMs: options.expectedModifiedAtMs,
  })) return null;
  return "Diese Datei kann in diesem Zustand nicht verschoben werden.";
}
