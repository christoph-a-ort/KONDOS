/**
 * P2-J-A – READ-ONLY structure insight view model / presentation mapping.
 *
 * Derives a deterministic presentation layer from assessed P2-I rule candidates
 * plus the ScanResult tree. Does NOT run P2-H/P2-I, mutate inputs, invent
 * semantics, scores, or filesystem actions.
 */

import { isDirectory, type DirectoryNode, type ScanResult } from "../model";
import { displayInventoryPath } from "./inventoryOverview";
import type {
  StructureInsightConfidenceLevel,
  StructureInsightEvidenceItem,
  StructureInsightRuleCandidate,
} from "./structureInsightModel";
import {
  PRINCIPLE_PARALLEL_FILE_NAME_FORM_SET,
  PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET,
  PRINCIPLE_RECURRING_CHILD_FOLDER_NAME,
  PRINCIPLE_RECURRING_CHILD_FOLDER_SET,
  PRINCIPLE_RECURRING_FILE_NAME_FORM,
  PRINCIPLE_RECURRING_YEAR,
  compareRuleCandidateText,
} from "./structureRuleCandidate";
import { findNodeById } from "./treeRows";

export const STRUCTURE_INSIGHT_VIEW_MODEL_SCHEMA_VERSION = 1 as const;

/** Machine-readable user category keys (not P2 phase names). */
export type InsightUserCategoryKey =
  | "file-names"
  | "folder-structure"
  | "time-years"
  | "file-distribution";

export type InsightEvidenceLevel = StructureInsightConfidenceLevel;

export type InsightElementRole = "primary" | "secondaryRecurring" | "other";

export type InsightLocationKind = "root" | "folder";

export interface InsightPathSegment {
  nodeId: string;
  displayName: string;
}

export interface InsightElementRef {
  nodeId: string;
  displayName: string;
  relativePath?: string;
  role: InsightElementRole;
}

export interface InsightSecondaryRecurringGroup {
  /** Stable key within the card (formSignature, peer candidate id, …). */
  groupKey: string;
  /** Neutral German label; no right/wrong wording. */
  label: string;
  elements: InsightElementRef[];
}

export interface InsightStructureSummary {
  plainDescription: string;
  examples: string[];
  /** Optional structural token description for file-name forms (non-semantic). */
  structuralParts?: string[];
}

export interface InsightCardModel {
  id: string;
  locationId: string;
  principle: string;
  category: InsightUserCategoryKey;
  categoryLabel: string;
  title: string;
  factLine: string;
  evidenceLevel: InsightEvidenceLevel;
  evidenceLabel: string;
  incompleteData: boolean;
  explanationBullets: string[];
  structureSummary: InsightStructureSummary;
  primaryElements: InsightElementRef[];
  secondaryRecurringGroups: InsightSecondaryRecurringGroup[];
  otherElements: InsightElementRef[];
  searchText: string;
}

export interface InsightLocationGroup {
  locationId: string;
  kind: InsightLocationKind;
  /** Display context for root locations (P2-J.35). */
  rootContextLabel?: string;
  displayPathSegments: InsightPathSegment[];
  insightIds: string[];
}

export interface InsightEvidenceCounts {
  high: number;
  medium: number;
  low: number;
  unassessed: number;
  total: number;
}

export interface InsightCategoryCounts {
  "file-names": number;
  "folder-structure": number;
  "time-years": number;
  "file-distribution": number;
}

export interface StructureInsightViewModel {
  schemaVersion: typeof STRUCTURE_INSIGHT_VIEW_MODEL_SCHEMA_VERSION;
  locations: InsightLocationGroup[];
  insights: InsightCardModel[];
  countsByEvidence: InsightEvidenceCounts;
  countsByCategory: InsightCategoryCounts;
  globallyIncomplete: boolean;
}

const ROOT_CONTEXT_LABEL = "Eingelesener Hauptordner";

const CATEGORY_LABELS: Record<InsightUserCategoryKey, string> = {
  "file-names": "Dateinamen",
  "folder-structure": "Ordnerstruktur",
  "time-years": "Zeit/Jahre",
  "file-distribution": "Dateiaufteilung",
};

const EVIDENCE_LABELS: Record<InsightEvidenceLevel, string> = {
  high: "Hoch",
  medium: "Mittel",
  low: "Niedrig",
  unassessed: "Noch nicht bewertet",
};

const EVIDENCE_SORT_RANK: Record<InsightEvidenceLevel, number> = {
  high: 0,
  medium: 1,
  low: 2,
  unassessed: 3,
};

const PRINCIPLE_SORT_RANK: Record<string, number> = {
  [PRINCIPLE_RECURRING_FILE_NAME_FORM]: 0,
  [PRINCIPLE_PARALLEL_FILE_NAME_FORM_SET]: 1,
  [PRINCIPLE_RECURRING_YEAR]: 2,
  [PRINCIPLE_RECURRING_CHILD_FOLDER_NAME]: 3,
  [PRINCIPLE_RECURRING_CHILD_FOLDER_SET]: 4,
  [PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET]: 5,
};

