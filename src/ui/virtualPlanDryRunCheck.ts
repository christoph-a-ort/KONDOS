/** P2-L.4b.2 stage 1: existing scan directories must not become createVirtualFolder. */
import type { DirectoryNode, FileNode, FsNode, ScanConfig, ScanResult } from "../model";
import { isDirectory } from "../model";
import { makeSnapshotBinding, type SnapshotBinding, type VirtualPlan, type VirtualPlanFolder, type VirtualPlanItem } from "./virtualPlan";
import { createVirtualPlanJournal } from "./virtualPlanJournal";
import { buildVirtualPlanDryRun } from "./virtualPlanDryRun";

function assert(value: boolean, label: string): void {
  if (!value) throw new Error(label);
}

const config: ScanConfig = {
  rootPath: "C:\\Dotty-Test",
  maxDepth: 10,
  excludeHidden: true,
  extensions: [],
  includeSize: true,
  includeCreatedAt: false,
  includeModifiedAt: true,
};

function file(id: string, name: string, depth: number): FileNode {
  return { id, path: id, name, depth, kind: "file", sizeBytes: 12, modifiedAtMs: 100 };
}

function dir(id: string, name: string, depth: number, children: FsNode[], listing: DirectoryNode["listing"] = "read"): DirectoryNode {
  return { id, path: id, name, depth, kind: "directory", listing, children };
}

function withProbeordner(): ScanResult {
  const root = dir("C:\\Dotty-Test", "Dotty-Test", 0, [
    file("C:\\Dotty-Test\\Rechnung_A.txt", "Rechnung_A.txt", 1),
    file("C:\\Dotty-Test\\Rechnung_B.txt", "Rechnung_B.txt", 1),
    dir("C:\\Dotty-Test\\Probeordner", "Probeordner", 1, []),
  ]);
  return { root, warnings: [], stats: { directoryCount: 2, fileCount: 2, skippedCount: 0, durationMs: 1 } };
}

function withoutProbeordner(): ScanResult {
  const root = dir("C:\\Dotty-Test", "Dotty-Test", 0, [
    file("C:\\Dotty-Test\\Rechnung_A.txt", "Rechnung_A.txt", 1),
    file("C:\\Dotty-Test\\Rechnung_B.txt", "Rechnung_B.txt", 1),
  ]);
  return { root, warnings: [], stats: { directoryCount: 1, fileCount: 2, skippedCount: 0, durationMs: 1 } };
}

function nestedSameName(): ScanResult {
  const root = dir("C:\\Dotty-Test", "Dotty-Test", 0, [
    file("C:\\Dotty-Test\\Rechnung_A.txt", "Rechnung_A.txt", 1),
    dir("C:\\Dotty-Test\\Other", "Other", 1, [
      dir("C:\\Dotty-Test\\Other\\Probeordner", "Probeordner", 2, []),
    ]),
  ]);
  return { root, warnings: [], stats: { directoryCount: 3, fileCount: 1, skippedCount: 0, durationMs: 1 } };
}

function probeordnerAsFile(): ScanResult {
  const root = dir("C:\\Dotty-Test", "Dotty-Test", 0, [
    file("C:\\Dotty-Test\\Rechnung_A.txt", "Rechnung_A.txt", 1),
    file("C:\\Dotty-Test\\Probeordner", "Probeordner", 1),
  ]);
  return { root, warnings: [], stats: { directoryCount: 1, fileCount: 2, skippedCount: 0, durationMs: 1 } };
}

