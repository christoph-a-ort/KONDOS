/** P2-L.2 – Pure, non-executable dry-run model. No filesystem access. */
import type { FsNode, ScanResult } from "../model";
import { isDirectory } from "../model";
import { normalizeVirtualPlanPath, type SnapshotBinding, type VirtualPlan } from "./virtualPlan";
import { validateVirtualPlan } from "./virtualPlanEditor";

export type DryRunOperationKind = "createVirtualFolder" | "moveFile" | "renameFile";
export type DryRunStatus = "allowed" | "restricted" | "blocked";
export type DryRunCheck = "snapshotVerified" | "notDecidableFromSnapshot" | "mustCheckAtExecution" | "blocked";
export interface VirtualDryRunOperation {
  id: string; kind: DryRunOperationKind; objectId: string; sourcePath: string; targetPath: string;
  expectedSource: string; preconditions: string[]; expectedTarget: string; collisionStatus: DryRunCheck;
  checkStatus: DryRunCheck; rationale: string; recovery: string;
}
export interface VirtualDryRunReport {
  status: DryRunStatus; operations: VirtualDryRunOperation[]; folderCount: number; fileOperationCount: number;
  unchangedFileCount: number; blockedOperationCount: number; openRequirements: string[]; warnings: string[];
}
const invalidName = (name: string) => !name || name === "." || name === ".." || /[\\/:*?"<>|]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name);
const join = (left: string, right: string) => left === "." ? right : `${left}/${right}`;
const parent = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) || "." : ".";
const base = (path: string) => path.slice(path.lastIndexOf("/") + 1);

function relativeFromRoot(rootPath: string, nodePath: string): string | null {
  const root = normalizeVirtualPlanPath(rootPath);
  const path = normalizeVirtualPlanPath(nodePath);
  if (path === root) return ".";
  const prefix = `${root}/`;
  return path.startsWith(prefix) && path.length > prefix.length ? path.slice(prefix.length) : null;
}

function indexSnapshotPaths(root: FsNode): Map<string, FsNode[]> | null {
  const index = new Map<string, FsNode[]>();
  let unclear = false;
  const walk = (node: FsNode) => {
    const relative = relativeFromRoot(root.path, node.path);
    if (relative === null) {
      unclear = true;
      return;
    }
    const entries = index.get(relative) ?? [];
    entries.push(node);
    index.set(relative, entries);
    if (isDirectory(node)) node.children.forEach(walk);
  };
  walk(root);
  return unclear ? null : index;
}

function existingDirectoryInSnapshot(index: Map<string, FsNode[]>, relativePath: string): "missing" | "existingDirectory" | "blocked" {
  const entries = index.get(normalizeVirtualPlanPath(relativePath));
  if (entries === undefined || entries.length === 0) return "missing";
  if (entries.length !== 1) return "blocked";
  const node = entries[0]!;
  if (!isDirectory(node) || node.listing !== "read") return "blocked";
  return "existingDirectory";
}

