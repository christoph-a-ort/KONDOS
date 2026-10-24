/** P2-L.3: pure execution-journal simulation. It never accesses the filesystem. */
import type { SnapshotBinding, VirtualPlan } from "./virtualPlan";
import type { VirtualDryRunOperation, VirtualDryRunReport } from "./virtualPlanDryRun";

export type JournalStatus = "prepared" | "checking" | "simulating" | "simulatedComplete" | "interrupted" | "failed" | "recoveryRequired" | "recovering" | "simulatedRecovered" | "blocked" | "executing" | "executionHalted" | "completed";
export type JournalOperationStatus = "pending" | "checked" | "started" | "simulatedComplete" | "failed" | "rollbackStarted" | "simulatedRolledBack" | "executed" | "unverified";
export type JournalBindingStatus = "reserved" | "releasePrepared" | "released";
export type BoundExecutionStatus = "unbound" | "reserved" | "releasePrepared" | "released" | "inconsistent" | "blocked";
export interface JournalEvent { sequence: number; atMs: number; message: string; operationId?: string }
export interface VirtualPlanJournal {
  schemaVersion: 1; journalId: string; revision: number; createdAtMs: number;
  planId: string; planRevision: number; binding: SnapshotBinding;
  operations: ReadonlyArray<VirtualDryRunOperation>;
  status: JournalStatus; operationStatus: Record<string, JournalOperationStatus>;
  events: ReadonlyArray<JournalEvent>; reason: string | null;
  scanRoot: string; ownerRunId: string; bindingStatus: JournalBindingStatus;
  preflight?: {
    schemaVersion: 1; currentIndex: number; halted: boolean; reason: string | null;
    outcomes: Record<string, string>;
  };
}

export const JOURNAL_COMPLETED_LABEL = "Abgeschlossen";

const knownJournalStatus = new Set<JournalStatus>([
  "prepared", "checking", "simulating", "simulatedComplete", "interrupted", "failed",
  "recoveryRequired", "recovering", "simulatedRecovered", "blocked", "executing",
  "executionHalted", "completed",
]);
const terminal = new Set<JournalStatus>(["simulatedComplete", "simulatedRecovered", "blocked", "executionHalted", "completed"]);
const allowed: Readonly<Record<JournalStatus, ReadonlySet<JournalStatus>>> = {
  prepared: new Set(["checking", "blocked", "executing"]),
  checking: new Set(["simulating", "failed", "interrupted", "blocked"]),
  simulating: new Set(["simulatedComplete", "failed", "interrupted", "recoveryRequired"]),
  simulatedComplete: new Set(["recovering", "executing"]),
  interrupted: new Set(["recoveryRequired", "recovering", "blocked"]),
  failed: new Set(["recoveryRequired", "recovering", "blocked"]),
  recoveryRequired: new Set(["recovering", "blocked"]),
  recovering: new Set(["simulatedRecovered", "failed", "recoveryRequired"]),
  simulatedRecovered: new Set(["executing"]),
  blocked: new Set(),
  executing: new Set(["executing", "executionHalted", "blocked", "recoveryRequired", "completed"]),
  executionHalted: new Set(["blocked"]),
  completed: new Set(),
};

