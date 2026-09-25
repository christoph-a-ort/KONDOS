import type { ScanResult, ScanWarning } from "../model";
import type { InventoryAnalysis, InventoryNodeRef } from "./inventoryAnalysis";
import type {
  ExactDirectFileNameStructureGroup,
  ExactExtensionMultisetGroup,
  InventoryExactFolderFileStructureContext,
} from "./inventoryExactFolderFileStructure";
import type {
  DatePatternFormat,
  InventoryFileNameSyntaxContext,
  SameStemDifferentExtensionsGroup,
} from "./inventoryFileNameSyntax";
import {
  DATE_FORM_DISPLAY_LABELS,
  DATE_FORM_ORDER,
  DATE_FORMS_HINT,
  EXTENSION_MULTISET_HINT,
  PATTERN_OBSERVATION_HINT,
  SIX_DIGIT_HINT,
} from "./inventoryPatternOverview";
import { displayInventoryPath, REPEATED_FILES_HINT } from "./inventoryOverview";
import type { InventoryStructureContext, YearFolderGroup } from "./inventoryStructureContext";

/**
 * Format-independent IST report model (R1).
 *
 * Aggregates existing ScanResult + authoritative inventory contexts.
 * No filesystem I/O, no PDF/XLSX, no UI.
 *
 * Semantics:
 * - Model always carries the full data basis.
 * - chapterSelection marks which chapters later exporters should include.
 * - Deactivated chapters remain in `chapters` data (no rebuild required for PDF/XLSX).
 */

export const INVENTORY_REPORT_SCHEMA_VERSION = 1;

export const INVENTORY_REPORT_CHAPTER_IDS = [
  "overview",
  "fileTypes",
  "folders",
  "emptyFolders",
  "singleFileFolders",
  "unreadable",
  "repeatedFolderNames",
  "repeatedFileNames",
  "yearStructures",
  "fileNamePatterns",
  "sameFileStems",
  "exactFileNameStructures",
  "extensionDistributions",
  "interpretation",
] as const;

export type InventoryReportChapterId = (typeof INVENTORY_REPORT_CHAPTER_IDS)[number];

export type InventoryReportChapterSelection = {
  [K in InventoryReportChapterId]: boolean;
};

export interface InventoryReportMeta {
  schemaVersion: number;
  createdAtMs: number;
  rootPath: string;
  rootName: string;
  maxDepth: number | null;
  scanId: number | null;
  maxObservedDepth: number;
}

export interface InventoryReportOverview {
  directoryCount: number;
  fileCount: number;
  knownSizeBytes: number;
  filesWithoutKnownSize: number;
  depthLimitedFolderCount: number;
  subdirectoryCount: number;
}

export interface InventoryReportFileTypeRow {
  extension: string;
  label: string;
  fileCount: number;
  knownSizeBytes: number;
}

export interface InventoryReportFolderRow {
  name: string;
  relativePath: string;
  depth: number;
  listing: string;
  directFileCount: number;
  directDirectoryCount: number;
  directKnownSizeBytes: number;
}

export interface InventoryReportPathRow {
  name: string;
  relativePath: string;
}

export interface InventoryReportSingleFileFolderRow {
  folderName: string;
  relativePath: string;
  fileName: string;
  extension: string;
}

export interface InventoryReportWarningRow {
  relativePath: string;
  code: string;
  message: string;
}

export interface InventoryReportNameGroup {
  name: string;
  count: number;
  relativePaths: string[];
}

export interface InventoryReportYearStructure {
  parentRelativePath: string;
  parentName: string;
  years: number[];
  minYear: number;
  maxYear: number;
  missingYears: number[];
  consecutiveRuns: { start: number; end: number }[];
  yearFolders: { year: number; relativePath: string; name: string }[];
}

export interface InventoryReportFileNamePatterns {
  analyzedFileCount: number;
  filesWithDigits: number;
  filesWithLeadingDigits: number;
  filesWithRecognizedDateForms: number;
  filesWithSixDigitBlocks: number;
  dateFormGroups: {
    format: DatePatternFormat;
    label: string;
    matchCount: number;
  }[];
  sixDigitHint: string;
  dateFormsHint: string;
}

export interface InventoryReportSameStemGroup {
  normalizedStem: string;
  observedStemForms: string[];
  extensionKeys: string[];
  occurrenceCount: number;
  occurrences: {
    relativePath: string;
    filename: string;
    extensionKey: string;
  }[];
}