const FORBIDDEN_VISIBLE_TOKENS = [
  "falsch",
  "fehler",
  "schlecht",
  "ausreißer",
  "ausreisser",
  "problemdatei",
  "sollte",
  "muss umbenannt",
  "empfohlen",
  "support-near-unanimity",
  "rival-clear-lead",
  "listing-complete",
  "counter-evidence-present",
  "evidence-breadth",
  "assessment-data-incomplete",
] as const;

export function mapPrincipleToUserCategory(principle: string): InsightUserCategoryKey | null {
  switch (principle) {
    case PRINCIPLE_RECURRING_FILE_NAME_FORM:
    case PRINCIPLE_PARALLEL_FILE_NAME_FORM_SET:
      return "file-names";
    case PRINCIPLE_RECURRING_YEAR:
      return "time-years";
    case PRINCIPLE_RECURRING_CHILD_FOLDER_NAME:
    case PRINCIPLE_RECURRING_CHILD_FOLDER_SET:
      return "folder-structure";
    case PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET:
      return "file-distribution";
    default:
      return null;
  }
}

export function userCategoryLabel(category: InsightUserCategoryKey): string {
  return CATEGORY_LABELS[category];
}

export function evidenceLevelLabel(level: InsightEvidenceLevel): string {
  return EVIDENCE_LABELS[level];
}

export function createEmptyStructureInsightViewModel(): StructureInsightViewModel {
  return {
    schemaVersion: STRUCTURE_INSIGHT_VIEW_MODEL_SCHEMA_VERSION,
    locations: [],
    insights: [],
    countsByEvidence: { high: 0, medium: 0, low: 0, unassessed: 0, total: 0 },
    countsByCategory: {
      "file-names": 0,
      "folder-structure": 0,
      "time-years": 0,
      "file-distribution": 0,
    },
    globallyIncomplete: false,
  };
}

/**
 * Build a READ-ONLY presentation view model from assessed P2-I candidates.
 * Does not mutate scanResult or assessedCandidates. Does not run P2-H/P2-I.
 */
export function buildStructureInsightViewModel(
  scanResult: ScanResult,
  assessedCandidates: readonly StructureInsightRuleCandidate[],
): StructureInsightViewModel {
  const parentById = buildParentIndex(scanResult.root);
  const rootId = scanResult.root.id;

  type Draft = {
    candidate: StructureInsightRuleCandidate;
    locationId: string;
    category: InsightUserCategoryKey;
  };

  const drafts: Draft[] = [];
  for (const candidate of assessedCandidates) {
    const category = mapPrincipleToUserCategory(candidate.principle);
    if (category === null) {
      continue;
    }
    const locationId = resolveLocationId(candidate, parentById, rootId);
    if (locationId === null) {
      continue;
    }
    drafts.push({ candidate, locationId, category });
  }

  // First pass: cards without peer-candidate secondary groups
  const cardsById = new Map<string, InsightCardModel>();
  for (const draft of drafts) {
    const card = buildCard(draft.candidate, draft.locationId, draft.category, scanResult, parentById, []);
    cardsById.set(card.id, card);
  }

  // Second pass: attach P2-G secondary recurring from peer candidates at same location
  for (const draft of drafts) {
    if (
      draft.candidate.principle !== PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET &&
      draft.candidate.principle !== PRINCIPLE_PARALLEL_FILE_NAME_FORM_SET
    ) {
      continue;
    }
    const peerIds = drafts
      .filter(
        (other) =>
          other.candidate.id !== draft.candidate.id &&
          other.locationId === draft.locationId &&
          other.candidate.principle === draft.candidate.principle,
      )
      .map((other) => other.candidate.id)
      .sort(compareRuleCandidateText);

    const card = cardsById.get(draft.candidate.id);
    if (card === undefined) {
      continue;
    }
    const rebuilt = buildCard(
      draft.candidate,
      draft.locationId,
      draft.category,
      scanResult,
      parentById,
      peerIds.map((id) => cardsById.get(id)).filter((c): c is InsightCardModel => c !== undefined),
    );
    cardsById.set(draft.candidate.id, rebuilt);
  }

  const insights = [...cardsById.values()].sort(compareInsightCards);

  const locationIds = [...new Set(insights.map((insight) => insight.locationId))];
  locationIds.sort((left, right) => compareLocationIds(left, right, scanResult.root));

  const locations: InsightLocationGroup[] = locationIds.map((locationId) => {
    const kind: InsightLocationKind = locationId === rootId ? "root" : "folder";
    const segments = buildDisplayPathSegments(locationId, parentById, scanResult.root);
    const insightIds = insights
      .filter((insight) => insight.locationId === locationId)
      .map((insight) => insight.id);
    const group: InsightLocationGroup = {
      locationId,
      kind,
      displayPathSegments: segments,
      insightIds,
    };
    if (kind === "root") {
      group.rootContextLabel = ROOT_CONTEXT_LABEL;
    }
    return group;
  });

  const countsByEvidence: InsightEvidenceCounts = {
    high: 0,
    medium: 0,
    low: 0,
    unassessed: 0,
    total: insights.length,
  };
  const countsByCategory: InsightCategoryCounts = {
    "file-names": 0,
    "folder-structure": 0,
    "time-years": 0,
    "file-distribution": 0,
  };
  let globallyIncomplete = false;
  for (const insight of insights) {
    countsByEvidence[insight.evidenceLevel] += 1;
    countsByCategory[insight.category] += 1;
    if (insight.incompleteData) {
      globallyIncomplete = true;
    }
  }

  return {
    schemaVersion: STRUCTURE_INSIGHT_VIEW_MODEL_SCHEMA_VERSION,
    locations,
    insights,
    countsByEvidence,
    countsByCategory,
    globallyIncomplete,
  };
}

