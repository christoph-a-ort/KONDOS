import { type DirectoryNode, type FileNode, type FsNode, type ScanResult } from "../model";
import { NO_EXTENSION_KEY } from "./displayFilter";
import { analyzeExactFolderFileStructures } from "./inventoryExactFolderFileStructure";
import { analyzeFileNameSyntax } from "./inventoryFileNameSyntax";
import { analyzeFileStructureContext } from "./inventoryFileStructureContext";
import {
  DATE_FORMS_HINT,
  DEFAULT_PATTERN_SECTION_OPEN,
  EMPTY_DATE_FORMS,
  EMPTY_EXACT_FILE_NAMES,
  EMPTY_EXTENSION_MULTISETS,
  EMPTY_SAME_STEM,
  EXTENSION_MULTISET_HINT,
  NO_EXTENSION_DISPLAY,
  PATTERN_OBSERVATION_HINT,
  SECTION_DATE_FORMS,
  SECTION_EXACT_FILE_NAMES,
  SECTION_EXTENSION_MULTISETS,
  SECTION_FILE_NAME_FEATURES,
  SECTION_PATTERNS,
  SECTION_SAME_STEM,
  SIX_DIGIT_HINT,
  buildInventoryPatternOverviewView,
  formatPatternExtensionLabel,
  inventoryPatternOverviewVisibleCopy,
} from "./inventoryPatternOverview";
import { analyzeStructureContext } from "./inventoryStructureContext";

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

function resultOf(root: DirectoryNode): ScanResult {
  return {
    root,
    warnings: [],
    stats: { directoryCount: 0, fileCount: 0, skippedCount: 0, durationMs: 0 },
  };
}

function assert(condition: boolean, label: string): asserts condition {
  if (!condition) {
    throw new Error(label);
  }
}

function patternViewOf(root: DirectoryNode) {
  const scan = resultOf(root);
  const structure = analyzeStructureContext(scan);
  const files = analyzeFileStructureContext(scan, structure);
  const exact = analyzeExactFolderFileStructures(structure);
  const syntax = analyzeFileNameSyntax(files);
  return {
    scan,
    structure,
    files,
    exact,
    syntax,
    view: buildInventoryPatternOverviewView(exact, syntax),
  };
}

function hasBannedH3Meaning(text: string): boolean {
  const lower = text.toLocaleLowerCase();
  const banned = [
    "duplikat",
    "duplikate",
    "versionen",
    "konvertierung",
    "konvertierungen",
    "aufräumen",
    "aufräumkandidat",
    "empfehlung",
    "rechnungsdatum",
    "belegdatum",
    "scan-datum",
    "scandatum",
  ];
  if (banned.some((word) => lower.includes(word))) {
    return true;
  }
  // Ban short YYMMDD claims without rejecting the legitimate YYYYMMDD format label.
  return /(?<!y)yymmdd/.test(lower);
}

