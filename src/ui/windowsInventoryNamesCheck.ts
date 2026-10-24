/** FV2-02c – Synthetic inventory-name marking checks. No filesystem actions. */
import type { DirectoryNode, FileNode, FsNode, ScanConfig, ScanResult } from "../model";
import { isDirectory } from "../model";
import { makeSnapshotBinding, parseVirtualPlan, type VirtualPlan, type VirtualPlanItem } from "./virtualPlan";
import {
  assignFileToVirtualFolder,
  projectVirtualPlan,
  renameVirtualPlanFolder,
  validateVirtualPlan,
} from "./virtualPlanEditor";
import { buildVirtualPlanDryRun } from "./virtualPlanDryRun";
import { createVirtualPlanJournal } from "./virtualPlanJournal";
import { collectExpandableDirectoryIds, deriveVisibleRows } from "./treeRows";
import { isAllowedWindowsComponent } from "./windowsPathRules";
import {
  EXISTING_WINDOWS_NAME_MARK,
  existingWindowsNameIssue,
  existingWindowsNameIssueForNode,
  hasProblematicExistingWindowsName,
} from "./windowsInventoryNames";

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
  return { id, path: id, name, depth: 1, kind: "file", sizeBytes: 1, modifiedAtMs: 100 };
}

function dir(id: string, name: string, children: FsNode[]): DirectoryNode {
  return { id, path: id, name, depth: name === "Fixture" ? 0 : 1, kind: "directory", listing: "read", children };
}

function inventory(children: FsNode[]): ScanResult {
  const root = dir("C:\\Fixture", "Fixture", children);
  const files = children.filter((node) => node.kind === "file").length;
  const directories = 1 + children.filter((node) => node.kind === "directory").length;
  return { root, warnings: [], stats: { directoryCount: directories, fileCount: files, skippedCount: 0, durationMs: 1 } };
}

function item(nodeId: string, relative: string, kind: "file" | "directory", target: string, extras: Partial<VirtualPlanItem> = {}): VirtualPlanItem {
  return {
    id: `vpi_${relative}`,
    observed: {
      nodeId,
      relativePath: relative,
      kind,
      identityStatus: "scanLocalOnly",
      metadata: { sizeBytes: 1, modifiedAtMs: 100 },
    },
    virtualTargetPath: target,
    originalVirtualTargetPath: target,
    status: extras.status ?? "proposed",
    sourceInsightIds: [],
    alternatives: [],
    ...extras,
  };
}

function itemsFor(result: ScanResult, fileTargets: Record<string, string>, renames: Record<string, string> = {}): VirtualPlanItem[] {
  const items: VirtualPlanItem[] = [];
  const walk = (node: FsNode) => {
    const relative = node.path === result.root.path ? "." : node.path.slice(result.root.path.length + 1).replace(/\\/g, "/");
    const target = node.kind === "file"
      ? (fileTargets[relative] ?? (relative.includes("/") ? relative.slice(0, relative.lastIndexOf("/")) : "."))
      : (relative.includes("/") ? relative.slice(0, relative.lastIndexOf("/")) : ".");
    items.push(item(node.id, relative, node.kind, target, {
      status: node.kind === "file" && fileTargets[relative] !== undefined ? "edited" : "excluded",
      ...(renames[relative] !== undefined ? { virtualRename: renames[relative] } : {}),
    }));
    if (isDirectory(node)) node.children.forEach(walk);
  };
  walk(result.root);
  return items;
}