export function buildVirtualPlanDryRun(options: { plan: VirtualPlan; scanResult: ScanResult; binding: SnapshotBinding; current: boolean }): VirtualDryRunReport {
  const { plan, scanResult, binding } = options;
  const warnings: string[] = ["Dry-Run ist keine Freigabe für eine reale Ausführung."];
  const openRequirements = ["Stabile Dateisystemidentität unmittelbar vor einer späteren Ausführung prüfen."];
  const validation = validateVirtualPlan(plan.status === "draft" ? plan : { ...plan, status: "draft" }, scanResult, binding);
  const blockers: string[] = [];
  if (plan.status !== "virtuallyApproved") blockers.push("Nur ein virtuell bestätigter Plan kann simuliert werden.");
  if (!options.current) blockers.push("Der Plan gehört nicht unverändert zum aktuellen Scan-Snapshot.");
  if (binding.incomplete || plan.openCases.length > 0) blockers.push("Der Scan oder Plan enthält offene blockierende Voraussetzungen.");
  blockers.push(...validation.errors);
  if (blockers.length > 0) return { status: "blocked", operations: [], folderCount: 0, fileOperationCount: 0, unchangedFileCount: 0, blockedOperationCount: 0, openRequirements: [...new Set([...openRequirements, ...blockers])], warnings };

  const snapshotIndex = indexSnapshotPaths(scanResult.root);
  if (snapshotIndex === null) {
    return { status: "blocked", operations: [], folderCount: 0, fileOperationCount: 0, unchangedFileCount: 0, blockedOperationCount: 1, openRequirements: [...openRequirements, "Der Scan-Snapshot ist nicht eindeutig interpretierbar."], warnings };
  }

  const operations: VirtualDryRunOperation[] = [];
  const targets = new Set<string>();
  const identityBlockers: string[] = [];
  for (const folder of plan.virtualFolders ?? []) {
    const path = join(folder.parentVirtualPath, folder.name);
    if (invalidName(folder.name) || path.includes("..") || path.startsWith("/")) {
      blockers.push(`Ungültiger virtueller Zielordner: ${path}`);
      continue;
    }
    const existing = existingDirectoryInSnapshot(snapshotIndex, path);
    if (existing === "blocked") {
      identityBlockers.push(`Der Zielpfad „${path}“ ist im aktuellen Scan kein eindeutig erkanntes Verzeichnis.`);
      continue;
    }
    if (existing === "existingDirectory") {
      warnings.push(`Vorhandenes Scan-Verzeichnis „${path}“ wird nicht erneut als Ordneranlage geplant.`);
      continue;
    }
    operations.push({ id: `dry-folder-${folder.id}`, kind: "createVirtualFolder", objectId: folder.id, sourcePath: folder.parentVirtualPath, targetPath: path, expectedSource: "Zielordner ist nur virtuell geplant.", preconditions: ["Zielpfad bleibt innerhalb der Scanwurzel.", "Ziel darf später nicht existieren oder kollidieren."], expectedTarget: "Virtueller Zielordner", collisionStatus: "notDecidableFromSnapshot", checkStatus: "mustCheckAtExecution", rationale: "Benötigter virtueller Zielordner.", recovery: "Bei späterer Ausführung nur entfernen, wenn leer und durch das Journal erstellt." });
  }
  if (identityBlockers.length > 0) {
    return { status: "blocked", operations: [], folderCount: 0, fileOperationCount: 0, unchangedFileCount: 0, blockedOperationCount: identityBlockers.length, openRequirements: [...new Set([...openRequirements, ...identityBlockers])], warnings };
  }
  for (const item of plan.items.filter((entry) => entry.observed.kind === "file")) {
    const source = item.observed.relativePath;
    const target = join(item.virtualTargetPath, item.virtualRename ?? base(source));
    if (target === source) continue;
    if (target.includes("..") || target.startsWith("/") || invalidName(base(target))) { blockers.push(`Ungültiger Dateizielpfad: ${target}`); continue; }
    const key = target.toLowerCase();
    if (targets.has(key)) { blockers.push(`Doppelter Dateizielpfad: ${target}`); continue; }
    targets.add(key);
    const kind: DryRunOperationKind = parent(source) === parent(target) ? "renameFile" : "moveFile";
    operations.push({ id: `dry-file-${item.id}`, kind, objectId: item.observed.nodeId, sourcePath: source, targetPath: target, expectedSource: `Scan-lokale Identität; Größe ${item.observed.metadata.sizeBytes ?? "unbekannt"}.`, preconditions: ["Quelle muss später unverändert und kein Reparse-Point sein.", "Ziel darf später nicht existieren.", "Gleiches Laufwerk, Berechtigung und Zielordner später prüfen."], expectedTarget: "Nicht vorhandene Datei am virtuellen Zielpfad", collisionStatus: "notDecidableFromSnapshot", checkStatus: "mustCheckAtExecution", rationale: kind === "moveFile" ? "Virtuelle Zuordnung in einen anderen Zielordner." : "Virtuelle Umbenennung im selben Zielordner.", recovery: "Spätere Umkehrung ausschließlich aus dem Ausführungsjournal." });
  }
  const sorted = operations.sort((a, b) => (a.kind === "createVirtualFolder" ? 0 : 1) - (b.kind === "createVirtualFolder" ? 0 : 1) || a.targetPath.localeCompare(b.targetPath));
  if (blockers.length > 0) return { status: "blocked", operations: sorted, folderCount: sorted.filter((entry) => entry.kind === "createVirtualFolder").length, fileOperationCount: sorted.filter((entry) => entry.kind !== "createVirtualFolder").length, unchangedFileCount: plan.items.filter((entry) => entry.observed.kind === "file").length - sorted.filter((entry) => entry.kind !== "createVirtualFolder").length, blockedOperationCount: blockers.length, openRequirements: [...new Set([...openRequirements, ...blockers])], warnings };
  warnings.push("OneDrive-, UNC-, Netzlaufwerk-, Reparse-Point-, Existenz- und Berechtigungsprüfung ist erst unmittelbar vor einer späteren Ausführung möglich.");
  return { status: "restricted", operations: sorted, folderCount: sorted.filter((entry) => entry.kind === "createVirtualFolder").length, fileOperationCount: sorted.filter((entry) => entry.kind !== "createVirtualFolder").length, unchangedFileCount: plan.items.filter((entry) => entry.observed.kind === "file").length - sorted.filter((entry) => entry.kind !== "createVirtualFolder").length, blockedOperationCount: 0, openRequirements, warnings };
}
