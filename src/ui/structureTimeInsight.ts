/**
 * P2-C – Year / time structure detection → StructureInsightObservation.
 *
 * Observes only. Does not decide which order is correct.
 * No RuleCandidates, Suggestions, confirmedExceptions, or filesystem actions.
 *
 * Identity is scan-local nodeId (same as P2-A / P2-B). Paths are display/sort only.
 * Year bounds are formal (1900–2199) and independent of the system calendar clock.
 *
 * Inventory report year helpers (1900–2100, group "missing years" wording) are NOT reused:
 * different bounds and different product semantics.
 */

import { isDirectory, type DirectoryNode, type ScanResult } from "../model";
import { displayInventoryPath } from "./inventoryOverview";
import {
  buildStructureComparisonContexts,
  type StructureComparisonContext,
  type StructureComparisonResult,
} from "./structureComparisonContext";
import {
  STRUCTURE_INSIGHT_SCHEMA_VERSION,
  createEmptyStructureInsightResult,
  evidence,
  nodeRef,
  observationClaimsMissingElements,
  structureInsightJsonRoundTrip,
  type StructureInsightAttrMap,
  type StructureInsightObservation,
  type StructureInsightResult,
} from "./structureInsightModel";

export const STRUCTURE_TIME_SCHEMA_VERSION = 1 as const;
export const STRUCTURE_TIME_DETECTOR_ID = "year-time-structure" as const;
export const STRUCTURE_TIME_DETECTOR_VERSION = 1 as const;

/** Formal year range for P2-C — not tied to the current calendar year. */
export const STRUCTURE_TIME_YEAR_MIN = 1900;
export const STRUCTURE_TIME_YEAR_MAX = 2199;

export type StructureTimeKind = "year" | "yearMonth" | "quarter" | "yearRange" | "month";

export type StructureTimeRecognitionMode = "direct" | "contextual";

export type StructureTimeValues =
  | { kind: "year"; year: number }
  | { kind: "yearMonth"; year: number; month: number }
  | { kind: "quarter"; year: number; quarter: number }
  | { kind: "yearRange"; startYear: number; endYear: number }
  | { kind: "month"; year: number; month: number };

export type StructureTimePatternId =
  | "exact-year"
  | "year-month-sep"
  | "month-year-sep"
  | "quarter-year"
  | "year-quarter"
  | "year-range"
  | "contextual-month-number"
  | "contextual-month-de";

export interface StructureTimeProvenance {
  detectorId: typeof STRUCTURE_TIME_DETECTOR_ID;
  detectorVersion: typeof STRUCTURE_TIME_DETECTOR_VERSION;
}

/**
 * Structured time feature for one folder node.
 * Truth lives in values + patternId + recognitionMode — not in prose.
 */
export interface StructureTimeFeature {
  nodeId: string;
  name: string;
  relativePath: string;
  recognitionMode: StructureTimeRecognitionMode;
  patternId: StructureTimePatternId;
  values: StructureTimeValues;
  provenance: StructureTimeProvenance;
}

export interface StructureTimeInsightResult {
  schemaVersion: typeof STRUCTURE_TIME_SCHEMA_VERSION;
  features: StructureTimeFeature[];
  insight: StructureInsightResult;
}

const TIME_PROVENANCE: StructureTimeProvenance = {
  detectorId: STRUCTURE_TIME_DETECTOR_ID,
  detectorVersion: STRUCTURE_TIME_DETECTOR_VERSION,
};

const GERMAN_MONTHS: ReadonlyMap<string, number> = new Map([
  ["januar", 1],
  ["februar", 2],
  ["märz", 3],
  ["marz", 3],
  ["april", 4],
  ["mai", 5],
  ["juni", 6],
  ["juli", 7],
  ["august", 8],
  ["september", 9],
  ["oktober", 10],
  ["november", 11],
  ["dezember", 12],
]);

const RE_YEAR_MONTH = /^(\d{4})([-_.])(\d{2})$/;
const RE_MONTH_YEAR = /^(\d{2})([-_.])(\d{4})$/;
const RE_QUARTER_YEAR = /^Q([1-4])([ \-_])(\d{4})$/i;
const RE_YEAR_QUARTER = /^(\d{4})([ \-_])Q([1-4])$/i;
const RE_YEAR_RANGE = /^(\d{4})-(\d{4})$/;
const RE_EXACT_YEAR = /^(\d{4})$/;
const RE_MONTH_NUMBER = /^(0[1-9]|1[0-2])$/;

