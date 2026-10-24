import type { DirectoryNode, ScanConfig, ScanResult } from "../model";
import { makeSnapshotBinding } from "./virtualPlan";
import type { VirtualDryRunReport } from "./virtualPlanDryRun";
import {
  bindingAllowsProgress, bindingAllowsRelease, bindingBlocksNewRun,
  canCompleteJournal, completeExecutedJournal, createVirtualPlanJournal,
  historicalCompletionMarkAllowed, inferCompletedFromLegacyHints,
  journalForBoundWrite, journalIsTerminal, journalStatusLabel, journalTransitionAllowed,
  parsePersistedJournal, plannedOperationsReallyExecuted, shouldAutoResumeSimulation,
  simulateJournal, type JournalOperationStatus, type VirtualPlanJournal,
} from "./virtualPlanJournal";
import { reservationBindingLabel } from "./virtualPlanReservationAdmin";

function assert(value: boolean, label: string): void {
  if (!value) throw new Error(label);
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

function fixture(): ScanResult {
  const root: DirectoryNode = {
    id: "C:\\Fixture",
    path: "C:\\Fixture",
    name: "Fixture",
    depth: 0,
    kind: "directory",
    listing: "read",
    children: [],
  };
  return { root, warnings: [], stats: { directoryCount: 1, fileCount: 0, skippedCount: 0, durationMs: 1 } };
}

const report: VirtualDryRunReport = {
  status: "restricted",
  operations: [{
    id: "op1", kind: "renameFile", objectId: "n1", sourcePath: "a.txt", targetPath: "b.txt",
    expectedSource: "Quelle", preconditions: ["prüfen"], expectedTarget: "Ziel",
    collisionStatus: "mustCheckAtExecution", checkStatus: "mustCheckAtExecution",
    rationale: "Test", recovery: "Journal",
  }],
  folderCount: 0, fileOperationCount: 1, unchangedFileCount: 0, blockedOperationCount: 0,
  openRequirements: [], warnings: [],
};

export function runVirtualPlanJournalCheck(): void {
  const result = fixture();
  const binding = makeSnapshotBinding(result, config, 9);
  const plan = {
    schemaVersion: 1 as const, planId: "vp_test", builderVersion: 1, revision: 2,
    status: "virtuallyApproved" as const, scope: { kind: "scanRoot" as const, rootNodeId: result.root.id },
    binding, items: [], openCases: [], decisions: [], preferences: [],
  };
  const prepared = createVirtualPlanJournal(plan, binding, report);
  assert(prepared.scanRoot === binding.normalizedRootPath, "prepared journal keeps scan root");
  assert(prepared.bindingStatus === "reserved", "first persist state is reserved");
  assert(prepared.planRevision === 2 && prepared.revision === 1, "plan revision is independent from journal revision");

  const simulated = simulateJournal(prepared);
  const persisted = journalForBoundWrite(simulated, 1, "reserved");
  assert(persisted.revision === 2, "bound write uses expected revision plus one");
  assert(persisted.status === "simulatedComplete", "simulation content is kept");
  assert(persisted.bindingStatus === "reserved", "progress keeps reservation");

  const parsed = parsePersistedJournal(JSON.stringify(persisted));
  assert(parsed !== null && parsed.journalId === persisted.journalId, "load after restart parses persisted journal");
  assert(!shouldAutoResumeSimulation("reserved", parsed), "restart does not auto-resume");

  assert(parsePersistedJournal("{bad") === null, "corrupt journal is rejected");
  assert(parsePersistedJournal(JSON.stringify({ ...persisted, bindingStatus: "unknown" })) === null, "unknown binding is rejected");

  const conflictExpected = persisted.revision;
  const staleWrite = journalForBoundWrite(persisted, conflictExpected - 1, "reserved");
  assert(staleWrite.revision !== persisted.revision + 1 || staleWrite.revision === conflictExpected, "conflict write must not skip stored revision");
  assert(staleWrite.revision === conflictExpected, "stale expected revision is not overwritten blindly");

  assert(bindingBlocksNewRun("reserved"), "foreign or own reservation blocks a new run");
  assert(bindingBlocksNewRun("inconsistent"), "inconsistent state blocks a new run");
  assert(bindingBlocksNewRun("blocked"), "blocked state blocks a new run");
  assert(!bindingBlocksNewRun("released"), "released state allows a later new run");
  assert(bindingAllowsProgress("reserved") && !bindingAllowsProgress("inconsistent"), "only reserved journals may progress");
  assert(bindingAllowsRelease("releasePrepared") && !bindingAllowsRelease("reserved"), "release requires prepared state");

  const preparedRelease = journalForBoundWrite(parsed as VirtualPlanJournal, 2, "releasePrepared");
  assert(preparedRelease.bindingStatus === "releasePrepared" && preparedRelease.revision === 3, "release is prepared first");
  const released = journalForBoundWrite(preparedRelease, 3, "released");
  assert(released.bindingStatus === "released" && released.revision === 4, "successful release increments once");
  assert(released.planRevision === 2, "release does not raise the virtual plan revision");

  const folder = report.operations[0];
  const extra = {
    ...folder,
    id: "op2",
    sourcePath: "c.txt",
    targetPath: "d.txt",
  };
  const ops = (first: JournalOperationStatus, second: JournalOperationStatus): Record<string, JournalOperationStatus> => ({
    [folder.id]: first,
    op2: second,
  });
  const executingReady: VirtualPlanJournal = {
    ...persisted,
    status: "executing",
    operations: [folder, extra],
    operationStatus: ops("executed", "executed"),
    bindingStatus: "reserved",
  };
  assert(plannedOperationsReallyExecuted(executingReady), "FV2-01: every planned operation is executed");
  assert(canCompleteJournal(executingReady), "FV2-01: executing journal with proven ops can complete");
  const completedReserved = completeExecutedJournal(executingReady);
  assert(completedReserved.status === "completed", "FV2-01: executing → completed");
  assert(completedReserved.bindingStatus === "reserved", "FV2-01: completion keeps reserved binding");
  assert(journalStatusLabel(completedReserved.status) === "Abgeschlossen", "FV2-01: completed label");
  assert(journalIsTerminal("completed"), "FV2-01: completed is terminal");
  assert(!journalTransitionAllowed("completed", "executing"), "FV2-01: completed cannot reopen to executing");
  assert(!journalTransitionAllowed("completed", "prepared"), "FV2-01: completed cannot return to prepared");
  assert(!journalTransitionAllowed("prepared", "completed"), "FV2-01: prepared cannot jump to completed");
  assert(!journalTransitionAllowed("executionHalted", "completed"), "FV2-01: halted cannot complete");
  assert(journalTransitionAllowed("executing", "completed"), "FV2-01: map allows executing → completed");

  const pendingLeft = { ...executingReady, operationStatus: ops("executed", "pending") };
  assert(!plannedOperationsReallyExecuted(pendingLeft), "FV2-01: pending operation is not complete");
  assert(!canCompleteJournal(pendingLeft), "FV2-01: leftover pending blocks completion");
  let pendingThrew = false;
  try { completeExecutedJournal(pendingLeft); } catch { pendingThrew = true; }
  assert(pendingThrew, "FV2-01: complete throws while an operation is pending");

  const started = { ...executingReady, operationStatus: ops("executed", "started") };
  const unverified = { ...executingReady, operationStatus: ops("executed", "unverified") };
  assert(!canCompleteJournal(started) && !canCompleteJournal(unverified), "FV2-01: started/unverified block completion");

  const failed = { ...executingReady, operationStatus: ops("executed", "failed") };
  assert(!canCompleteJournal(failed), "FV2-01: failed operation blocks completion");

  const countOnly = {
    ...executingReady,
    operationStatus: ops("simulatedComplete", "simulatedComplete"),
  };
  assert(Object.values(countOnly.operationStatus).filter((status) => status === "pending").length === 0, "FV2-01: zero pending is not proof");
  assert(!plannedOperationsReallyExecuted(countOnly), "FV2-01: simulatedComplete is not real success");
  assert(!canCompleteJournal(countOnly), "FV2-01: counters do not complete the journal");

  const legacy = {
    ...executingReady,
    status: "executing" as const,
    bindingStatus: "released" as const,
    operationStatus: ops("simulatedComplete", "simulatedComplete"),
  };
  assert(Object.values(legacy.operationStatus).filter((status) => status === "pending").length === 0, "FV2-01: legacy fixture has pending=0");
  const parsedLegacy = parsePersistedJournal(JSON.stringify(legacy));
  assert(parsedLegacy !== null && parsedLegacy.status === "executing", "FV2-01: old journal stays readable as executing");
  assert(parsedLegacy?.bindingStatus === "released", "FV2-01: old released binding is kept");
  assert(inferCompletedFromLegacyHints(legacy) === false, "FV2-01: executing+released+pending=0 is not completed");
  assert(journalStatusLabel(legacy.status) !== "Abgeschlossen", "FV2-01: legacy executing is not shown as Abgeschlossen");
  assert(reservationBindingLabel(legacy.bindingStatus) === "Freigegeben", "FV2-01a: legacy released binding is Freigegeben");
  assert(!reservationBindingLabel(legacy.bindingStatus).includes("Abgeschlossen"), "FV2-01a: reservation release never yields Abgeschlossen");
  assert(!historicalCompletionMarkAllowed(legacy), "FV2-01: no historical mark without explicit completed status");

  const legacyAllExecuted = { ...executingReady, status: "executing" as const, bindingStatus: "released" as const };
  const parsedProvenLegacy = parsePersistedJournal(JSON.stringify(legacyAllExecuted));
  assert(parsedProvenLegacy !== null && parsedProvenLegacy.status === "executing", "FV2-01: proven old journal is not migrated");
  assert(plannedOperationsReallyExecuted(legacyAllExecuted), "FV2-01: historical proof can exist without rewriting status");
  assert(!inferCompletedFromLegacyHints(legacyAllExecuted), "FV2-01: proof plus released binding still does not invent completed");
  assert(!historicalCompletionMarkAllowed(legacyAllExecuted), "FV2-01: no automatic historical completion mark");

  const completedReleased = journalForBoundWrite(completedReserved, completedReserved.revision, "released");
  assert(completedReleased.status === "completed", "FV2-01: release write does not drop completed");
  assert(completedReleased.bindingStatus === "released", "FV2-01: completed can sit on a released binding");
  assert(journalStatusLabel(completedReleased.status) === "Abgeschlossen", "FV2-01a: completed stays Abgeschlossen after release");
  assert(reservationBindingLabel(completedReleased.bindingStatus) === "Freigegeben", "FV2-01a: released stays Freigegeben after completion");
  assert(historicalCompletionMarkAllowed(completedReleased), "FV2-01: explicit completed+released is a valid mark");
  assert(historicalCompletionMarkAllowed(completedReserved), "FV2-01: explicit completed+reserved is a valid mark");

  const unknownRaw = JSON.stringify({ ...persisted, status: "mystery-v0" });
  const parsedUnknown = parsePersistedJournal(unknownRaw);
  assert(parsedUnknown !== null && String(parsedUnknown.status) === "mystery-v0", "FV2-01: unknown status remains readable");
  assert(journalStatusLabel(String(parsedUnknown!.status)) !== "Abgeschlossen", "FV2-01: unknown status is not Abgeschlossen");
  assert(!journalTransitionAllowed(String(parsedUnknown!.status), "completed"), "FV2-01: unknown status cannot transition to completed");
  assert(!canCompleteJournal(parsedUnknown as VirtualPlanJournal), "FV2-01: unknown status cannot complete");
}
