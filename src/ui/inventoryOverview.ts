import { formatByteSize } from "./treeFormat";
import {
  analyzeInventory,
  type FolderOccupancy,
  type InventoryAnalysis,
  type InventoryNodeRef,
  type RepeatedNameGroup,
} from "./inventoryAnalysis";
import type { ConsecutiveYearRun, InventoryStructureContext, YearFolderGroup } from "./inventoryStructureContext";
import type { ScanResult } from "../model";

export const IST_OVERVIEW_TITLE = "IST-Überblick";
export const IST_OVERVIEW_NO_SCAN = "Zuerst einen Ordner einlesen.";
export const START_FOLDER_LABEL = "Startordner";
export const DIRECT_FILE_RANK_LIMIT = 10;
export const EMPTY_FILE_TYPES = "Keine Dateitypen gefunden.";
export const EMPTY_BUSY_FOLDERS = "Keine Ordner mit direkt enthaltenen Dateien gefunden.";
export const EMPTY_EMPTY_FOLDERS = "Keine leeren Ordner gefunden.";
export const EMPTY_SINGLE_FILE_FOLDERS = "Keine Ordner mit genau einer direkt enthaltenen Datei gefunden.";
export const EMPTY_REPEATED_FOLDERS = "Keine wiederkehrenden Ordnernamen gefunden.";
export const EMPTY_REPEATED_FILES = "Keine wiederkehrenden Dateinamen gefunden.";
export const REPEATED_FILES_HINT =
  "Gleiche Dateinamen bedeuten nicht automatisch identische Dateiinhalte.";
export const UNCONFIRMED_EMPTY_TITLE = "Nicht vollständig prüfbare Ordner";
export const UNCONFIRMED_EMPTY_HINT =
  "Diese Ordner wirken leer, konnten beim Einlesen jedoch nicht eindeutig als leer bestätigt werden.";
export const SECTION_FILE_TYPES = "Dateitypen";
export const SECTION_BUSY_FOLDERS = "Ordner nach Anzahl direkt enthaltener Dateien";
export const SECTION_EMPTY_FOLDERS = "Leere Ordner";
export const SECTION_SINGLE_FILE_FOLDERS = "Ordner mit genau einer direkt enthaltenen Datei";
export const SECTION_REPEATED_FOLDERS = "Wiederkehrende Ordnernamen";
export const SECTION_REPEATED_FILES = "Wiederkehrende Dateinamen";
export const SECTION_YEAR_STRUCTURES = "Jahresstrukturen";
export const FILE_TYPE_TOTAL_LABEL = "Gesamt";
export const EMPTY_YEAR_STRUCTURES = "Keine wiederkehrende Jahresstruktur erkannt.";
export const YEAR_FOLDERS_PRESENT_LABEL = "Vorhandene Jahresordner";
export const YEAR_SPAN_LABEL = "Beobachtete Spanne";
export const YEAR_MISSING_LABEL = "Nicht vorhandene Jahresordner innerhalb der Spanne";
export const YEAR_RUNS_LABEL = "Zusammenhängende Folgen";

export const DEFAULT_SECTION_OPEN = {
  fileTypes: true,
  busyFolders: true,
  emptyFolders: false,
  unconfirmed: false,
  singleFile: false,
  repeatedFolders: false,
  repeatedFiles: false,
  yearStructures: false,
} as const;

export interface InventoryOverviewRow {
  name: string;
  path: string;
  pathLabel: string;
  countLabel: string;
}

export interface InventoryOverviewTypeRow {
  label: string;
  fileCountLabel: string;
  knownSizeLabel: string;
}

export interface InventoryOverviewNameGroup {
  name: string;
  countLabel: string;
  summary: string;
  paths: string[];
  pathLabels: string[];
}

export interface InventoryOverviewYearGroup {
  parentName: string;
  parentPath: string;
  parentPathLabel: string;
  yearsLabel: string;
  spanLabel: string;
  missingYearsLabel: string | null;
  consecutiveRunsLabel: string | null;
}

