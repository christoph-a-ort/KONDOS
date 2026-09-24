import { type DirectoryNode, type FileNode, type FsNode, type ScanResult } from "../model";
import { NO_EXTENSION_KEY } from "./displayFilter";
import { analyzeFileStructureContext } from "./inventoryFileStructureContext";
import {
  analyzeFileNameSyntax,
  isValidCalendarDate,
  stemFromFilename,
  type FileNameSyntax,
  type InventoryFileNameSyntaxContext,
} from "./inventoryFileNameSyntax";
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

function syntaxTree(children: FsNode[]): InventoryFileNameSyntaxContext {
  const scan = resultOf(dir("C:/docs", "docs", children));
  const structure = analyzeStructureContext(scan);
  const files = analyzeFileStructureContext(scan, structure);
  return analyzeFileNameSyntax(files);
}

function syntaxOf(name: string, path = `C:/docs/${name}`): FileNameSyntax {
  const context = syntaxTree([file(path, name, { depth: 1 })]);
  const item = context.files.find((entry) => entry.path === path);
  assert(item !== undefined, `missing syntax for ${path}`);
  return item;
}

function syntaxByPath(context: InventoryFileNameSyntaxContext, path: string): FileNameSyntax {
  const item = context.files.find((entry) => entry.path === path);
  assert(item !== undefined, `missing syntax for ${path}`);
  return item;
}

