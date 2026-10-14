/**
 * P2-K.3a – Virtual SOLL preview and justifiable suggestions.
 * READ-ONLY projection over an observed ScanResult + optional insights/draft.
 * No filesystem actions. No automatic rename/move/delete/create of user files.
 */

import type { DirectoryNode, FsNode, ScanConfig, ScanResult } from "../model";
import { isDirectory } from "../model";
import type { StructureInsightViewModel } from "./structureInsightViewModel";
import {
  makeSnapshotBinding,
  normalizeVirtualPlanPath,
  type ObjectIdentityStatus,
  type OpenCase,
  type SnapshotBinding,
  type VirtualPlan,
} from "./virtualPlan";

export const VIRTUAL_PLAN_PREVIEW_BUILDER_VERSION = 1 as const;

export type SuggestionKind = "structureHint" | "reviewCase" | "unchanged";

export type SollChangeKind = "unchanged";

export interface StructureHint {
  id: string;
  locationNodeId: string;
  title: string;
  rationale: string;
  evidenceBasis: string;
  sourceInsightIds: string[];
  kind: "structureHint";
}

export interface ReviewCase {
  id: string;
  locationNodeId?: string;
  reason: OpenCase["reason"] | "similarStructure";
  rationale: string;
  /** Named structural features that justify opening a review case — not a move approval. */
  features: string[];
  sourceInsightIds: string[];
  kind: "reviewCase";
}

export interface SollNodeProjection {
  nodeId: string;
  relativePath: string;
  displayName: string;
  kind: "file" | "directory";
  depth: number;
  changeKind: SollChangeKind;
  suggestionKind: SuggestionKind;
  hintIds: string[];
  reviewCaseIds: string[];
  identityStatus: ObjectIdentityStatus;
  listing?: DirectoryNode["listing"];
  /** True when this directory listing was not fully read. */
  incompleteListing: boolean;
}

export interface VirtualSollPreview {
  builderVersion: typeof VIRTUAL_PLAN_PREVIEW_BUILDER_VERSION;
  binding: SnapshotBinding;
  nodes: SollNodeProjection[];
  hints: StructureHint[];
  reviewCases: ReviewCase[];
  flags: {
    incomplete: boolean;
    identityLimited: boolean;
    draftStale: boolean;
    draftBlocked: boolean;
    draftPresent: boolean;
  };
  /** Every observed nodeId appears exactly once. */
  observedNodeCount: number;
}

export type DraftConflict =
  | { kind: "none" }
  | { kind: "missing" }
  | { kind: "stale"; reason: "fingerprintMismatch" | "scanIdMismatch" }
  | { kind: "blocked"; reason: string };

export function planIdForBinding(binding: SnapshotBinding): string {
  return `vp_${binding.snapshotFingerprint}`;
}

export function relativeVirtualPath(rootPath: string, nodePath: string): string {
  const root = normalizeVirtualPlanPath(rootPath);
  const path = normalizeVirtualPlanPath(nodePath);
  if (path === root) {
    return ".";
  }
  const prefix = `${root}/`;
  if (path.startsWith(prefix)) {
    return path.slice(prefix.length);
  }
  return path;
}

export function assessDraftConflict(
  binding: SnapshotBinding,
  draft: VirtualPlan | null,
  draftBlocked: boolean,
): DraftConflict {
  if (draftBlocked) {
    return { kind: "blocked", reason: "unreadable-or-unknown-version" };
  }
  if (draft === null) {
    return { kind: "missing" };
  }
  if (draft.binding.snapshotFingerprint !== binding.snapshotFingerprint) {
    return { kind: "stale", reason: "fingerprintMismatch" };
  }
  if (draft.binding.sourceScanId !== binding.sourceScanId) {
    return { kind: "stale", reason: "scanIdMismatch" };
  }
  return { kind: "none" };
}

/**
 * True only when a write would be allowed without silently clobbering another draft.
 * K.3a does not auto-write; this guard documents the contract for later phases.
 */
export function mayPersistPreviewDraft(
  conflict: DraftConflict,
  incomplete: boolean,
): boolean {
  if (incomplete) {
    return false;
  }
  return conflict.kind === "none" || conflict.kind === "missing";
}

function compareUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function walkObserved(root: FsNode, visit: (node: FsNode) => void): void {
  visit(root);
  if (isDirectory(root)) {
    for (const child of root.children) {
      walkObserved(child, visit);
    }
  }
}

function countObservedNodes(root: FsNode): number {
  let count = 0;
  walkObserved(root, () => {
    count += 1;
  });
  return count;
}

/** Compact evidence line for users — no fact-line repetition. */
export function formatHintEvidenceBasis(
  categoryLabel: string,
  evidenceLevel: string,
  evidenceLabel: string,
): string {
  const parts = [`Kategorie: ${categoryLabel}`];
  // Unassessed has no useful strength signal for the user in this stage.
  if (evidenceLevel !== "unassessed" && evidenceLabel.length > 0) {
    parts.push(`Evidenzstärke: ${evidenceLabel}`);
  }
  return parts.join(" · ");
}

