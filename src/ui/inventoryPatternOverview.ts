import { NO_EXTENSION_KEY } from "./displayFilter";
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
import { formatInventoryCount, sectionSummary } from "./inventoryOverview";

/**
 * UI view model for P1-M pattern observations in the IST overview.
 * Aggregates existing H1/H2 contexts only — no new analysis heuristics.
 */

export const SECTION_PATTERNS = "Muster";
export const SECTION_FILE_NAME_FEATURES = "Muster in Dateinamen";
export const SECTION_DATE_FORMS = "Im Dateinamen erkannte Datumsformen";
export const SECTION_SAME_STEM = "Gleicher Dateistamm mit unterschiedlichen Endungen";
export const SECTION_EXACT_FILE_NAMES = "Exakt gleiche direkte Dateinamensstrukturen";
export const SECTION_EXTENSION_MULTISETS = "Gleiche Endungsverteilungen";

export const PATTERN_OBSERVATION_HINT =
  "Dotty hat im eingelesenen Bestand wiederkehrende Strukturen und Muster erkannt. Die Angaben beschreiben den Bestand und stellen keine Bewertung dar.";

export const DATE_FORMS_HINT =
  "Syntaktische Formen im Dateinamen – keine Aussage zur fachlichen Bedeutung des Datums.";

/** Visible example labels only — not used by recognition logic. */
export const DATE_FORM_DISPLAY_LABELS: Record<DatePatternFormat, string> = {
  "YYYY-MM-DD": "2025-09-25 (JJJJ-MM-TT)",
  YYYY_MM_DD: "2025_09_25 (JJJJ_MM_TT)",
  YYYYMMDD: "20250925 (JJJJMMTT)",
};

export const SIX_DIGIT_HINT = "Sechsstellige Ziffernblöcke werden nicht als Datum gewertet.";

export const EXTENSION_MULTISET_HINT = "Gleiche Endungsverteilung bedeutet nicht gleichen Inhalt.";

export const EMPTY_DATE_FORMS = "Keine gültigen Datumsformen in Dateinamen erkannt.";
export const EMPTY_SAME_STEM = "Keine gleichen Dateistämme mit unterschiedlichen Endungen gefunden.";
export const EMPTY_EXACT_FILE_NAMES =
  "Keine mehrfach vorkommenden exakt gleichen direkten Dateinamensstrukturen gefunden.";
export const EMPTY_EXTENSION_MULTISETS =
  "Keine mehrfach vorkommenden gleichen Endungsverteilungen gefunden.";

export const NO_EXTENSION_DISPLAY = "ohne Endung";

export const DEFAULT_PATTERN_SECTION_OPEN = {
  patterns: false,
  dateForms: false,
  sameStem: false,
  exactFileNames: false,
  extensionMultisets: false,
} as const;

export const DATE_FORM_ORDER: readonly DatePatternFormat[] = [
  "YYYY-MM-DD",
  "YYYY_MM_DD",
  "YYYYMMDD",
];

export interface PatternFolderRow {
  name: string;
  path: string;
  pathLabel: string;
}

export interface PatternPathRow {
  path: string;
  pathLabel: string;
  filename: string;
  extensionLabel: string;
}

export interface PatternSameStemGroupView {
  key: string;
  stemLabel: string;
  extensionsLabel: string;
  occurrenceCount: number;
  occurrenceCountLabel: string;
  summary: string;
  occurrences: PatternPathRow[];
}

export interface PatternExactNameGroupView {
  key: string;
  folderCount: number;
  folderCountLabel: string;
  directFileCount: number;
  directFileCountLabel: string;
  fileNamesLabel: string;
  summary: string;
  folders: PatternFolderRow[];
}

export interface PatternExtensionMultisetGroupView {
  key: string;
  extensionsLabel: string;
  directFileCount: number;
  directFileCountLabel: string;
  folderCount: number;
  folderCountLabel: string;
  summary: string;
  folders: PatternFolderRow[];
}

export interface PatternDateFormRow {
  format: DatePatternFormat;
  label: string;
  count: number;
  countLabel: string;
}

