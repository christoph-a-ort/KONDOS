import { type DirectoryNode, type FileNode, type FsNode, type ScanResult, type ScanWarning } from "../model";
import { analyzeInventory } from "./inventoryAnalysis";
import { analyzeExactFolderFileStructures } from "./inventoryExactFolderFileStructure";
import { analyzeFileNameSyntax } from "./inventoryFileNameSyntax";
import { analyzeFileStructureContext } from "./inventoryFileStructureContext";
import { analyzeStructureContext } from "./inventoryStructureContext";
import {
  buildInventoryReportModel,
  createDefaultInventoryReportChapterSelection,
  INVENTORY_REPORT_CHAPTER_IDS,
  INVENTORY_REPORT_SCHEMA_VERSION,
  isInventoryReportChapterEnabled,
  setInventoryReportChapter,
  type InventoryReportModel,
} from "./inventoryReportModel";

function file(id: string, name: string, extras: Partial<FileNode> = {}): FileNode {
  return { id, name, path: id, depth: 1, kind: "file", ...extras };
}

function dir(
  id: string,
  name: string,
  children: FsNode[],
  extras: Partial<DirectoryNode> = {},
): DirectoryNode {
  return { id, name, path: id, depth: 0, kind: "directory", listing: "read", children, ...extras };
}

function warning(path: string, extras: Partial<ScanWarning> = {}): ScanWarning {
  return { path, code: "skipped", message: "Dateisystemverweis wird nicht gefolgt.", ...extras };
}

function resultOf(root: DirectoryNode, warnings: ScanWarning[] = []): ScanResult {
  return {
    root,
    warnings,
    stats: { directoryCount: 0, fileCount: 0, skippedCount: 0, durationMs: 0 },
  };
}

function assert(condition: boolean, label: string): asserts condition {
  if (!condition) {
    throw new Error(label);
  }
}

function buildReport(result: ScanResult, extras: { maxDepth?: number; scanId?: number; createdAtMs?: number } = {}) {
  const analysis = analyzeInventory(result);
  const structure = analyzeStructureContext(result);
  const fileStructure = analyzeFileStructureContext(result, structure);
  const fileNameSyntax = analyzeFileNameSyntax(fileStructure);
  const exactFolderStructures = analyzeExactFolderFileStructures(structure);
  return buildInventoryReportModel({
    result,
    analysis,
    structure,
    fileNameSyntax,
    exactFolderStructures,
    maxDepth: extras.maxDepth ?? 10,
    scanId: extras.scanId ?? 42,
    createdAtMs: extras.createdAtMs ?? 1_700_000_000_000,
  });
}

function assertJsonSerializable(model: InventoryReportModel): void {
  const json = JSON.stringify(model);
  assert(typeof json === "string" && json.length > 2, "json: stringify works");
  const parsed = JSON.parse(json) as InventoryReportModel;
  assert(parsed.meta.schemaVersion === model.meta.schemaVersion, "json: roundtrip schema");
  assert(!json.includes("[object Object]"), "json: no opaque objects");
}