export function structureInsightViewModelJsonRoundTrip(
  model: StructureInsightViewModel,
): StructureInsightViewModel {
  return JSON.parse(JSON.stringify(model)) as StructureInsightViewModel;
}

export function structureInsightViewModelRoundTripEquals(model: StructureInsightViewModel): boolean {
  return JSON.stringify(structureInsightViewModelJsonRoundTrip(model)) === JSON.stringify(model);
}

/** True when a visible user-facing string contains a forbidden normative/technical token. */
export function visibleTextHasForbiddenClaim(text: string): boolean {
  const lower = text.toLowerCase();
  for (const token of FORBIDDEN_VISIBLE_TOKENS) {
    if (lower.includes(token)) {
      return true;
    }
  }
  if (/\b\d+\s*%/.test(text) || /\bscore\b/i.test(text) || /\bwahrscheinlichkeit\b/i.test(text)) {
    return true;
  }
  return false;
}

export function structureInsightViewModelHasForbiddenVisibleClaims(
  model: StructureInsightViewModel,
): boolean {
  for (const insight of model.insights) {
    const parts = [
      insight.title,
      insight.factLine,
      insight.evidenceLabel,
      insight.categoryLabel,
      ...insight.explanationBullets,
      insight.structureSummary.plainDescription,
      ...insight.structureSummary.examples,
      ...(insight.structureSummary.structuralParts ?? []),
      ...insight.secondaryRecurringGroups.map((group) => group.label),
    ];
    for (const part of parts) {
      if (visibleTextHasForbiddenClaim(part)) {
        return true;
      }
    }
  }
  for (const location of model.locations) {
    if (location.rootContextLabel !== undefined && visibleTextHasForbiddenClaim(location.rootContextLabel)) {
      return true;
    }
  }
  return false;
}

function buildCard(
  candidate: StructureInsightRuleCandidate,
  locationId: string,
  category: InsightUserCategoryKey,
  scanResult: ScanResult,
  parentById: ReadonlyMap<string, string | null>,
  peerCards: readonly InsightCardModel[],
): InsightCardModel {
  const matched = candidate.support.matchedCount;
  const evaluable = resolveEvaluable(candidate);
  const evidenceLevel = normalizeEvidenceLevel(candidate.confidence.level);
  const incompleteData = isIncompleteListing(candidate);
  const primaryElements = buildPrimaryElements(candidate, scanResult);
  const { secondaryRecurringGroups, otherElements } = buildSecondaryAndOther(
    candidate,
    scanResult,
    primaryElements,
    peerCards,
  );
  const structureSummary = buildStructureSummary(candidate, primaryElements, scanResult);
  const title = titleForPrinciple(candidate.principle);
  const factLine = factLineForPrinciple(candidate.principle, matched, evaluable);
  const explanationBullets = buildExplanationBullets(
    candidate,
    matched,
    evaluable,
    incompleteData,
    secondaryRecurringGroups,
    otherElements,
  );
  const searchText = buildSearchText({
    locationId,
    root: scanResult.root,
    parentById,
    title,
    factLine,
    structureSummary,
    primaryElements,
    secondaryRecurringGroups,
    otherElements,
    categoryLabel: CATEGORY_LABELS[category],
    evidenceLabel: EVIDENCE_LABELS[evidenceLevel],
  });

  return {
    id: candidate.id,
    locationId,
    principle: candidate.principle,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    title,
    factLine,
    evidenceLevel,
    evidenceLabel: EVIDENCE_LABELS[evidenceLevel],
    incompleteData,
    explanationBullets,
    structureSummary,
    primaryElements,
    secondaryRecurringGroups,
    otherElements,
    searchText,
  };
}

function normalizeEvidenceLevel(level: string): InsightEvidenceLevel {
  if (level === "high" || level === "medium" || level === "low" || level === "unassessed") {
    return level;
  }
  return "unassessed";
}

function resolveEvaluable(candidate: StructureInsightRuleCandidate): number {
  const raw = candidate.candidateFeatures?.evaluableCount;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return raw;
  }
  return candidate.support.matchedCount;
}

function isIncompleteListing(candidate: StructureInsightRuleCandidate): boolean {
  const listing = candidate.candidateFeatures?.listingCompleteness;
  return listing === "partial" || listing === "unknown";
}