export interface InventoryReportExactNameStructureGroup {
  signature: string;
  directFileNames: string[];
  directFileCount: number;
  folderCount: number;
  folders: { relativePath: string; name: string; depth: number }[];
}

export interface InventoryReportExtensionDistributionGroup {
  signature: string;
  extensionCounts: { extensionKey: string; count: number }[];
  directFileCount: number;
  folderCount: number;
  folders: { relativePath: string; name: string; depth: number }[];
  hint: string;
}

export interface InventoryReportInterpretation {
  notes: string[];
}

export interface InventoryReportChapters {
  overview: InventoryReportOverview;
  fileTypes: InventoryReportFileTypeRow[];
  folders: InventoryReportFolderRow[];
  emptyFolders: InventoryReportPathRow[];
  singleFileFolders: InventoryReportSingleFileFolderRow[];
  unreadable: {
    warnings: InventoryReportWarningRow[];
    unconfirmedEmptyLookingFolders: InventoryReportPathRow[];
  };
  repeatedFolderNames: InventoryReportNameGroup[];
  repeatedFileNames: InventoryReportNameGroup[];
  yearStructures: InventoryReportYearStructure[];
  fileNamePatterns: InventoryReportFileNamePatterns;
  sameFileStems: InventoryReportSameStemGroup[];
  exactFileNameStructures: InventoryReportExactNameStructureGroup[];
  extensionDistributions: InventoryReportExtensionDistributionGroup[];
  interpretation: InventoryReportInterpretation;
}

export interface InventoryReportModel {
  meta: InventoryReportMeta;
  chapterSelection: InventoryReportChapterSelection;
  chapters: InventoryReportChapters;
}

export interface InventoryReportBuildInput {
  result: ScanResult;
  analysis: InventoryAnalysis;
  structure: InventoryStructureContext;
  fileNameSyntax: InventoryFileNameSyntaxContext;
  exactFolderStructures: InventoryExactFolderFileStructureContext;
  /** Scan config max depth when known; not part of ScanResult. */
  maxDepth?: number | null;
  /** Active scan id when known; not part of ScanResult. */
  scanId?: number | null;
  createdAtMs?: number;
  chapterSelection?: InventoryReportChapterSelection;
}

export function createDefaultInventoryReportChapterSelection(): InventoryReportChapterSelection {
  const selection = {} as InventoryReportChapterSelection;
  for (const id of INVENTORY_REPORT_CHAPTER_IDS) {
    selection[id] = true;
  }
  return selection;
}

export function setInventoryReportChapter(
  selection: InventoryReportChapterSelection,
  id: InventoryReportChapterId,
  enabled: boolean,
): InventoryReportChapterSelection {
  return { ...selection, [id]: enabled };
}

/** True when a later exporter should emit this chapter. */
export function isInventoryReportChapterEnabled(
  selection: InventoryReportChapterSelection,
  id: InventoryReportChapterId,
): boolean {
  return selection[id] === true;
}

/**
 * Build a JSON-serializable report model from existing analysis contexts.
 * Pure: no I/O, no mutation of inputs.
 */
