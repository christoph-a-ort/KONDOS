import type { VirtualDryRunOperation } from "./virtualPlanDryRun";
import type { VirtualPlanJournal } from "./virtualPlanJournal";
import type { PreflightDecision } from "./virtualPlanPreflight";
import { evaluatePreflight, hasCompleteFileFingerprint } from "./virtualPlanPreflight";
import type { VirtualPlan } from "./virtualPlan";
import {
  bindRealFileMoveConfirm, canSubmitRealFileMove, canSubmitRealFolderCreate, confirmedSourcePath,
  confirmedTargetPath, executionMustHalt, isReadyForRealExecution, isRealFileMoveKind,
  isRealFolderCreateKind, journalBoundToApprovedPlan, nextRealExecutionOperation, nextRealFileMoveOperation,
  nextRealFolderOperation, realExecutionConfirmKey, realExecutionOperationsFrom, realExecutionUiOpen,
  realFileMoveConfirmIsCurrent, realFileMoveDisableReason, realFileMoveOperationLabel,
  realFolderOperationLabel, shouldAutoExecuteNext, shouldAutoResumeExecution,
} from "./virtualPlanExecution";

function assert(value: boolean, label: string): void {
  if (!value) throw new Error(label);
}

function folderOp(id: string, target = "neu"): VirtualDryRunOperation {
  return {
    id, kind: "createVirtualFolder", objectId: "vf", sourcePath: ".", targetPath: target,
    expectedSource: "s", preconditions: [], expectedTarget: "t",
    collisionStatus: "mustCheckAtExecution", checkStatus: "mustCheckAtExecution",
    rationale: "r", recovery: "later",
  };
}

function moveOp(id: string, source = "Rechnung_A.txt", target = "Probeordner/Rechnung_A.txt"): VirtualDryRunOperation {
  return {
    id, kind: "moveFile", objectId: "n1", sourcePath: source, targetPath: target,
    expectedSource: "s", preconditions: [], expectedTarget: "t",
    collisionStatus: "mustCheckAtExecution", checkStatus: "mustCheckAtExecution",
    rationale: "r", recovery: "later",
  };
}

function renameOp(id: string): VirtualDryRunOperation {
  return {
    id, kind: "renameFile", objectId: "n2", sourcePath: "alt.txt", targetPath: "neu.txt",
    expectedSource: "s", preconditions: [], expectedTarget: "t",
    collisionStatus: "mustCheckAtExecution", checkStatus: "mustCheckAtExecution",
    rationale: "r", recovery: "later",
  };
}

function journal(overrides: Partial<VirtualPlanJournal> = {}): VirtualPlanJournal {
  const operations = [folderOp("op1"), folderOp("op2", "zwei")];
  return {
    schemaVersion: 1, journalId: "j1", revision: 1, createdAtMs: 1, planId: "p", planRevision: 1,
    binding: {
      sourceScanId: 1, normalizedRootPath: "c:/t", scanConfig: {
        maxDepth: 8, excludeHidden: true, extensions: [], includeSize: true, includeCreatedAt: false, includeModifiedAt: true,
      }, snapshotFingerprint: "vp1", incomplete: false,
    },
    operations, status: "prepared", operationStatus: { op1: "pending", op2: "pending" },
    events: [], reason: null, scanRoot: "c:/t", ownerRunId: "run", bindingStatus: "reserved",
    ...overrides,
  };
}

function readyMoveSubmit(overrides: Partial<Parameters<typeof canSubmitRealFileMove>[0]> = {}) {
  const operation = moveOp("op-file");
  const confirm = bindRealFileMoveConfirm(operation, "j1");
  return canSubmitRealFileMove({
    approvedTestRoot: true,
    explicitConfirm: true,
    halt: false,
    snapshotCurrent: true,
    journalBoundToPlan: false,
    operation,
    journalId: "j1",
    confirm,
    decisionStatus: "ready",
    expectedSizeBytes: 12,
    expectedModifiedAtMs: 100,
    ...overrides,
  });
}