export function isStructureTimeYear(year: number): boolean {
  return (
    Number.isInteger(year) && year >= STRUCTURE_TIME_YEAR_MIN && year <= STRUCTURE_TIME_YEAR_MAX
  );
}

/**
 * Direct name parse only — no contextual month/name recognition.
 * More specific patterns win over year-range and bare year.
 */
export function parseDirectStructureTimeName(
  name: string,
): { patternId: StructureTimePatternId; values: StructureTimeValues } | null {
  const yearMonth = name.match(RE_YEAR_MONTH);
  if (yearMonth) {
    const year = Number(yearMonth[1]);
    const month = Number(yearMonth[3]);
    if (isStructureTimeYear(year) && month >= 1 && month <= 12) {
      return { patternId: "year-month-sep", values: { kind: "yearMonth", year, month } };
    }
    return null;
  }

  const monthYear = name.match(RE_MONTH_YEAR);
  if (monthYear) {
    const month = Number(monthYear[1]);
    const year = Number(monthYear[3]);
    if (isStructureTimeYear(year) && month >= 1 && month <= 12) {
      return { patternId: "month-year-sep", values: { kind: "yearMonth", year, month } };
    }
    return null;
  }

  const quarterYear = name.match(RE_QUARTER_YEAR);
  if (quarterYear) {
    const quarter = Number(quarterYear[1]);
    const year = Number(quarterYear[3]);
    if (isStructureTimeYear(year) && quarter >= 1 && quarter <= 4) {
      return { patternId: "quarter-year", values: { kind: "quarter", year, quarter } };
    }
    return null;
  }

  const yearQuarter = name.match(RE_YEAR_QUARTER);
  if (yearQuarter) {
    const year = Number(yearQuarter[1]);
    const quarter = Number(yearQuarter[3]);
    if (isStructureTimeYear(year) && quarter >= 1 && quarter <= 4) {
      return { patternId: "year-quarter", values: { kind: "quarter", year, quarter } };
    }
    return null;
  }

  const yearRange = name.match(RE_YEAR_RANGE);
  if (yearRange) {
    const startYear = Number(yearRange[1]);
    const endYear = Number(yearRange[2]);
    if (isStructureTimeYear(startYear) && isStructureTimeYear(endYear)) {
      return { patternId: "year-range", values: { kind: "yearRange", startYear, endYear } };
    }
    return null;
  }

  const exactYear = name.match(RE_EXACT_YEAR);
  if (exactYear) {
    const year = Number(exactYear[1]);
    if (isStructureTimeYear(year)) {
      return { patternId: "exact-year", values: { kind: "year", year } };
    }
    return null;
  }

  return null;
}

/** Pure year folder name (exact four digits in P2-C range). */
export function parseExactStructureTimeYear(name: string): number | null {
  const parsed = parseDirectStructureTimeName(name);
  if (parsed === null || parsed.values.kind !== "year") {
    return null;
  }
  return parsed.values.year;
}

/**
 * Contextual month under a pure-year parent.
 * Numeric 01–12 or full German month names only (no abbreviations).
 */
export function parseContextualMonthName(
  name: string,
  parentYear: number,
): { patternId: StructureTimePatternId; values: StructureTimeValues } | null {
  if (!isStructureTimeYear(parentYear)) {
    return null;
  }
  if (RE_MONTH_NUMBER.test(name)) {
    const month = Number(name);
    return {
      patternId: "contextual-month-number",
      values: { kind: "month", year: parentYear, month },
    };
  }
  const month = GERMAN_MONTHS.get(name.toLocaleLowerCase("de-DE"));
  if (month !== undefined) {
    return {
      patternId: "contextual-month-de",
      values: { kind: "month", year: parentYear, month },
    };
  }
  return null;
}

export function createEmptyStructureTimeInsightResult(): StructureTimeInsightResult {
  return {
    schemaVersion: STRUCTURE_TIME_SCHEMA_VERSION,
    features: [],
    insight: createEmptyStructureInsightResult(),
  };
}