export function buildInventoryReportModel(input: InventoryReportBuildInput): InventoryReportModel {
  const {
    result,
    analysis,
    structure,
    fileNameSyntax,
    exactFolderStructures,
  } = input;
  const rootPath = result.root.path;
  const chapterSelection = freezeSelection(
    input.chapterSelection ?? createDefaultInventoryReportChapterSelection(),
  );

  const folderByAbsPath = new Map(
    structure.folders.map((folder) => [normalizePathKey(folder.folder.path), folder]),
  );

  const meta: InventoryReportMeta = {
    schemaVersion: INVENTORY_REPORT_SCHEMA_VERSION,
    createdAtMs: input.createdAtMs ?? Date.now(),
    rootPath,
    rootName: result.root.name,
    maxDepth: input.maxDepth ?? null,
    scanId: input.scanId ?? null,
    maxObservedDepth: analysis.maxObservedDepth,
  };

  const overview: InventoryReportOverview = {
    directoryCount: analysis.directoryCount,
    fileCount: analysis.fileCount,
    knownSizeBytes: analysis.knownSizeBytes,
    filesWithoutKnownSize: analysis.filesWithoutKnownSize,
    depthLimitedFolderCount: analysis.depthLimitedFolderCount,
    subdirectoryCount: Math.max(0, analysis.directoryCount - 1),
  };

  const fileTypes: InventoryReportFileTypeRow[] = analysis.fileTypes.map((row) => ({
    extension: row.extension,
    label: row.label,
    fileCount: row.fileCount,
    knownSizeBytes: row.knownSizeBytes,
  }));

  const folders: InventoryReportFolderRow[] = analysis.folderOccupancy
    .map((folder) => ({
      name: folder.name,
      relativePath: relativeReportPath(rootPath, folder.path),
      depth: folder.depth,
      listing: folder.listing,
      directFileCount: folder.directFileCount,
      directDirectoryCount: folder.directDirectoryCount,
      directKnownSizeBytes: folder.directKnownSizeBytes,
    }))
    .sort((left, right) => compareText(left.relativePath, right.relativePath));

  const emptyFolders = analysis.emptyFolders.map((node) => pathRow(rootPath, node));
  const singleFileFolders = analysis.singleDirectFileFolders.map((node) =>
    singleFileFolderRow(rootPath, node, folderByAbsPath),
  );

  const unreadable = {
    warnings: result.warnings.map((warning) => warningRow(rootPath, warning)),
    unconfirmedEmptyLookingFolders: analysis.unconfirmedEmptyLookingFolders.map((node) =>
      pathRow(rootPath, node),
    ),
  };

  const repeatedFolderNames = analysis.repeatedFolderNames.map((group) => nameGroup(rootPath, group.name, group.count, group.paths));
  const repeatedFileNames = analysis.repeatedFileNames.map((group) => nameGroup(rootPath, group.name, group.count, group.paths));

  const yearStructures = structure.yearGroups.map((group) => yearStructureRow(rootPath, group));

  const fileNamePatterns = buildFileNamePatterns(fileNameSyntax);
  const sameFileStems = fileNameSyntax.sameStemDifferentExtensions.map((group) => sameStemGroup(group));
  const exactFileNameStructures = exactFolderStructures.exactDirectFileNameStructures.map((group) =>
    exactNameGroup(group),
  );
  const extensionDistributions = exactFolderStructures.exactExtensionMultisets.map((group) =>
    extensionGroup(group),
  );

  const interpretation: InventoryReportInterpretation = {
    notes: [
      PATTERN_OBSERVATION_HINT,
      REPEATED_FILES_HINT,
      DATE_FORMS_HINT,
      SIX_DIGIT_HINT,
      EXTENSION_MULTISET_HINT,
      "Eine auffällige Zahl oder Struktur ist für Dotty zunächst ein Hinweis, aber noch keine Bewertung.",
      "Gleiche Namen bedeuten nicht automatisch gleiche Inhalte.",
      "Wiederkehrende Strukturen sind Beobachtungen und keine Lösch-, Verschiebe- oder Bereinigungsempfehlung.",
    ],
  };

  return {
    meta,
    chapterSelection,
    chapters: {
      overview,
      fileTypes,
      folders,
      emptyFolders,
      singleFileFolders,
      unreadable,
      repeatedFolderNames,
      repeatedFileNames,
      yearStructures,
      fileNamePatterns,
      sameFileStems,
      exactFileNameStructures,
      extensionDistributions,
      interpretation,
    },
  };
}

function freezeSelection(selection: InventoryReportChapterSelection): InventoryReportChapterSelection {
  const next = createDefaultInventoryReportChapterSelection();
  for (const id of INVENTORY_REPORT_CHAPTER_IDS) {
    next[id] = selection[id] === true;
  }
  return next;
}

function relativeReportPath(rootAbs: string, abs: string): string {
  return displayInventoryPath(rootAbs, abs);
}

function pathRow(rootPath: string, node: InventoryNodeRef): InventoryReportPathRow {
  return {
    name: node.name,
    relativePath: relativeReportPath(rootPath, node.path),
  };
}

function singleFileFolderRow(
  rootPath: string,
  node: InventoryNodeRef,
  folderByAbsPath: Map<string, { childFiles: InventoryNodeRef[] }>,
): InventoryReportSingleFileFolderRow {
  const folder = folderByAbsPath.get(normalizePathKey(node.path));
  const file = folder?.childFiles[0];
  const fileName = file?.name ?? "";
  const extension = fileName.includes(".")
    ? fileName.slice(fileName.lastIndexOf(".")).toLocaleLowerCase()
    : "";
  return {
    folderName: node.name,
    relativePath: relativeReportPath(rootPath, node.path),
    fileName,
    extension,
  };
}

