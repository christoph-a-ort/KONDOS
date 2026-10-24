/** FV2-02a – Shared Windows path-rule checks. Synthetic only, no filesystem actions. */
import type { DirectoryNode, FileNode, ScanConfig, ScanResult } from "../model";
import { makeSnapshotBinding, type VirtualPlan, type VirtualPlanItem } from "./virtualPlan";
import { assignFileToVirtualFolder, renameVirtualPlanFolder, validateVirtualPlan } from "./virtualPlanEditor";
import { buildVirtualPlanDryRun } from "./virtualPlanDryRun";
import { evaluatePreflight, type PlannedOperationFacts } from "./virtualPlanPreflight";
import {
  assertWindowsPathRuleFixture,
  executionPathLooksUnsafe,
  isAllowedAbsoluteWindowsPath,
  isAllowedRelativePlanPath,
  isAllowedWindowsComponent,
  type WindowsPathRuleFixture,
} from "./windowsPathRules";

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

function file(id: string, name: string): FileNode {
  return { id, path: id, name, depth: 1, kind: "file", sizeBytes: 1 };
}

function reservedInventory(): ScanResult {
  const root: DirectoryNode = {
    id: "C:\\Fixture",
    path: "C:\\Fixture",
    name: "Fixture",
    depth: 0,
    kind: "directory",
    listing: "read",
    children: [
      file("C:\\Fixture\\CON.txt", "CON.txt"),
      file("C:\\Fixture\\Rechnung.pdf", "Rechnung.pdf"),
    ],
  };
  return {
    root,
    warnings: [],
    stats: { directoryCount: 1, fileCount: 2, skippedCount: 0, durationMs: 1 },
  };
}

function item(nodeId: string, relative: string, kind: "file" | "directory", target: string): VirtualPlanItem {
  return {
    id: `vpi_${relative}`,
    observed: {
      nodeId,
      relativePath: relative,
      kind,
      identityStatus: "scanLocalOnly",
      metadata: { sizeBytes: 1 },
    },
    virtualTargetPath: target,
    originalVirtualTargetPath: target,
    status: "proposed",
    sourceInsightIds: [],
    alternatives: [],
  };
}

function draftWithBerichte(result: ScanResult): { plan: VirtualPlan; binding: ReturnType<typeof makeSnapshotBinding> } {
  const binding = makeSnapshotBinding(result, config, 1);
  const plan: VirtualPlan = {
    schemaVersion: 1,
    planId: "vp_reserved",
    builderVersion: 1,
    revision: 1,
    status: "draft",
    scope: { kind: "scanRoot", rootNodeId: result.root.id },
    binding,
    items: [
      item(result.root.id, ".", "directory", "."),
      item("C:\\Fixture\\CON.txt", "CON.txt", "file", "."),
      item("C:\\Fixture\\Rechnung.pdf", "Rechnung.pdf", "file", "."),
    ],
    virtualFolders: [
      { id: "vpf_berichte", sourceProposalId: "prop", parentVirtualPath: ".", name: "Berichte", originalName: "Berichte" },
    ],
    openCases: [],
    decisions: [],
    preferences: [],
  };
  return { plan, binding };
}