function titleForPrinciple(principle: string): string {
  switch (principle) {
    case PRINCIPLE_RECURRING_FILE_NAME_FORM:
      return "Wiederkehrende Dateinamensstruktur erkannt";
    case PRINCIPLE_RECURRING_YEAR:
      return "Wiederkehrende Jahresstruktur erkannt";
    case PRINCIPLE_RECURRING_CHILD_FOLDER_NAME:
      return "Wiederkehrende Ordnernamensstruktur erkannt";
    case PRINCIPLE_RECURRING_CHILD_FOLDER_SET:
      return "Wiederkehrende Ordner-Zusammenstellung erkannt";
    case PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET:
      return "Ähnliche Dateiaufteilung erkannt";
    case PRINCIPLE_PARALLEL_FILE_NAME_FORM_SET:
      return "Ähnliche Dateinamensstrukturen erkannt";
    default:
      return "Strukturelles Muster erkannt";
  }
}

function factLineForPrinciple(principle: string, matched: number, evaluable: number): string {
  switch (principle) {
    case PRINCIPLE_RECURRING_FILE_NAME_FORM:
      return `${matched} von ${evaluable} Dateien folgen derselben Namensstruktur.`;
    case PRINCIPLE_RECURRING_YEAR:
      return `${matched} von ${evaluable} vergleichbaren Ordnern folgen derselben zeitlichen Gliederung.`;
    case PRINCIPLE_RECURRING_CHILD_FOLDER_NAME:
      return `${matched} von ${evaluable} vergleichbaren Ordnern enthalten denselben wiederkehrenden Unterordnernamen.`;
    case PRINCIPLE_RECURRING_CHILD_FOLDER_SET:
      return `${matched} von ${evaluable} vergleichbaren Ordnern folgen derselben Unterordner-Zusammenstellung.`;
    case PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET:
      return `${matched} von ${evaluable} vergleichbaren Bereichen verwenden dieselbe Aufteilung nach Dateitypen.`;
    case PRINCIPLE_PARALLEL_FILE_NAME_FORM_SET:
      return `${matched} von ${evaluable} vergleichbaren Bereichen verwenden dieselbe Menge an Namensstrukturen.`;
    default:
      return `${matched} von ${evaluable} Einträgen folgen demselben Muster.`;
  }
}

function buildExplanationBullets(
  candidate: StructureInsightRuleCandidate,
  matched: number,
  evaluable: number,
  incompleteData: boolean,
  secondary: readonly InsightSecondaryRecurringGroup[],
  other: readonly InsightElementRef[],
): string[] {
  const bullets: string[] = [];
  bullets.push(factLineForPrinciple(candidate.principle, matched, evaluable));

  const otherCount = other.length;
  const secondaryCount = secondary.reduce((sum, group) => sum + group.elements.length, 0);
  if (otherCount > 0 && secondaryCount === 0) {
    if (candidate.principle === PRINCIPLE_RECURRING_FILE_NAME_FORM) {
      bullets.push(
        otherCount === 1
          ? "1 Datei verwendet eine andere erkannte Struktur."
          : `${otherCount} Dateien verwenden andere erkannte Strukturen.`,
      );
    } else {
      bullets.push(
        otherCount === 1
          ? "1 vergleichbarer Bereich folgt einer anderen Struktur."
          : `${otherCount} vergleichbare Bereiche folgen anderen Strukturen.`,
      );
    }
  }
  if (secondary.length > 0) {
    bullets.push(
      secondary.length === 1
        ? "Neben der häufigsten Struktur wurde eine weitere wiederkehrende Struktur erkannt."
        : `Neben der häufigsten Struktur wurden ${secondary.length} weitere wiederkehrende Strukturen erkannt.`,
    );
  }

  const maxRival = candidate.candidateFeatures?.maxRivalMatchedCount;
  if (
    typeof maxRival === "number" &&
    maxRival === 0 &&
    secondary.length === 0 &&
    (candidate.principle === PRINCIPLE_RECURRING_FILE_NAME_FORM ||
      candidate.principle === PRINCIPLE_RECURRING_YEAR ||
      candidate.principle === PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET ||
      candidate.principle === PRINCIPLE_PARALLEL_FILE_NAME_FORM_SET ||
      candidate.principle === PRINCIPLE_RECURRING_CHILD_FOLDER_SET)
  ) {
    if (candidate.principle === PRINCIPLE_RECURRING_FILE_NAME_FORM) {
      bullets.push("Es wurde keine weitere wiederkehrende Namensstruktur erkannt.");
    }
  }

  if (incompleteData) {
    bullets.push("Nicht alle relevanten Einträge konnten ausgewertet werden.");
  } else {
    if (candidate.principle === PRINCIPLE_RECURRING_FILE_NAME_FORM) {
      bullets.push("Alle relevanten Dateien konnten ausgewertet werden.");
    } else {
      bullets.push("Alle relevanten Einträge konnten ausgewertet werden.");
    }
  }

  return bullets;
}

function buildPrimaryElements(
  candidate: StructureInsightRuleCandidate,
  scanResult: ScanResult,
): InsightElementRef[] {
  return dedupeAndSortElements(
    candidate.supportingEvidence.map((item) =>
      evidenceToElement(item, "primary", scanResult, candidate.principle),
    ),
  );
}