function event(journal: VirtualPlanJournal, message: string, operationId?: string): VirtualPlanJournal {
  return { ...journal, revision: journal.revision + 1, events: [...journal.events, { sequence: journal.events.length + 1, atMs: Date.now(), message, operationId }] };
}
function allowedTargets(status: JournalStatus): ReadonlySet<JournalStatus> | undefined {
  return allowed[status];
}
function transition(journal: VirtualPlanJournal, status: JournalStatus, message: string): VirtualPlanJournal {
  const targets = allowedTargets(journal.status);
  if (targets === undefined || !targets.has(status)) throw new Error(`Unzulässiger Journalübergang: ${journal.status} → ${status}.`);
  return { ...event(journal, message), status };
}
export function createVirtualPlanJournal(plan: VirtualPlan, binding: SnapshotBinding, report: VirtualDryRunReport): VirtualPlanJournal {
  if (report.status !== "restricted") throw new Error("Nur ein gültiger eingeschränkter Dry-Run kann ein Journal vorbereiten.");
  const operations = report.operations.map((operation) => ({ ...operation, preconditions: [...operation.preconditions] }));
  return {
    schemaVersion: 1, journalId: `vj_${plan.planId}_${Date.now()}`, revision: 1, createdAtMs: Date.now(),
    planId: plan.planId, planRevision: plan.revision, binding, operations,
    status: "prepared", operationStatus: Object.fromEntries(operations.map((operation) => [operation.id, "pending"])),
    events: [{ sequence: 1, atMs: Date.now(), message: "Journal ausschließlich für Simulation vorbereitet." }], reason: null,
    scanRoot: binding.normalizedRootPath, ownerRunId: `run_${Date.now()}`, bindingStatus: "reserved",
  };
}
export function journalForBoundWrite(journal: VirtualPlanJournal, expectedRevision: number, bindingStatus: JournalBindingStatus): VirtualPlanJournal {
  return { ...journal, revision: expectedRevision + 1, bindingStatus };
}
export function parsePersistedJournal(raw: string): VirtualPlanJournal | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object") return null;
    const journal = value as Partial<VirtualPlanJournal>;
    if (journal.schemaVersion !== 1 || typeof journal.journalId !== "string" || typeof journal.revision !== "number") return null;
    if (!Array.isArray(journal.operations) || !Array.isArray(journal.events) || typeof journal.scanRoot !== "string") return null;
    if (typeof journal.ownerRunId !== "string" || !journal.binding || typeof journal.status !== "string") return null;
    if (journal.bindingStatus !== "reserved" && journal.bindingStatus !== "releasePrepared" && journal.bindingStatus !== "released") return null;
    return journal as VirtualPlanJournal;
  } catch {
    return null;
  }
}
export function bindingBlocksNewRun(status: BoundExecutionStatus): boolean {
  return status === "reserved" || status === "releasePrepared" || status === "inconsistent" || status === "blocked";
}
export function bindingAllowsProgress(status: BoundExecutionStatus): boolean {
  return status === "reserved";
}
export function bindingAllowsRelease(status: BoundExecutionStatus): boolean {
  return status === "releasePrepared";
}
export function shouldAutoResumeSimulation(_status: BoundExecutionStatus, _journal: VirtualPlanJournal | null): false {
  return false;
}
export function simulateJournal(journal: VirtualPlanJournal, failAfter?: number, abort = false): VirtualPlanJournal {
  let next = transition(journal, "checking", "Simulierte Vorprüfung begonnen.");
  next = transition(next, "simulating", "Simulationslauf begonnen.");
  for (let index = 0; index < next.operations.length; index += 1) {
    const operation = next.operations[index];
    if (failAfter === index) return { ...event({ ...next, operationStatus: { ...next.operationStatus, [operation.id]: "failed" } }, "Simulierter Fehler.", operation.id), status: "recoveryRequired", reason: "Simulierter Fehler" };
    if (abort) return { ...event(next, "Simulierter Benutzerabbruch."), status: "interrupted", reason: "Simulierter Benutzerabbruch" };
    next = event({ ...next, operationStatus: { ...next.operationStatus, [operation.id]: "simulatedComplete" } }, "Operation simuliert abgeschlossen.", operation.id);
  }
  return transition(next, "simulatedComplete", "Simulation vollständig abgeschlossen.");
}
export function simulateJournalRecovery(journal: VirtualPlanJournal): VirtualPlanJournal {
  let next = transition(journal, "recovering", "Simulierte Wiederherstellung begonnen.");
  for (const operation of [...next.operations].reverse()) {
    if (next.operationStatus[operation.id] !== "simulatedComplete") continue;
    if (!operation.recovery) return { ...event(next, "Rücknahmeinformation fehlt.", operation.id), status: "recoveryRequired", reason: "Rücknahmeinformation fehlt" };
    next = event({ ...next, operationStatus: { ...next.operationStatus, [operation.id]: "simulatedRolledBack" } }, "Operation simuliert zurückgenommen.", operation.id);
  }
  return transition(next, "simulatedRecovered", "Simulation der Wiederherstellung abgeschlossen.");
}
export function journalIsTerminal(status: JournalStatus): boolean { return terminal.has(status); }

export function isKnownJournalStatus(status: string): status is JournalStatus {
  return knownJournalStatus.has(status as JournalStatus);
}

export function journalStatusLabel(status: string): string {
  return status === "completed" ? JOURNAL_COMPLETED_LABEL : status;
}

export function journalTransitionAllowed(from: string, to: JournalStatus): boolean {
  if (!isKnownJournalStatus(from)) return false;
  const targets = allowedTargets(from);
  return targets !== undefined && targets.has(to);
}

function journalBindingConsistent(journal: VirtualPlanJournal): boolean {
  return journal.bindingStatus === "reserved"
    || journal.bindingStatus === "releasePrepared"
    || journal.bindingStatus === "released";
}

/** Proof is per planned operation, never a pending-count or bindingStatus shortcut. */
export function plannedOperationsReallyExecuted(journal: VirtualPlanJournal): boolean {
  if (journal.operations.length === 0) return false;
  const plannedIds = journal.operations.map((operation) => operation.id);
  if (new Set(plannedIds).size !== plannedIds.length) return false;
  const statusIds = Object.keys(journal.operationStatus);
  if (statusIds.length !== plannedIds.length) return false;
  if (!statusIds.every((id) => plannedIds.includes(id))) return false;
  return journal.operations.every((operation) => journal.operationStatus[operation.id] === "executed");
}

export function inferCompletedFromLegacyHints(journal: VirtualPlanJournal): boolean {
  const pending = Object.values(journal.operationStatus).filter((status) => status === "pending").length;
  if (journal.status === "executing" && journal.bindingStatus === "released" && pending === 0) {
    return false;
  }
  return journal.status === "completed";
}

export function historicalCompletionMarkAllowed(journal: VirtualPlanJournal): boolean {
  return journal.status === "completed"
    && plannedOperationsReallyExecuted(journal)
    && journalBindingConsistent(journal);
}

export function canCompleteJournal(journal: VirtualPlanJournal): boolean {
  if (journal.status !== "executing") return false;
  if (!isKnownJournalStatus(journal.status)) return false;
  if (!journalBindingConsistent(journal)) return false;
  if (journal.journalId.length === 0 || journal.scanRoot.length === 0) return false;
  if (journal.binding.normalizedRootPath !== journal.scanRoot) return false;
  return plannedOperationsReallyExecuted(journal);
}

export function completeExecutedJournal(journal: VirtualPlanJournal): VirtualPlanJournal {
  if (!canCompleteJournal(journal)) {
    throw new Error("Journalabschluss ist in diesem Zustand nicht zulässig.");
  }
  return transition(journal, "completed", "Alle vorgesehenen realen Operationen wurden erfolgreich ausgeführt.");
}