function draft(result: ScanResult, folders: { name: string; parent?: string }[], fileTargets: Record<string, string> = {}, renames: Record<string, string> = {}): { plan: VirtualPlan; binding: ReturnType<typeof makeSnapshotBinding> } {
  const binding = makeSnapshotBinding(result, config, 1);
  const plan: VirtualPlan = {
    schemaVersion: 1,
    planId: "vp_inventory",
    builderVersion: 1,
    revision: 1,
    status: "draft",
    scope: { kind: "scanRoot", rootNodeId: result.root.id },
    binding,
    items: itemsFor(result, fileTargets, renames),
    virtualFolders: folders.map((folder, index) => ({
      id: `vpf_${index}_${folder.name}`,
      sourceProposalId: "prop",
      parentVirtualPath: folder.parent ?? ".",
      name: folder.name,
      originalName: folder.name,
    })),
    openCases: [],
    decisions: [],
    preferences: [],
  };
  return { plan, binding };
}

function approvedOf(plan: VirtualPlan): VirtualPlan {
  return { ...plan, status: "virtuallyApproved" };
}

function journalCreated(plan: VirtualPlan, binding: ReturnType<typeof makeSnapshotBinding>, report: ReturnType<typeof buildVirtualPlanDryRun>): boolean {
  try {
    createVirtualPlanJournal(plan, binding, report);
    return true;
  } catch {
    return false;
  }
}

function visibleMarked(result: ScanResult, name: string): boolean {
  const rows = deriveVisibleRows(result.root, collectExpandableDirectoryIds(result.root));
  const row = rows.find((entry) => entry.node.name === name);
  return row !== undefined && row.hasProblematicExistingWindowsName === true;
}

function visibleUnmarked(result: ScanResult, name: string): boolean {
  const rows = deriveVisibleRows(result.root, collectExpandableDirectoryIds(result.root));
  const row = rows.find((entry) => entry.node.name === name);
  return row !== undefined && row.hasProblematicExistingWindowsName !== true;
}

function fillAscii(length: number): string {
  return "a".repeat(length);
}