export function runInventoryFileNameSyntaxCheck(): void {
  // A: stem / extension
  const a1 = stemFromFilename("test.pdf");
  assert(a1.stem === "test" && a1.extensionKey === ".pdf" && a1.hasExtension === true, "A1: test.pdf");

  const a2 = stemFromFilename("archiv.tar.gz");
  assert(a2.stem === "archiv.tar" && a2.extensionKey === ".gz" && a2.hasExtension === true, "A2: archiv.tar.gz");

  const a3 = stemFromFilename("README");
  assert(a3.stem === "README" && a3.extensionKey === NO_EXTENSION_KEY && a3.hasExtension === false, "A3: no extension");

  const a4 = stemFromFilename("Doc.PDF");
  assert(a4.extensionKey === ".pdf" && a4.stem === "Doc", "A4: extension case");

  const a5 = stemFromFilename(".gitignore");
  assert(a5.hasExtension === false && a5.stem === ".gitignore" && a5.extensionKey === NO_EXTENSION_KEY, "A5: leading dot");

  // B: digit blocks
  const b1 = syntaxOf("ABC_123_0045.txt");
  assert(b1.digitBlockCount === 2, "B1: two digit blocks");
  assert(b1.digitBlocks[0]?.value === "123" && b1.digitBlocks[0].startIndex === 4, "B1: 123");
  assert(b1.digitBlocks[1]?.value === "0045" && b1.digitBlocks[1].length === 4, "B1: 0045 keeps zeros");

  const b2 = syntaxOf("001_Rechnung.txt");
  assert(b2.leadingDigitBlock === "001", "B2: leading 001");

  const b3 = syntaxOf("A001_Rechnung.txt");
  assert(b3.leadingDigitBlock === null, "B3: no leading block");
  assert(b3.digitBlocks.some((item) => item.value === "001"), "B3: inner 001 still present");

  const b4 = syntaxOf("1234567.txt");
  assert(b4.digitBlockCount === 1 && b4.digitBlocks[0]?.value === "1234567", "B4: one 7-digit block");
  assert(b4.sixDigitBlocks.length === 0, "B4/D3: seven digits is not sixDigitBlock");

  const b5 = syntaxOf("007.txt");
  assert(b5.digitBlocks[0]?.value === "007", "B5: leading zeros stay string");

  const b6 = syntaxOf("12_34_56.txt");
  assert(b6.digitBlockCount === 3, "B6: three separated blocks");

  // C: dates
  assert(isValidCalendarDate(2024, 2, 29) === true, "C4 helper: leap day valid");
  assert(isValidCalendarDate(2025, 2, 29) === false, "C5 helper: leap day invalid");
  assert(isValidCalendarDate(2025, 13, 1) === false, "C6 helper: month 13");
  assert(isValidCalendarDate(2025, 4, 31) === false, "C7 helper: April 31");

  const c1 = syntaxOf("2025-03-17.txt");
  assert(c1.datePatterns.length === 1 && c1.datePatterns[0]?.format === "YYYY-MM-DD", "C1: YYYY-MM-DD");
  assert(c1.datePatterns[0]?.raw === "2025-03-17" && c1.datePatterns[0].year === 2025, "C1: fields");

  const c2 = syntaxOf("2025_03_17.txt");
  assert(c2.datePatterns[0]?.format === "YYYY_MM_DD" && c2.datePatterns[0].raw === "2025_03_17", "C2: YYYY_MM_DD");

  const c3 = syntaxOf("20250317.txt");
  assert(c3.datePatterns[0]?.format === "YYYYMMDD" && c3.datePatterns[0].raw === "20250317", "C3: YYYYMMDD");

  assert(syntaxOf("2024-02-29.txt").datePatterns.length === 1, "C4: 2024-02-29 valid");
  assert(syntaxOf("2025-02-29.txt").datePatterns.length === 0, "C5: 2025-02-29 invalid");
  assert(syntaxOf("2025-13-01.txt").datePatterns.length === 0, "C6: 2025-13-01 invalid");
  assert(syntaxOf("2025-04-31.txt").datePatterns.length === 0, "C7: 2025-04-31 invalid");

  const c8 = syntaxOf("Scan20250317Rechnung.txt");
  assert(c8.datePatterns.length === 1 && c8.datePatterns[0]?.raw === "20250317", "C8: Scan20250317Rechnung");

  const c9 = syntaxOf("Scan1202503179.txt");
  assert(c9.datePatterns.length === 0, "C9: no partial YYYYMMDD from longer digits");
  assert(c9.digitBlocks[0]?.value === "1202503179", "C9: one long digit block");

  const c10 = syntaxOf("2025-03-17_and_2024_01_02.txt");
  assert(c10.datePatterns.length === 2, "C10: two valid date patterns");
  assert(c10.datePatterns[0]?.startIndex < c10.datePatterns[1]?.startIndex, "C12: ordered by startIndex");

  const c11 = syntaxOf("2025-03-17_20250318.txt");
  assert(
    c11.datePatterns.some((item) => item.format === "YYYY-MM-DD") &&
      c11.datePatterns.some((item) => item.format === "YYYYMMDD"),
    "C11: separated and compact together",
  );

  // D: six-digit blocks
  const d1 = syntaxOf("250317.txt");
  assert(d1.sixDigitBlocks.length === 1 && d1.sixDigitBlocks[0]?.raw === "250317", "D1: 250317");

  const d2 = syntaxOf("ABC250317XYZ.txt");
  assert(d2.sixDigitBlocks.length === 1 && d2.sixDigitBlocks[0]?.raw === "250317", "D2: embedded six");

  const d4 = syntaxOf("012345.txt");
  assert(d4.sixDigitBlocks[0]?.raw === "012345", "D4: leading zero preserved");

  const d5 = syntaxOf("250317_260101.txt");
  assert(d5.sixDigitBlocks.length === 2, "D5: two six-digit blocks");
  assert(
    !JSON.stringify(d5).toLocaleLowerCase().includes("scandatum") &&
      !JSON.stringify(d5).toLocaleLowerCase().includes("belegdatum"),
    "D6: no date interpretation fields for sixDigitBlock",
  );

  // E: delimiters / tokens
  const e1 = syntaxOf("a_b.txt");
  assert(e1.delimiterCounts.some((item) => item.delimiter === "_" && item.count === 1), "E1: underscore");
  assert(e1.tokens.join(",") === "a,b", "E1: tokens");

  const e2 = syntaxOf("a-b.txt");
  assert(e2.delimiterCounts.some((item) => item.delimiter === "-" && item.count === 1), "E2: hyphen");

  const e3 = syntaxOf("a b.txt");
  assert(e3.delimiterCounts.some((item) => item.delimiter === " " && item.count === 1), "E3: space");

  const e4 = syntaxOf("a.b.c.txt");
  assert(e4.stem === "a.b.c", "E4: stem keeps dots");
  assert(e4.delimiterCounts.some((item) => item.delimiter === "." && item.count === 2), "E4: dots in stem");
  assert(e4.tokens.join(",") === "a,b,c", "E4: point tokens");

  const e5 = syntaxOf("2025-03-17_Rechnung final.txt");
  assert(e5.tokenCount === 5, "E5/E8: tokenCount");
  assert(e5.tokens.join(",") === "2025,03,17,Rechnung,final", "E5: combination tokens");
  assert(
    e5.delimiterCounts.find((item) => item.delimiter === "-")?.count === 2 &&
      e5.delimiterCounts.find((item) => item.delimiter === "_")?.count === 1 &&
      e5.delimiterCounts.find((item) => item.delimiter === " ")?.count === 1,
    "E5: delimiterCounts",
  );

  const e6 = syntaxOf("a__b--c  d.txt");
  assert(e6.tokens.join(",") === "a,b,c,d", "E6: no empty tokens");
  assert(e6.tokens.every((token) => token === token), "E7: original token spelling retained");

  // F: character features
  const f1 = syntaxOf("OnlyLetters.txt");
  assert(f1.hasAsciiLetters && !f1.hasAsciiDigits && f1.asciiLetterCount === 11, "F1: letters only");

  const f2 = syntaxOf("12345.txt");
  assert(!f2.hasAsciiLetters && f2.hasAsciiDigits && f2.asciiDigitCount === 5, "F2: digits only");

  const f3 = syntaxOf("A1.txt");
  assert(f3.asciiLetterCount === 1 && f3.asciiDigitCount === 1, "F3: mixed");

  const f4 = syntaxOf("A_1 B.txt");
  assert(f4.asciiLetterCount === 2 && f4.asciiDigitCount === 1, "F4: delimiters not letter/digit");
  assert(f4.otherCharacterCount === f4.stemLength - f4.asciiLetterCount - f4.asciiDigitCount, "F4: other");

  const f5 = syntaxOf("abc.txt");
  assert(f5.stemLength === 3, "F5: stemLength");

  // G: same stem / different extensions
  const g1 = syntaxTree([
    file("C:/docs/Bericht.pdf", "Bericht.pdf", { depth: 1 }),
    file("C:/docs/Bericht.docx", "Bericht.docx", { depth: 1 }),
  ]);
  assert(g1.sameStemDifferentExtensions.length === 1, "G1: Bericht.pdf + Bericht.docx");
  assert(g1.sameStemDifferentExtensions[0]?.normalizedStem === "bericht", "G1: normalizedStem");
  assert(
    g1.sameStemDifferentExtensions[0]?.extensionKeys.join(",") === ".docx,.pdf",
    "G9: extensionKeys sorted",
  );

  const g2 = syntaxTree([
    file("C:/docs/Bericht.pdf", "Bericht.pdf", { depth: 1 }),
    file("C:/docs/bericht.DOCX", "bericht.DOCX", { depth: 1 }),
  ]);
  assert(g2.sameStemDifferentExtensions.length === 1, "G2: case-insensitive stem");

  const g3 = syntaxTree([
    file("C:/docs/Bericht.pdf", "Bericht.pdf", { depth: 1 }),
    file("C:/docs/Bericht.PDF", "Bericht.PDF", { depth: 1 }),
  ]);
  assert(g3.sameStemDifferentExtensions.length === 0, "G3: same extension after case fold → no group");

  const g4 = syntaxTree([file("C:/docs/Bericht.pdf", "Bericht.pdf", { depth: 1 })]);
  assert(g4.sameStemDifferentExtensions.length === 0, "G4: single file → no group");

  const g5 = syntaxTree([
    file("C:/docs/Bericht.pdf", "Bericht.pdf", { depth: 1 }),
    file("C:/docs/AndererBericht.docx", "AndererBericht.docx", { depth: 1 }),
  ]);
  assert(g5.sameStemDifferentExtensions.length === 0, "G5: different stems");

  const g6 = syntaxTree([
    file("C:/docs/Bericht.pdf", "Bericht.pdf", { depth: 1 }),
    file("C:/docs/Bericht.docx", "Bericht.docx", { depth: 1 }),
    file("C:/docs/Bericht.txt", "Bericht.txt", { depth: 1 }),
  ]);
  assert(g6.sameStemDifferentExtensions[0]?.extensionKeys.length === 3, "G6: three extensions");

  const g7 = syntaxTree([
    file("C:/docs/A/Bericht.pdf", "Bericht.pdf", { depth: 2 }),
    file("C:/docs/B/Bericht.pdf", "Bericht.pdf", { depth: 2 }),
  ]);
  assert(g7.sameStemDifferentExtensions.length === 0, "G7: same extension twice → no group");

  const g8 = syntaxTree([
    file("C:/docs/Bericht", "Bericht", { depth: 1 }),
    file("C:/docs/Bericht.pdf", "Bericht.pdf", { depth: 1 }),
  ]);
  assert(g8.sameStemDifferentExtensions.length === 1, "G8: no-extension + .pdf same stem");
  assert(
    g8.sameStemDifferentExtensions[0]?.extensionKeys.includes(NO_EXTENSION_KEY) &&
      g8.sameStemDifferentExtensions[0]?.extensionKeys.includes(".pdf"),
    "G8: extension keys include empty and .pdf",
  );

  const gOrder = syntaxTree([
    dir(
      "C:/docs/Zed",
      "Zed",
      [file("C:/docs/Zed/Bericht.pdf", "Bericht.pdf", { depth: 2 })],
      { depth: 1 },
    ),
    dir(
      "C:/docs/Abel",
      "Abel",
      [file("C:/docs/Abel/Bericht.docx", "Bericht.docx", { depth: 2 })],
      { depth: 1 },
    ),
  ]);
  assert(
    gOrder.sameStemDifferentExtensions[0]?.occurrences
      .map((item) => item.relativePath)
      .join(",") === "Abel\\Bericht.docx,Zed\\Bericht.pdf",
    "G10: occurrences by relativePath",
  );

  const gGroups = syntaxTree([
    file("C:/docs/Zebra.pdf", "Zebra.pdf", { depth: 1 }),
    file("C:/docs/Zebra.docx", "Zebra.docx", { depth: 1 }),
    file("C:/docs/Alpha.pdf", "Alpha.pdf", { depth: 1 }),
    file("C:/docs/Alpha.txt", "Alpha.txt", { depth: 1 }),
  ]);
  assert(
    gGroups.sameStemDifferentExtensions.map((item) => item.normalizedStem).join(",") === "alpha,zebra",
    "G11: groups by normalizedStem",
  );

  // H: combinations
  const h1 = syntaxOf("2025-03-17_Rechnung_250317.pdf");
  assert(h1.stem === "2025-03-17_Rechnung_250317" && h1.extensionKey === ".pdf", "H1: stem/ext");
  assert(h1.datePatterns.some((item) => item.raw === "2025-03-17"), "H1: date pattern");
  assert(h1.sixDigitBlocks.some((item) => item.raw === "250317"), "H1: sixDigitBlock");
  assert(h1.digitBlockCount >= 4, "H1: digit blocks");
  assert(h1.tokenCount === 5, "H1: tokens");
  assert(h1.hasAsciiLetters && h1.hasAsciiDigits, "H1: character features");

  const h2 = syntaxOf("archiv.20250317.tar.gz");
  assert(h2.extensionKey === ".gz" && h2.stem === "archiv.20250317.tar", "H2: stem/ext");
  assert(h2.datePatterns.some((item) => item.raw === "20250317"), "H2: date in stem");
  assert(h2.tokens.includes("archiv") && h2.tokens.includes("20250317") && h2.tokens.includes("tar"), "H2: tokens");

  const h3 = syntaxOf("2025-03-17_Notiz");
  assert(h3.hasExtension === false && h3.datePatterns.length === 1, "H3: no-extension with date");

  const blob = JSON.stringify(h1).toLocaleLowerCase();
  assert(!blob.includes("rechnungdatum") && !blob.includes("belegdatum"), "H4: no semantic date claims");
  assert(!blob.includes("duplikat") && !blob.includes("kategorie"), "H4: no classification");
  assert(!blob.includes("unnötig") && !blob.includes("löschen") && !blob.includes("loeschen"), "H4: no action rating");

  const filesSorted = syntaxTree([
    dir("C:/docs/Zed", "Zed", [file("C:/docs/Zed/b.txt", "b.txt", { depth: 2 })], { depth: 1 }),
    dir("C:/docs/Abel", "Abel", [file("C:/docs/Abel/a.txt", "a.txt", { depth: 2 })], { depth: 1 }),
  ]);
  assert(
    filesSorted.files.map((item) => item.relativePath).join(",") === "Abel\\a.txt,Zed\\b.txt",
    "sort: files by relativePath",
  );

  assert(syntaxByPath(g1, "C:/docs/Bericht.pdf").path === "C:/docs/Bericht.pdf", "join: path retained");
}
