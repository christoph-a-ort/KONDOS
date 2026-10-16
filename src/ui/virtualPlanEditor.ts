/**
 * P2-K.4b/c – Pure virtual-plan selection, editing and validation.
 * This module never accesses the filesystem and never mutates its inputs.
 */

import type { FsNode, ScanResult } from "../model";
import { isDirectory } from "../model";
import {
  normalizeVirtualPlanPath,
  type DecisionRecord,
  type ObservedObjectRef,
  type SnapshotBinding,
  type VirtualPlan,
  type VirtualPlanFolder,
  type VirtualPlanItem,
} from "./virtualPlan";
import type { VirtualReorgProposal, VirtualPreviewEntry } from "./virtualPlanSuggestions";

export const VIRTUAL_PLAN_EDITOR_BUILDER_VERSION = 1 as const;

export interface VirtualPlanProjectionRow {
  itemId: string;
  nodeId: string;
  displayName: string;
  kind: "file" | "directory";
  sourceRelativePath: string;
  virtualTargetPath: string;
  virtualPath: string;
  status: VirtualPlanItem["status"];
}

export interface VirtualPlanValidation {
  valid: boolean;
  errors: string[];
  observedObjectCount: number;
  projectedObjectCount: number;
}

export type VirtualPlanEditResult =
  | { ok: true; plan: VirtualPlan }
  | { ok: false; error: string };

