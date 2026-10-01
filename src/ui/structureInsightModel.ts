/**
 * P2-A – Structure insight / recognition model (foundation only).
 *
 * Observation ≠ judgment. Deviation ≠ confirmed exception. Deviation ≠ missing element.
 * Competing rule candidates may coexist. Empty suggestions are valid.
 * No detectors, no UI, no persistence, no filesystem actions.
 *
 * Element references use ScanResult node ids. Those ids are stable within one scan
 * snapshot only — not across rescans or machines.
 */

/** Schema version of this pure insight result shape. */
export const STRUCTURE_INSIGHT_SCHEMA_VERSION = 1 as const;

/** Scan-local node identity from FsNode.id / InventoryNodeRef.id. */
export interface StructureInsightNodeRef {
  /** ScanResult node id — join key within one scan only. */
  nodeId: string;
  /** Optional display aids; never used as a join key for truth. */
  name?: string;
  /** Optional relative/display path; never used as a join key for truth. */
  relativePath?: string;
}

export type StructureInsightScope =
  | { kind: "scanRoot" }
  | { kind: "node"; nodeId: string }
  | { kind: "comparisonSet"; nodeIds: string[] }
  | { kind: "labeled"; label: string };

export interface StructureInsightProvenance {
  /** Stable detector id, e.g. "year-folder-detector" (not implemented in P2-A). */
  detectorId: string;
  detectorVersion: number;
}

export interface StructureInsightEvidenceItem {
  element: StructureInsightNodeRef;
  /** Machine role, e.g. "supports" | "counter" | "peer". */
  role?: string;
  attributes?: StructureInsightAttrMap;
}

/** JSON-safe attribute bag for machine-readable features. */
export type StructureInsightAttrMap = {
  [key: string]: string | number | boolean | null;
};

/**
 * Observation categories — extensible without redesigning the core model.
 * year-folder is only one possible later detector, not a privileged core type.
 */
export type StructureInsightObservationCategory =
  | "folderStructure"
  | "fileNamePattern"
  | "contentHash"
  | "documentClass"
  | "other";

/**
 * Factual observation only. No good/bad/orderly ratings.
 * Truth lives in counts + features + evidence, not in displayHint.
 */
export interface StructureInsightObservation {
  id: string;
  category: StructureInsightObservationCategory;
  /** Machine type, e.g. "year-folders-among-peers", "date-like-file-names". */
  observationType: string;
  scope: StructureInsightScope;
  comparisonGroup: StructureInsightNodeRef[];
  supportingEvidence: StructureInsightEvidenceItem[];
  /** Analytical deviations / counter-examples — not confirmed exceptions. */
  counterEvidence: StructureInsightEvidenceItem[];
  matchedCount: number;
  totalCount: number;
  provenance: StructureInsightProvenance;
  /** Machine-readable pattern features (pattern keys, flags, etc.). */
  patternFeatures: StructureInsightAttrMap;
  /**
   * Optional later UI prose. Must not be the sole carrier of truth.
   * Must not claim "missing elements" unless patternFeatures explicitly supports that claim.
   */
  displayHint?: string;
}

export type StructureInsightConfidenceLevel = "unassessed" | "low" | "medium" | "high";

/** Structured factor explaining a confidence level — not a bare percentage. */
export interface StructureInsightConfidenceFactor {
  id: string;
  value?: number;
  detail?: string;
  /**
   * Optional polarity for assessed factors (P2-I).
   * Absent on legacy samples; P2-I always sets it explicitly.
   */
  kind?: "supporting" | "limiting";
}

export interface StructureInsightConfidence {
  level: StructureInsightConfidenceLevel;
  factors: StructureInsightConfidenceFactor[];
}

export type StructureInsightRuleStatus =
  | "detected"
  | "confirmed"
  | "rejected"
  | "reviewLater";

/**
 * Interprets one or more observations. Competing candidates for the same scope are allowed.
 * Status values are stable internals; German UI labels come later.
 *
 * confidence.level "unassessed" means P2-I has not evaluated this candidate yet.
 * "low" | "medium" | "high" are reserved for assessed confidence (P2-I).
 * candidateFeatures hold descriptive formation facts only — not confidence scoring.
 */