function buildHintsFromInsights(
  viewModel: StructureInsightViewModel | null,
): StructureHint[] {
  if (viewModel === null) {
    return [];
  }
  const hints: StructureHint[] = [];
  for (const insight of viewModel.insights) {
    hints.push({
      id: `hint_${insight.id}`,
      locationNodeId: insight.locationId,
      title: insight.title,
      // Fact once — UI must not repeat this under evidenceBasis.
      rationale: insight.factLine,
      evidenceBasis: formatHintEvidenceBasis(
        insight.categoryLabel,
        insight.evidenceLevel,
        insight.evidenceLabel,
      ),
      sourceInsightIds: [insight.id],
      kind: "structureHint",
    });
  }
  hints.sort((a, b) => compareUtf16(a.id, b.id));
  return hints;
}

function principleFeatureLabel(principle: string): string {
  if (principle.includes("file-name") || principle.includes("file_name")) {
    return "Wiederkehrende oder parallele Dateinamensmuster";
  }
  if (principle.includes("folder") || principle.includes("child")) {
    return "Wiederkehrende oder parallele Ordnernamen";
  }
  if (principle.includes("year")) {
    return "Wiederkehrende Jahresangaben in Namen";
  }
  if (principle.includes("file-type") || principle.includes("type")) {
    return "Parallele Dateityp-Verteilung";
  }
  return "Strukturell ähnliches Namens- oder Ordnermuster";
}

/**
 * Review cases only when a concrete user decision may be needed.
 * Recurring/parallel patterns alone are structure hints — never auto Prüffälle.
 */
function buildReviewCases(options: {
  binding: SnapshotBinding;
  viewModel: StructureInsightViewModel | null;
  draft: VirtualPlan | null;
  conflict: DraftConflict;
}): ReviewCase[] {
  const cases: ReviewCase[] = [];
  // Global identity / incomplete belong in status flags only — not as list items.
  void options.binding;

  if (options.viewModel !== null) {
    for (const insight of options.viewModel.insights) {
      // Incomplete observation at a named insight location → genuine ambiguity.
      if (insight.incompleteData) {
        cases.push({
          id: `case_insight_incomplete_${insight.id}`,
          locationNodeId: insight.locationId,
          reason: "incompleteSnapshot",
          rationale: `Gegenstand: Muster „${insight.title}“. Unklar: Ob das beobachtete Muster vollständig erfasst ist, weil die Datengrundlage an diesem Ort eingeschränkt war. Entscheidung: keine automatische Strukturänderung; ggf. später erneut prüfen.`,
          features: [
            "Eingeschränkte Datengrundlage am Musterort",
            `Kategorie: ${insight.categoryLabel}`,
          ],
          sourceInsightIds: [insight.id],
          kind: "reviewCase",
        });
      }
      // Deliberately NO auto Prüffall for parallel/recurring principles.
    }
  }

  // Carry forward draft open cases only when the draft matches the current snapshot.
  if (options.conflict.kind === "none" && options.draft !== null) {
    for (const open of options.draft.openCases) {
      const id = `case_draft_${open.id}`;
      if (cases.some((entry) => entry.id === id)) {
        continue;
      }
      cases.push({
        id,
        locationNodeId: open.planItemId,
        reason: open.reason,
        rationale:
          "Gegenstand: Offener Fall aus dem gespeicherten Entwurf. Unklar: Die frühere Entscheidung steht noch aus. Entscheidung: wird angezeigt, aber nicht automatisch als strukturelle Änderung übernommen.",
        features: [reviewReasonLabel(open.reason)],
        sourceInsightIds: [],
        kind: "reviewCase",
      });
    }
  }

  cases.sort((a, b) => compareUtf16(a.id, b.id));
  return cases;
}

/** User-facing reason title — never the raw machine code. */
export function reviewReasonLabel(reason: ReviewCase["reason"]): string {
  switch (reason) {
    case "identityUnavailable":
      return "Zuordnung nur innerhalb dieses Scans";
    case "incompleteSnapshot":
      return "Eingeschränkte Datengrundlage";
    case "ambiguous":
      return "Mehrdeutige Lage";
    case "similarStructure":
      return "Ähnliche Strukturen erkannt";
    default:
      return "Offener Prüffall";
  }
}

/**
 * Map technical feature tokens to German labels when legacy tokens appear.
 * Prefer already-human features from the builder.
 */