function warningRow(rootPath: string, warning: ScanWarning): InventoryReportWarningRow {
  return {
    relativePath: relativeReportPath(rootPath, warning.path),
    code: warning.code,
    message: warning.message,
  };
}

function nameGroup(
  rootPath: string,
  name: string,
  count: number,
  paths: readonly string[],
): InventoryReportNameGroup {
  return {
    name,
    count,
    relativePaths: paths.map((path) => relativeReportPath(rootPath, path)),
  };
}

function yearStructureRow(rootPath: string, group: YearFolderGroup): InventoryReportYearStructure {
  return {
    parentRelativePath: group.parentRelativePath,
    parentName: group.parent.name,
    years: group.years.slice(),
    minYear: group.minYear,
    maxYear: group.maxYear,
    missingYears: group.missingYears.slice(),
    consecutiveRuns: group.consecutiveRuns.map((run) => ({ start: run.start, end: run.end })),
    yearFolders: group.yearFolders.map((entry) => ({
      year: entry.year,
      relativePath: relativeReportPath(rootPath, entry.folder.path),
      name: entry.folder.name,
    })),
  };
}

function buildFileNamePatterns(syntax: InventoryFileNameSyntaxContext): InventoryReportFileNamePatterns {
  let filesWithDigits = 0;
  let filesWithLeadingDigits = 0;
  let filesWithRecognizedDateForms = 0;
  let filesWithSixDigitBlocks = 0;
  const dateFormCounts: Record<DatePatternFormat, number> = {
    "YYYY-MM-DD": 0,
    YYYY_MM_DD: 0,
    YYYYMMDD: 0,
  };

  for (const file of syntax.files) {
    if (file.digitBlockCount > 0) {
      filesWithDigits += 1;
    }
    if (file.leadingDigitBlock !== null) {
      filesWithLeadingDigits += 1;
    }
    if (file.datePatterns.length > 0) {
      filesWithRecognizedDateForms += 1;
    }
    if (file.sixDigitBlocks.length > 0) {
      filesWithSixDigitBlocks += 1;
    }
    for (const match of file.datePatterns) {
      dateFormCounts[match.format] += 1;
    }
  }

  return {
    analyzedFileCount: syntax.files.length,
    filesWithDigits,
    filesWithLeadingDigits,
    filesWithRecognizedDateForms,
    filesWithSixDigitBlocks,
    dateFormGroups: DATE_FORM_ORDER.map((format) => ({
      format,
      label: DATE_FORM_DISPLAY_LABELS[format],
      matchCount: dateFormCounts[format],
    })),
    sixDigitHint: SIX_DIGIT_HINT,
    dateFormsHint: DATE_FORMS_HINT,
  };
}

function sameStemGroup(group: SameStemDifferentExtensionsGroup): InventoryReportSameStemGroup {
  return {
    normalizedStem: group.normalizedStem,
    observedStemForms: group.observedStemForms.slice(),
    extensionKeys: group.extensionKeys.slice(),
    occurrenceCount: group.occurrenceCount,
    occurrences: group.occurrences.map((item) => ({
      relativePath: item.relativePath ?? item.path,
      filename: item.filename,
      extensionKey: item.extensionKey,
    })),
  };
}

function exactNameGroup(group: ExactDirectFileNameStructureGroup): InventoryReportExactNameStructureGroup {
  return {
    signature: group.signature,
    directFileNames: group.directFileNames.slice(),
    directFileCount: group.directFileCount,
    folderCount: group.folderCount,
    folders: group.folders.map((folder) => ({
      relativePath: folder.relativePath,
      name: folder.folder.name,
      depth: folder.depth,
    })),
  };
}

function extensionGroup(group: ExactExtensionMultisetGroup): InventoryReportExtensionDistributionGroup {
  return {
    signature: group.signature,
    extensionCounts: group.extensionCounts.map((item) => ({
      extensionKey: item.extensionKey,
      count: item.count,
    })),
    directFileCount: group.directFileCount,
    folderCount: group.folderCount,
    folders: group.folders.map((folder) => ({
      relativePath: folder.relativePath,
      name: folder.folder.name,
      depth: folder.depth,
    })),
    hint: EXTENSION_MULTISET_HINT,
  };
}

function normalizePathKey(path: string): string {
  return path.replace(/\\/g, "/").toLocaleLowerCase();
}

function compareText(left: string, right: string): number {
  const order = left.localeCompare(right, undefined, { sensitivity: "base" });
  if (order !== 0) {
    return order;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}
