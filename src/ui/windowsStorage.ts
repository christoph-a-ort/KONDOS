/** FV2-02d.2 – TypeScript storage-kind gate. Classification comes from Rust. */
import type { FsNode, ScanResult } from "../model";
import { isDirectory } from "../model";
import { normalizeVirtualPlanPath } from "./virtualPlan";
import type { DryRunStatus, VirtualDryRunOperation, VirtualDryRunReport } from "./virtualPlanDryRun";

export type StorageKind = "local" | "remote" | "unsupported" | "unverifiable";

export interface StorageKindView {
  path: string;
  kind: string;
  message: string | null;
}

export const STORAGE_REMOTE_REASON =
  "Netzwerkspeicherort erkannt. Echte Dateioperationen sind hier nicht zulässig.";
export const STORAGE_UNSUPPORTED_REASON =
  "Dieser Speicherort wird für echte Dateioperationen derzeit nicht unterstützt.";
export const STORAGE_UNVERIFIABLE_REASON =
  "Der Speicherort konnte nicht zuverlässig überprüft werden.";

export function parseStorageKind(value: unknown): StorageKind {
  if (value === "local" || value === "remote" || value === "unsupported" || value === "unverifiable") {
    return value;
  }
  return "unverifiable";
}

export function worstStorageKind(kinds: ReadonlyArray<StorageKind>): StorageKind {
  if (kinds.length === 0) return "unverifiable";
  if (kinds.some((kind) => kind === "remote")) return "remote";
  if (kinds.some((kind) => kind === "unsupported")) return "unsupported";
  if (kinds.some((kind) => kind === "unverifiable")) return "unverifiable";
  if (kinds.every((kind) => kind === "local")) return "local";
  return "unverifiable";
}

export function storageKindReason(kind: StorageKind): string | null {
  if (kind === "remote") return STORAGE_REMOTE_REASON;
  if (kind === "unsupported") return STORAGE_UNSUPPORTED_REASON;
  if (kind === "unverifiable") return STORAGE_UNVERIFIABLE_REASON;
  return null;
}

function absoluteScanPath(scanRoot: string, relative: string): string {
  if (relative === "." || relative === "") return scanRoot;
  const slash = scanRoot.includes("\\") ? "\\" : "/";
  return `${scanRoot.replace(/[\\/]+$/, "")}${slash}${relative.replace(/[\\/]/g, slash)}`;
}

function parentRelative(path: string): string {
  const normalized = normalizeVirtualPlanPath(path);
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "." : normalized.slice(0, index);
}

function snapshotIndex(root: FsNode): Map<string, FsNode> {
  const index = new Map<string, FsNode>();
  const walk = (node: FsNode) => {
    const relative = relativeFromRoot(root.path, node.path);
    if (relative !== null && !index.has(relative)) index.set(relative, node);
    if (isDirectory(node)) node.children.forEach(walk);
  };
  walk(root);
  return index;
}

function relativeFromRoot(rootPath: string, nodePath: string): string | null {
  const root = normalizeVirtualPlanPath(rootPath);
  const path = normalizeVirtualPlanPath(nodePath);
  if (path === root) return ".";
  const prefix = `${root}/`;
  return path.startsWith(prefix) && path.length > prefix.length ? path.slice(prefix.length) : null;
}

export function existingStoragePathsForDryRun(
  scanRoot: string,
  scanResult: ScanResult,
  operations: ReadonlyArray<VirtualDryRunOperation>,
): string[] {
  const paths = new Set<string>([scanRoot]);
  const index = snapshotIndex(scanResult.root);
  for (const operation of operations) {
    if (operation.kind !== "createVirtualFolder") {
      const source = index.get(normalizeVirtualPlanPath(operation.sourcePath));
      if (source !== undefined) {
        paths.add(absoluteScanPath(scanRoot, operation.sourcePath));
      }
      const dest = index.get(normalizeVirtualPlanPath(operation.targetPath));
      if (dest !== undefined) {
        paths.add(absoluteScanPath(scanRoot, operation.targetPath));
      }
    }
    let ancestor = parentRelative(operation.targetPath);
    while (ancestor !== ".") {
      const node = index.get(ancestor);
      if (node !== undefined && isDirectory(node) && node.listing === "read") {
        paths.add(absoluteScanPath(scanRoot, ancestor));
        break;
      }
      ancestor = parentRelative(ancestor);
    }
  }
  return [...paths];
}

export function applyStorageClassification(
  report: VirtualDryRunReport,
  kinds: ReadonlyArray<unknown>,
): VirtualDryRunReport {
  const parsed = kinds.map(parseStorageKind);
  const worst = worstStorageKind(parsed);
  const reason = storageKindReason(worst);
  const storageClassification = worst;
  if (worst === "local") {
    return { ...report, storageClassification };
  }
  const status: DryRunStatus = worst === "unverifiable" && report.status !== "blocked" ? "unverifiable" : "blocked";
  const openRequirements = reason === null
    ? report.openRequirements
    : [...new Set([...report.openRequirements, reason])];
  return {
    ...report,
    status,
    storageClassification,
    blockedOperationCount: Math.max(report.blockedOperationCount, 1),
    openRequirements,
  };
}

export function storageAllowsJournal(report: VirtualDryRunReport): boolean {
  return report.status === "restricted" && report.storageClassification === "local";
}

export function withLocalStorageClassification(report: VirtualDryRunReport): VirtualDryRunReport {
  return { ...report, storageClassification: "local" };
}