export function structureTimeInsightJsonRoundTrip(
  result: StructureTimeInsightResult,
): StructureTimeInsightResult {
  return JSON.parse(JSON.stringify(result)) as StructureTimeInsightResult;
}

/**
 * Detect time features and emit descriptive StructureInsightObservations.
 * Pure: does not mutate ScanResult or comparison contexts.
 */
export function buildStructureTimeInsight(
  result: ScanResult,
  comparison: StructureComparisonResult = buildStructureComparisonContexts(result),
): StructureTimeInsightResult {
  const rootPath = result.root.path;
  const features = detectTimeFeatures(result.root, rootPath);
  const featureByNodeId = new Map(features.map((feature) => [feature.nodeId, feature]));
  const observations: StructureInsightObservation[] = [];

  for (const context of comparison.contexts) {
    observations.push(...observationsForSiblingContext(context, featureByNodeId, result.root));
  }

  observations.sort((left, right) => compareText(left.id, right.id));

  const insight: StructureInsightResult = {
    schemaVersion: STRUCTURE_INSIGHT_SCHEMA_VERSION,
    observations,
    ruleCandidates: [],
    suggestions: [],
    confirmedExceptions: [],
  };

  return {
    schemaVersion: STRUCTURE_TIME_SCHEMA_VERSION,
    features,
    insight,
  };
}

function detectTimeFeatures(root: DirectoryNode, rootPath: string): StructureTimeFeature[] {
  const features: StructureTimeFeature[] = [];

  function visit(node: DirectoryNode, parent: DirectoryNode | null): void {
    const direct = parseDirectStructureTimeName(node.name);
    if (direct !== null) {
      features.push(featureFrom(node, rootPath, "direct", direct.patternId, direct.values));
    } else if (parent !== null) {
      const parentYear = parseExactStructureTimeYear(parent.name);
      if (parentYear !== null) {
        const contextual = parseContextualMonthName(node.name, parentYear);
        if (contextual !== null) {
          features.push(
            featureFrom(node, rootPath, "contextual", contextual.patternId, contextual.values),
          );
        }
      }
    }

    for (const child of node.children) {
      if (isDirectory(child)) {
        visit(child, node);
      }
    }
  }

  visit(root, null);
  features.sort((left, right) => {
    const byPath = compareText(left.relativePath, right.relativePath);
    if (byPath !== 0) {
      return byPath;
    }
    return compareText(left.nodeId, right.nodeId);
  });
  return features;
}

function featureFrom(
  node: DirectoryNode,
  rootPath: string,
  recognitionMode: StructureTimeRecognitionMode,
  patternId: StructureTimePatternId,
  values: StructureTimeValues,
): StructureTimeFeature {
  return {
    nodeId: node.id,
    name: node.name,
    relativePath: displayInventoryPath(rootPath, node.path),
    recognitionMode,
    patternId,
    values,
    provenance: TIME_PROVENANCE,
  };
}

function observationsForSiblingContext(
  context: StructureComparisonContext,
  featureByNodeId: ReadonlyMap<string, StructureTimeFeature>,
  root: DirectoryNode,
): StructureInsightObservation[] {
  const observations: StructureInsightObservation[] = [];
  const memberFeatures = context.members
    .map((member) => featureByNodeId.get(member.nodeId))
    .filter((feature): feature is StructureTimeFeature => feature !== undefined);

  const yearMembers = memberFeatures.filter((feature) => feature.values.kind === "year");
  const quarterMembers = memberFeatures.filter((feature) => feature.values.kind === "quarter");
  const yearMonthMembers = memberFeatures.filter((feature) => feature.values.kind === "yearMonth");
  const yearRangeMembers = memberFeatures.filter((feature) => feature.values.kind === "yearRange");
  const monthMembers = memberFeatures.filter((feature) => feature.values.kind === "month");

  if (yearMembers.length >= 1) {
    observations.push(
      buildPeerTimeKindObservation(context, yearMembers, "year", "year-features-among-peers"),
    );
  }
  if (quarterMembers.length >= 1) {
    observations.push(
      buildPeerTimeKindObservation(context, quarterMembers, "quarter", "quarter-features-among-peers"),
    );
  }
  if (yearMonthMembers.length >= 1) {
    observations.push(
      buildPeerTimeKindObservation(
        context,
        yearMonthMembers,
        "yearMonth",
        "year-month-features-among-peers",
      ),
    );
  }
  if (yearRangeMembers.length >= 1) {
    observations.push(
      buildPeerTimeKindObservation(
        context,
        yearRangeMembers,
        "yearRange",
        "year-range-features-among-peers",
      ),
    );
  }
  if (monthMembers.length >= 1) {
    observations.push(
      buildPeerTimeKindObservation(context, monthMembers, "month", "month-features-among-peers"),
    );
  }

  if (distinctKinds(memberFeatures).length >= 2) {
    observations.push(buildMixedKindsObservation(context, memberFeatures));
  }

  if (yearMembers.length >= 2) {
    const gapObservation = buildYearSpanGapObservation(context, yearMembers);
    if (gapObservation !== null) {
      observations.push(gapObservation);
    }
  }

  if (context.comparisonPossible) {
    const peerYearObs = buildPeerAreasDirectYearObservation(context, root);
    if (peerYearObs !== null) {
      observations.push(peerYearObs);
    }
  }

  return observations;
}

