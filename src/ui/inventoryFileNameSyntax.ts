import { fileExtensionKey, NO_EXTENSION_KEY } from "./displayFilter";
import type {
  FileStructureContext,
  InventoryFileStructureContext,
} from "./inventoryFileStructureContext";

/**
 * Read-only syntactic file-name features (P1-M Häppchen 2).
 *
 * Observes how a file name is built — not what it means.
 * Digit blocks, date-like patterns, six-digit blocks, delimiters, and tokens
 * are structural observations only.
 *
 * Not in this slice: semantics, document types, similarity, hashing, content,
 * size/time comparison, SOLL, UI, or actions.
 * A six-digit block is not a date claim.
 */
export type DatePatternFormat = "YYYY-MM-DD" | "YYYY_MM_DD" | "YYYYMMDD";

export interface DigitBlock {
  value: string;
  startIndex: number;
  length: number;
}

export interface DatePatternMatch {
  raw: string;
  format: DatePatternFormat;
  startIndex: number;
  year: number;
  month: number;
  day: number;
}

export interface SixDigitBlock {
  raw: string;
  startIndex: number;
}

export interface DelimiterCount {
  delimiter: string;
  count: number;
}

export interface FileNameSyntax {
  path: string;
  relativePath: string | null;
  filename: string;
  extensionKey: string;
  hasExtension: boolean;
  stem: string;
  digitBlocks: DigitBlock[];
  digitBlockCount: number;
  leadingDigitBlock: string | null;
  datePatterns: DatePatternMatch[];
  sixDigitBlocks: SixDigitBlock[];
  delimiterCounts: DelimiterCount[];
  tokens: string[];
  tokenCount: number;
  stemLength: number;
  hasAsciiLetters: boolean;
  hasAsciiDigits: boolean;
  asciiLetterCount: number;
  asciiDigitCount: number;
  otherCharacterCount: number;
}

export interface SameStemDifferentExtensionOccurrence {
  path: string;
  relativePath: string | null;
  filename: string;
  extensionKey: string;
}

export interface SameStemDifferentExtensionsGroup {
  normalizedStem: string;
  observedStemForms: string[];
  extensionKeys: string[];
  occurrences: SameStemDifferentExtensionOccurrence[];
  occurrenceCount: number;
}

export interface InventoryFileNameSyntaxContext {
  files: FileNameSyntax[];
  sameStemDifferentExtensions: SameStemDifferentExtensionsGroup[];
}

const SUPPORTED_DELIMITERS = ["_", "-", " ", "."] as const;
const TOKEN_SPLIT = /[\s_\-.]+/;
const DIGIT_BLOCK = /\d+/g;
const DATE_DASH = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
const DATE_UNDERSCORE = /(?<!\d)(\d{4})_(\d{2})_(\d{2})(?!\d)/g;
const DATE_COMPACT = /(?<!\d)(\d{8})(?!\d)/g;
const SIX_DIGIT = /(?<!\d)(\d{6})(?!\d)/g;

export function analyzeFileNameSyntax(
  fileStructure: InventoryFileStructureContext,
): InventoryFileNameSyntaxContext {
  const files = fileStructure.files.map(syntaxOf).sort(compareFileSyntax);
  return {
    files,
    sameStemDifferentExtensions: buildSameStemDifferentExtensions(files),
  };
}

export function stemFromFilename(filename: string): {
  stem: string;
  extensionKey: string;
  hasExtension: boolean;
} {
  const extension = fileExtensionKey(filename);
  const hasExtension = extension !== null;
  const extensionKey = hasExtension ? extension : NO_EXTENSION_KEY;
  if (!hasExtension) {
    return { stem: filename, extensionKey, hasExtension };
  }
  const lastDot = filename.lastIndexOf(".");
  return {
    stem: filename.slice(0, lastDot),
    extensionKey,
    hasExtension,
  };
}

function syntaxOf(file: FileStructureContext): FileNameSyntax {
  const filename = file.file?.name ?? basenameOf(file.path);
  const fromName = stemFromFilename(filename);
  const stem = fromName.stem;
  const digitBlocks = collectDigitBlocks(stem);
  const leadingMatch = /^(\d+)/.exec(stem);
  const datePatterns = collectDatePatterns(stem);
  const sixDigitBlocks = collectSixDigitBlocks(stem);
  const delimiterCounts = collectDelimiterCounts(stem);
  const tokens = stem.split(TOKEN_SPLIT).filter((token) => token.length > 0);
  const asciiLetterCount = countMatches(stem, /[A-Za-z]/g);
  const asciiDigitCount = countMatches(stem, /[0-9]/g);
  return {
    path: file.path,
    relativePath: file.relativePath,
    filename,
    extensionKey: fromName.extensionKey,
    hasExtension: fromName.hasExtension,
    stem,
    digitBlocks,
    digitBlockCount: digitBlocks.length,
    leadingDigitBlock: leadingMatch?.[1] ?? null,
    datePatterns,
    sixDigitBlocks,
    delimiterCounts,
    tokens,
    tokenCount: tokens.length,
    stemLength: stem.length,
    hasAsciiLetters: asciiLetterCount > 0,
    hasAsciiDigits: asciiDigitCount > 0,
    asciiLetterCount,
    asciiDigitCount,
    otherCharacterCount: stem.length - asciiLetterCount - asciiDigitCount,
  };
}