export function runWindowsPathRulesCheck(fixture: WindowsPathRuleFixture): void {
  assertWindowsPathRuleFixture(fixture, assert);
  assert(isAllowedWindowsComponent("Rechnung.pdf"), "smoke allowed invoice name");
  assert(!isAllowedWindowsComponent("CON.txt"), "smoke reserved with extension");
  assert(isAllowedRelativePlanPath("Docs/Rechnung.pdf"), "smoke relative folder file");
  assert(isAllowedAbsoluteWindowsPath("C:\\Ordner\\Datei.txt"), "smoke drive path");
  assert(isAllowedAbsoluteWindowsPath("C:\\Ordner\\Unterordner\\Datei.txt"), "nested drive path remains allowed");
  assert(isAllowedAbsoluteWindowsPath("\\\\server\\share\\Ordner\\Datei.txt"), "unc path remains allowed by name only");
  assert(!isAllowedAbsoluteWindowsPath("C:\\Ordner\\\\Datei.txt"), "empty component after folder is rejected");
  assert(!isAllowedAbsoluteWindowsPath("C:\\\\Ordner\\Datei.txt"), "empty component after drive root is rejected");
  assert(!isAllowedAbsoluteWindowsPath("\\\\server\\share\\\\Datei.txt"), "empty unc inner component is rejected");
  assert(!isAllowedAbsoluteWindowsPath("\\\\server\\\\share\\Datei.txt"), "empty unc server-share component is rejected");
  assert(!isAllowedAbsoluteWindowsPath("C:\\Ordner\\Datei.txt\\\\"), "trailing extra separators are rejected");
  assert(!isAllowedAbsoluteWindowsPath("\\\\.\\CON"), "device path remains rejected");
  assert(!isAllowedAbsoluteWindowsPath("C:\\Ordner\\Datei.txt:Stream"), "ADS absolute path remains rejected");
  assert(!isAllowedAbsoluteWindowsPath("C:\\Ordner\\CON.txt"), "reserved absolute name remains rejected");
  assert(isAllowedRelativePlanPath("Docs/Rechnung.pdf"), "relative rules stay independent");
  assert(!isAllowedRelativePlanPath("Docs//Rechnung.pdf"), "relative empty component stays rejected");
  assert(executionPathLooksUnsafe("Datei.txt:$DATA"), "smoke ADS execution path");

  const result = reservedInventory();
  const { plan, binding } = draftWithBerichte(result);
  assert(validateVirtualPlan(plan, result, binding).valid, "existing reserved file remains in a valid draft");
  const assigned = assignFileToVirtualFolder(plan, "vpi_CON.txt", "vpf_berichte");
  assert(assigned.ok, "existing reserved file stays virtually assignable");
  if (!assigned.ok) return;
  assert(validateVirtualPlan(assigned.plan, result, binding).valid, "assigned reserved inventory remains a valid draft");
  assert(assigned.plan.items.some((entry) => entry.observed.relativePath === "CON.txt" && entry.virtualTargetPath === "Berichte"), "reserved inventory stays visible in the virtual assignment");

  const reservedFolder = renameVirtualPlanFolder(assigned.plan, "vpf_berichte", "CON.txt");
  assert(!reservedFolder.ok, "new reserved target folder name is rejected");
  const com0Folder = renameVirtualPlanFolder(assigned.plan, "vpf_berichte", "COM0");
  assert(!com0Folder.ok, "new COM0 target folder name is rejected");

  const approved = { ...assigned.plan, status: "virtuallyApproved" as const };
  const dryRun = buildVirtualPlanDryRun({ plan: approved, scanResult: result, binding, current: true });
  assert(approved.items.some((entry) => entry.observed.relativePath === "CON.txt"), "reserved inventory remains in the approved virtual plan");
  assert(dryRun.status === "blocked", "reserved target name is not executable before F8 marking");

  const facts: PlannedOperationFacts = {
    kind: "moveFile",
    bindingStatus: "unbound",
    bindingMessage: "",
    source: { exists: true, isFile: true, isDir: false, isReparse: false, readable: true, withinRoot: true, sizeBytes: 1, modifiedAtMs: 100 },
    target: { exists: false, isFile: false, isDir: false, isReparse: false, readable: true, withinRoot: true, sizeBytes: null, modifiedAtMs: null },
    targetParentExists: true,
    targetParentIsDir: true,
    targetParentIsReparse: false,
    maximumComponentLength: 255,
    reminder: "erneut",
  };
  const blocked = evaluatePreflight({
    operation: {
      id: "op1",
      kind: "moveFile",
      objectId: "n1",
      sourcePath: "CON.txt",
      targetPath: "Berichte/Rechnung.pdf",
      expectedSource: "src",
      preconditions: [],
      expectedTarget: "dst",
      collisionStatus: "mustCheckAtExecution",
      checkStatus: "mustCheckAtExecution",
      rationale: "t",
      recovery: "r",
    },
    facts,
    expectedSizeBytes: 1,
    expectedModifiedAtMs: 100,
    simulatedFolderTargets: [],
  });
  assert(blocked.status === "blocked" && !blocked.canConfirm, "preflight blocks reserved inventory execution");
}