function buildSecondaryAndOther(
  candidate: StructureInsightRuleCandidate,
  scanResult: ScanResult,
  primaryElements: readonly InsightElementRef[],
  peerCards: readonly InsightCardModel[],
): {
  secondaryRecurringGroups: InsightSecondaryRecurringGroup[];
  otherElements: InsightElementRef[];
} {
  const primaryIds = new Set(primaryElements.map((element) => element.nodeId));

  if (candidate.principle === PRINCIPLE_RECURRING_FILE_NAME_FORM) {
    return groupFileNameCounterEvidence(candidate, scanResult, primaryIds);
  }

  if (
    candidate.principle === PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET ||
    candidate.principle === PRINCIPLE_PARALLEL_FILE_NAME_FORM_SET
  ) {
    return buildParallelSecondaryAndOther(candidate, scanResult, primaryIds, peerCards);
  }

  if (candidate.principle === PRINCIPLE_RECURRING_CHILD_FOLDER_SET) {
    return groupSetCounterEvidence(candidate, scanResult, primaryIds);
  }

  // Year, child-folder-name: counter as other only; no invented secondary recurring
  const otherElements = dedupeAndSortElements(
    candidate.counterEvidence
      .map((item) => evidenceToElement(item, "other", scanResult, candidate.principle))
      .filter((element) => !primaryIds.has(element.nodeId)),
  );
  return { secondaryRecurringGroups: [], otherElements };
}

function groupFileNameCounterEvidence(
  candidate: StructureInsightRuleCandidate,
  scanResult: ScanResult,
  primaryIds: ReadonlySet<string>,
): {
  secondaryRecurringGroups: InsightSecondaryRecurringGroup[];
  otherElements: InsightElementRef[];
} {
  const byForm = new Map<string, StructureInsightEvidenceItem[]>();
  const withoutForm: StructureInsightEvidenceItem[] = [];
  for (const item of candidate.counterEvidence) {
    if (primaryIds.has(item.element.nodeId)) {
      continue;
    }
    const form =
      typeof item.attributes?.formSignature === "string" ? item.attributes.formSignature : null;
    if (form === null || form.length === 0) {
      withoutForm.push(item);
      continue;
    }
    const list = byForm.get(form);
    if (list === undefined) {
      byForm.set(form, [item]);
    } else {
      list.push(item);
    }
  }

  const secondaryRecurringGroups: InsightSecondaryRecurringGroup[] = [];
  const otherItems: StructureInsightEvidenceItem[] = [...withoutForm];
  const formKeys = [...byForm.keys()].sort(compareRuleCandidateText);
  for (const form of formKeys) {
    const items = byForm.get(form) ?? [];
    if (items.length >= 2) {
      secondaryRecurringGroups.push({
        groupKey: form,
        label: "Weitere Struktur erkannt",
        elements: dedupeAndSortElements(
          items.map((item) => evidenceToElement(item, "secondaryRecurring", scanResult, candidate.principle)),
        ),
      });
    } else {
      otherItems.push(...items);
    }
  }

  return {
    secondaryRecurringGroups,
    otherElements: dedupeAndSortElements(
      otherItems.map((item) => evidenceToElement(item, "other", scanResult, candidate.principle)),
    ),
  };
}

function groupSetCounterEvidence(
  candidate: StructureInsightRuleCandidate,
  scanResult: ScanResult,
  primaryIds: ReadonlySet<string>,
): {
  secondaryRecurringGroups: InsightSecondaryRecurringGroup[];
  otherElements: InsightElementRef[];
} {
  const bySig = new Map<string, StructureInsightEvidenceItem[]>();
  const withoutSig: StructureInsightEvidenceItem[] = [];
  for (const item of candidate.counterEvidence) {
    if (primaryIds.has(item.element.nodeId)) {
      continue;
    }
    const signature = typeof item.attributes?.signature === "string" ? item.attributes.signature : null;
    if (signature === null || signature.length === 0 || signature === "[]") {
      withoutSig.push(item);
      continue;
    }
    const list = bySig.get(signature);
    if (list === undefined) {
      bySig.set(signature, [item]);
    } else {
      list.push(item);
    }
  }

  const secondaryRecurringGroups: InsightSecondaryRecurringGroup[] = [];
  const otherItems: StructureInsightEvidenceItem[] = [...withoutSig];
  const keys = [...bySig.keys()].sort(compareRuleCandidateText);
  for (const signature of keys) {
    const items = bySig.get(signature) ?? [];
    if (items.length >= 2) {
      const names = signature
        .split("\n")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      secondaryRecurringGroups.push({
        groupKey: signature,
        label: "Weitere Struktur erkannt",
        elements: dedupeAndSortElements(
          items.map((item) => evidenceToElement(item, "secondaryRecurring", scanResult, candidate.principle)),
        ),
      });
      void names;
    } else {
      otherItems.push(...items);
    }
  }

  return {
    secondaryRecurringGroups,
    otherElements: dedupeAndSortElements(
      otherItems.map((item) => evidenceToElement(item, "other", scanResult, candidate.principle)),
    ),
  };
}

