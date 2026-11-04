/** FV2-02d.2 – Dry-run/preflight storage gate. No real filesystem mutation. */
import type { DirectoryNode, FileNode, FsNode, ScanConfig, ScanResult } from "../model";
import { isDirectory } from "../model";
import { makeSnapshotBinding, type SnapshotBinding, type VirtualPlan, type VirtualPlanFolder, type VirtualPlanItem } from "./virtualPlan";
import { buildVirtualPlanDryRun, dryRunStatusLabel } from "./virtualPlanDryRun";
import { createVirtualPlanJournal } from "./virtualPlanJournal";
import { evaluatePreflight, type PlannedOperationFacts } from "./virtualPlanPreflight";
import {
  STORAGE_REMOTE_REASON, STORAGE_UNSUPPORTED_REASON, STORAGE_UNVERIFIABLE_REASON,
  applyStorageClassification, existingStoragePathsForDryRun, parseStorageKind, storageAllowsJournal,
  worstStorageKind, type StorageKindView,
} from "./windowsStorage";
import { classifyDryRunReportStorage } from "./windowsStorageApi";

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

function file(id: string, name: string, depth: number): FileNode {
  return { id, path: id, name, depth, kind: "file", sizeBytes: 1, modifiedAtMs: 100 };
}

function dir(id: string, name: string, depth: number, children: FsNode[]): DirectoryNode {
  return { id, path: id, name, depth, kind: "directory", listing: "read", children };
}

function inventory(rootPath: string, children: FsNode[]): ScanResult {
  const name = rootPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "Fixture";
  const root = dir(rootPath, name, 0, children);
  return { root, warnings: [], stats: { directoryCount: 2, fileCount: children.filter((node) => node.kind === "file").length, skippedCount: 0, durationMs: 1 } };
}

function relativeOf(rootPath: string, nodePath: string): string {
  const root = rootPath.replace(/\\/g, "/").toLowerCase();
  const path = nodePath.replace(/\\/g, "/").toLowerCase();
  if (path === root) return ".";
  return path.slice(root.length + 1);
}

function itemsFor(result: ScanResult, fileTargets: Record<string, string>): VirtualPlanItem[] {
  const items: VirtualPlanItem[] = [];
  const walk = (node: FsNode) => {
    const relative = relativeOf(result.root.path, node.path);
    const target = node.kind === "file"
      ? (fileTargets[relative] ?? (relative.includes("/") ? relative.slice(0, relative.lastIndexOf("/")) : "."))
      : (relative.includes("/") ? relative.slice(0, relative.lastIndexOf("/")) : ".");
    items.push({
      id: `vpi_${relative}`,
      observed: {
        nodeId: node.id,
        relativePath: relative,
        kind: node.kind,
        identityStatus: "scanLocalOnly",
        metadata: { sizeBytes: node.sizeBytes, modifiedAtMs: node.modifiedAtMs },
      },
      virtualTargetPath: target,
      originalVirtualTargetPath: target,
      status: node.kind === "file" && fileTargets[relative] !== undefined ? "edited" : "excluded",
      sourceInsightIds: [],
      alternatives: [],
    });
    if (isDirectory(node)) node.children.forEach(walk);
  };
  walk(result.root);
  return items;
}

function folder(name: string): VirtualPlanFolder {
  return { id: `vpf_${name}`, sourceProposalId: "prop", parentVirtualPath: ".", name, originalName: name };
}

function approvedPlan(result: ScanResult, binding: SnapshotBinding, folders: VirtualPlanFolder[], fileTargets: Record<string, string>): VirtualPlan {
  return {
    schemaVersion: 1,
    planId: `vp_${binding.snapshotFingerprint}`,
    builderVersion: 1,
    revision: 1,
    status: "virtuallyApproved",
    scope: { kind: "scanRoot", rootNodeId: result.root.id },
    binding,
    items: itemsFor(result, fileTargets),
    virtualFolders: folders,
    openCases: [],
    decisions: [],
    preferences: [],
  };
}

function localFacts(): PlannedOperationFacts {
  return {
    kind: "moveFile",
    bindingStatus: "unbound",
    bindingMessage: "",
    source: { exists: true, isFile: true, isDir: false, isReparse: false, readable: true, withinRoot: true, sizeBytes: 1, modifiedAtMs: 100 },
    target: { exists: false, isFile: false, isDir: false, isReparse: false, readable: true, withinRoot: true, sizeBytes: null, modifiedAtMs: null },
    targetParentExists: true,
    targetParentIsDir: true,
    targetParentIsReparse: false,
    maximumComponentLength: 255,
    storageKind: "local",
    storageMessage: null,
    reminder: "erneut",
  };
}

function journalOk(plan: VirtualPlan, binding: SnapshotBinding, report: ReturnType<typeof buildVirtualPlanDryRun>): boolean {
  try {
    createVirtualPlanJournal(plan, binding, report);
    return true;
  } catch {
    return false;
  }
}