export interface StructureInsightRuleCandidate {
  id: string;
  category: string;
  /** Machine-readable principle, e.g. "year-based-filing-within-peers". */
  principle: string;
  label?: string;
  scope: StructureInsightScope;
  observationIds: string[];
  supportingEvidence: StructureInsightEvidenceItem[];
  counterEvidence: StructureInsightEvidenceItem[];
  support: {
    matchedCount: number;
    totalCount: number;
  };
  confidence: StructureInsightConfidence;
  status: StructureInsightRuleStatus;
  /** Optional descriptive candidate-formation facts (not confidence, not SOLL). */
  candidateFeatures?: StructureInsightAttrMap;
}

export type StructureInsightSuggestionStatus =
  | "proposed"
  | "accepted"
  | "dismissed"
  | "reviewLater";

/**
 * User-facing hint derived from a rule candidate.
 * Never encodes filesystem mutations (no move/rename/delete/create/…).
 */
export interface StructureInsightSuggestion {
  id: string;
  ruleCandidateId: string;
  affectedElements: StructureInsightNodeRef[];
  /** Machine suggestion type, e.g. "review-structure-alignment". */
  suggestionType: string;
  rationale: StructureInsightAttrMap;
  confidence: StructureInsightConfidence;
  status: StructureInsightSuggestionStatus;
  displayHint?: string;
}

/**
 * User-confirmed exception to a rule — distinct from analytical counterEvidence.
 * P2-A models the shape only; no confirmation UI or persistence yet.
 */
export interface StructureInsightConfirmedException {
  id: string;
  ruleCandidateId: string;
  element: StructureInsightNodeRef;
  /** Always true when present; exceptions are never inferred from analysis alone. */
  confirmed: true;
  note?: string;
  attributes?: StructureInsightAttrMap;
}

/**
 * Aggregate P2 result for one analysis pass.
 * Any of the arrays may be empty — that is a valid outcome.
 */
export interface StructureInsightResult {
  schemaVersion: typeof STRUCTURE_INSIGHT_SCHEMA_VERSION;
  observations: StructureInsightObservation[];
  ruleCandidates: StructureInsightRuleCandidate[];
  suggestions: StructureInsightSuggestion[];
  confirmedExceptions: StructureInsightConfirmedException[];
}

export function createEmptyStructureInsightResult(): StructureInsightResult {
  return {
    schemaVersion: STRUCTURE_INSIGHT_SCHEMA_VERSION,
    observations: [],
    ruleCandidates: [],
    suggestions: [],
    confirmedExceptions: [],
  };
}

export function nodeRef(
  nodeId: string,
  extras: Pick<StructureInsightNodeRef, "name" | "relativePath"> = {},
): StructureInsightNodeRef {
  return { nodeId, ...extras };
}

export function evidence(
  element: StructureInsightNodeRef,
  role?: string,
  attributes?: StructureInsightAttrMap,
): StructureInsightEvidenceItem {
  const item: StructureInsightEvidenceItem = { element };
  if (role !== undefined) {
    item.role = role;
  }
  if (attributes !== undefined) {
    item.attributes = attributes;
  }
  return item;
}

/**
 * True when an observation's features claim concrete missing child elements.
 * Default / absent flag means: deviation only — do not invent missing folders/files.
 */
export function observationClaimsMissingElements(
  observation: StructureInsightObservation,
): boolean {
  return observation.patternFeatures.claimsMissingElements === true;
}

/** JSON round-trip for serializability regression (functions / cycles must not appear). */
export function structureInsightJsonRoundTrip(
  result: StructureInsightResult,
): StructureInsightResult {
  return JSON.parse(JSON.stringify(result)) as StructureInsightResult;
}

/**
 * Guard: suggestion types must never look like filesystem mutation verbs.
 * P2-A stores hints only; later phases may add actions separately.
 */
const FORBIDDEN_SUGGESTION_ACTION_TOKENS = [
  "move",
  "rename",
  "delete",
  "createDirectory",
  "create-directory",
  "copy",
  "overwrite",
] as const;

export function suggestionTypeLooksLikeFilesystemAction(suggestionType: string): boolean {
  const normalized = suggestionType.trim().toLowerCase();
  return FORBIDDEN_SUGGESTION_ACTION_TOKENS.some(
    (token) => normalized === token || normalized.startsWith(`${token}:`) || normalized.startsWith(`${token}-`),
  );
}
