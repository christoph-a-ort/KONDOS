/**
 * P2-K.2 – Virtual-plan foundation.  No React, no filesystem actions.
 * A draft is an intent overlay bound to an observed scan snapshot.
 */
import type { DirectoryListing, FsNode, ScanConfig, ScanResult } from "../model";

export const VIRTUAL_PLAN_SCHEMA_VERSION = 1 as const;
export type VirtualPlanStatus = "draft" | "stale" | "virtuallyApproved";
export type VirtualPlanItemStatus = "proposed" | "edited" | "excluded" | "openCase" | "virtuallyApproved";
export type VirtualObjectKind = "file" | "directory";
export type ObjectIdentityStatus = "scanLocalOnly" | "identityUnavailable";
export type VirtualPlanScope =
  | { kind: "scanRoot"; rootNodeId: string }
  | { kind: "subtree"; rootNodeId: string; subtreeNodeId: string }
  | { kind: "comparisonSet"; rootNodeId: string; nodeIds: string[] };

export interface SnapshotBinding {
  sourceScanId: number;
  normalizedRootPath: string;
  scanConfig: Pick<ScanConfig, "maxDepth" | "excludeHidden" | "extensions" | "includeSize" | "includeCreatedAt" | "includeModifiedAt">;
  snapshotFingerprint: string;
  incomplete: boolean;
}
export interface ObservedObjectRef {
  nodeId: string; relativePath: string; kind: VirtualObjectKind;
  identityStatus: ObjectIdentityStatus;
  metadata: { sizeBytes?: number; createdAtMs?: number; modifiedAtMs?: number };
  /** Reserved for a future platform object identity; never inferred from name/content. */
  windowsObjectIdentity?: { volumeSerial: string; fileIndex: string };
}
export interface VirtualPlanItem {
  id: string; observed: ObservedObjectRef; virtualTargetPath: string;
  virtualRename?: string; status: VirtualPlanItemStatus;
  sourceInsightIds: string[]; alternatives: string[]; rationale?: string;
}
export interface OpenCase { id: string; planItemId?: string; reason: "identityUnavailable" | "incompleteSnapshot" | "ambiguous"; }
export interface DecisionRecord { id: string; revision: number; planId: string; planItemId?: string; kind: "exclude" | "approveVirtual" | "revokeVirtual" | "edit"; origin: "user"; createdAtMs: number; }
export interface PreferenceRecord { id: string; scope: VirtualPlanScope; description: string; revision: number; active: boolean; origin: "user"; }
export interface VirtualPlan {
  schemaVersion: typeof VIRTUAL_PLAN_SCHEMA_VERSION; planId: string; builderVersion: number; revision: number;
  status: VirtualPlanStatus; scope: VirtualPlanScope; binding: SnapshotBinding; items: VirtualPlanItem[];
  openCases: OpenCase[]; decisions: DecisionRecord[]; preferences: PreferenceRecord[];
}
export type DraftLoadResult =
  | { kind: "missing" }
  | { kind: "valid"; plan: VirtualPlan }
  | { kind: "blocked"; reason: "corrupt" | "unknownVersion" | "migrationFailed" };

export function normalizeVirtualPlanPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/+$/, "").toLowerCase();
}
export function snapshotFingerprint(result: ScanResult, config: ScanConfig): string {
  const tokens: string[] = [];
  const walk = (node: FsNode) => {
    const listing: DirectoryListing | "" = node.kind === "directory" ? node.listing : "";
    tokens.push([normalizeVirtualPlanPath(node.path), node.kind, listing, node.sizeBytes ?? "", node.createdAtMs ?? "", node.modifiedAtMs ?? ""].join("|"));
    if (node.kind === "directory") node.children.forEach(walk);
  };
  walk(result.root);
  const source = JSON.stringify({ root: normalizeVirtualPlanPath(result.root.path), config: { ...config, rootPath: normalizeVirtualPlanPath(config.rootPath), extensions: [...config.extensions].map(x => x.toLowerCase()).sort() }, tokens });
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
  return `vp1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
export function snapshotIsIncomplete(result: ScanResult, config: ScanConfig): boolean {
  const incomplete = (node: FsNode): boolean => node.kind === "directory" && (node.listing !== "read" || node.children.some(incomplete));
  return incomplete(result.root) || result.warnings.length > 0 || config.extensions.length > 0;
}
export function makeSnapshotBinding(result: ScanResult, config: ScanConfig, sourceScanId: number): SnapshotBinding {
  return { sourceScanId, normalizedRootPath: normalizeVirtualPlanPath(result.root.path), scanConfig: { maxDepth: config.maxDepth, excludeHidden: config.excludeHidden, extensions: [...config.extensions].map(x => x.toLowerCase()).sort(), includeSize: config.includeSize, includeCreatedAt: config.includeCreatedAt, includeModifiedAt: config.includeModifiedAt }, snapshotFingerprint: snapshotFingerprint(result, config), incomplete: snapshotIsIncomplete(result, config) };
}
export function parseVirtualPlan(raw: string): DraftLoadResult {
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object") return { kind: "blocked", reason: "corrupt" };
    const plan = value as Partial<VirtualPlan>;
    if (plan.schemaVersion !== VIRTUAL_PLAN_SCHEMA_VERSION) return { kind: "blocked", reason: typeof plan.schemaVersion === "number" ? "unknownVersion" : "corrupt" };
    if (typeof plan.planId !== "string" || typeof plan.revision !== "number" || !plan.binding || !Array.isArray(plan.items) || !Array.isArray(plan.openCases) || !Array.isArray(plan.decisions) || !Array.isArray(plan.preferences)) return { kind: "blocked", reason: "corrupt" };
    return { kind: "valid", plan: plan as VirtualPlan };
  } catch { return { kind: "blocked", reason: "corrupt" }; }
}
export function canWriteVirtualDraft(load: DraftLoadResult, expectedRevision: number, candidate: VirtualPlan): boolean {
  return load.kind === "valid" && load.plan.planId === candidate.planId && load.plan.revision === expectedRevision;
}