function incompleteProbeordner(): ScanResult {
  const root = dir("C:\\Dotty-Test", "Dotty-Test", 0, [
    file("C:\\Dotty-Test\\Rechnung_A.txt", "Rechnung_A.txt", 1),
    dir("C:\\Dotty-Test\\Probeordner", "Probeordner", 1, [], "incomplete"),
  ]);
  return { root, warnings: [], stats: { directoryCount: 2, fileCount: 1, skippedCount: 0, durationMs: 1 } };
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
    const target = node.kind === "file" ? (fileTargets[relative] ?? (relative.includes("/") ? relative.slice(0, relative.lastIndexOf("/")) : ".")) : (relative.includes("/") ? relative.slice(0, relative.lastIndexOf("/")) : ".");
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

function folder(name: string, parentVirtualPath = "."): VirtualPlanFolder {
  return { id: `vpf_${name}`, sourceProposalId: "prop", parentVirtualPath, name, originalName: name };
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

export function runVirtualPlanDryRunCheck(): void {
  const existing = withProbeordner();
  const existingBinding = makeSnapshotBinding(existing, config, 11);
  const existingPlan = approvedPlan(existing, existingBinding, [folder("Probeordner")], { "rechnung_a.txt": "Probeordner" });
  const existingRun = buildVirtualPlanDryRun({ plan: existingPlan, scanResult: existing, binding: existingBinding, current: true });
  assert(existingRun.status === "restricted", "existing real directory remains restricted, not blocked");
  assert(!existingRun.operations.some((operation) => operation.kind === "createVirtualFolder"), "existing scan directory does not emit createVirtualFolder");
  assert(existingRun.operations.filter((operation) => operation.kind === "moveFile").length === 1, "file move into existing directory is kept");
  assert(existingRun.operations[0]?.kind === "moveFile" && existingRun.operations[0]?.targetPath.replace(/\\/g, "/").toLowerCase().endsWith("probeordner/rechnung_a.txt"), "single move targets the existing directory path");
  assert(existingRun.folderCount === 0 && existingRun.fileOperationCount === 1, "counts match one move and no folder create");
  const journal = createVirtualPlanJournal(existingPlan, existingBinding, existingRun);
  assert(journal.operations.length === 1 && journal.operations[0]?.kind === "moveFile", "bound journal receives only the file move");

  const fresh = withoutProbeordner();
  const freshBinding = makeSnapshotBinding(fresh, config, 11);
  const freshPlan = approvedPlan(fresh, freshBinding, [folder("Neu")], { "rechnung_a.txt": "Neu" });
  const freshRun = buildVirtualPlanDryRun({ plan: freshPlan, scanResult: fresh, binding: freshBinding, current: true });
  assert(freshRun.status === "restricted", "new virtual folder stays restricted");
  assert(freshRun.operations.some((operation) => operation.kind === "createVirtualFolder" && operation.targetPath === "Neu"), "new virtual folder still emits createVirtualFolder");
  assert(freshRun.operations.some((operation) => operation.kind === "moveFile"), "file move into a new folder remains");

  const nested = nestedSameName();
  const nestedBinding = makeSnapshotBinding(nested, config, 11);
  const nestedPlan = approvedPlan(nested, nestedBinding, [folder("Probeordner")], { "rechnung_a.txt": "Probeordner" });
  const nestedRun = buildVirtualPlanDryRun({ plan: nestedPlan, scanResult: nested, binding: nestedBinding, current: true });
  assert(nestedRun.operations.some((operation) => operation.kind === "createVirtualFolder" && operation.targetPath === "Probeordner"), "same folder name under another parent is not treated as the target");
  assert(nestedRun.operations.some((operation) => operation.kind === "moveFile"), "move into a not-yet-existing root folder remains");

  const stale = buildVirtualPlanDryRun({ plan: existingPlan, scanResult: existing, binding: existingBinding, current: false });
  assert(stale.status === "blocked" && stale.operations.length === 0, "stale snapshot is not approved");

  const asFile = probeordnerAsFile();
  const asFileBinding = makeSnapshotBinding(asFile, config, 11);
  const asFilePlan = approvedPlan(asFile, asFileBinding, [folder("Probeordner")], { "rechnung_a.txt": "Probeordner" });
  const asFileRun = buildVirtualPlanDryRun({ plan: asFilePlan, scanResult: asFile, binding: asFileBinding, current: true });
  assert(asFileRun.status === "blocked" && asFileRun.operations.length === 0, "file at the target path is not treated as a directory");

  const incomplete = incompleteProbeordner();
  const incompleteBinding = makeSnapshotBinding(incomplete, config, 11);
  const incompletePlan = approvedPlan(incomplete, incompleteBinding, [folder("Probeordner")], { "rechnung_a.txt": "Probeordner" });
  const incompleteRun = buildVirtualPlanDryRun({ plan: incompletePlan, scanResult: incomplete, binding: incompleteBinding, current: true });
  assert(incompleteRun.status === "blocked" && incompleteRun.operations.length === 0, "incomplete directory listing is not approved");
}