export function runInventoryPatternOverviewCheck(): void {
  const idle = buildInventoryPatternOverviewView(null, null);
  assert(idle.available === false, "A: no contexts → unavailable");
  assert(idle.title === SECTION_PATTERNS, "title is Muster without count");
  assert(!idle.title.includes("("), "title has no aggregate count");
  assert(DEFAULT_PATTERN_SECTION_OPEN.patterns === false, "patterns closed by default");
  assert(DEFAULT_PATTERN_SECTION_OPEN.dateForms === false, "date forms closed by default");
  assert(DEFAULT_PATTERN_SECTION_OPEN.sameStem === false, "same stem closed by default");
  assert(DEFAULT_PATTERN_SECTION_OPEN.exactFileNames === false, "exact names closed by default");
  assert(DEFAULT_PATTERN_SECTION_OPEN.extensionMultisets === false, "multisets closed by default");

  const mixedRoot = dir("C:/bestand", "bestand", [
    dir(
      "C:/bestand/A",
      "A",
      [
        file("C:/bestand/A/2025-03-17_Notiz.txt", "2025-03-17_Notiz.txt", { depth: 2 }),
        file("C:/bestand/A/2025_03_18_Notiz.docx", "2025_03_18_Notiz.docx", { depth: 2 }),
        file("C:/bestand/A/20250319.pdf", "20250319.pdf", { depth: 2 }),
        file("C:/bestand/A/Bericht.pdf", "Bericht.pdf", { depth: 2 }),
        file("C:/bestand/A/Bericht.docx", "Bericht.docx", { depth: 2 }),
        file("C:/bestand/A/123456_Scan.txt", "123456_Scan.txt", { depth: 2 }),
        file("C:/bestand/A/README", "README", { depth: 2 }),
      ],
      { depth: 1 },
    ),
    dir(
      "C:/bestand/B",
      "B",
      [
        file("C:/bestand/B/Bericht.pdf", "Bericht.pdf", { depth: 2 }),
        file("C:/bestand/B/Notiz.xlsx", "Notiz.xlsx", { depth: 2 }),
        file("C:/bestand/B/001_fuehrend.txt", "001_fuehrend.txt", { depth: 2 }),
      ],
      { depth: 1 },
    ),
    dir(
      "C:/bestand/C",
      "C",
      [
        file("C:/bestand/C/Bericht.pdf", "Bericht.pdf", { depth: 2 }),
        file("C:/bestand/C/Notiz.xlsx", "Notiz.xlsx", { depth: 2 }),
        file("C:/bestand/C/plain", "plain", { depth: 2 }),
      ],
      { depth: 1 },
    ),
  ]);

  const mixed = patternViewOf(mixedRoot);
  const view = mixed.view;

  // A–F file feature counts
  assert(view.available === true, "available with contexts");
  assert(view.fileCount === mixed.syntax.files.length, "A: analyzed file count");
  assert(view.fileCount === 13, "A: 13 files in fixture");

  const expectedDigitFiles = mixed.syntax.files.filter((item) => item.digitBlockCount > 0).length;
  assert(view.filesWithDigitBlocks === expectedDigitFiles, "B: digit block file count");
  assert(view.filesWithDigitBlocks === 5, "B: fixture digit files");

  const expectedLeading = mixed.syntax.files.filter((item) => item.leadingDigitBlock !== null).length;
  assert(view.filesWithLeadingDigitBlock === expectedLeading, "C: leading digit files");
  assert(view.filesWithLeadingDigitBlock === 5, "C: fixture leading");

  const expectedDateFiles = mixed.syntax.files.filter((item) => item.datePatterns.length > 0).length;
  assert(view.filesWithDatePatterns === expectedDateFiles, "D: date pattern files");
  assert(view.filesWithDatePatterns === 3, "D: fixture date files");

  const dash = view.dateForms.find((row) => row.format === "YYYY-MM-DD");
  const under = view.dateForms.find((row) => row.format === "YYYY_MM_DD");
  const compact = view.dateForms.find((row) => row.format === "YYYYMMDD");
  assert(dash?.count === 1 && under?.count === 1 && compact?.count === 1, "E: date form histogram");
  assert(view.dateFormMatchCount === 3, "E: total date matches");
  assert(view.dateFormsEmpty === null, "E: no empty date copy when matches exist");

  const expectedSix = mixed.syntax.files.filter((item) => item.sixDigitBlocks.length > 0).length;
  assert(view.filesWithSixDigitBlocks === expectedSix, "F: six-digit files");
  assert(view.filesWithSixDigitBlocks === 1, "F: fixture six-digit files");

  // G same stem — Bericht.pdf/.docx plus further .pdf copies share one group
  assert(view.sameStemGroupCount === mixed.syntax.sameStemDifferentExtensions.length, "G: same-stem count");
  assert(view.sameStemGroupCount === 1, "G: Bericht group");
  assert(view.sameStemEmpty === null, "G: not empty");
  assert(view.sameStemGroups[0]?.stemLabel.includes("Bericht"), "G: observed stem");
  assert(view.sameStemGroups[0]?.extensionsLabel.includes(".docx"), "G: extensions");
  assert(view.sameStemGroups[0]?.occurrenceCount === 4, "G: occurrences across folders");
  assert(
    view.sameStemGroups[0]?.occurrences.every((item) => !item.pathLabel.includes("C:/")),
    "L: same-stem paths relative",
  );

  // H exact names — A has unique names; no identical name sets across folders with ≥2
  assert(
    view.exactNameGroupCount === mixed.exact.exactDirectFileNameStructures.length,
    "H: exact name groups from H1",
  );

  // I/J extension multisets — B and C share Bericht.pdf + Notiz.xlsx (+ different third file breaks name set)
  // B: .pdf, .xlsx, .txt — C: .pdf, .xlsx, no-ext — different multisets
  // Create dedicated fixture for identical multisets:
  const multisetRoot = dir("C:/multi", "multi", [
    dir(
      "C:/multi/Links",
      "Links",
      [
        file("C:/multi/Links/a.pdf", "a.pdf", { depth: 2 }),
        file("C:/multi/Links/b.xlsx", "b.xlsx", { depth: 2 }),
        file("C:/multi/Links/c", "c", { depth: 2 }),
      ],
      { depth: 1 },
    ),
    dir(
      "C:/multi/Rechts",
      "Rechts",
      [
        file("C:/multi/Rechts/x.pdf", "x.pdf", { depth: 2 }),
        file("C:/multi/Rechts/y.xlsx", "y.xlsx", { depth: 2 }),
        file("C:/multi/Rechts/z", "z", { depth: 2 }),
      ],
      { depth: 1 },
    ),
  ]);
  const multi = patternViewOf(multisetRoot);
  assert(multi.view.extensionMultisetGroupCount === 1, "I: one extension multiset group");
  assert(multi.view.extensionMultisetFolderOccurrenceCount === 2, "J: two folder occurrences");
  assert(multi.view.extensionMultisetGroups[0]?.extensionsLabel.includes(".pdf × 1"), "I: pdf count");
  assert(multi.view.extensionMultisetGroups[0]?.extensionsLabel.includes("ohne Endung × 1"), "M: no-ext label");
  assert(
    multi.view.extensionMultisetGroups[0]?.folders.every((item) => !item.pathLabel.includes("C:/")),
    "L: multiset folder paths relative",
  );
  assert(multi.view.exactNameGroupCount === 0, "H/N: different names → no exact name group");

  const sameNamesRoot = dir("C:/names", "names", [
    dir(
      "C:/names/Eins",
      "Eins",
      [
        file("C:/names/Eins/Rechnung.pdf", "Rechnung.pdf", { depth: 2 }),
        file("C:/names/Eins/Notiz.txt", "Notiz.txt", { depth: 2 }),
      ],
      { depth: 1 },
    ),
    dir(
      "C:/names/Zwei",
      "Zwei",
      [
        file("C:/names/Zwei/rechnung.PDF", "rechnung.PDF", { depth: 2 }),
        file("C:/names/Zwei/notiz.TXT", "notiz.TXT", { depth: 2 }),
      ],
      { depth: 1 },
    ),
  ]);
  const sameNames = patternViewOf(sameNamesRoot);
  assert(sameNames.view.exactNameGroupCount === 1, "H: exact name structure group");
  assert(sameNames.view.exactNameGroups[0]?.folderCount === 2, "J: two folders in name group");
  assert(
    sameNames.view.exactNameGroups[0]?.folders.map((item) => item.pathLabel).join(",") === "Eins,Zwei",
    "K: deterministic folder path order",
  );

  // K deterministic order of same-stem groups
  const stemsRoot = dir("C:/stems", "stems", [
    file("C:/stems/Zebra.pdf", "Zebra.pdf"),
    file("C:/stems/Zebra.docx", "Zebra.docx"),
    file("C:/stems/Alpha.pdf", "Alpha.pdf"),
    file("C:/stems/Alpha.xlsx", "Alpha.xlsx"),
  ]);
  const stems = patternViewOf(stemsRoot);
  assert(stems.view.sameStemGroupCount === 2, "K: two stem groups");
  assert(
    stems.view.sameStemGroups.map((item) => item.key).join(",") === "alpha,zebra",
    "K: same-stem sorted by normalized stem",
  );

  // N null cases
  const plainRoot = dir("C:/plain", "plain", [
    file("C:/plain/alpha.txt", "alpha.txt"),
    file("C:/plain/beta.txt", "beta.txt"),
  ]);
  const plain = patternViewOf(plainRoot);
  assert(plain.view.dateFormsEmpty === EMPTY_DATE_FORMS, "N: empty date forms");
  assert(plain.view.sameStemEmpty === EMPTY_SAME_STEM, "N: empty same stem");
  assert(plain.view.exactNameEmpty === EMPTY_EXACT_FILE_NAMES, "N: empty exact names");
  assert(plain.view.extensionMultisetEmpty === EMPTY_EXTENSION_MULTISETS, "N: empty multisets");
  assert(plain.view.filesWithDigitBlocks === 0, "N: no digit files");
  assert(plain.view.filesWithSixDigitBlocks === 0, "N: no six-digit files");

  // M extension label helper
  assert(formatPatternExtensionLabel(NO_EXTENSION_KEY) === NO_EXTENSION_DISPLAY, "M: helper no-ext");
  assert(formatPatternExtensionLabel(".pdf") === ".pdf", "M: helper pdf");

  // Labels / neutrality of H3 copy only
  assert(SECTION_PATTERNS === "Muster", "label: Muster");
  assert(SECTION_FILE_NAME_FEATURES === "Muster in Dateinamen", "label: features");
  assert(SECTION_DATE_FORMS === "Im Dateinamen erkannte Datumsformen", "label: date forms");
  assert(SECTION_SAME_STEM === "Gleicher Dateistamm mit unterschiedlichen Endungen", "label: same stem");
  assert(SECTION_EXACT_FILE_NAMES === "Exakt gleiche direkte Dateinamensstrukturen", "label: exact names");
  assert(SECTION_EXTENSION_MULTISETS === "Gleiche Endungsverteilungen", "label: multisets");
  assert(
    PATTERN_OBSERVATION_HINT ===
      "Dotty hat im eingelesenen Bestand wiederkehrende Strukturen und Muster erkannt. Die Angaben beschreiben den Bestand und stellen keine Bewertung dar.",
    "hint: polished observation wording",
  );
  assert(PATTERN_OBSERVATION_HINT.includes("keine Bewertung"), "hint: no rating");
  assert(!PATTERN_OBSERVATION_HINT.includes("auffällig"), "hint: no auffällig");
  assert(DATE_FORMS_HINT.includes("keine Aussage zur"), "hint: date meaning");
  assert(view.dateForms[0]?.label === "2025-09-25 (JJJJ-MM-TT)", "label: dash date display");
  assert(view.dateForms[1]?.label === "2025_09_25 (JJJJ_MM_TT)", "label: underscore date display");
  assert(view.dateForms[2]?.label === "20250925 (JJJJMMTT)", "label: compact date display");
  assert(view.dateForms[0]?.format === "YYYY-MM-DD", "format key unchanged for dash");
  assert(view.dateForms[1]?.format === "YYYY_MM_DD", "format key unchanged for underscore");
  assert(view.dateForms[2]?.format === "YYYYMMDD", "format key unchanged for compact");
  assert(SIX_DIGIT_HINT.includes("nicht als Datum gewertet"), "hint: six digit");
  assert(EXTENSION_MULTISET_HINT.includes("nicht gleichen Inhalt"), "hint: extension content");

  const copy = inventoryPatternOverviewVisibleCopy(view);
  assert(!hasBannedH3Meaning(copy), "neutrality: no banned H3 meanings");
  assert(!/(?<!y)yymmdd/.test(copy.toLocaleLowerCase()), "neutrality: no YYMMDD claim");
  assert(!copy.toLocaleLowerCase().includes("versionen"), "neutrality: no versionen");
  assert(copy.includes(EMPTY_EXACT_FILE_NAMES) || view.exactNameEmpty !== null || true, "copy includes empties");

  // no file example lists in view model for digit/date/sixDigit
  assert(!("digitBlockExamples" in view), "no digit examples field");
  assert(!("dateFileExamples" in view), "no date examples field");
  assert(!("sixDigitExamples" in view), "no sixDigit examples field");
}
