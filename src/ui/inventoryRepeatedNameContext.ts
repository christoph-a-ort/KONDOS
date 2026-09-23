import type { DirectoryListing } from "../model";
import type { InventoryAnalysis, InventoryNodeRef, RepeatedNameGroup } from "./inventoryAnalysis";
import {
  folderContextByPath,
  isYearFolderName,
  type FolderStructureContext,
  type InventoryStructureContext,
  type YearFolderGroup,
} from "./inventoryStructureContext";

/**
 * Read-only join of P1-H repeated folder names with P1-I/P1-J structure context.
 *
 * Same normalized name still means only the same folder name at several paths.
 * Observation only, not a rating, duplicate claim, or merge suggestion.
 *
 * Not in this slice: UI, similarity, content, hashing, KI, SOLL, or actions.
 */
export interface RepeatedFolderNameYearGroupContext {
  parent: InventoryNodeRef;
  parentRelativePath: string;
  years: number[];
  minYear: number;
  maxYear: number;
}

export interface RepeatedFolderNameOccurrenceContext {
  path: string;
  joinFound: boolean;
  folder: InventoryNodeRef | null;
  relativePath: string | null;
  depth: number | null;
  listing: DirectoryListing | null;
  parent: InventoryNodeRef | null;
  parentRelativePath: string | null;
  siblingDirectoryCount: number;
  siblingDirectoryNames: string[];
  isYearFolderName: boolean;
  yearGroup: RepeatedFolderNameYearGroupContext | null;
  parentInRepeatedChildDirectoryStructure: boolean;
  parentRepeatedChildDirectoryStructureSignature: string | null;
  inFolderChain: boolean;
}

export interface RepeatedFolderNameContextGroup {
  name: string;
  count: number;
  occurrences: RepeatedFolderNameOccurrenceContext[];
}

export function analyzeRepeatedFolderNameContext(
  analysis: InventoryAnalysis,
  structure: InventoryStructureContext,
): RepeatedFolderNameContextGroup[] {
  const yearGroupByFolderPath = yearGroupIndex(structure);
  const structureSignatureByParentPath = parentStructureIndex(structure);
  const chainFolderPaths = chainPathSet(structure);

  return analysis.repeatedFolderNames.map((group) => ({
    name: group.name,
    count: group.count,
    occurrences: occurrencesOf(group, structure, yearGroupByFolderPath, structureSignatureByParentPath, chainFolderPaths),
  }));
}

function occurrencesOf(
  group: RepeatedNameGroup,
  structure: InventoryStructureContext,
  yearGroupByFolderPath: ReadonlyMap<string, YearFolderGroup>,
  structureSignatureByParentPath: ReadonlyMap<string, string>,
  chainFolderPaths: ReadonlySet<string>,
): RepeatedFolderNameOccurrenceContext[] {
  return group.paths
    .map((path) =>
      occurrenceOf(
        path,
        folderContextByPath(structure, path),
        structure,
        yearGroupByFolderPath,
        structureSignatureByParentPath,
        chainFolderPaths,
      ),
    )
    .sort(compareOccurrence);
}

function occurrenceOf(
  path: string,
  folder: FolderStructureContext | undefined,
  structure: InventoryStructureContext,
  yearGroupByFolderPath: ReadonlyMap<string, YearFolderGroup>,
  structureSignatureByParentPath: ReadonlyMap<string, string>,
  chainFolderPaths: ReadonlySet<string>,
): RepeatedFolderNameOccurrenceContext {
  if (folder === undefined) {
    return missingOccurrence(path);
  }
  const parentPath = folder.parent?.path;
  const parentContext = parentPath === undefined ? undefined : folderContextByPath(structure, parentPath);
  const parentSignature = parentPath === undefined ? undefined : structureSignatureByParentPath.get(parentPath);
  const yearGroup = yearGroupByFolderPath.get(folder.folder.path);
  return {
    path,
    joinFound: true,
    folder: folder.folder,
    relativePath: folder.relativePath,
    depth: folder.depth,
    listing: folder.listing,
    parent: folder.parent,
    parentRelativePath: parentContext?.relativePath ?? null,
    siblingDirectoryCount: folder.siblingDirectories.length,
    siblingDirectoryNames: folder.siblingDirectories
      .map((item) => item.name)
      .slice()
      .sort(compareText),
    isYearFolderName: isYearFolderName(folder.folder.name),
    yearGroup: yearGroup === undefined ? null : yearGroupContext(yearGroup),
    parentInRepeatedChildDirectoryStructure: parentSignature !== undefined,
    parentRepeatedChildDirectoryStructureSignature: parentSignature ?? null,
    inFolderChain: chainFolderPaths.has(folder.folder.path),
  };
}

function missingOccurrence(path: string): RepeatedFolderNameOccurrenceContext {
  return {
    path,
    joinFound: false,
    folder: null,
    relativePath: null,
    depth: null,
    listing: null,
    parent: null,
    parentRelativePath: null,
    siblingDirectoryCount: 0,
    siblingDirectoryNames: [],
    isYearFolderName: false,
    yearGroup: null,
    parentInRepeatedChildDirectoryStructure: false,
    parentRepeatedChildDirectoryStructureSignature: null,
    inFolderChain: false,
  };
}

function yearGroupContext(group: YearFolderGroup): RepeatedFolderNameYearGroupContext {
  return {
    parent: group.parent,
    parentRelativePath: group.parentRelativePath,
    years: group.years,
    minYear: group.minYear,
    maxYear: group.maxYear,
  };
}

function yearGroupIndex(structure: InventoryStructureContext): Map<string, YearFolderGroup> {
  const index = new Map<string, YearFolderGroup>();
  for (const group of structure.yearGroups) {
    for (const yearFolder of group.yearFolders) {
      index.set(yearFolder.folder.path, group);
    }
  }
  return index;
}

function parentStructureIndex(structure: InventoryStructureContext): Map<string, string> {
  const index = new Map<string, string>();
  for (const group of structure.repeatedChildDirectoryStructures) {
    for (const parent of group.parents) {
      index.set(parent.folder.path, group.signature);
    }
  }
  return index;
}

function chainPathSet(structure: InventoryStructureContext): Set<string> {
  const paths = new Set<string>();
  for (const chain of structure.folderChains) {
    for (const folder of chain.folders) {
      paths.add(folder.path);
    }
  }
  return paths;
}

function compareOccurrence(
  left: RepeatedFolderNameOccurrenceContext,
  right: RepeatedFolderNameOccurrenceContext,
): number {
  if (left.relativePath !== null && right.relativePath !== null) {
    const byRelative = compareText(left.relativePath, right.relativePath);
    if (byRelative !== 0) {
      return byRelative;
    }
  }
  return compareText(left.path, right.path);
}

function compareText(left: string, right: string): number {
  const order = left.localeCompare(right, undefined, { sensitivity: "base" });
  if (order !== 0) {
    return order;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}