export interface InventoryPatternOverviewView {
  available: boolean;
  title: string;
  observationHint: string;
  fileCount: number;
  fileCountLabel: string;
  filesWithDigitBlocks: number;
  filesWithDigitBlocksLabel: string;
  filesWithLeadingDigitBlock: number;
  filesWithLeadingDigitBlockLabel: string;
  filesWithDatePatterns: number;
  filesWithDatePatternsLabel: string;
  filesWithSixDigitBlocks: number;
  filesWithSixDigitBlocksLabel: string;
  sixDigitHint: string;
  dateForms: PatternDateFormRow[];
  dateFormMatchCount: number;
  dateFormsEmpty: string | null;
  dateFormsHint: string;
  sameStemGroups: PatternSameStemGroupView[];
  sameStemGroupCount: number;
  sameStemEmpty: string | null;
  sameStemTitle: string;
  exactNameGroups: PatternExactNameGroupView[];
  exactNameGroupCount: number;
  exactNameEmpty: string | null;
  exactNameTitle: string;
  extensionMultisetGroups: PatternExtensionMultisetGroupView[];
  extensionMultisetGroupCount: number;
  extensionMultisetFolderOccurrenceCount: number;
  extensionMultisetEmpty: string | null;
  extensionMultisetTitle: string;
  extensionMultisetHint: string;
}

const emptyView: InventoryPatternOverviewView = {
  available: false,
  title: SECTION_PATTERNS,
  observationHint: PATTERN_OBSERVATION_HINT,
  fileCount: 0,
  fileCountLabel: "",
  filesWithDigitBlocks: 0,
  filesWithDigitBlocksLabel: "",
  filesWithLeadingDigitBlock: 0,
  filesWithLeadingDigitBlockLabel: "",
  filesWithDatePatterns: 0,
  filesWithDatePatternsLabel: "",
  filesWithSixDigitBlocks: 0,
  filesWithSixDigitBlocksLabel: "",
  sixDigitHint: SIX_DIGIT_HINT,
  dateForms: DATE_FORM_ORDER.map((format) => ({
    format,
    label: DATE_FORM_DISPLAY_LABELS[format],
    count: 0,
    countLabel: formatInventoryCount(0),
  })),
  dateFormMatchCount: 0,
  dateFormsEmpty: EMPTY_DATE_FORMS,
  dateFormsHint: DATE_FORMS_HINT,
  sameStemGroups: [],
  sameStemGroupCount: 0,
  sameStemEmpty: EMPTY_SAME_STEM,
  sameStemTitle: sectionSummary(SECTION_SAME_STEM, 0),
  exactNameGroups: [],
  exactNameGroupCount: 0,
  exactNameEmpty: EMPTY_EXACT_FILE_NAMES,
  exactNameTitle: sectionSummary(SECTION_EXACT_FILE_NAMES, 0),
  extensionMultisetGroups: [],
  extensionMultisetGroupCount: 0,
  extensionMultisetFolderOccurrenceCount: 0,
  extensionMultisetEmpty: EMPTY_EXTENSION_MULTISETS,
  extensionMultisetTitle: sectionSummary(SECTION_EXTENSION_MULTISETS, 0),
  extensionMultisetHint: EXTENSION_MULTISET_HINT,
};

export function formatPatternExtensionLabel(extensionKey: string): string {
  if (extensionKey === NO_EXTENSION_KEY) {
    return NO_EXTENSION_DISPLAY;
  }
  return extensionKey;
}

export function formatPatternExtensionList(extensionKeys: readonly string[]): string {
  return extensionKeys.map(formatPatternExtensionLabel).join(" · ");
}

export function formatPatternExtensionCounts(
  counts: readonly { extensionKey: string; count: number }[],
): string {
  return counts
    .map((item) => `${formatPatternExtensionLabel(item.extensionKey)} × ${formatInventoryCount(item.count)}`)
    .join(" · ");
}

export function formatObservedStemLabel(forms: readonly string[], fallbackNormalized: string): string {
  if (forms.length > 0) {
    return forms.join(" · ");
  }
  return fallbackNormalized;
}

