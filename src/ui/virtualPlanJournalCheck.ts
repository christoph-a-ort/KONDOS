import type { DirectoryNode, ScanConfig, ScanResult } from "../model";
import { makeSnapshotBinding } from "./virtualPlan";
import type { VirtualDryRunReport } from "./virtualPlanDryRun";
import {
  bindingAllowsProgress, bindingAllowsRelease, bindingBlocksNewRun,
  createVirtualPlanJournal, journalForBoundWrite, parsePersistedJournal,
  shouldAutoResumeSimulation, simulateJournal, type VirtualPlanJournal,
} from "./virtualPlanJournal";

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
}
