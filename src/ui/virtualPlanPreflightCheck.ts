import type { VirtualDryRunOperation } from "./virtualPlanDryRun";
import {
  abortPreflight, applyPreflightDecision, confirmSimulatedOperation, createPreflightSession,
  evaluatePreflight, previewSimulatedUndo, preflightStatusLabel, shouldAutoConfirmNext,
  shouldAutoResumePreflight,
  type PlannedOperationFacts, type PreflightDecision,
} from "./virtualPlanPreflight";

function assert(value: boolean, label: string): void {
  if (!value) throw new Error(label);
}

function observation(overrides: Partial<PlannedOperationFacts["source"]> = {}): PlannedOperationFacts["source"] {
  return {
    exists: true, isFile: true, isDir: false, isReparse: false, readable: true, withinRoot: true,
    sizeBytes: 5, modifiedAtMs: 100, ...overrides,
  };
}

function facts(overrides: Partial<PlannedOperationFacts> = {}): PlannedOperationFacts {
  return {
    kind: "moveFile", bindingStatus: "unbound", bindingMessage: "",
    source: observation(),
    target: observation({ exists: false, isFile: false, sizeBytes: null, modifiedAtMs: null }),
    targetParentExists: true, targetParentIsDir: true, targetParentIsReparse: false,
    reminder: "erneut", ...overrides,
  };
}

function fileOp(id: string, kind: "moveFile" | "renameFile" = "moveFile"): VirtualDryRunOperation {
  return {
    id, kind, objectId: "n1", sourcePath: "a.txt", targetPath: "b.txt",
    expectedSource: "src", preconditions: [], expectedTarget: "dst",
    collisionStatus: "mustCheckAtExecution", checkStatus: "mustCheckAtExecution",
    rationale: "t", recovery: "r",
  };
}

const ready: PreflightDecision = { status: "ready", reason: "ok", canConfirm: true, halt: false };

export function runVirtualPlanPreflightCheck(): void {
  assert(preflightStatusLabel("readySimulated") === "Bereit (nur Simulation)", "readySimulated label");
  assert(preflightStatusLabel("ready") === "Prüfung erfolgreich", "ready label");
  assert(preflightStatusLabel("blocked") === "Blockiert", "blocked label");
  assert(preflightStatusLabel("unverifiable") === "Nicht sicher verifizierbar", "unverifiable label");
  const move = fileOp("op1");
  assert(evaluatePreflight({ operation: move, facts: facts(), expectedSizeBytes: 5, expectedModifiedAtMs: 100, simulatedFolderTargets: [] }).canConfirm, "valid file operation");
  assert(evaluatePreflight({ operation: move, facts: facts({ source: observation({ exists: false }) }), expectedSizeBytes: 5, simulatedFolderTargets: [] }).reason.includes("fehlt"), "missing source");
  assert(evaluatePreflight({ operation: move, facts: facts({ target: observation() }), expectedSizeBytes: 5, simulatedFolderTargets: [] }).reason.includes("belegt"), "existing target");
  assert(evaluatePreflight({ operation: move, facts: facts({ source: observation({ sizeBytes: 9 }) }), expectedSizeBytes: 5, simulatedFolderTargets: [] }).halt, "changed source stops");
  assert(evaluatePreflight({ operation: move, facts: facts({ source: observation({ withinRoot: false }) }), expectedSizeBytes: 5, simulatedFolderTargets: [] }).reason.includes("außerhalb"), "path outside root");
  assert(evaluatePreflight({ operation: move, facts: facts({ source: observation({ isReparse: true }) }), expectedSizeBytes: 5, simulatedFolderTargets: [] }).reason.includes("Reparse"), "reparse/junction");
  assert(evaluatePreflight({ operation: move, facts: facts(), simulatedFolderTargets: [] }).status === "unverifiable", "missing planning metadata is unverifiable");
  assert(evaluatePreflight({ operation: move, facts: facts({ bindingStatus: "inconsistent", bindingMessage: "unklar" }), expectedSizeBytes: 5, simulatedFolderTargets: [] }).halt, "inconsistent binding stops");

  const operations = [fileOp("op1"), fileOp("op2")];
  let session = createPreflightSession(operations);
  const blocked = evaluatePreflight({ operation: move, facts: facts({ source: observation({ exists: false }) }), expectedSizeBytes: 5, simulatedFolderTargets: [] });
  session = applyPreflightDecision(session, "op1", blocked);
  assert(session.halted && session.outcomes.op2 === "pending", "error stop leaves later operations unconfirmed");

  session = createPreflightSession(operations);
  session = confirmSimulatedOperation(session, operations, "op1", ready);
  assert(session.currentIndex === 1 && session.outcomes.op1 === "simulatedConfirmed" && session.outcomes.op2 === "pending", "next proposal is shown, not confirmed");
  assert(!shouldAutoConfirmNext(session), "no automatic follow-up confirmation");
  assert(!shouldAutoResumePreflight("reserved", session), "restart does not auto-execute");
  assert(previewSimulatedUndo(session, "op1").reason.includes("P2-L.4a"), "undo remains preparatory");
  session = abortPreflight(session, "op2");
  assert(session.halted && session.outcomes.op2 === "aborted", "abort halts without executing");
}