export function buildInventoryPatternOverviewView(
  exact: InventoryExactFolderFileStructureContext | null,
  syntax: InventoryFileNameSyntaxContext | null,
): InventoryPatternOverviewView {
  if (exact === null || syntax === null) {
    return emptyView;
  }

  let filesWithDigitBlocks = 0;
  let filesWithLeadingDigitBlock = 0;
  let filesWithDatePatterns = 0;
  let filesWithSixDigitBlocks = 0;
  const dateFormCounts: Record<DatePatternFormat, number> = {
    "YYYY-MM-DD": 0,
    YYYY_MM_DD: 0,
    YYYYMMDD: 0,
  };

  for (const file of syntax.files) {
    if (file.digitBlockCount > 0) {
      filesWithDigitBlocks += 1;
    }
    if (file.leadingDigitBlock !== null) {
      filesWithLeadingDigitBlock += 1;
    }
    if (file.datePatterns.length > 0) {
      filesWithDatePatterns += 1;
    }
    if (file.sixDigitBlocks.length > 0) {
      filesWithSixDigitBlocks += 1;
    }
    for (const match of file.datePatterns) {
      dateFormCounts[match.format] += 1;
    }
  }

  const dateForms = DATE_FORM_ORDER.map((format) => ({
    format,
    label: DATE_FORM_DISPLAY_LABELS[format],
    count: dateFormCounts[format],
    countLabel: formatInventoryCount(dateFormCounts[format]),
  }));
  const dateFormMatchCount = dateForms.reduce((sum, row) => sum + row.count, 0);

  const sameStemGroups = syntax.sameStemDifferentExtensions.map((group) => sameStemRow(group));
  const exactNameGroups = exact.exactDirectFileNameStructures.map((group) => exactNameRow(group));
  const extensionMultisetGroups = exact.exactExtensionMultisets.map((group) => extensionMultisetRow(group));
  const extensionMultisetFolderOccurrenceCount = extensionMultisetGroups.reduce(
    (sum, group) => sum + group.folderCount,
    0,
  );

  return {
    available: true,
    title: SECTION_PATTERNS,
    observationHint: PATTERN_OBSERVATION_HINT,
    fileCount: syntax.files.length,
    fileCountLabel: formatInventoryCount(syntax.files.length),
    filesWithDigitBlocks,
    filesWithDigitBlocksLabel: formatInventoryCount(filesWithDigitBlocks),
    filesWithLeadingDigitBlock,
    filesWithLeadingDigitBlockLabel: formatInventoryCount(filesWithLeadingDigitBlock),
    filesWithDatePatterns,
    filesWithDatePatternsLabel: formatInventoryCount(filesWithDatePatterns),
    filesWithSixDigitBlocks,
    filesWithSixDigitBlocksLabel: formatInventoryCount(filesWithSixDigitBlocks),
    sixDigitHint: SIX_DIGIT_HINT,
    dateForms,
    dateFormMatchCount,
    dateFormsEmpty: dateFormMatchCount === 0 ? EMPTY_DATE_FORMS : null,
    dateFormsHint: DATE_FORMS_HINT,
    sameStemGroups,
    sameStemGroupCount: sameStemGroups.length,
    sameStemEmpty: sameStemGroups.length === 0 ? EMPTY_SAME_STEM : null,
    sameStemTitle: sectionSummary(SECTION_SAME_STEM, sameStemGroups.length),
    exactNameGroups,
    exactNameGroupCount: exactNameGroups.length,
    exactNameEmpty: exactNameGroups.length === 0 ? EMPTY_EXACT_FILE_NAMES : null,
    exactNameTitle: sectionSummary(SECTION_EXACT_FILE_NAMES, exactNameGroups.length),
    extensionMultisetGroups,
    extensionMultisetGroupCount: extensionMultisetGroups.length,
    extensionMultisetFolderOccurrenceCount,
    extensionMultisetEmpty:
      extensionMultisetGroups.length === 0 ? EMPTY_EXTENSION_MULTISETS : null,
    extensionMultisetTitle: sectionSummary(SECTION_EXTENSION_MULTISETS, extensionMultisetGroups.length),
    extensionMultisetHint: EXTENSION_MULTISET_HINT,
  };
}