function approvedPlan(overrides: Partial<VirtualPlan> = {}): VirtualPlan {
  const binding = journal().binding;
  return {
    schemaVersion: 1,
    planId: "p",
    builderVersion: 1,
    revision: 1,
    status: "virtuallyApproved",
    binding,
    scope: { kind: "scanRoot", rootNodeId: "root" },
    items: [],
    openCases: [],
    decisions: [],
    preferences: [],
    virtualFolders: [],
    ...overrides,
  };
}

function readyDecision(overrides: Partial<PreflightDecision> = {}): PreflightDecision {
  return { status: "ready", reason: "Read-only-Prüfung erfolgreich. Noch keine Dateioperation.", canConfirm: true, halt: false, ...overrides };
}

function disableReason(overrides: Partial<Parameters<typeof realFileMoveDisableReason>[0]> = {}) {
  const operation = moveOp("op-file");
  return realFileMoveDisableReason({
    busy: false,
    locked: false,
    halt: false,
    haltReason: null,
    approvedTestRoot: true,
    explicitConfirm: true,
    snapshotCurrent: true,
    journalBoundToPlan: false,
    operation,
    journalId: "j1",
    confirm: bindRealFileMoveConfirm(operation, "j1"),
    decision: readyDecision(),
    expectedSizeBytes: 12,
    expectedModifiedAtMs: 100,
    ...overrides,
  });
}