export function reviewFeatureLabel(feature: string): string {
  if (feature === "identityStatus.scanLocalOnly") {
    return "Dateien können derzeit nur innerhalb dieses Scanvorgangs eindeutig zugeordnet werden";
  }
  if (feature === "snapshot.incomplete" || feature === "binding.incomplete") {
    return "Scan ist unvollständig oder gefiltert";
  }
  if (feature === "insight.incompleteData") {
    return "Datengrundlage am Musterort eingeschränkt";
  }
  if (feature.startsWith("principle:")) {
    return principleFeatureLabel(feature.slice("principle:".length));
  }
  if (feature.startsWith("category:")) {
    const key = feature.slice("category:".length);
    if (key === "file-names") return "Kategorie: Dateinamen";
    if (key === "folder-structure") return "Kategorie: Ordnerstruktur";
    if (key === "time-years") return "Kategorie: Zeit/Jahre";
    if (key === "file-distribution") return "Kategorie: Dateiaufteilung";
    return `Kategorie: ${key}`;
  }
  if (feature.startsWith("evidence:")) {
    const level = feature.slice("evidence:".length);
    if (level === "high") return "Evidenzstärke: Hoch";
    if (level === "medium") return "Evidenzstärke: Mittel";
    if (level === "low") return "Evidenzstärke: Niedrig";
    if (level === "unassessed") return "Evidenzstärke: Noch nicht bewertet";
    return `Evidenzstärke: ${level}`;
  }
  if (feature.startsWith("draft.openCase:")) {
    return reviewReasonLabel(feature.slice("draft.openCase:".length) as ReviewCase["reason"]);
  }
  return feature;
}

/** True if a feature string still looks like an internal machine key. */
export function looksLikeTechnicalFeatureKey(feature: string): boolean {
  return (
    feature.includes("identityStatus.") ||
    feature.startsWith("principle:") ||
    feature.startsWith("evidence:") ||
    feature.startsWith("draft.openCase:") ||
    feature === "snapshot.incomplete" ||
    feature === "binding.incomplete" ||
    feature === "insight.incompleteData" ||
    /^(identityUnavailable|similarStructure|incompleteSnapshot|ambiguous)$/.test(feature)
  );
}

export function buildVirtualSollPreview(options: {
  scanResult: ScanResult;
  scanConfig: ScanConfig;
  sourceScanId: number;
  insightViewModel?: StructureInsightViewModel | null;
  existingDraft?: VirtualPlan | null;
  draftBlocked?: boolean;
}): VirtualSollPreview {
  const viewModel = options.insightViewModel ?? null;
  const draft = options.existingDraft ?? null;
  const draftBlocked = options.draftBlocked === true;
  const binding = makeSnapshotBinding(
    options.scanResult,
    options.scanConfig,
    options.sourceScanId,
  );
  const conflict = assessDraftConflict(binding, draft, draftBlocked);
  const hints = buildHintsFromInsights(viewModel);
  const reviewCases = buildReviewCases({ binding, viewModel, draft, conflict });

  const hintsByLocation = new Map<string, string[]>();
  for (const hint of hints) {
    const list = hintsByLocation.get(hint.locationNodeId) ?? [];
    list.push(hint.id);
    hintsByLocation.set(hint.locationNodeId, list);
  }
  const casesByLocation = new Map<string, string[]>();
  for (const reviewCase of reviewCases) {
    if (reviewCase.locationNodeId === undefined) {
      continue;
    }
    const list = casesByLocation.get(reviewCase.locationNodeId) ?? [];
    list.push(reviewCase.id);
    casesByLocation.set(reviewCase.locationNodeId, list);
  }

  const nodes: SollNodeProjection[] = [];
  walkObserved(options.scanResult.root, (node) => {
    const hintIds = hintsByLocation.get(node.id) ?? [];
    const reviewCaseIds = casesByLocation.get(node.id) ?? [];
    const incompleteListing =
      isDirectory(node) && node.listing !== "read";
    let suggestionKind: SuggestionKind = "unchanged";
    if (reviewCaseIds.length > 0) {
      suggestionKind = "reviewCase";
    } else if (hintIds.length > 0) {
      suggestionKind = "structureHint";
    }
    nodes.push({
      nodeId: node.id,
      relativePath: relativeVirtualPath(options.scanResult.root.path, node.path),
      displayName: node.name,
      kind: node.kind,
      depth: node.depth,
      changeKind: "unchanged",
      suggestionKind,
      hintIds,
      reviewCaseIds,
      identityStatus: "scanLocalOnly",
      listing: isDirectory(node) ? node.listing : undefined,
      incompleteListing,
    });
  });

  // Invariant: SOLL contains every observed object; none silently dropped.
  const observedNodeCount = countObservedNodes(options.scanResult.root);
  if (nodes.length !== observedNodeCount) {
    throw new Error("virtual-soll-projection-incomplete");
  }

  // No structural path changes in K.3a — every node stays unchanged.
  for (const node of nodes) {
    if (node.changeKind !== "unchanged") {
      throw new Error("virtual-soll-unauthorized-change");
    }
  }

  return {
    builderVersion: VIRTUAL_PLAN_PREVIEW_BUILDER_VERSION,
    binding,
    nodes,
    hints,
    reviewCases,
    flags: {
      incomplete: binding.incomplete,
      identityLimited: true,
      draftStale: conflict.kind === "stale",
      draftBlocked: conflict.kind === "blocked",
      draftPresent: conflict.kind === "none" || conflict.kind === "stale",
    },
    observedNodeCount,
  };
}

/** Guard used by checks: K.3a must never emit rename/move intent fields on projection nodes. */
export function projectionHasStructuralChangeIntent(preview: VirtualSollPreview): boolean {
  return preview.nodes.some((node) => node.changeKind !== "unchanged");
}