function buildPeerTimeKindObservation(
  context: StructureComparisonContext,
  matchedFeatures: readonly StructureTimeFeature[],
  kind: StructureTimeKind,
  observationType: string,
): StructureInsightObservation {
  const matchedIds = new Set(matchedFeatures.map((feature) => feature.nodeId));
  const supportingEvidence = matchedFeatures.map((feature) =>
    evidence(nodeRef(feature.nodeId, { name: feature.name, relativePath: feature.relativePath }), "supports", {
      timeKind: feature.values.kind,
      patternId: feature.patternId,
      recognitionMode: feature.recognitionMode,
      ...valuesAsAttrs(feature.values),
    }),
  );
  const counterEvidence = context.members
    .filter((member) => !matchedIds.has(member.nodeId))
    .map((member) =>
      evidence(nodeRef(member.nodeId, { name: member.name, relativePath: member.relativePath }), "counter", {
        timeKind: null,
      }),
    );

  const recurring = matchedFeatures.length >= 2;
  const patternFeatures: StructureInsightAttrMap = {
    pattern: observationType,
    timeKind: kind,
    recurring,
    claimsMissingElements: false,
    matchedKindCount: matchedFeatures.length,
    memberCount: context.memberCount,
    comparisonContextId: context.id,
  };

  if (kind === "year") {
    const years = matchedFeatures
      .map((feature) => (feature.values.kind === "year" ? feature.values.year : -1))
      .filter((year) => year >= 0)
      .sort((a, b) => a - b);
    patternFeatures.observedYears = years.join(",");
    patternFeatures.minObservedYear = years[0] ?? null;
    patternFeatures.maxObservedYear = years[years.length - 1] ?? null;
  }

  return {
    id: observationId(observationType, context.id),
    category: "folderStructure",
    observationType,
    scope: { kind: "comparisonSet", nodeIds: context.members.map((member) => member.nodeId) },
    comparisonGroup: context.members.map((member) =>
      nodeRef(member.nodeId, { name: member.name, relativePath: member.relativePath }),
    ),
    supportingEvidence,
    counterEvidence,
    matchedCount: matchedFeatures.length,
    totalCount: context.memberCount,
    provenance: {
      detectorId: STRUCTURE_TIME_DETECTOR_ID,
      detectorVersion: STRUCTURE_TIME_DETECTOR_VERSION,
    },
    patternFeatures,
  };
}

