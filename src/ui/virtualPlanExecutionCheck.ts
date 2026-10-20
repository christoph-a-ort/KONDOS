import type { VirtualDryRunOperation } from "./virtualPlanDryRun";
import type { VirtualPlanJournal } from "./virtualPlanJournal";
import {
  canSubmitRealFolderCreate, executionMustHalt, isRealFolderCreateKind, nextRealFolderOperation,
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

export function runVirtualPlanExecutionCheck(): void {
  assert(realFolderOperationLabel("createVirtualFolder") === "Ordner anlegen", "folder label");
  assert(!isRealFolderCreateKind("moveFile") && !isRealFolderCreateKind("renameFile"), "file ops forbidden");
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
}