export function runWindowsInventoryNamesCheck(): void {
  assert(EXISTING_WINDOWS_NAME_MARK === "nicht ausführbar", "mark text is a visible label, not color-only");
  assert(existingWindowsNameIssue("Rechnung.pdf") === null, "ordinary name has no inventory issue");
  assert(existingWindowsNameIssue(".") === null, "scan-root sentinel is not an inventory name problem");
  const issueShape = existingWindowsNameIssue("CON.txt");
  assert(issueShape !== null && issueShape.hasProblematicExistingName === true, "reserved inventory issue is typed independently of plan status");
  assert(!("canConfirm" in (issueShape ?? {})), "inventory issue does not carry canConfirm");
  assert(!("grantsRealExecution" in (issueShape ?? {})), "inventory issue does not carry grantsRealExecution");
  assert(!("status" in (issueShape ?? {})), "inventory issue does not reuse item.status");

  const reservedNames = ["CON.txt", "NUL.pdf", "COM1.docx", "COM0", "LPT0", "COM\u00B9", "LPT\u00B2", "COM\u00B3.txt"];
  for (const name of reservedNames) {
    assert(!isAllowedWindowsComponent(name), `shared helper rejects ${name}`);
    assert(hasProblematicExistingWindowsName(name), `relative ${name} is marked`);
    assert(hasProblematicExistingWindowsName(`C:\\Fixture\\${name}`), `absolute ${name} is marked`);
    const result = inventory([file(`C:\\Fixture\\${name}`, name), file("C:\\Fixture\\Rechnung.pdf", "Rechnung.pdf")]);
    assert(result.root.children.some((node) => node.name === name), `scan keeps ${name}`);
    assert(visibleMarked(result, name), `tree keeps and marks ${name}`);
    assert(visibleUnmarked(result, "Rechnung.pdf"), `ordinary sibling of ${name} stays unmarked`);
    const { plan, binding } = draft(result, [{ name: "Berichte" }]);
    const validation = validateVirtualPlan(plan, result, binding);
    assert(validation.valid, `draft with existing ${name} stays valid`);
    const reservedItem = plan.items.find((entry) => entry.observed.relativePath === name);
    assert(reservedItem !== undefined && reservedItem.status === "excluded", `${name} is not auto-excluded beyond the unused default`);
    assert(plan.openCases.length === 0, `${name} does not force an openCase`);
    assert(reservedItem?.virtualRename === undefined, `${name} is not auto-renamed`);
    const assigned = assignFileToVirtualFolder(plan, `vpi_${name}`, "vpf_0_Berichte");
    assert(assigned.ok, `${name} remains virtually assignable`);
    if (!assigned.ok) return;
    assert(assigned.plan.items.find((entry) => entry.id === `vpi_${name}`)?.status === "edited", `${name} assignment does not replace edited with openCase`);
    assert(validateVirtualPlan(assigned.plan, result, binding).valid, `assigned ${name} remains a valid draft`);
    const rows = projectVirtualPlan(assigned.plan);
    const marked = rows.find((row) => row.sourceRelativePath === name);
    const ordinary = rows.find((row) => row.sourceRelativePath === "Rechnung.pdf");
    assert(marked?.existingWindowsNameIssue?.hasProblematicExistingName === true, `projection marks ${name}`);
    assert(ordinary !== undefined && ordinary.existingWindowsNameIssue === undefined, `projection leaves ordinary sibling of ${name} unmarked`);
    const dry = buildVirtualPlanDryRun({ plan: approvedOf(assigned.plan), scanResult: result, binding, current: true });
    assert(dry.status === "blocked", `dry-run with reserved source ${name} is blocked`);
    assert(!journalCreated(approvedOf(assigned.plan), binding, dry), `blocked dry-run with ${name} cannot create a journal`);
  }

  const trailingDot = inventory([file("C:\\Fixture\\name.", "name."), file("C:\\Fixture\\Rechnung.pdf", "Rechnung.pdf")]);
  assert(visibleMarked(trailingDot, "name."), "10: trailing-dot name stays visible and marked");
  assert(validateVirtualPlan(draft(trailingDot, [{ name: "Berichte" }]).plan, trailingDot, draft(trailingDot, [{ name: "Berichte" }]).binding).valid, "10: trailing-dot source stays in a valid draft");

  const trailingSpace = inventory([file("C:\\Fixture\\name ", "name "), file("C:\\Fixture\\Rechnung.pdf", "Rechnung.pdf")]);
  assert(visibleMarked(trailingSpace, "name "), "11: trailing-space name stays visible and marked");
  assert(hasProblematicExistingWindowsName("name "), "11: trailing space is a name-component problem");

  const cleanTarget = inventory([file("C:\\Fixture\\CON.txt", "CON.txt"), file("C:\\Fixture\\Rechnung.pdf", "Rechnung.pdf")]);
  const cleanDraft = draft(cleanTarget, [{ name: "Berichte" }], { "CON.txt": "Berichte" }, { "CON.txt": "Konto.pdf" });
  assert(validateVirtualPlan(cleanDraft.plan, cleanTarget, cleanDraft.binding).valid, "12: reserved source with clean target stays editor-valid");
  assert(cleanDraft.plan.items.find((entry) => entry.observed.relativePath === "CON.txt")?.virtualRename === "Konto.pdf", "12: virtualRename is only present when explicitly set");
  const cleanDry = buildVirtualPlanDryRun({ plan: approvedOf(cleanDraft.plan), scanResult: cleanTarget, binding: cleanDraft.binding, current: true });
  assert(cleanDry.status === "blocked", "12: reserved source blocks the whole dry-run even with a clean target");
  assert(cleanDry.operations.some((operation) => operation.sourcePath === "CON.txt" && operation.targetPath === "Berichte/Konto.pdf" && operation.checkStatus === "blocked"), "12: blocked operation keeps the reserved source visible");
  assert(cleanDry.openRequirements.some((entry) => entry.includes("Quellname") && entry.includes("CON.txt")), "12: source-name blocker names the reserved file");
  assert(!journalCreated(approvedOf(cleanDraft.plan), cleanDraft.binding, cleanDry), "12: no journal for reserved source with clean target");

  const goodSource = inventory([file("C:\\Fixture\\Rechnung.pdf", "Rechnung.pdf")]);
  const goodDraft = draft(goodSource, [{ name: "Berichte" }], { "Rechnung.pdf": "Berichte" });
  const reservedFolder = renameVirtualPlanFolder(goodDraft.plan, "vpf_0_Berichte", "CON");
  assert(!reservedFolder.ok, "13/15: new reserved target folder remains rejected");
  const constructedReservedTarget: VirtualPlan = {
    ...goodDraft.plan,
    virtualFolders: [{ id: "vpf_0_CON", sourceProposalId: "prop", parentVirtualPath: ".", name: "CON", originalName: "CON" }],
    items: goodDraft.plan.items.map((entry) => entry.observed.relativePath === "Rechnung.pdf" ? { ...entry, virtualTargetPath: "CON", status: "edited" } : entry),
  };
  const reservedTargetDry = buildVirtualPlanDryRun({ plan: approvedOf(constructedReservedTarget), scanResult: goodSource, binding: goodDraft.binding, current: true });
  assert(reservedTargetDry.status === "blocked", "13/15: new reserved target folder blocks dry-run");
  assert(!journalCreated(approvedOf(constructedReservedTarget), goodDraft.binding, reservedTargetDry), "13/15: no journal for a new reserved target");

  const existingFolder = inventory([
    dir("C:\\Fixture\\CON", "CON", [file("C:\\Fixture\\CON\\Notiz.txt", "Notiz.txt")]),
    file("C:\\Fixture\\Rechnung.pdf", "Rechnung.pdf"),
  ]);
  assert(visibleMarked(existingFolder, "CON"), "14: existing reserved folder is marked in the tree");
  assert(visibleMarked(existingFolder, "Notiz.txt"), "14: file under a reserved folder is marked via its path");
  const existingDraft = draft(existingFolder, [{ name: "Berichte" }], { "Rechnung.pdf": "CON" });
  assert(projectVirtualPlan(existingDraft.plan).some((row) => row.sourceRelativePath === "CON" && row.kind === "directory" && row.existingWindowsNameIssue !== undefined), "14: existing reserved folder is marked in the plan projection");
  assert(validateVirtualPlan(existingDraft.plan, existingFolder, existingDraft.binding).valid, "14: existing reserved folder remains in a valid draft");
  const existingDry = buildVirtualPlanDryRun({ plan: approvedOf(existingDraft.plan), scanResult: existingFolder, binding: existingDraft.binding, current: true });
  assert(existingDry.status === "blocked", "14: move through an existing reserved folder stays blocked");
  assert(!journalCreated(approvedOf(existingDraft.plan), existingDraft.binding, existingDry), "14: no journal when the existing target folder is reserved");

  const longName = `${fillAscii(180)}.txt`;
  assert(isAllowedWindowsComponent(longName), "16: long existing name remains a legal Windows component");
  assert(!hasProblematicExistingWindowsName(longName), "16: long existing source is not a 02c name mark");
  const longResult = inventory([file(`C:\\Fixture\\${longName}`, longName), file("C:\\Fixture\\Rechnung.pdf", "Rechnung.pdf")]);
  assert(visibleUnmarked(longResult, longName), "16: long existing source stays visible and unmarked");
  const longDraft = draft(longResult, [{ name: "Berichte" }], { [longName]: "Berichte" });
  assert(validateVirtualPlan(longDraft.plan, longResult, longDraft.binding).valid, "16: long existing source stays editor-valid");
  const longAssigned = assignFileToVirtualFolder(longDraft.plan, `vpi_${longName}`, "vpf_0_Berichte");
  assert(longAssigned.ok, "16: long existing source remains assignable");
  if (!longAssigned.ok) return;
  const longDry = buildVirtualPlanDryRun({ plan: approvedOf(longAssigned.plan), scanResult: longResult, binding: longDraft.binding, current: true });
  assert(longDry.status === "restricted", "16: long existing source is not blocked only because of total length");
  assert(journalCreated(approvedOf(longAssigned.plan), longDraft.binding, longDry), "16: long existing source may still prepare a journal");

  const ordinary = inventory([file("C:\\Fixture\\Rechnung.pdf", "Rechnung.pdf")]);
  const ordinaryDraft = draft(ordinary, [{ name: "Berichte" }], { "Rechnung.pdf": "Berichte" });
  assert(visibleUnmarked(ordinary, "Rechnung.pdf"), "17: ordinary file is not marked");
  assert(projectVirtualPlan(ordinaryDraft.plan).every((row) => row.existingWindowsNameIssue === undefined), "17: ordinary projection has no inventory mark");
  const ordinaryDry = buildVirtualPlanDryRun({ plan: approvedOf(ordinaryDraft.plan), scanResult: ordinary, binding: ordinaryDraft.binding, current: true });
  assert(ordinaryDry.status === "restricted", "17: ordinary source and target stay restricted");
  assert(ordinaryDry.operations.every((operation) => operation.checkStatus !== "blocked"), "17: ordinary operations stay execution-check pending, not inventory-blocked");
  assert(journalCreated(approvedOf(ordinaryDraft.plan), ordinaryDraft.binding, ordinaryDry), "17: ordinary restricted dry-run can still prepare a journal");

  const mixed = inventory([file("C:\\Fixture\\CON.txt", "CON.txt"), file("C:\\Fixture\\Rechnung.pdf", "Rechnung.pdf")]);
  const mixedDraft = draft(mixed, [{ name: "Berichte" }], { "CON.txt": "Berichte", "Rechnung.pdf": "Berichte" }, { "CON.txt": "Konto.pdf" });
  const mixedRows = projectVirtualPlan(mixedDraft.plan);
  assert(mixedRows.some((row) => row.sourceRelativePath === "CON.txt" && row.existingWindowsNameIssue !== undefined), "mixed: reserved source stays visible and marked");
  assert(mixedRows.some((row) => row.sourceRelativePath === "Rechnung.pdf" && row.existingWindowsNameIssue === undefined), "mixed: ordinary source stays visible and unmarked");
  assert(assignFileToVirtualFolder(mixedDraft.plan, "vpi_Rechnung.pdf", "vpf_0_Berichte").ok, "mixed: ordinary file remains assignable");
  const mixedDry = buildVirtualPlanDryRun({ plan: approvedOf(mixedDraft.plan), scanResult: mixed, binding: mixedDraft.binding, current: true });
  assert(mixedDry.status === "blocked", "mixed: one reserved source blocks the whole dry-run");
  assert(mixedDry.operations.some((operation) => operation.sourcePath === "CON.txt"), "mixed: reserved source remains in the dry-run list");
  assert(mixedDry.operations.some((operation) => operation.sourcePath === "Rechnung.pdf"), "mixed: ordinary source remains in the dry-run list");
  assert(!journalCreated(approvedOf(mixedDraft.plan), mixedDraft.binding, mixedDry), "mixed: no journal for the whole mixed plan");

  const persisted = parseVirtualPlan(JSON.stringify(mixedDraft.plan));
  assert(persisted.kind === "valid", "persisted plan contract still loads without an inventory field");
  assert(!JSON.stringify(mixedDraft.plan).includes("existingWindowsNameIssue"), "inventory mark is not written into the plan document");
  assert(mixedDraft.plan.items.every((entry) => entry.status === "edited" || entry.status === "excluded"), "no item.status was added or rewritten for inventory marking");
  assert(existingWindowsNameIssueForNode({ name: "CON.txt", path: "C:\\Fixture\\CON.txt" }) !== null, "node helper marks reserved file names");
  assert(existingWindowsNameIssueForNode({ name: "Rechnung.pdf", path: "C:\\Fixture\\Rechnung.pdf" }) === null, "node helper leaves ordinary files unmarked");
}