function relativePath(rootPath: string, nodePath: string): string {
  const root = normalizeVirtualPlanPath(rootPath);
  const path = normalizeVirtualPlanPath(nodePath);
  if (path === root) return ".";
  const prefix = `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function parentPath(path: string): string {
  const normalized = normalizeVirtualPlanPath(path);
  if (normalized === "." || normalized.length === 0 || !normalized.includes("/")) {
    return ".";
  }
  return normalized.slice(0, normalized.lastIndexOf("/")) || ".";
}

function joinVirtualPath(parent: string, name: string): string {
  const normalizedParent = normalizeVirtualPlanPath(parent);
  return normalizedParent === "." ? name : `${normalizedParent}/${name}`;
}

function itemId(nodeId: string): string {
  return `vpi_${normalizeVirtualPlanPath(nodeId).replace(/[^a-z0-9_./-]+/gi, "_")}`;
}

function folderId(entry: VirtualPreviewEntry): string {
  return `vpf_${entry.entryId.replace(/[^a-z0-9_./-]+/gi, "_")}`;
}

function walk(root: FsNode, visit: (node: FsNode) => void): void {
  visit(root);
  if (isDirectory(root)) {
    for (const child of root.children) {
      walk(child, visit);
    }
  }
}

function virtualGroups(entry: VirtualPreviewEntry): VirtualPreviewEntry[] {
  const groups: VirtualPreviewEntry[] = [];
  const visit = (current: VirtualPreviewEntry): void => {
    if (current.role === "virtualGroup") groups.push(current);
    for (const child of current.children ?? []) visit(child);
  };
  visit(entry);
  return groups;
}

function makeDecision(
  plan: VirtualPlan,
  kind: DecisionRecord["kind"],
  extras: Pick<
    DecisionRecord,
    "planItemId" | "previousVirtualTargetPath" | "previousStatus" | "virtualFolderId" | "previousFolderName"
  >,
): DecisionRecord {
  return {
    id: `vpd_${plan.revision + 1}_${plan.decisions.length + 1}`,
    revision: plan.revision + 1,
    planId: plan.planId,
    kind,
    origin: "user",
    createdAtMs: Date.now(),
    ...extras,
  };
}

function withDecision(plan: VirtualPlan, decision: DecisionRecord): VirtualPlan {
  return {
    ...plan,
    revision: plan.revision + 1,
    items: plan.items.map((item) => ({
      ...item,
      observed: { ...item.observed, metadata: { ...item.observed.metadata } },
    })),
    virtualFolders: (plan.virtualFolders ?? []).map((folder) => ({ ...folder })),
    decisions: [...plan.decisions, decision],
  };
}

function validWindowsName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Der virtuelle Ordnername darf nicht leer sein.";
  if (trimmed === "." || trimmed === "..") return "Der virtuelle Ordnername ist ungültig.";
  if (/[\\/:*?"<>|]/.test(trimmed) || /[. ]$/.test(trimmed)) {
    return "Der virtuelle Ordnername enthält ungültige Windows-Zeichen oder endet mit Punkt/Leerzeichen.";
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(trimmed)) {
    return "Der virtuelle Ordnername ist unter Windows reserviert.";
  }
  return null;
}

function bindingMatches(left: SnapshotBinding, right: SnapshotBinding): boolean {
  return (
    left.snapshotFingerprint === right.snapshotFingerprint &&
    left.sourceScanId === right.sourceScanId &&
    left.normalizedRootPath === right.normalizedRootPath
  );
}

function editablePlanError(plan: VirtualPlan): string | null {
  return plan.status === "draft" ? null : "Ein virtuell bestätigter Plan ist nicht stillschweigend bearbeitbar.";
}

export function createVirtualPlanFromProposal(options: {
  proposal: VirtualReorgProposal;
  scanResult: ScanResult;
  binding: SnapshotBinding;
}): VirtualPlanEditResult {
  if (options.binding.incomplete || !options.proposal.completeness.complete) {
    return { ok: false, error: "Der Vorschlag kann bei eingeschränkter Datengrundlage nicht als vollständiger Entwurf angelegt werden." };
  }

  const sourceFolderPath = relativePath(options.scanResult.root.path, options.proposal.sourceFolderNodeId);
  const folders = virtualGroups(options.proposal.virtualTarget.tree);
  if (folders.length === 0) {
    return { ok: false, error: "Der ausgewählte Vorschlag enthält keinen vorhandenen virtuellen Zielordner." };
  }

  const targetByNodeId = new Map<string, string>();
  const virtualFolders: VirtualPlanFolder[] = [];
  for (const group of folders) {
    const nameError = validWindowsName(group.name);
    if (nameError !== null) return { ok: false, error: nameError };
    const target = joinVirtualPath(sourceFolderPath, group.name);
    if (virtualFolders.some((folder) => joinVirtualPath(folder.parentVirtualPath, folder.name) === target)) {
      return { ok: false, error: "Der Vorschlag enthält kollidierende virtuelle Zielordner." };
    }
    virtualFolders.push({
      id: folderId(group),
      sourceProposalId: options.proposal.id,
      parentVirtualPath: sourceFolderPath,
      name: group.name,
      originalName: group.name,
    });
    for (const child of group.children ?? []) {
      if (child.role === "regrouped") targetByNodeId.set(child.entryId, target);
    }
  }

  const items: VirtualPlanItem[] = [];
  walk(options.scanResult.root, (node) => {
    const sourceRelativePath = relativePath(options.scanResult.root.path, node.path);
    const target = targetByNodeId.get(node.id) ?? parentPath(sourceRelativePath);
    const observed: ObservedObjectRef = {
      nodeId: node.id,
      relativePath: sourceRelativePath,
      kind: node.kind,
      identityStatus: "scanLocalOnly",
      metadata: {
        sizeBytes: node.sizeBytes,
        createdAtMs: node.createdAtMs,
        modifiedAtMs: node.modifiedAtMs,
      },
    };
    items.push({
      id: itemId(node.id),
      observed,
      virtualTargetPath: target,
      originalVirtualTargetPath: target,
      status: targetByNodeId.has(node.id) ? "proposed" : "excluded",
      sourceInsightIds: [],
      alternatives: [],
    });
  });

  const plan: VirtualPlan = {
    schemaVersion: 1,
    planId: `vp_${options.binding.snapshotFingerprint}`,
    builderVersion: VIRTUAL_PLAN_EDITOR_BUILDER_VERSION,
    revision: 1,
    status: "draft",
    scope: { kind: "scanRoot", rootNodeId: options.scanResult.root.id },
    binding: { ...options.binding, scanConfig: { ...options.binding.scanConfig, extensions: [...options.binding.scanConfig.extensions] } },
    items,
    virtualFolders,
    openCases: [],
    decisions: [],
    preferences: [],
  };
  const validation = validateVirtualPlan(plan, options.scanResult, options.binding);
  return validation.valid ? { ok: true, plan } : { ok: false, error: validation.errors[0] ?? "Der virtuelle Entwurf ist ungültig." };
}

export function listVirtualPlanFolders(plan: VirtualPlan): readonly VirtualPlanFolder[] {
  return plan.virtualFolders ?? [];
}

export function renameVirtualPlanFolder(
  plan: VirtualPlan,
  folderIdToRename: string,
  requestedName: string,
): VirtualPlanEditResult {
  const editError = editablePlanError(plan);
  if (editError !== null) return { ok: false, error: editError };
  const folder = (plan.virtualFolders ?? []).find((entry) => entry.id === folderIdToRename);
  if (folder === undefined) return { ok: false, error: "Der virtuelle Zielordner ist nicht vorhanden." };
  const error = validWindowsName(requestedName);
  if (error !== null) return { ok: false, error };
  const name = requestedName.trim();
  if (name === folder.name) return { ok: true, plan };
  if (
    (plan.virtualFolders ?? []).some(
      (entry) =>
        entry.id !== folder.id &&
        entry.parentVirtualPath === folder.parentVirtualPath &&
        entry.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    return { ok: false, error: "Ein virtueller Zielordner mit diesem Namen ist bereits vorhanden." };
  }

  const oldPath = joinVirtualPath(folder.parentVirtualPath, folder.name);
  const newPath = joinVirtualPath(folder.parentVirtualPath, name);
  const decision = makeDecision(plan, "edit", {
    virtualFolderId: folder.id,
    previousFolderName: folder.name,
  });
  const next = withDecision(plan, decision);
  return {
    ok: true,
    plan: {
      ...next,
      virtualFolders: (next.virtualFolders ?? []).map((entry) =>
        entry.id === folder.id ? { ...entry, name } : entry,
      ),
      items: next.items.map((item) => ({
        ...item,
        virtualTargetPath:
          item.virtualTargetPath === oldPath
            ? newPath
            : item.virtualTargetPath.startsWith(`${oldPath}/`)
              ? `${newPath}${item.virtualTargetPath.slice(oldPath.length)}`
              : item.virtualTargetPath,
      })),
    },
  };
}

export function assignFileToVirtualFolder(
  plan: VirtualPlan,
  planItemId: string,
  targetFolderId: string,
): VirtualPlanEditResult {
  const editError = editablePlanError(plan);
  if (editError !== null) return { ok: false, error: editError };
  const item = plan.items.find((entry) => entry.id === planItemId);
  const folder = (plan.virtualFolders ?? []).find((entry) => entry.id === targetFolderId);
  if (item === undefined || item.observed.kind !== "file") {
    return { ok: false, error: "Nur eine vorhandene Datei kann virtuell zugeordnet werden." };
  }
  if (folder === undefined) return { ok: false, error: "Der virtuelle Zielordner ist nicht vorhanden." };
  const nextTarget = joinVirtualPath(folder.parentVirtualPath, folder.name);
  if (item.virtualTargetPath === nextTarget && item.status !== "excluded") return { ok: true, plan };
  const decision = makeDecision(plan, "edit", {
    planItemId: item.id,
    previousVirtualTargetPath: item.virtualTargetPath,
    previousStatus: item.status,
  });
  const next = withDecision(plan, decision);
  return {
    ok: true,
    plan: {
      ...next,
      items: next.items.map((entry) =>
        entry.id === item.id
          ? { ...entry, virtualTargetPath: nextTarget, status: "edited" }
          : entry,
      ),
    },
  };
}

export function excludeFileFromVirtualPlan(
  plan: VirtualPlan,
  planItemId: string,
): VirtualPlanEditResult {
  const editError = editablePlanError(plan);
  if (editError !== null) return { ok: false, error: editError };
  const item = plan.items.find((entry) => entry.id === planItemId);
  if (item === undefined || item.observed.kind !== "file") {
    return { ok: false, error: "Nur eine vorhandene Datei kann unverändert gelassen werden." };
  }
  const originalTarget = parentPath(item.observed.relativePath);
  if (item.virtualTargetPath === originalTarget && item.status === "excluded") return { ok: true, plan };
  const decision = makeDecision(plan, "exclude", {
    planItemId: item.id,
    previousVirtualTargetPath: item.virtualTargetPath,
    previousStatus: item.status,
  });
  const next = withDecision(plan, decision);
  return {
    ok: true,
    plan: {
      ...next,
      items: next.items.map((entry) =>
        entry.id === item.id
          ? { ...entry, virtualTargetPath: originalTarget, status: "excluded" }
          : entry,
      ),
    },
  };
}

export function undoLastVirtualPlanEdit(plan: VirtualPlan): VirtualPlanEditResult {
  const editError = editablePlanError(plan);
  if (editError !== null) return { ok: false, error: editError };
  const decision = plan.decisions[plan.decisions.length - 1];
  if (decision === undefined) return { ok: false, error: "Es gibt keine lokale Bearbeitung zum Rückgängigmachen." };
  const next = {
    ...plan,
    revision: Math.max(1, plan.revision - 1),
    decisions: plan.decisions.slice(0, -1),
    items: plan.items.map((item) => ({
      ...item,
      observed: { ...item.observed, metadata: { ...item.observed.metadata } },
    })),
    virtualFolders: (plan.virtualFolders ?? []).map((folder) => ({ ...folder })),
  };
  if (decision.virtualFolderId !== undefined && decision.previousFolderName !== undefined) {
    const folder = next.virtualFolders?.find((entry) => entry.id === decision.virtualFolderId);
    if (folder === undefined) return { ok: false, error: "Der frühere virtuelle Zielordner ist nicht mehr vorhanden." };
    const currentPath = joinVirtualPath(folder.parentVirtualPath, folder.name);
    const previousPath = joinVirtualPath(folder.parentVirtualPath, decision.previousFolderName);
    return {
      ok: true,
      plan: {
        ...next,
        virtualFolders: next.virtualFolders.map((entry) =>
          entry.id === folder.id ? { ...entry, name: decision.previousFolderName! } : entry,
        ),
        items: next.items.map((item) => ({
          ...item,
          virtualTargetPath:
            item.virtualTargetPath === currentPath
              ? previousPath
              : item.virtualTargetPath.startsWith(`${currentPath}/`)
                ? `${previousPath}${item.virtualTargetPath.slice(currentPath.length)}`
                : item.virtualTargetPath,
        })),
      },
    };
  }
  if (
    decision.planItemId !== undefined &&
    decision.previousVirtualTargetPath !== undefined &&
    decision.previousStatus !== undefined
  ) {
    return {
      ok: true,
      plan: {
        ...next,
        items: next.items.map((item) =>
          item.id === decision.planItemId
            ? {
                ...item,
                virtualTargetPath: decision.previousVirtualTargetPath!,
                status: decision.previousStatus!,
              }
            : item,
        ),
      },
    };
  }
  return { ok: false, error: "Die letzte Bearbeitung kann nicht sicher rückgängig gemacht werden." };
}

export function resetVirtualPlanToSelection(
  currentPlan: VirtualPlan,
): VirtualPlanEditResult {
  const editError = editablePlanError(currentPlan);
  if (editError !== null) return { ok: false, error: editError };
  return {
    ok: true,
    plan: {
      ...currentPlan,
      revision: currentPlan.revision + 1,
      binding: { ...currentPlan.binding, scanConfig: { ...currentPlan.binding.scanConfig, extensions: [...currentPlan.binding.scanConfig.extensions] } },
      items: currentPlan.items.map((item) => ({
        ...item,
        observed: { ...item.observed, metadata: { ...item.observed.metadata } },
        virtualTargetPath: item.originalVirtualTargetPath ?? parentPath(item.observed.relativePath),
        status:
          item.originalVirtualTargetPath === undefined ||
          item.originalVirtualTargetPath === parentPath(item.observed.relativePath)
            ? "excluded"
            : "proposed",
      })),
      virtualFolders: (currentPlan.virtualFolders ?? []).map((folder) => ({
        ...folder,
        name: folder.originalName,
      })),
      // Reset deliberately establishes a new local baseline; there is no partial
      // snapshot to replay, so stale undo records must not be retained.
      decisions: [],
    },
  };
}

export function prepareVirtualPlanForSave(
  plan: VirtualPlan,
  expectedRevision: number,
): VirtualPlan {
  return {
    ...plan,
    revision: expectedRevision + 1,
    items: plan.items.map((item) => ({
      ...item,
      observed: { ...item.observed, metadata: { ...item.observed.metadata } },
    })),
    virtualFolders: (plan.virtualFolders ?? []).map((folder) => ({ ...folder })),
    decisions: plan.decisions.map((decision) => ({ ...decision, revision: expectedRevision + 1 })),
  };
}

export function projectVirtualPlan(plan: VirtualPlan): VirtualPlanProjectionRow[] {
  return plan.items
    .map((item) => ({
      itemId: item.id,
      nodeId: item.observed.nodeId,
      displayName:
        item.observed.relativePath === "."
          ? "."
          : item.observed.relativePath.slice(item.observed.relativePath.lastIndexOf("/") + 1),
      kind: item.observed.kind,
      sourceRelativePath: item.observed.relativePath,
      virtualTargetPath: item.virtualTargetPath,
      virtualPath: joinVirtualPath(
        item.virtualTargetPath,
        item.virtualRename ??
          (item.observed.relativePath === "."
            ? "."
            : item.observed.relativePath.slice(item.observed.relativePath.lastIndexOf("/") + 1)),
      ),
      status: item.status,
    }))
    .sort((left, right) => left.virtualPath.localeCompare(right.virtualPath));
}

export function validateVirtualPlan(
  plan: VirtualPlan,
  scanResult: ScanResult,
  binding: SnapshotBinding,
): VirtualPlanValidation {
  const errors: string[] = [];
  if (!bindingMatches(plan.binding, binding)) errors.push("Der Entwurf gehört nicht zum aktuellen Scan-Snapshot.");
  if (binding.incomplete) errors.push("Ein unvollständiger Scan kann nicht als vollständiger virtueller Plan gespeichert werden.");
  if (plan.status !== "draft") errors.push("Nur ein virtueller Entwurf kann bearbeitet werden.");

  const observedIds = new Set<string>();
  walk(scanResult.root, (node) => observedIds.add(node.id));
  const itemIds = new Set<string>();
  const nodeIds = new Set<string>();
  for (const item of plan.items) {
    if (itemIds.has(item.id)) errors.push("Der virtuelle Plan enthält doppelte Planobjekte.");
    itemIds.add(item.id);
    if (nodeIds.has(item.observed.nodeId)) errors.push("Ein beobachtetes Objekt ist mehrfach im Plan enthalten.");
    nodeIds.add(item.observed.nodeId);
    if (!observedIds.has(item.observed.nodeId)) errors.push("Der virtuelle Plan verweist auf ein nicht beobachtetes Objekt.");
    if (item.virtualTargetPath.includes("..") || item.virtualTargetPath.startsWith("/")) {
      errors.push("Ein virtueller Zielpfad verlässt den beobachteten Quellbereich.");
    }
  }
  if (nodeIds.size !== observedIds.size) errors.push("Nicht jedes beobachtete Objekt ist genau einmal im virtuellen Plan enthalten.");

  const folderPaths = new Set<string>();
  for (const folder of plan.virtualFolders ?? []) {
    const nameError = validWindowsName(folder.name);
    if (nameError !== null) errors.push(nameError);
    const path = joinVirtualPath(folder.parentVirtualPath, folder.name).toLowerCase();
    if (folderPaths.has(path)) errors.push("Virtuelle Zielordner kollidieren.");
    folderPaths.add(path);
  }
  const projectedPaths = new Set<string>();
  for (const row of projectVirtualPlan(plan)) {
    const key = row.virtualPath.toLowerCase();
    if (projectedPaths.has(key)) errors.push("Virtuelle Zielpfade kollidieren.");
    projectedPaths.add(key);
  }

  return {
    valid: errors.length === 0,
    errors,
    observedObjectCount: observedIds.size,
    projectedObjectCount: nodeIds.size,
  };
}
