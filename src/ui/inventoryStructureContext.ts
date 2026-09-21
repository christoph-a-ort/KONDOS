import { isDirectory, isFile, type DirectoryListing, type DirectoryNode, type FileNode, type ScanResult } from "../model";
import type { InventoryNodeRef } from "./inventoryAnalysis";
import { displayInventoryPath } from "./inventoryOverview";

/**
 * Read-only structure context derived from one ScanResult.
 *
 * Year folders are exact four ASCII digits in YEAR_FOLDER_MIN..YEAR_FOLDER_MAX.
 * Year groups are two or more such folders under the same direct parent.
 * Missing years are a structural observation only, not an error or a claim that data is absent.
 *
 * Not in this slice: technical companion folders (a_data, a_data_002, container_data_003),
 * saved-website .js companions, ratings, SOLL, KI, or UI.
 */
export const YEAR_FOLDER_MIN = 1900;
export const YEAR_FOLDER_MAX = 2100;
export const MIN_YEAR_GROUP_SIZE = 2;

const YEAR_FOLDER_NAME = /^[0-9]{4}$/;

export interface FolderStructureContext {
  folder: InventoryNodeRef;
  parent: InventoryNodeRef | null;
  childDirectories: InventoryNodeRef[];
  childFiles: InventoryNodeRef[];
  siblingDirectories: InventoryNodeRef[];
  depth: number;
  relativePath: string;
  listing: DirectoryListing;
}

export interface YearFolderRef {
  year: number;
  folder: InventoryNodeRef;
  listing: DirectoryListing;
}

export interface ConsecutiveYearRun {
  start: number;
  end: number;
}

export interface YearFolderGroup {
  parent: InventoryNodeRef;
  parentRelativePath: string;
  years: number[];
  yearFolders: YearFolderRef[];
  minYear: number;
  maxYear: number;
  missingYears: number[];
  consecutiveRuns: ConsecutiveYearRun[];
}

export interface InventoryStructureContext {
  folders: FolderStructureContext[];
  yearFolders: YearFolderRef[];
  yearGroups: YearFolderGroup[];
}

export function parseYearFolderName(name: string): number | null {
  if (!YEAR_FOLDER_NAME.test(name)) {
    return null;
  }
  const year = Number(name);
  if (year < YEAR_FOLDER_MIN || year > YEAR_FOLDER_MAX) {
    return null;
  }
  return year;
}

export function isYearFolderName(name: string): boolean {
  return parseYearFolderName(name) !== null;
}

export function analyzeStructureContext(result: ScanResult): InventoryStructureContext {
  const rootPath = result.root.path;
  const folders: FolderStructureContext[] = [];
  const yearFolders: YearFolderRef[] = [];
  const yearGroups: YearFolderGroup[] = [];

  function visit(node: DirectoryNode, parent: DirectoryNode | null, siblingDirectories: readonly DirectoryNode[]): void {
    const childDirectories = node.children.filter(isDirectory);
    const childFiles = node.children.filter(isFile);
    const folderRef = nodeRef(node);
    const year = parseYearFolderName(node.name);
    if (year !== null) {
      yearFolders.push(yearRef(year, node));
    }

    folders.push({
      folder: folderRef,
      parent: parent === null ? null : nodeRef(parent),
      childDirectories: sortedRefs(childDirectories),
      childFiles: sortedFileRefs(childFiles),
      siblingDirectories: sortedRefs(siblingDirectories.filter((sibling) => sibling.id !== node.id)),
      depth: node.depth,
      relativePath: displayInventoryPath(rootPath, node.path),
      listing: node.listing,
    });

    const childYearFolders = childDirectories
      .map((child) => {
        const childYear = parseYearFolderName(child.name);
        return childYear === null ? null : yearRef(childYear, child);
      })
      .filter((item): item is YearFolderRef => item !== null)
      .sort(compareYearFolder);

    if (childYearFolders.length >= MIN_YEAR_GROUP_SIZE) {
      yearGroups.push(buildYearGroup(node, rootPath, childYearFolders));
    }

    for (const child of childDirectories) {
      visit(child, node, childDirectories);
    }
  }

  visit(result.root, null, []);

  folders.sort((left, right) => compareText(left.folder.path, right.folder.path));
  yearFolders.sort(compareYearFolder);
  yearGroups.sort((left, right) => compareText(left.parent.path, right.parent.path));

  return { folders, yearFolders, yearGroups };
}

function buildYearGroup(
  parent: DirectoryNode,
  rootPath: string,
  yearFolders: YearFolderRef[],
): YearFolderGroup {
  const years = uniqueYears(yearFolders);
  const minYear = years[0] ?? 0;
  const maxYear = years[years.length - 1] ?? 0;
  return {
    parent: nodeRef(parent),
    parentRelativePath: displayInventoryPath(rootPath, parent.path),
    years,
    yearFolders,
    minYear,
    maxYear,
    missingYears: missingYearsBetween(minYear, maxYear, years),
    consecutiveRuns: consecutiveRunsOf(years),
  };
}

function uniqueYears(yearFolders: readonly YearFolderRef[]): number[] {
  const years: number[] = [];
  for (const item of yearFolders) {
    if (years[years.length - 1] !== item.year) {
      years.push(item.year);
    }
  }
  return years;
}

function missingYearsBetween(minYear: number, maxYear: number, present: readonly number[]): number[] {
  const presentSet = new Set(present);
  const missing: number[] = [];
  for (let year = minYear; year <= maxYear; year += 1) {
    if (!presentSet.has(year)) {
      missing.push(year);
    }
  }
  return missing;
}

function consecutiveRunsOf(years: readonly number[]): ConsecutiveYearRun[] {
  const runs: ConsecutiveYearRun[] = [];
  if (years.length === 0) {
    return runs;
  }
  let start = years[0] ?? 0;
  let end = start;
  for (let index = 1; index < years.length; index += 1) {
    const year = years[index] ?? end;
    if (year === end + 1) {
      end = year;
      continue;
    }
    if (end > start) {
      runs.push({ start, end });
    }
    start = year;
    end = year;
  }
  if (end > start) {
    runs.push({ start, end });
  }
  return runs;
}

function nodeRef(node: DirectoryNode | FileNode): InventoryNodeRef {
  return {
    id: node.id,
    name: node.name,
    path: node.path,
    depth: node.depth,
  };
}

function yearRef(year: number, node: DirectoryNode): YearFolderRef {
  return {
    year,
    folder: nodeRef(node),
    listing: node.listing,
  };
}

function sortedRefs(nodes: readonly DirectoryNode[]): InventoryNodeRef[] {
  return nodes.map(nodeRef).sort((left, right) => compareText(left.path, right.path));
}

function sortedFileRefs(nodes: readonly FileNode[]): InventoryNodeRef[] {
  return nodes.map(nodeRef).sort((left, right) => compareText(left.path, right.path));
}

function compareYearFolder(left: YearFolderRef, right: YearFolderRef): number {
  if (left.year !== right.year) {
    return left.year - right.year;
  }
  return compareText(left.folder.path, right.folder.path);
}

function compareText(left: string, right: string): number {
  const order = left.localeCompare(right, undefined, { sensitivity: "base" });
  if (order !== 0) {
    return order;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

export function folderContextByPath(
  context: InventoryStructureContext,
  path: string,
): FolderStructureContext | undefined {
  return context.folders.find((item) => item.folder.path === path);
}