function assertNoExoticValues(value: unknown, path: string): void {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "function") {
    throw new Error(`exotic function at ${path}`);
  }
  if (value instanceof Map || value instanceof Set) {
    throw new Error(`exotic collection at ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoExoticValues(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      assertNoExoticValues(child, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`exotic type at ${path}`);
}

export function runInventoryReportModelCheck(): void {
  const defaults = createDefaultInventoryReportChapterSelection();
  assert(INVENTORY_REPORT_CHAPTER_IDS.length === 14, "chapters: 14 ids");
  for (const id of INVENTORY_REPORT_CHAPTER_IDS) {
    assert(defaults[id] === true, `chapters: default enabled ${id}`);
  }
  const disabled = setInventoryReportChapter(defaults, "yearStructures", false);
  assert(defaults.yearStructures === true, "chapters: default not mutated");
  assert(disabled.yearStructures === false, "chapters: can disable one");
  assert(isInventoryReportChapterEnabled(disabled, "overview") === true, "chapters: others stay on");
  assert(isInventoryReportChapterEnabled(disabled, "yearStructures") === false, "chapters: disabled detected");

  const fixture = dir("X:/bestand", "bestand", [
    dir(
      "X:/bestand/A",
      "A",
      [
        file("X:/bestand/A/Rechnung_2024-01-15.pdf", "Rechnung_2024-01-15.pdf", {
          depth: 2,
          sizeBytes: 100,
        }),
        file("X:/bestand/A/Notiz.txt", "Notiz.txt", { depth: 2, sizeBytes: 10 }),
      ],
      { depth: 1 },
    ),
    dir(
      "X:/bestand/B",
      "B",
      [
        file("X:/bestand/B/Rechnung_2024-01-15.pdf", "Rechnung_2024-01-15.pdf", {
          depth: 2,
          sizeBytes: 90,
        }),
        file("X:/bestand/B/Notiz.docx", "Notiz.docx", { depth: 2, sizeBytes: 20 }),
      ],
      { depth: 1 },
    ),
    dir("X:/bestand/leer", "leer", [], { depth: 1 }),
    dir(
      "X:/bestand/einzeln",
      "einzeln",
      [file("X:/bestand/einzeln/allein.txt", "allein.txt", { depth: 2, sizeBytes: 3 })],
      { depth: 1 },
    ),
    dir(
      "X:/bestand/Jahre",
      "Jahre",
      [
        dir("X:/bestand/Jahre/2022", "2022", [], { depth: 2 }),
        dir("X:/bestand/Jahre/2023", "2023", [], { depth: 2 }),
        dir("X:/bestand/Jahre/2024", "2024", [], { depth: 2 }),
      ],
      { depth: 1 },
    ),
    dir(
      "X:/bestand/stem",
      "stem",
      [
        file("X:/bestand/stem/Protokoll.pdf", "Protokoll.pdf", { depth: 2, sizeBytes: 1 }),
        file("X:/bestand/stem/Protokoll.docx", "Protokoll.docx", { depth: 2, sizeBytes: 2 }),
      ],
      { depth: 1 },
    ),
  ]);

  const junction = dir("X:/bestand/junction", "junction", [], { depth: 1 });
  fixture.children.push(junction);
  const scan = resultOf(fixture, [warning("X:/bestand/junction")]);

  const analysisBefore = JSON.stringify(analyzeInventory(scan));
  const structureBefore = JSON.stringify(analyzeStructureContext(scan));
  const model = buildReport(scan, { maxDepth: 10, scanId: 7, createdAtMs: 1_700_000_000_123 });
  const analysisAfter = JSON.stringify(analyzeInventory(scan));
  const structureAfter = JSON.stringify(analyzeStructureContext(scan));
  assert(analysisBefore === analysisAfter, "inputs: analysis not mutated");
  assert(structureBefore === structureAfter, "inputs: structure not mutated");

  assert(model.meta.schemaVersion === INVENTORY_REPORT_SCHEMA_VERSION, "meta: schema");
  assert(model.meta.createdAtMs === 1_700_000_000_123, "meta: createdAt");
  assert(model.meta.rootPath === "X:/bestand", "meta: absolute root");
  assert(model.meta.rootName === "bestand", "meta: root name");
  assert(model.meta.maxDepth === 10, "meta: maxDepth");
  assert(model.meta.scanId === 7, "meta: scanId");
  assert(model.meta.maxObservedDepth >= 1, "meta: observed depth");

  for (const id of INVENTORY_REPORT_CHAPTER_IDS) {
    assert(model.chapterSelection[id] === true, `selection default ${id}`);
  }

  assert(model.chapters.overview.fileCount >= 7, "overview: files");
  assert(model.chapters.overview.directoryCount >= 8, "overview: folders");
  assert(model.chapters.overview.knownSizeBytes > 0, "overview: known size");
  assert(model.chapters.overview.subdirectoryCount === model.chapters.overview.directoryCount - 1, "overview: subdirs");

  assert(model.chapters.fileTypes.some((row) => row.extension === ".pdf"), "types: pdf");
  assert(model.chapters.fileTypes.length >= 1, "types: present");
  assert(model.chapters.fileTypes.every((row) => typeof row.knownSizeBytes === "number"), "types: sizes");

  assert(model.chapters.folders.length === model.chapters.overview.directoryCount, "folders: full occupancy");
  assert(model.chapters.folders.every((row) => !row.relativePath.includes("X:/")), "folders: relative paths");
  assert(model.chapters.emptyFolders.some((row) => row.name === "leer"), "empty: leer");
  assert(model.chapters.emptyFolders.every((row) => !row.relativePath.startsWith("X:")), "empty: relative");

  const single = model.chapters.singleFileFolders.find((row) => row.folderName === "einzeln");
  assert(single !== undefined, "single: einzeln present");
  assert(single.fileName === "allein.txt", "single: file name");
  assert(single.extension === ".txt", "single: extension");

  assert(model.chapters.unreadable.warnings.length === 1, "unreadable: warning");
  assert(model.chapters.unreadable.warnings[0]?.code === "skipped", "unreadable: code");
  assert(
    model.chapters.unreadable.unconfirmedEmptyLookingFolders.some((row) => row.name === "junction"),
    "unreadable: unconfirmed empty-looking",
  );

  const repeatedFile = model.chapters.repeatedFileNames.find((group) => group.name === "Rechnung_2024-01-15.pdf");
  assert(repeatedFile !== undefined && repeatedFile.count === 2, "repeated files: count");
  assert(repeatedFile.relativePaths.length === 2, "repeated files: all paths");
  assert(repeatedFile.relativePaths.every((path) => !path.startsWith("X:")), "repeated files: relative");

  assert(model.chapters.yearStructures.length >= 1, "years: group present");
  const years = model.chapters.yearStructures[0]!;
  assert(years.years.includes(2022) && years.years.includes(2024), "years: values");
  assert(years.yearFolders.length === 3, "years: all occurrences");
  assert(years.yearFolders.every((row) => !row.relativePath.startsWith("X:")), "years: relative");

  assert(model.chapters.fileNamePatterns.analyzedFileCount >= 7, "patterns: analyzed");
  assert(model.chapters.fileNamePatterns.filesWithDigits >= 1, "patterns: digits");
  assert(model.chapters.fileNamePatterns.filesWithRecognizedDateForms >= 1, "patterns: dates");
  assert(
    model.chapters.fileNamePatterns.dateFormGroups.some(
      (row) => row.format === "YYYY-MM-DD" && row.matchCount >= 1,
    ),
    "patterns: date form group",
  );
  assert(model.chapters.fileNamePatterns.sixDigitHint.length > 0, "patterns: six-digit hint");

  assert(model.chapters.sameFileStems.some((group) => group.normalizedStem.includes("protokoll")), "stems: protokoll");
  const stem = model.chapters.sameFileStems.find((group) => group.occurrenceCount >= 2);
  assert(stem !== undefined && stem.occurrences.length >= 2, "stems: all occurrences");
  assert(stem.occurrences.every((item) => !String(item.relativePath).startsWith("X:")), "stems: relative");

  assert(model.chapters.exactFileNameStructures.length >= 0, "exact names: modeled");
  assert(model.chapters.extensionDistributions.length >= 0, "extensions: modeled");
  // A and B share same extension multiset (.pdf + .docx/.txt differ) — at least exact names or multisets exist as arrays
  assert(Array.isArray(model.chapters.exactFileNameStructures), "exact names: array");
  assert(Array.isArray(model.chapters.extensionDistributions), "extensions: array");

  assert(model.chapters.interpretation.notes.length >= 3, "interpretation: notes");
  assert(
    model.chapters.interpretation.notes.some((note) => note.toLocaleLowerCase().includes("keine bewertung")),
    "interpretation: neutral",
  );
  assert(
    model.chapters.interpretation.notes.some((note) =>
      note.includes("keine Lösch-, Verschiebe- oder Bereinigungsempfehlung"),
    ),
    "interpretation: explicitly no cleanup recommendation",
  );

  const withDisabled = buildInventoryReportModel({
    result: scan,
    analysis: analyzeInventory(scan),
    structure: analyzeStructureContext(scan),
    fileNameSyntax: analyzeFileNameSyntax(
      analyzeFileStructureContext(scan, analyzeStructureContext(scan)),
    ),
    exactFolderStructures: analyzeExactFolderFileStructures(analyzeStructureContext(scan)),
    chapterSelection: disabled,
    createdAtMs: 1,
  });
  assert(withDisabled.chapterSelection.yearStructures === false, "disabled: selection stored");
  assert(withDisabled.chapters.yearStructures.length >= 1, "disabled: data still present");
  assert(withDisabled.chapters.overview.fileCount === model.chapters.overview.fileCount, "disabled: other data kept");

  const folderPaths = model.chapters.folders.map((row) => row.relativePath);
  assert(
    folderPaths.slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })).join("|") ===
      folderPaths.join("|"),
    "sort: folders deterministic relativePath",
  );

  assertJsonSerializable(model);
  assertNoExoticValues(model, "model");
  assert(model.meta.rootPath.startsWith("X:/"), "synthetic fixture root only");
}