function buildParallelSecondaryAndOther(
  candidate: StructureInsightRuleCandidate,
  scanResult: ScanResult,
  primaryIds: ReadonlySet<string>,
  peerCards: readonly InsightCardModel[],
): {
  secondaryRecurringGroups: InsightSecondaryRecurringGroup[];
  otherElements: InsightElementRef[];
} {
  const secondaryRecurringGroups: InsightSecondaryRecurringGroup[] = [];
  const covered = new Set<string>(primaryIds);

  for (const peer of [...peerCards].sort((left, right) => compareRuleCandidateText(left.id, right.id))) {
    const elements = peer.primaryElements
      .filter((element) => !covered.has(element.nodeId))
      .map((element) => ({ ...element, role: "secondaryRecurring" as const }));
    if (elements.length === 0) {
      continue;
    }
    for (const element of elements) {
      covered.add(element.nodeId);
    }
    secondaryRecurringGroups.push({
      groupKey: peer.id,
      label: "Weitere Struktur erkannt",
      elements: dedupeAndSortElements(elements),
    });
  }

  const otherElements: InsightElementRef[] = [];
  if (candidate.scope.kind === "comparisonSet") {
    for (const nodeId of candidate.scope.nodeIds) {
      if (covered.has(nodeId)) {
        continue;
      }
      const node = findNodeById(scanResult.root, nodeId);
      if (node === undefined) {
        continue;
      }
      otherElements.push({
        nodeId,
        displayName: node.name,
        relativePath: displayInventoryPath(scanResult.root.path, node.path),
        role: "other",
      });
      covered.add(nodeId);
    }
  }

  return {
    secondaryRecurringGroups,
    otherElements: dedupeAndSortElements(otherElements),
  };
}

function evidenceToElement(
  item: StructureInsightEvidenceItem,
  role: InsightElementRole,
  scanResult: ScanResult,
  _principle: string,
): InsightElementRef {
  const nodeId = item.element.nodeId;
  const node = findNodeById(scanResult.root, nodeId);
  const displayName = item.element.name ?? node?.name ?? nodeId;
  const relativePath =
    item.element.relativePath ??
    (node !== undefined ? displayInventoryPath(scanResult.root.path, node.path) : undefined);

  return {
    nodeId,
    displayName,
    relativePath,
    role,
  };
}

function dedupeAndSortElements(elements: readonly InsightElementRef[]): InsightElementRef[] {
  const byId = new Map<string, InsightElementRef>();
  for (const element of elements) {
    if (!byId.has(element.nodeId)) {
      byId.set(element.nodeId, element);
    }
  }
  return [...byId.values()].sort((left, right) => {
    const byName = compareRuleCandidateText(left.displayName, right.displayName);
    if (byName !== 0) {
      return byName;
    }
    return compareRuleCandidateText(left.nodeId, right.nodeId);
  });
}

function buildStructureSummary(
  candidate: StructureInsightRuleCandidate,
  primaryElements: readonly InsightElementRef[],
  _scanResult: ScanResult,
): InsightStructureSummary {
  const examples = primaryElements
    .slice()
    .sort((left, right) => compareRuleCandidateText(left.displayName, right.displayName))
    .map((element) => element.displayName);

  switch (candidate.principle) {
    case PRINCIPLE_RECURRING_FILE_NAME_FORM: {
      const form = firstFormSignature(candidate);
      const structuralParts = form !== null ? describeFormSignatureStructurally(form) : [];
      const extensions = collectExtensions(candidate);
      const plain =
        structuralParts.length > 0
          ? `Wiederkehrende Namensstruktur aus ${structuralParts.join(", ")}.`
          : "Wiederkehrende Dateinamensstruktur erkannt.";
      const withExt =
        extensions.length > 0 ? `${plain} Dateiendungen: ${extensions.join(", ")}.` : plain;
      return {
        plainDescription: withExt,
        examples: examples.slice(0, 8),
        structuralParts: structuralParts.length > 0 ? structuralParts : undefined,
      };
    }
    case PRINCIPLE_RECURRING_YEAR:
      return {
        plainDescription: "Vergleichbare Ordner sind wiederkehrend als Jahresordner organisiert.",
        examples: examples.slice(0, 8),
      };
    case PRINCIPLE_RECURRING_CHILD_FOLDER_NAME: {
      const nameKey =
        typeof candidate.candidateFeatures?.sourcePatternKey === "string"
          ? candidate.candidateFeatures.sourcePatternKey
          : examples[0] ?? "";
      return {
        plainDescription:
          nameKey.length > 0
            ? `Wiederkehrender Unterordnername „${nameKey}“.`
            : "Wiederkehrender Unterordnername erkannt.",
        examples: examples.slice(0, 8),
      };
    }
    case PRINCIPLE_RECURRING_CHILD_FOLDER_SET: {
      const signature =
        typeof candidate.candidateFeatures?.signature === "string"
          ? candidate.candidateFeatures.signature
          : "";
      const names = signature
        .split("\n")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      return {
        plainDescription:
          names.length > 0
            ? `Wiederkehrende Unterordner-Zusammenstellung: ${names.join(", ")}.`
            : "Wiederkehrende Unterordner-Zusammenstellung erkannt.",
        examples: examples.slice(0, 8),
      };
    }
    case PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET: {
      const extensions = parseBucketSignature(candidate);
      return {
        plainDescription:
          extensions.length > 0
            ? `Gleiche Aufteilung nach Dateitypen: ${extensions.join(", ")}.`
            : "Gleiche Aufteilung nach Dateitypen in vergleichbaren Bereichen.",
        examples: examples.slice(0, 8),
      };
    }
    case PRINCIPLE_PARALLEL_FILE_NAME_FORM_SET:
      return {
        plainDescription:
          "Vergleichbare Bereiche verwenden dieselbe Menge wiederkehrender Dateinamensstrukturen.",
        examples: examples.slice(0, 8),
      };
    default:
      return {
        plainDescription: "Strukturelles Muster erkannt.",
        examples: examples.slice(0, 8),
      };
  }
}