function sameStemRow(group: SameStemDifferentExtensionsGroup): PatternSameStemGroupView {
  const stemLabel = formatObservedStemLabel(group.observedStemForms, group.normalizedStem);
  const extensionsLabel = formatPatternExtensionList(group.extensionKeys);
  const occurrenceCountLabel = formatInventoryCount(group.occurrenceCount);
  return {
    key: group.normalizedStem,
    stemLabel,
    extensionsLabel,
    occurrenceCount: group.occurrenceCount,
    occurrenceCountLabel,
    summary: `${stemLabel} – ${extensionsLabel} (${occurrenceCountLabel} Vorkommen)`,
    occurrences: group.occurrences.map((item) => ({
      path: item.path,
      pathLabel: item.relativePath ?? item.filename,
      filename: item.filename,
      extensionLabel: formatPatternExtensionLabel(item.extensionKey),
    })),
  };
}

function exactNameRow(group: ExactDirectFileNameStructureGroup): PatternExactNameGroupView {
  const folderCountLabel = formatInventoryCount(group.folderCount);
  const directFileCountLabel = formatInventoryCount(group.directFileCount);
  const fileNamesLabel = group.directFileNames.join(" · ");
  return {
    key: group.signature,
    folderCount: group.folderCount,
    folderCountLabel,
    directFileCount: group.directFileCount,
    directFileCountLabel,
    fileNamesLabel,
    summary: `${folderCountLabel} Ordner · ${directFileCountLabel} Dateinamen`,
    folders: group.folders.map((item) => ({
      name: item.folder.name,
      path: item.folder.path,
      pathLabel: item.relativePath,
    })),
  };
}

function extensionMultisetRow(group: ExactExtensionMultisetGroup): PatternExtensionMultisetGroupView {
  const extensionsLabel = formatPatternExtensionCounts(group.extensionCounts);
  const folderCountLabel = formatInventoryCount(group.folderCount);
  const directFileCountLabel = formatInventoryCount(group.directFileCount);
  return {
    key: group.signature,
    extensionsLabel,
    directFileCount: group.directFileCount,
    directFileCountLabel,
    folderCount: group.folderCount,
    folderCountLabel,
    summary: `${extensionsLabel} – ${folderCountLabel} Ordner · ${directFileCountLabel} Dateien`,
    folders: group.folders.map((item) => ({
      name: item.folder.name,
      path: item.folder.path,
      pathLabel: item.relativePath,
    })),
  };
}

/** Visible H3 copy used by neutrality checks — not a whole-project word scan. */
export function inventoryPatternOverviewVisibleCopy(
  view: InventoryPatternOverviewView = emptyView,
): string {
  return [
    view.title,
    view.observationHint,
    SECTION_FILE_NAME_FEATURES,
    "Dateien analysiert",
    "Dateien mit Ziffernblöcken",
    "Dateien mit führendem Ziffernblock",
    "Dateien mit erkannten Datumsformen",
    "Dateien mit sechsstelligen Ziffernblöcken",
    view.sixDigitHint,
    SECTION_DATE_FORMS,
    view.dateFormsHint,
    view.dateFormsEmpty ?? "",
    ...DATE_FORM_ORDER.map((format) => DATE_FORM_DISPLAY_LABELS[format]),
    SECTION_SAME_STEM,
    view.sameStemEmpty ?? "",
    SECTION_EXACT_FILE_NAMES,
    view.exactNameEmpty ?? "",
    SECTION_EXTENSION_MULTISETS,
    view.extensionMultisetHint,
    view.extensionMultisetEmpty ?? "",
    NO_EXTENSION_DISPLAY,
    EMPTY_DATE_FORMS,
    EMPTY_SAME_STEM,
    EMPTY_EXACT_FILE_NAMES,
    EMPTY_EXTENSION_MULTISETS,
  ].join("\n");
}