function collectDigitBlocks(stem: string): DigitBlock[] {
  const blocks: DigitBlock[] = [];
  DIGIT_BLOCK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DIGIT_BLOCK.exec(stem)) !== null) {
    blocks.push({
      value: match[0],
      startIndex: match.index,
      length: match[0].length,
    });
  }
  return blocks;
}

function collectDatePatterns(stem: string): DatePatternMatch[] {
  const matches: DatePatternMatch[] = [];
  collectSeparatedDates(stem, DATE_DASH, "YYYY-MM-DD", "-", matches);
  collectSeparatedDates(stem, DATE_UNDERSCORE, "YYYY_MM_DD", "_", matches);
  DATE_COMPACT.lastIndex = 0;
  let compact: RegExpExecArray | null;
  while ((compact = DATE_COMPACT.exec(stem)) !== null) {
    const raw = compact[1];
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(4, 6));
    const day = Number(raw.slice(6, 8));
    if (isValidCalendarDate(year, month, day)) {
      matches.push({
        raw,
        format: "YYYYMMDD",
        startIndex: compact.index,
        year,
        month,
        day,
      });
    }
  }
  matches.sort((left, right) => {
    if (left.startIndex !== right.startIndex) {
      return left.startIndex - right.startIndex;
    }
    return compareText(left.format, right.format) || compareText(left.raw, right.raw);
  });
  return matches;
}

function collectSeparatedDates(
  stem: string,
  pattern: RegExp,
  format: DatePatternFormat,
  separator: string,
  matches: DatePatternMatch[],
): void {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(stem)) !== null) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!isValidCalendarDate(year, month, day)) {
      continue;
    }
    matches.push({
      raw: `${match[1]}${separator}${match[2]}${separator}${match[3]}`,
      format,
      startIndex: match.index,
      year,
      month,
      day,
    });
  }
}

function collectSixDigitBlocks(stem: string): SixDigitBlock[] {
  const blocks: SixDigitBlock[] = [];
  SIX_DIGIT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SIX_DIGIT.exec(stem)) !== null) {
    blocks.push({
      raw: match[1],
      startIndex: match.index,
    });
  }
  return blocks;
}

function collectDelimiterCounts(stem: string): DelimiterCount[] {
  const counts = new Map<string, number>();
  for (const delimiter of SUPPORTED_DELIMITERS) {
    counts.set(delimiter, 0);
  }
  for (const character of stem) {
    if (counts.has(character)) {
      counts.set(character, (counts.get(character) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([delimiter, count]) => ({ delimiter, count }))
    .sort((left, right) => compareText(left.delimiter, right.delimiter));
}

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (year < 0 || year > 9999 || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function buildSameStemDifferentExtensions(
  files: readonly FileNameSyntax[],
): SameStemDifferentExtensionsGroup[] {
  const buckets = new Map<string, FileNameSyntax[]>();
  for (const file of files) {
    const key = normalizeStem(file.stem);
    const existing = buckets.get(key);
    if (existing === undefined) {
      buckets.set(key, [file]);
    } else {
      existing.push(file);
    }
  }

  const groups: SameStemDifferentExtensionsGroup[] = [];
  for (const [normalizedStem, members] of buckets) {
    const extensionKeys = uniqueSorted(
      members.map((item) => item.extensionKey),
      compareText,
    );
    if (extensionKeys.length < 2) {
      continue;
    }
    const observedStemForms = uniqueSorted(
      members.map((item) => item.stem),
      compareText,
    );
    const occurrences = members
      .map((item) => ({
        path: item.path,
        relativePath: item.relativePath,
        filename: item.filename,
        extensionKey: item.extensionKey,
      }))
      .sort((left, right) => {
        const leftRelative = left.relativePath ?? left.path;
        const rightRelative = right.relativePath ?? right.path;
        return compareText(leftRelative, rightRelative) || compareText(left.path, right.path);
      });
    groups.push({
      normalizedStem,
      observedStemForms,
      extensionKeys,
      occurrences,
      occurrenceCount: occurrences.length,
    });
  }

  groups.sort((left, right) => compareText(left.normalizedStem, right.normalizedStem));
  return groups;
}

function normalizeStem(stem: string): string {
  return stem.toLocaleLowerCase();
}

function uniqueSorted(values: readonly string[], compare: (left: string, right: string) => number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result.sort(compare);
}

function basenameOf(path: string): string {
  const normalized = path.replace(/\//g, "\\");
  const index = normalized.lastIndexOf("\\");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function countMatches(text: string, pattern: RegExp): number {
  const matches = text.match(pattern);
  return matches?.length ?? 0;
}

function compareFileSyntax(left: FileNameSyntax, right: FileNameSyntax): number {
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