function buildMixedKindsObservation(
  context: StructureComparisonContext,
  memberFeatures: readonly StructureTimeFeature[],
): StructureInsightObservation {
  const kindCounts = countKinds(memberFeatures);
  return {
    id: observationId("mixed-time-kinds-among-peers", context.id),
    category: "folderStructure",
    observationType: "mixed-time-kinds-among-peers",
    scope: { kind: "comparisonSet", nodeIds: context.members.map((member) => member.nodeId) },
    comparisonGroup: context.members.map((member) =>
      nodeRef(member.nodeId, { name: member.name, relativePath: member.relativePath }),
    ),
    supportingEvidence: memberFeatures.map((feature) =>
      evidence(nodeRef(feature.nodeId, { name: feature.name, relativePath: feature.relativePath }), "supports", {
        timeKind: feature.values.kind,
        ...valuesAsAttrs(feature.values),
      }),
    ),
    counterEvidence: context.members
      .filter((member) => !memberFeatures.some((feature) => feature.nodeId === member.nodeId))
      .map((member) =>
        evidence(nodeRef(member.nodeId, { name: member.name, relativePath: member.relativePath }), "counter"),
      ),
    matchedCount: memberFeatures.length,
    totalCount: context.memberCount,
    provenance: {
      detectorId: STRUCTURE_TIME_DETECTOR_ID,
      detectorVersion: STRUCTURE_TIME_DETECTOR_VERSION,
    },
    patternFeatures: {
      pattern: "mixed-time-kinds-among-peers",
      claimsMissingElements: false,
      yearCount: kindCounts.year,
      yearMonthCount: kindCounts.yearMonth,
      quarterCount: kindCounts.quarter,
      yearRangeCount: kindCounts.yearRange,
      monthCount: kindCounts.month,
      comparisonContextId: context.id,
      unifiedTimeKind: false,
    },
  };
}

function buildYearSpanGapObservation(
  context: StructureComparisonContext,
  yearMembers: readonly StructureTimeFeature[],
): StructureInsightObservation | null {
  const years = yearMembers
    .map((feature) => (feature.values.kind === "year" ? feature.values.year : -1))
    .filter((year) => year >= 0)
    .sort((a, b) => a - b);
  const uniqueYears = uniqueSorted(years);
  if (uniqueYears.length < 2) {
    return null;
  }
  const minYear = uniqueYears[0];
  const maxYear = uniqueYears[uniqueYears.length - 1];
  const present = new Set(uniqueYears);
  const absentInSpan: number[] = [];
  for (let year = minYear; year <= maxYear; year += 1) {
    if (!present.has(year)) {
      absentInSpan.push(year);
    }
  }
  if (absentInSpan.length === 0) {
    return null;
  }

  return {
    id: observationId("year-span-absence-among-peers", context.id),
    category: "folderStructure",
    observationType: "year-span-absence-among-peers",
    scope: { kind: "comparisonSet", nodeIds: context.members.map((member) => member.nodeId) },
    comparisonGroup: context.members.map((member) =>
      nodeRef(member.nodeId, { name: member.name, relativePath: member.relativePath }),
    ),
    supportingEvidence: yearMembers.map((feature) =>
      evidence(nodeRef(feature.nodeId, { name: feature.name, relativePath: feature.relativePath }), "supports", {
        timeKind: "year",
        ...valuesAsAttrs(feature.values),
      }),
    ),
    counterEvidence: [],
    matchedCount: yearMembers.length,
    totalCount: context.memberCount,
    provenance: {
      detectorId: STRUCTURE_TIME_DETECTOR_ID,
      detectorVersion: STRUCTURE_TIME_DETECTOR_VERSION,
    },
    patternFeatures: {
      pattern: "year-span-absence-among-peers",
      claimsMissingElements: false,
      observedYears: uniqueYears.join(","),
      minObservedYear: minYear,
      maxObservedYear: maxYear,
      /** Years in [min,max] with no peer folder of kind year — observation only, not "must create". */
      absentYearsInObservedSpan: absentInSpan.join(","),
      comparisonContextId: context.id,
    },
  };
}