function firstFormSignature(candidate: StructureInsightRuleCandidate): string | null {
  for (const item of candidate.supportingEvidence) {
    const form = item.attributes?.formSignature;
    if (typeof form === "string" && form.length > 0) {
      return form;
    }
  }
  return null;
}

function collectExtensions(candidate: StructureInsightRuleCandidate): string[] {
  const set = new Set<string>();
  for (const item of candidate.supportingEvidence) {
    const ext = item.attributes?.extensionKey;
    if (typeof ext === "string" && ext.length > 0) {
      set.add(ext.startsWith(".") ? ext : `.${ext}`);
    }
  }
  return [...set].sort(compareRuleCandidateText);
}

/**
 * Structural-only description of a P2-E formSignature.
 * Never invents semantic roles (date, invoice number, vendor, …).
 */
export function describeFormSignatureStructurally(formSignature: string): string[] {
  const parts: string[] = [];
  const tokens = formSignature.split("|");
  for (const token of tokens) {
    if (token.startsWith("digits:")) {
      const length = token.slice("digits:".length);
      parts.push(length.length > 0 ? `Ziffernfolge (${length} Stellen)` : "Ziffernfolge");
    } else if (token.startsWith('sep:')) {
      const raw = token.slice(4);
      let sep = raw;
      if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
        sep = raw.slice(1, -1);
      }
      parts.push(sep.length > 0 ? `Trennzeichen „${sep}“` : "Trennzeichen");
    } else if (token === "text") {
      parts.push("Textbestandteil");
    } else if (token === "whitespace") {
      parts.push("Leerzeichen");
    }
  }
  return parts;
}

function parseBucketSignature(candidate: StructureInsightRuleCandidate): string[] {
  const raw =
    typeof candidate.candidateFeatures?.signature === "string"
      ? candidate.candidateFeatures.signature
      : typeof candidate.supportingEvidence[0]?.attributes?.signature === "string"
        ? candidate.supportingEvidence[0].attributes.signature
        : null;
  if (raw === null) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => (item === null ? "(ohne Endung)" : String(item)))
      .sort(compareRuleCandidateText);
  } catch {
    return [];
  }
}

function buildSearchText(input: {
  locationId: string;
  root: DirectoryNode;
  parentById: ReadonlyMap<string, string | null>;
  title: string;
  factLine: string;
  structureSummary: InsightStructureSummary;
  primaryElements: readonly InsightElementRef[];
  secondaryRecurringGroups: readonly InsightSecondaryRecurringGroup[];
  otherElements: readonly InsightElementRef[];
  categoryLabel: string;
  evidenceLabel: string;
}): string {
  const segments = buildDisplayPathSegments(input.locationId, input.parentById, input.root);
  const pathText = segments.map((segment) => segment.displayName).join(" ");
  const parts: string[] = [
    pathText,
    input.title,
    input.factLine,
    input.structureSummary.plainDescription,
    ...input.structureSummary.examples,
    ...(input.structureSummary.structuralParts ?? []),
    input.categoryLabel,
    input.evidenceLabel,
  ];
  for (const element of input.primaryElements) {
    parts.push(element.displayName);
    if (element.relativePath !== undefined) {
      parts.push(element.relativePath);
    }
  }
  for (const group of input.secondaryRecurringGroups) {
    parts.push(group.label);
    for (const element of group.elements) {
      parts.push(element.displayName);
      if (element.relativePath !== undefined) {
        parts.push(element.relativePath);
      }
    }
  }
  for (const element of input.otherElements) {
    parts.push(element.displayName);
    if (element.relativePath !== undefined) {
      parts.push(element.relativePath);
    }
  }
  return normalizeSearchText(parts.join("\n"));
}

function normalizeSearchText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function resolveLocationId(
  candidate: StructureInsightRuleCandidate,
  parentById: ReadonlyMap<string, string | null>,
  rootId: string,
): string | null {
  if (candidate.principle === PRINCIPLE_RECURRING_FILE_NAME_FORM) {
    return resolveFileNameLocation(candidate, parentById, rootId);
  }
  return resolvePeerLocation(candidate, parentById, rootId);
}