function localViews(paths: ReadonlyArray<string>): StorageKindView[] {
  return paths.map((path) => ({ path, kind: "local", message: null }));
}

export async function runWindowsStorageCheck(): Promise<void> {
  assert(parseStorageKind("local") === "local", "A: local kind parses");
  assert(parseStorageKind("remote") === "remote", "C: remote kind parses");
  assert(parseStorageKind("unsupported") === "unsupported", "E: unsupported kind parses");
  assert(parseStorageKind("unverifiable") === "unverifiable", "D: unverifiable kind parses");
  assert(parseStorageKind("LOCAL") === "unverifiable", "I: unknown kind is never local");
  assert(parseStorageKind("") === "unverifiable", "I: empty kind is never local");
  assert(parseStorageKind(null) === "unverifiable", "I: null kind is never local");
  assert(worstStorageKind([]) === "unverifiable", "I: empty fold is unverifiable");
  assert(worstStorageKind(["local", "local"]) === "local", "A: all-local fold");
  assert(worstStorageKind(["local", "remote", "unsupported"]) === "remote", "F: one remote wins");
  assert(STORAGE_REMOTE_REASON.includes("Netzwerkspeicherort") && STORAGE_REMOTE_REASON.includes("nicht zulässig"), "G: remote wording");
  assert(STORAGE_UNVERIFIABLE_REASON.includes("nicht zuverlässig"), "G: unverifiable wording");
  assert(STORAGE_UNSUPPORTED_REASON.includes("nicht unterstützt"), "G: unsupported wording");
  assert(dryRunStatusLabel("blocked") === "Blockiert", "G: blocked label");
  assert(dryRunStatusLabel("unverifiable") === "Nicht sicher verifizierbar", "G: unverifiable label");
  assert(dryRunStatusLabel("restricted") === "Eingeschränkt – nur statisch geprüft", "G: restricted label");

  const localScan = inventory("C:\\Fixture", [
    file("C:\\Fixture\\a.txt", "a.txt", 1),
    file("C:\\Fixture\\b.txt", "b.txt", 1),
    dir("C:\\Fixture\\Ziel", "Ziel", 1, []),
  ]);
  const localBinding = makeSnapshotBinding(localScan, config, 1);
  const localPlan = approvedPlan(localScan, localBinding, [folder("Ziel")], { "a.txt": "Ziel", "b.txt": "Ziel" });
  const localDry = buildVirtualPlanDryRun({ plan: localPlan, scanResult: localScan, binding: localBinding, current: true });
  assert(localDry.status === "restricted" && localDry.operations.length >= 2, "H: local virtual plan remains restricted");
  const localClassified = applyStorageClassification(localDry, ["local", "local"]);
  assert(localClassified.status === "restricted" && localClassified.storageClassification === "local", "A: local stays restricted");
  assert(storageAllowsJournal(localClassified), "A: local classified dry-run may prepare a journal");
  assert(journalOk(localPlan, localBinding, localClassified), "A: journal remains possible for local");
  assert(!journalOk(localPlan, localBinding, localDry), "I: unclassified restricted report cannot create a journal");
  const localReady = evaluatePreflight({
    operation: localDry.operations.find((operation) => operation.kind === "moveFile") ?? localDry.operations[0]!,
    facts: localFacts(),
    scanRoot: "C:\\Fixture",
    expectedSizeBytes: 1,
    expectedModifiedAtMs: 100,
    simulatedFolderTargets: [],
  });
  assert(localReady.status === "ready" && localReady.canConfirm, "A: local + remaining checks reach ready");

  const uncScan = inventory("\\\\server\\share", [
    file("\\\\server\\share\\a.txt", "a.txt", 1),
    dir("\\\\server\\share\\Ziel", "Ziel", 1, []),
  ]);
  const uncBinding = makeSnapshotBinding(uncScan, { ...config, rootPath: "\\\\server\\share" }, 2);
  const uncPlan = approvedPlan(uncScan, uncBinding, [folder("Ziel")], { "a.txt": "Ziel" });
  const uncDry = buildVirtualPlanDryRun({ plan: uncPlan, scanResult: uncScan, binding: uncBinding, current: true });
  assert(uncDry.status === "restricted" && uncDry.operations.length > 0, "B: UNC remains virtually plannable");
  const uncClassified = applyStorageClassification(uncDry, ["remote"]);
  assert(uncClassified.status === "blocked", "B: UNC dry-run is blocked");
  assert(uncClassified.operations.length === uncDry.operations.length, "B/G: planned UNC operations stay visible");
  assert(uncClassified.openRequirements.includes(STORAGE_REMOTE_REASON), "B/G: UNC block reason is understandable");
  assert(!uncClassified.openRequirements.some((item) => item.toLowerCase().includes("bereit") && item.toLowerCase().includes("ausführ")), "G: no false success wording");
  assert(!storageAllowsJournal(uncClassified) && !journalOk(uncPlan, uncBinding, uncClassified), "B: UNC cannot create a journal");

  const mapped = applyStorageClassification(localDry, ["remote"]);
  assert(mapped.status === "blocked" && mapped.storageClassification === "remote", "C: mapped remote becomes blocked");
  assert(!journalOk(localPlan, localBinding, mapped), "C: mapped remote cannot create a journal");
  const mappedReady = evaluatePreflight({
    operation: localDry.operations[0]!,
    facts: { ...localFacts(), storageKind: "remote", storageMessage: STORAGE_REMOTE_REASON },
    scanRoot: "Z:\\Dokumente",
    expectedSizeBytes: 1,
    expectedModifiedAtMs: 100,
    simulatedFolderTargets: [],
  });
  assert(mappedReady.status === "blocked" && mappedReady.reason.includes("Netzwerk"), "C: TypeScript takes blocked from Rust remote");

  const unverifiable = applyStorageClassification(localDry, ["unverifiable"]);
  assert(unverifiable.status === "unverifiable", "D: unverifiable does not become ready");
  assert(!storageAllowsJournal(unverifiable) && !journalOk(localPlan, localBinding, unverifiable), "D: unverifiable cannot create a journal");
  const unsupported = applyStorageClassification(localDry, ["unsupported"]);
  assert(unsupported.status === "blocked" && unsupported.openRequirements.includes(STORAGE_UNSUPPORTED_REASON), "E: unsupported has its own reason");
  assert(!journalOk(localPlan, localBinding, unsupported), "E: unsupported cannot create a journal");

  const mixed = applyStorageClassification(localDry, ["local", "remote"]);
  assert(mixed.status === "blocked" && mixed.storageClassification === "remote", "F: one remote blocks the whole dry-run");
  assert(mixed.operations.length === localDry.operations.length, "F/G: mixed plan keeps the full operation list");
  assert(!journalOk(localPlan, localBinding, mixed), "F: mixed plan creates no partial journal");

  const emptyKinds = applyStorageClassification(localDry, []);
  assert(emptyKinds.status === "unverifiable" && emptyKinds.storageClassification === "unverifiable", "I: empty API result is never local");
  assert(!journalOk(localPlan, localBinding, emptyKinds), "I: failed/empty classification cannot create a journal");
  const staleLocal = applyStorageClassification({ ...localDry, storageClassification: "local" }, ["remote"]);
  assert(staleLocal.storageClassification === "remote" && !storageAllowsJournal(staleLocal), "I: stored local is overwritten by a later remote result");

  const paths = existingStoragePathsForDryRun(localScan.root.path, localScan, localDry.operations);
  assert(paths.includes(localScan.root.path), "7: scan root is inspected");
  assert(paths.some((path) => path.replace(/\\/g, "/").toLowerCase().endsWith("/a.txt")), "7: existing source file is inspected");
  assert(paths.some((path) => path.replace(/\\/g, "/").toLowerCase().endsWith("/ziel")), "7: existing destination parent is inspected");
  assert(!paths.some((path) => path.replace(/\\/g, "/").toLowerCase().endsWith("/ziel/a.txt")), "7: missing destination is not probe-created");

  let inspected: ReadonlyArray<string> = [];
  const mixedInspected = await classifyDryRunReportStorage(localScan.root.path, localScan, localDry, async (requested) => {
    inspected = requested;
    return requested.map((path, index) => ({
      path,
      kind: index === requested.length - 1 ? "remote" : "local",
      message: index === requested.length - 1 ? STORAGE_REMOTE_REASON : null,
    }));
  });
  assert(mixedInspected.status === "blocked" && mixedInspected.storageClassification === "remote", "F: production classify path blocks mixed inspect");
  assert(mixedInspected.operations.length === localDry.operations.length, "F: production classify keeps operations");
  assert(!journalOk(localPlan, localBinding, mixedInspected), "F: production classify creates no journal");
  assert(inspected.length >= 2, "7: production classify inspects more than the scan root");

  const emptyInspect = await classifyDryRunReportStorage(localScan.root.path, localScan, localDry, async () => []);
  assert(emptyInspect.storageClassification === "unverifiable", "I: empty inspect array is unverifiable");
  assert(!journalOk(localPlan, localBinding, emptyInspect), "I: empty inspect cannot create a journal");

  const failedInspect = await classifyDryRunReportStorage(localScan.root.path, localScan, localDry, async () => {
    throw new Error("invoke failed");
  });
  assert(failedInspect.storageClassification === "unverifiable" && failedInspect.status === "unverifiable", "I: failed Rust query is never local");
  assert(!journalOk(localPlan, localBinding, failedInspect), "I: failed Rust query cannot create a journal");

  const localInspect = await classifyDryRunReportStorage(localScan.root.path, localScan, localDry, async (requested) => localViews(requested));
  assert(localInspect.status === "restricted" && localInspect.storageClassification === "local", "A: production classify keeps local ready-capable");
  assert(journalOk(localPlan, localBinding, localInspect), "A: production local classify may create a journal");
}