export function runVirtualPlanExecutionCheck(): void {
  assert(realFolderOperationLabel("createVirtualFolder") === "Ordner anlegen", "folder label");
  assert(!isRealFolderCreateKind("moveFile") && !isRealFolderCreateKind("renameFile"), "file ops are not folder creates");
  assert(isRealFileMoveKind("moveFile") && !isRealFileMoveKind("renameFile") && !isRealFileMoveKind("createVirtualFolder"), "only moveFile is a real file move");
  assert(realFileMoveOperationLabel("moveFile") === "Datei verschieben", "move label");
  assert(realFileMoveOperationLabel("renameFile") === "Nicht zulässig", "rename remains forbidden");
  assert(!shouldAutoExecuteNext(journal()), "no auto execute");
  assert(!shouldAutoResumeExecution("reserved", journal()), "no auto resume");
  const current = nextRealFolderOperation(journal().operations, journal());
  assert(current?.id === "op1", "first pending folder is shown");
  const afterFirst = nextRealFolderOperation(journal().operations, journal({ operationStatus: { op1: "executed", op2: "pending" } }));
  assert(afterFirst?.id === "op2", "next proposal is shown after success");
  assert(!canSubmitRealFolderCreate({ approvedTestRoot: false, explicitConfirm: true, halt: false, operation: current }), "approval required");
  assert(!canSubmitRealFolderCreate({ approvedTestRoot: true, explicitConfirm: false, halt: false, operation: current }), "single confirmation required");
  assert(canSubmitRealFolderCreate({ approvedTestRoot: true, explicitConfirm: true, halt: false, operation: current }), "ready to submit");
  const halted = executionMustHalt(journal({ operationStatus: { op1: "started", op2: "pending" } }));
  assert(halted.halt && (halted.reason ?? "").includes("Keine automatische Wiederholung"), "crash window does not retry");
  const completedHalt = executionMustHalt(journal({
    status: "completed",
    operationStatus: { op1: "executed", op2: "executed" },
  }));
  assert(completedHalt.halt && (completedHalt.reason ?? "").includes("abgeschlossen"), "FV2-01: completed journal blocks further real ops");
  assert(!journalBoundToApprovedPlan(journal({ status: "completed", operationStatus: { op1: "executed", op2: "executed" } }), approvedPlan()), "FV2-01: completed journal is not an executable binding");

  const mixed = [folderOp("op-folder"), moveOp("op-file"), renameOp("op-rename")];
  const mixedJournal = journal({
    operations: mixed,
    operationStatus: { "op-folder": "pending", "op-file": "pending", "op-rename": "pending" },
  });
  assert(nextRealExecutionOperation(mixed, mixedJournal)?.id === "op-folder", "folders stay ahead of file moves");
  const afterFolder = journal({
    operations: mixed,
    operationStatus: { "op-folder": "executed", "op-file": "pending", "op-rename": "pending" },
  });
  assert(nextRealExecutionOperation(mixed, afterFolder)?.id === "op-file", "next move is shown after folder success, not executed");
  assert(nextRealFileMoveOperation(mixed, afterFolder)?.id === "op-file", "pending move is selected");
  const afterMove = journal({
    operations: mixed,
    operationStatus: { "op-folder": "executed", "op-file": "executed", "op-rename": "pending" },
  });
  assert(nextRealExecutionOperation(mixed, afterMove) === null, "renameFile is never a real execution candidate");
  assert(!shouldAutoExecuteNext(afterFolder), "showing the next move does not auto-execute it");

  const source = confirmedSourcePath("C:\\Dotty-Test", moveOp("op-file"));
  const target = confirmedTargetPath("C:\\Dotty-Test", moveOp("op-file"));
  assert(source === "C:\\Dotty-Test\\Rechnung_A.txt", "full Windows source path");
  assert(target === "C:\\Dotty-Test\\Probeordner\\Rechnung_A.txt", "full Windows target path");

  const facts = {
    kind: "moveFile" as const,
    bindingStatus: "unbound" as const,
    bindingMessage: "",
    source: {
      exists: true, isFile: true, isDir: false, isReparse: false, readable: true, withinRoot: true,
      sizeBytes: 12, modifiedAtMs: 100,
    },
    target: {
      exists: false, isFile: false, isDir: false, isReparse: false, readable: true, withinRoot: true,
      sizeBytes: null, modifiedAtMs: null,
    },
    targetParentExists: true, targetParentIsDir: true, targetParentIsReparse: false, reminder: "erneut",
  };
  const preflightReady = evaluatePreflight({
    operation: moveOp("op-file"), facts, expectedSizeBytes: 12, expectedModifiedAtMs: 100, simulatedFolderTargets: [],
  });
  assert(preflightReady.status === "ready" && preflightReady.canConfirm, "preflight with full fingerprint is ready");
  assert(hasCompleteFileFingerprint(12, 100), "full fingerprint is complete");
  assert(readyMoveSubmit({ decisionStatus: preflightReady.status }), "preflight ready, confirmation set and full fingerprint can submit");
  assert(disableReason({ decision: preflightReady }) === null, "complete grant enables the execute button");
  assert(!readyMoveSubmit({ approvedTestRoot: false }), "missing test-root approval blocks move");
  assert(!readyMoveSubmit({ explicitConfirm: false }), "missing single confirmation blocks move");
  assert(!readyMoveSubmit({ halt: true }), "halted journal blocks move");
  assert(!readyMoveSubmit({ snapshotCurrent: false, journalBoundToPlan: false }), "stale snapshot without bound journal blocks move");
  assert(readyMoveSubmit({ snapshotCurrent: false, journalBoundToPlan: true }), "bound journal keeps move reachable after scan-id change");
  assert(!readyMoveSubmit({ operation: renameOp("op-file") }), "renameFile is blocked");
  assert(!readyMoveSubmit({ operation: folderOp("op-file") }), "folder kind cannot use the move submit");
  assert(!readyMoveSubmit({ decisionStatus: "readySimulated" }), "readySimulated is not a real execution grant");
  assert(!readyMoveSubmit({ decisionStatus: "blocked" }), "blocked preflight cannot execute");
  assert(!readyMoveSubmit({ decisionStatus: "unverifiable" }), "unverifiable preflight cannot execute");
  assert(!readyMoveSubmit({ decisionStatus: null }), "missing live security check blocks move");
  assert(!readyMoveSubmit({ expectedSizeBytes: undefined }), "missing size fingerprint blocks move");
  assert(!readyMoveSubmit({ expectedModifiedAtMs: undefined }), "missing mtime fingerprint blocks move");
  const onlySize = evaluatePreflight({
    operation: moveOp("op-file"), facts, expectedSizeBytes: 12, simulatedFolderTargets: [],
  });
  assert(onlySize.status === "unverifiable" && onlySize.reason.includes("Änderungszeit"), "preflight without mtime is not ready");
  assert(!readyMoveSubmit({ expectedModifiedAtMs: undefined, decisionStatus: onlySize.status }), "missing mtime cannot submit");
  assert((disableReason({ expectedModifiedAtMs: undefined, decision: onlySize }) ?? "").includes("Änderungszeit"), "UI names missing mtime");
  const onlyMtime = evaluatePreflight({
    operation: moveOp("op-file"), facts, expectedModifiedAtMs: 100, simulatedFolderTargets: [],
  });
  assert(onlyMtime.status === "unverifiable" && onlyMtime.reason.includes("Dateigröße"), "preflight without size is not ready");
  assert(!readyMoveSubmit({ expectedSizeBytes: undefined, decisionStatus: onlyMtime.status }), "missing size cannot submit");
  assert((disableReason({ expectedSizeBytes: undefined, decision: onlyMtime }) ?? "").includes("Dateigröße"), "UI names missing size");
  assert(!isReadyForRealExecution("readySimulated"), "simulated ready is not real ready");
  assert(isReadyForRealExecution("ready"), "status ready is the only real grant");
  assert((disableReason({ explicitConfirm: false }) ?? "").includes("Einzelbestätigung"), "UI names missing confirmation");
  assert((disableReason({ decision: null }) ?? "").includes("Sicherheitsprüfung"), "UI names missing live check");

  const operation = moveOp("op-file");
  const bound = bindRealFileMoveConfirm(operation, "j1");
  assert(realFileMoveConfirmIsCurrent(bound, operation, "j1"), "confirm binds to current journal operation");
  assert(!realFileMoveConfirmIsCurrent(bound, { ...operation, kind: "renameFile" }, "j1"), "changed kind invalidates confirm");
  assert(!realFileMoveConfirmIsCurrent(bound, { ...operation, sourcePath: "andere.txt" }, "j1"), "changed source invalidates confirm");
  assert(!realFileMoveConfirmIsCurrent(bound, { ...operation, targetPath: "Probeordner/andere.txt" }, "j1"), "changed target invalidates confirm");
  assert(!realFileMoveConfirmIsCurrent(bound, { ...operation, id: "op-other" }, "j1"), "changed operation id invalidates confirm");
  assert(!realFileMoveConfirmIsCurrent(bound, operation, "j-other"), "changed journal invalidates confirm");
  assert(!readyMoveSubmit({ confirm: bound, journalId: "j-other" }), "journal mismatch blocks submit");
  assert(!readyMoveSubmit({ confirm: { ...bound, sourcePath: "andere.txt" } }), "stale source confirmation blocks submit");
  assert(!readyMoveSubmit({ confirm: { ...bound, targetPath: "Probeordner/andere.txt" } }), "stale target confirmation blocks submit");
  assert(!readyMoveSubmit({ confirm: { ...bound, kind: "renameFile" } }), "stale kind confirmation blocks submit");

  const failed = executionMustHalt(journal({ operationStatus: { op1: "failed", op2: "pending" }, reason: "Die Dateioperation ist fehlgeschlagen." }));
  assert(failed.halt && (failed.reason ?? "").includes("fehlgeschlagen"), "error halts and does not retry");

  const before = realExecutionConfirmKey("p1", 1, journal(), operation);
  const afterPlan = realExecutionConfirmKey("p1", 2, journal(), operation);
  const afterJournal = realExecutionConfirmKey("p1", 1, journal({ journalId: "j2" }), operation);
  const afterOp = realExecutionConfirmKey("p1", 1, journal(), moveOp("op-file", "andere.txt"));
  assert(before !== afterPlan && before !== afterJournal && before !== afterOp, "plan, reservation and operation changes invalidate the confirm key");

  // A: gültig vorbereitetes Journal + unveränderter Plan → Op erreichbar trotz neuer Scan-ID (current=false)
  const boundJournal = journal({
    operations: [moveOp("op-file")],
    operationStatus: { "op-file": "pending" },
  });
  const plan = approvedPlan();
  assert(journalBoundToApprovedPlan(boundJournal, plan), "prepared journal binds to the approved plan");
  assert(realExecutionUiOpen(plan, false, boundJournal), "A: UI stays open with bound journal after rescan");
  const reachable = realExecutionOperationsFrom([], boundJournal, plan, false);
  assert(nextRealExecutionOperation(reachable, boundJournal)?.id === "op-file", "A: pending move remains reachable from journal");
  assert(readyMoveSubmit({ snapshotCurrent: false, journalBoundToPlan: true }), "A: submit gate allows bound continuation");

  // B: veränderter Plan → keine Übernahme der alten Freigabe
  const changedPlan = approvedPlan({ revision: 2, planId: "p-other" });
  assert(!journalBoundToApprovedPlan(boundJournal, changedPlan), "B: different plan id/revision does not inherit journal");
  assert(!realExecutionUiOpen(changedPlan, false, boundJournal), "B: UI closed without current snapshot for foreign plan");
  assert(realExecutionOperationsFrom([], boundJournal, changedPlan, false).length === 0, "B: no operations for unmatched plan");

  // C: veränderte Quelldatei → Preflight blockiert echte Ausführung
  const changedSource = evaluatePreflight({
    operation: moveOp("op-file"),
    facts: { ...facts, source: { ...facts.source, sizeBytes: 99 } },
    expectedSizeBytes: 12,
    expectedModifiedAtMs: 100,
    simulatedFolderTargets: [],
  });
  assert(changedSource.status === "blocked" && changedSource.halt, "C: changed source fingerprint blocks execution");
  assert(!readyMoveSubmit({ snapshotCurrent: false, journalBoundToPlan: true, decisionStatus: changedSource.status }), "C: submit rejects changed source");

  // D: vorhandene Zieldatei → keine Überschreibung
  const occupiedTarget = evaluatePreflight({
    operation: moveOp("op-file"),
    facts: {
      ...facts,
      target: { ...facts.target, exists: true, isFile: true },
    },
    expectedSizeBytes: 12,
    expectedModifiedAtMs: 100,
    simulatedFolderTargets: [],
  });
  assert(occupiedTarget.status === "blocked" && occupiedTarget.reason.includes("belegt"), "D: existing target blocks overwrite");
  assert(!readyMoveSubmit({ snapshotCurrent: false, journalBoundToPlan: true, decisionStatus: occupiedTarget.status }), "D: submit rejects occupied target");

  // E: fehlende oder widersprüchliche Journalzuordnung → keine Ausführung
  assert(!journalBoundToApprovedPlan(null, plan), "E: missing journal is not bound");
  assert(!journalBoundToApprovedPlan(journal({ planId: "other" }), plan), "E: planId mismatch is not bound");
  assert(!journalBoundToApprovedPlan(journal({ planRevision: 9 }), plan), "E: planRevision mismatch is not bound");
  assert(!journalBoundToApprovedPlan(journal({
    binding: { ...journal().binding, snapshotFingerprint: "vp1-other" },
  }), plan), "E: fingerprint mismatch is not bound");
  assert(!journalBoundToApprovedPlan(journal({ bindingStatus: "released" }), plan), "E: released binding is not executable");
  assert(!realExecutionUiOpen(plan, false, null), "E: without journal and without current, UI stays closed");
  assert(!readyMoveSubmit({ snapshotCurrent: false, journalBoundToPlan: false, journalId: null }), "E: missing journal id blocks submit");

  // F: Operation außerhalb der Scanwurzel / Testbereichs → keine Ausführung
  const outside = evaluatePreflight({
    operation: moveOp("op-file"),
    facts: { ...facts, source: { ...facts.source, withinRoot: false } },
    expectedSizeBytes: 12,
    expectedModifiedAtMs: 100,
    simulatedFolderTargets: [],
  });
  assert(outside.status === "blocked" && outside.reason.includes("außerhalb"), "F: path outside scan root is blocked");
  assert(!readyMoveSubmit({ snapshotCurrent: false, journalBoundToPlan: true, decisionStatus: outside.status }), "F: submit rejects outside-root operation");
  assert(!readyMoveSubmit({ approvedTestRoot: false, snapshotCurrent: false, journalBoundToPlan: true }), "F: missing test-root approval blocks execution");
}