function buildPeerAreasDirectYearObservation(
  context: StructureComparisonContext,
  root: DirectoryNode,
): StructureInsightObservation | null {
  const nodeById = indexDirectories(root);
  const withYears: StructureComparisonContext["members"] = [];
  const withoutYears: StructureComparisonContext["members"] = [];

  for (const member of context.members) {
    const node = nodeById.get(member.nodeId);
    if (node === undefined) {
      withoutYears.push(member);
      continue;
    }
    const hasDirectYear = node.children.some(
      (child) => isDirectory(child) && parseExactStructureTimeYear(child.name) !== null,
    );
    if (hasDirectYear) {
      withYears.push(member);
    } else {
      withoutYears.push(member);
    }
  }

  if (withYears.length === 0) {
    return null;
  }

  return {
    id: observationId("peer-areas-direct-year-children", context.id),
    category: "folderStructure",
    observationType: "peer-areas-direct-year-children",
    scope: { kind: "comparisonSet", nodeIds: context.members.map((member) => member.nodeId) },
    comparisonGroup: context.members.map((member) =>
      nodeRef(member.nodeId, { name: member.name, relativePath: member.relativePath }),
    ),
    supportingEvidence: withYears.map((member) =>
      evidence(nodeRef(member.nodeId, { name: member.name, relativePath: member.relativePath }), "supports", {
        hasDirectYearChildren: true,
      }),
    ),
    counterEvidence: withoutYears.map((member) =>
      evidence(nodeRef(member.nodeId, { name: member.name, relativePath: member.relativePath }), "counter", {
        hasDirectYearChildren: false,
      }),
    ),
    matchedCount: withYears.length,
    totalCount: context.memberCount,
    provenance: {
      detectorId: STRUCTURE_TIME_DETECTOR_ID,
      detectorVersion: STRUCTURE_TIME_DETECTOR_VERSION,
    },
    patternFeatures: {
      pattern: "peer-areas-direct-year-children",
      claimsMissingElements: false,
      areasWithDirectYearChildren: withYears.length,
      areasWithoutDirectYearChildren: withoutYears.length,
      comparisonContextId: context.id,
    },
  };
}

function indexDirectories(root: DirectoryNode): Map<string, DirectoryNode> {
  const index = new Map<string, DirectoryNode>();
  function walk(node: DirectoryNode): void {
    index.set(node.id, node);
    for (const child of node.children) {
      if (isDirectory(child)) {
        walk(child);
      }
    }
  }
  walk(root);
  return index;
}

function valuesAsAttrs(values: StructureTimeValues): StructureInsightAttrMap {
  switch (values.kind) {
    case "year":
      return { year: values.year };
    case "yearMonth":
      return { year: values.year, month: values.month };
    case "quarter":
      return { year: values.year, quarter: values.quarter };
    case "yearRange":
      return { startYear: values.startYear, endYear: values.endYear };
    case "month":
      return { year: values.year, month: values.month };
  }
}

function countKinds(features: readonly StructureTimeFeature[]): Record<StructureTimeKind, number> {
  const counts: Record<StructureTimeKind, number> = {
    year: 0,
    yearMonth: 0,
    quarter: 0,
    yearRange: 0,
    month: 0,
  };
  for (const feature of features) {
    counts[feature.values.kind] += 1;
  }
  return counts;
}

function distinctKinds(features: readonly StructureTimeFeature[]): StructureTimeKind[] {
  const kinds = new Set<StructureTimeKind>();
  for (const feature of features) {
    kinds.add(feature.values.kind);
  }
  return [...kinds].sort(compareText);
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function observationId(observationType: string, contextId: string): string {
  return `obs:${STRUCTURE_TIME_DETECTOR_ID}:${observationType}:${contextId}`;
}

function compareText(left: string, right: string): number {
  const order = left.localeCompare(right, undefined, { sensitivity: "base" });
  if (order !== 0) {
    return order;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Guard helpers for tests / verifiers. */
export function structureTimeResultHasForbiddenClaims(result: StructureTimeInsightResult): boolean {
  const serialized = JSON.stringify(result).toLowerCase();
  if (result.insight.ruleCandidates.length > 0) {
    return true;
  }
  if (result.insight.suggestions.length > 0) {
    return true;
  }
  if (result.insight.confirmedExceptions.length > 0) {
    return true;
  }
  if (result.insight.observations.some((observation) => observationClaimsMissingElements(observation))) {
    return true;
  }
  if (/"confidenceScore"\s*:/.test(JSON.stringify(result))) {
    return true;
  }
  const forbiddenTokens = ["should" + "Exist", "missing" + "Folder", "create" + "Folder", "required" + "Year", "required" + "Month"];
  for (const token of forbiddenTokens) {
    if (serialized.includes(token.toLowerCase())) {
      return true;
    }
  }
  return false;
}

export function structureTimeInsightRoundTripEquals(result: StructureTimeInsightResult): boolean {
  const round = structureTimeInsightJsonRoundTrip(result);
  const insightRound = structureInsightJsonRoundTrip(result.insight);
  return (
    JSON.stringify(round) === JSON.stringify(result) &&
    JSON.stringify(insightRound) === JSON.stringify(result.insight)
  );
}