export interface InventoryOverviewView {
  available: boolean;
  title: string;
  noScanMessage: string | null;
  directoryCount: number;
  subdirectoryCount: number;
  directoryCountLabel: string;
  subdirectoryCountLabel: string;
  fileCountLabel: string;
  knownSizeLabel: string;
  filesWithoutKnownSizeLabel: string;
  maxObservedDepthLabel: string;
  depthLimitedNote: string | null;
  fileTypes: InventoryOverviewTypeRow[];
  fileTypesEmpty: string | null;
  fileTypeCount: number;
  fileTypeTotalCountLabel: string;
  fileTypeTotalSizeLabel: string;
  busyFolders: InventoryOverviewRow[];
  busyFolderCount: number;
  busyFoldersEmpty: string | null;
  emptyFolders: InventoryOverviewRow[];
  emptyFolderCount: number;
  emptyFoldersEmpty: string | null;
  unconfirmedFolders: InventoryOverviewRow[];
  unconfirmedCount: number;
  unconfirmedTitle: string;
  unconfirmedHint: string;
  singleFileCount: number;
  singleFileFolders: InventoryOverviewRow[];
  singleFileEmpty: string | null;
  repeatedFolders: InventoryOverviewNameGroup[];
  repeatedFolderCount: number;
  repeatedFoldersEmpty: string | null;
  repeatedFiles: InventoryOverviewNameGroup[];
  repeatedFileCount: number;
  repeatedFilesEmpty: string | null;
  repeatedFilesHint: string;
  yearGroups: InventoryOverviewYearGroup[];
  yearGroupCount: number;
  yearGroupsEmpty: string | null;
}

export function inventoryAnalysisFromScan(result: ScanResult | null): InventoryAnalysis | null {
  if (result === null) {
    return null;
  }
  return analyzeInventory(result);
}

export function formatInventoryCount(value: number): string {
  return value.toLocaleString("de-DE", { maximumFractionDigits: 0 });
}

export function depthLimitedNote(count: number): string | null {
  if (count <= 0) {
    return null;
  }
  if (count === 1) {
    return "Bei 1 Ordner wurde die eingestellte Einlesetiefe erreicht.";
  }
  return `Bei ${formatInventoryCount(count)} Ordnern wurde die eingestellte Einlesetiefe erreicht.`;
}

export function subdirectoryCount(directoryCount: number): number {
  return Math.max(directoryCount - 1, 0);
}

export function sectionSummary(title: string, count: number): string {
  return `${title} (${formatInventoryCount(count)})`;
}