function resolveFileNameLocation(
  candidate: StructureInsightRuleCandidate,
  parentById: ReadonlyMap<string, string | null>,
  rootId: string,
): string | null {
  const parents = new Set<string>();
  for (const item of [...candidate.supportingEvidence, ...candidate.counterEvidence]) {
    const parent = parentById.get(item.element.nodeId);
    if (parent === undefined) {
      return null;
    }
    if (parent === null) {
      parents.add(rootId);
    } else {
      parents.add(parent);
    }
  }
  if (parents.size !== 1) {
    // Also try scope file ids
    if (candidate.scope.kind === "comparisonSet" && candidate.scope.nodeIds.length > 0) {
      const scopeParents = new Set<string>();
      for (const nodeId of candidate.scope.nodeIds) {
        const parent = parentById.get(nodeId);
        if (parent === undefined) {
          return null;
        }
        scopeParents.add(parent === null ? rootId : parent);
      }
      if (scopeParents.size === 1) {
        return [...scopeParents][0]!;
      }
    }
    return null;
  }
  return [...parents][0]!;
}

function resolvePeerLocation(
  candidate: StructureInsightRuleCandidate,
  parentById: ReadonlyMap<string, string | null>,
  rootId: string,
): string | null {
  const peerIds: string[] = [];
  for (const item of candidate.supportingEvidence) {
    peerIds.push(item.element.nodeId);
  }
  if (peerIds.length === 0 && candidate.scope.kind === "comparisonSet") {
    peerIds.push(...candidate.scope.nodeIds);
  }
  if (peerIds.length === 0) {
    return null;
  }
  const parents = new Set<string>();
  for (const nodeId of peerIds) {
    const parent = parentById.get(nodeId);
    if (parent === undefined) {
      return null;
    }
    parents.add(parent === null ? rootId : parent);
  }
  if (parents.size !== 1) {
    return null;
  }
  return [...parents][0]!;
}

function buildParentIndex(root: DirectoryNode): Map<string, string | null> {
  const map = new Map<string, string | null>();
  map.set(root.id, null);
  function visit(node: DirectoryNode): void {
    for (const child of node.children) {
      map.set(child.id, node.id);
      if (isDirectory(child)) {
        visit(child);
      }
    }
  }
  visit(root);
  return map;
}

function buildDisplayPathSegments(
  locationId: string,
  parentById: ReadonlyMap<string, string | null>,
  root: DirectoryNode,
): InsightPathSegment[] {
  const chain: string[] = [];
  let current: string | null | undefined = locationId;
  const guard = new Set<string>();
  while (typeof current === "string" && current.length > 0 && !guard.has(current)) {
    guard.add(current);
    chain.push(current);
    const parent = parentById.get(current);
    if (parent === undefined || parent === null) {
      break;
    }
    current = parent;
  }
  chain.reverse();
  // Ensure root is first
  if (chain[0] !== root.id) {
    chain.unshift(root.id);
  }
  const segments: InsightPathSegment[] = [];
  for (const nodeId of chain) {
    const node = findNodeById(root, nodeId);
    segments.push({
      nodeId,
      displayName: node?.name ?? nodeId,
    });
  }
  return segments;
}

function compareInsightCards(left: InsightCardModel, right: InsightCardModel): number {
  const byLocation = compareRuleCandidateText(left.locationId, right.locationId);
  if (byLocation !== 0) {
    // Final location order is applied when grouping; within mixed list still stable
    // Evidence order is primary within same location — compare location first for full list stability
  }
  void byLocation;
  const byLoc = compareRuleCandidateText(left.locationId, right.locationId);
  if (byLoc !== 0) {
    return byLoc;
  }
  const byEvidence = EVIDENCE_SORT_RANK[left.evidenceLevel] - EVIDENCE_SORT_RANK[right.evidenceLevel];
  if (byEvidence !== 0) {
    return byEvidence;
  }
  const leftPrinciple = PRINCIPLE_SORT_RANK[left.principle] ?? 100;
  const rightPrinciple = PRINCIPLE_SORT_RANK[right.principle] ?? 100;
  if (leftPrinciple !== rightPrinciple) {
    return leftPrinciple - rightPrinciple;
  }
  const byPrinciple = compareRuleCandidateText(left.principle, right.principle);
  if (byPrinciple !== 0) {
    return byPrinciple;
  }
  return compareRuleCandidateText(left.id, right.id);
}

function compareLocationIds(left: string, right: string, root: DirectoryNode): number {
  const leftNode = findNodeById(root, left);
  const rightNode = findNodeById(root, right);
  const leftPath = leftNode !== undefined ? displayInventoryPath(root.path, leftNode.path) : left;
  const rightPath = rightNode !== undefined ? displayInventoryPath(root.path, rightNode.path) : right;
  const byPath = compareRuleCandidateText(leftPath, rightPath);
  if (byPath !== 0) {
    return byPath;
  }
  return compareRuleCandidateText(left, right);
}