export function displayInventoryPath(rootAbs: string, abs: string): string {
  const root = trimTrailingSlash(normalizeSeparators(rootAbs));
  const path = trimTrailingSlash(normalizeSeparators(abs));
  if (path.length === 0) {
    return START_FOLDER_LABEL;
  }
  if (root.length === 0) {
    return lastSegment(path);
  }
  if (pathEquals(path, root)) {
    return START_FOLDER_LABEL;
  }
  if (path.length > root.length && pathEquals(path.slice(0, root.length), root)) {
    const tail = path.slice(root.length);
    if (tail.startsWith("/")) {
      const relative = tail.slice(1);
      if (relative.length > 0) {
        return relative.replace(/\//g, "\\");
      }
    }
  }
  return lastSegment(path);
}

function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

function trimTrailingSlash(value: string): string {
  if (value.length >= 2 && isWindowsDrive(value) && value.endsWith("/")) {
    return value;
  }
  return value.replace(/\/+$/, "");
}

function isWindowsDrive(value: string): boolean {
  return value.length >= 2 && /[A-Za-z]/.test(value[0] ?? "") && value[1] === ":";
}

function pathEquals(left: string, right: string): boolean {
  return left.toLocaleLowerCase() === right.toLocaleLowerCase();
}

function lastSegment(path: string): string {
  const parts = path.split("/").filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? START_FOLDER_LABEL;
}

function folderRow(
  node: InventoryNodeRef | FolderOccupancy,
  rootPath: string,
  count?: number,
): InventoryOverviewRow {
  return {
    name: node.name,
    path: node.path,
    pathLabel: displayInventoryPath(rootPath, node.path),
    countLabel: count === undefined ? "" : formatInventoryCount(count),
  };
}

function nameGroups(groups: readonly RepeatedNameGroup[], rootPath: string): InventoryOverviewNameGroup[] {
  return groups.map((group) => ({
    name: group.name,
    countLabel: formatInventoryCount(group.count),
    summary: `${group.name} – ${formatInventoryCount(group.count)} Vorkommen`,
    paths: group.paths,
    pathLabels: group.paths.map((path) => displayInventoryPath(rootPath, path)),
  }));
}

export function formatYearList(years: readonly number[]): string {
  return years.map((year) => String(year)).join(" · ");
}

export function formatYearSpan(minYear: number, maxYear: number): string {
  return `${minYear}–${maxYear}`;
}

export function formatConsecutiveRuns(runs: readonly ConsecutiveYearRun[]): string {
  return runs.map((run) => formatYearSpan(run.start, run.end)).join(" · ");
}

function yearGroupRow(group: YearFolderGroup): InventoryOverviewYearGroup {
  const hasGaps = group.missingYears.length > 0;
  return {
    parentName: group.parent.name,
    parentPath: group.parent.path,
    parentPathLabel: group.parentRelativePath,
    yearsLabel: formatYearList(group.years),
    spanLabel: formatYearSpan(group.minYear, group.maxYear),
    missingYearsLabel: hasGaps ? formatYearList(group.missingYears) : null,
    consecutiveRunsLabel:
      hasGaps && group.consecutiveRuns.length > 0 ? formatConsecutiveRuns(group.consecutiveRuns) : null,
  };
}

const emptyView: InventoryOverviewView = {
  available: false,
  title: IST_OVERVIEW_TITLE,
  noScanMessage: IST_OVERVIEW_NO_SCAN,
  directoryCount: 0,
  subdirectoryCount: 0,
  directoryCountLabel: "",
  subdirectoryCountLabel: "",
  fileCountLabel: "",
  knownSizeLabel: "",
  filesWithoutKnownSizeLabel: "",
  maxObservedDepthLabel: "",
  depthLimitedNote: null,
  fileTypes: [],
  fileTypesEmpty: null,
  fileTypeCount: 0,
  fileTypeTotalCountLabel: "",
  fileTypeTotalSizeLabel: "",
  busyFolders: [],
  busyFolderCount: 0,
  busyFoldersEmpty: null,
  emptyFolders: [],
  emptyFolderCount: 0,
  emptyFoldersEmpty: null,
  unconfirmedFolders: [],
  unconfirmedCount: 0,
  unconfirmedTitle: UNCONFIRMED_EMPTY_TITLE,
  unconfirmedHint: UNCONFIRMED_EMPTY_HINT,
  singleFileCount: 0,
  singleFileFolders: [],
  singleFileEmpty: null,
  repeatedFolders: [],
  repeatedFolderCount: 0,
  repeatedFoldersEmpty: null,
  repeatedFiles: [],
  repeatedFileCount: 0,
  repeatedFilesEmpty: null,
  repeatedFilesHint: REPEATED_FILES_HINT,
  yearGroups: [],
  yearGroupCount: 0,
  yearGroupsEmpty: null,
};

export function buildInventoryOverviewView(
  analysis: InventoryAnalysis | null,
  rootPath = "",
  structure: InventoryStructureContext | null = null,
): InventoryOverviewView {
  if (analysis === null) {
    return emptyView;
  }

  const foldersWithDirectFiles = analysis.foldersByDirectFileCount.filter(
    (folder) => folder.directFileCount > 0,
  );
  const busyFolders = foldersWithDirectFiles
    .slice(0, DIRECT_FILE_RANK_LIMIT)
    .map((folder) => folderRow(folder, rootPath, folder.directFileCount));
  const nestedCount = subdirectoryCount(analysis.directoryCount);
  const yearGroups = (structure?.yearGroups ?? []).map(yearGroupRow);

  return {
    available: true,
    title: IST_OVERVIEW_TITLE,
    noScanMessage: null,
    directoryCount: analysis.directoryCount,
    subdirectoryCount: nestedCount,
    directoryCountLabel: formatInventoryCount(analysis.directoryCount),
    subdirectoryCountLabel: formatInventoryCount(nestedCount),
    fileCountLabel: formatInventoryCount(analysis.fileCount),
    knownSizeLabel: formatByteSize(analysis.knownSizeBytes),
    filesWithoutKnownSizeLabel: formatInventoryCount(analysis.filesWithoutKnownSize),
    maxObservedDepthLabel: formatInventoryCount(analysis.maxObservedDepth),
    depthLimitedNote: depthLimitedNote(analysis.depthLimitedFolderCount),
    fileTypes: analysis.fileTypes.map((item) => ({
      label: item.label,
      fileCountLabel: formatInventoryCount(item.fileCount),
      knownSizeLabel: formatByteSize(item.knownSizeBytes),
    })),
    fileTypesEmpty: analysis.fileTypes.length === 0 ? EMPTY_FILE_TYPES : null,
    fileTypeCount: analysis.fileTypes.length,
    fileTypeTotalCountLabel: formatInventoryCount(analysis.fileCount),
    fileTypeTotalSizeLabel: formatByteSize(analysis.knownSizeBytes),
    busyFolders,
    busyFolderCount: foldersWithDirectFiles.length,
    busyFoldersEmpty: busyFolders.length === 0 ? EMPTY_BUSY_FOLDERS : null,
    emptyFolders: analysis.emptyFolders.map((folder) => folderRow(folder, rootPath)),
    emptyFolderCount: analysis.emptyFolders.length,
    emptyFoldersEmpty: analysis.emptyFolders.length === 0 ? EMPTY_EMPTY_FOLDERS : null,
    unconfirmedFolders: analysis.unconfirmedEmptyLookingFolders.map((folder) => folderRow(folder, rootPath)),
    unconfirmedCount: analysis.unconfirmedEmptyLookingFolders.length,
    unconfirmedTitle: UNCONFIRMED_EMPTY_TITLE,
    unconfirmedHint: UNCONFIRMED_EMPTY_HINT,
    singleFileCount: analysis.singleDirectFileFolders.length,
    singleFileFolders: analysis.singleDirectFileFolders.map((folder) => folderRow(folder, rootPath)),
    singleFileEmpty:
      analysis.singleDirectFileFolders.length === 0 ? EMPTY_SINGLE_FILE_FOLDERS : null,
    repeatedFolders: nameGroups(analysis.repeatedFolderNames, rootPath),
    repeatedFolderCount: analysis.repeatedFolderNames.length,
    repeatedFoldersEmpty: analysis.repeatedFolderNames.length === 0 ? EMPTY_REPEATED_FOLDERS : null,
    repeatedFiles: nameGroups(analysis.repeatedFileNames, rootPath),
    repeatedFileCount: analysis.repeatedFileNames.length,
    repeatedFilesEmpty: analysis.repeatedFileNames.length === 0 ? EMPTY_REPEATED_FILES : null,
    repeatedFilesHint: REPEATED_FILES_HINT,
    yearGroups,
    yearGroupCount: yearGroups.length,
    yearGroupsEmpty: yearGroups.length === 0 ? EMPTY_YEAR_STRUCTURES : null,
  };
}
