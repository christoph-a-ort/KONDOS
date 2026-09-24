import type { InventoryAnalysis, RepeatedNameGroup } from "./inventoryAnalysis";
import type {
  FileStructureContext,
  InventoryFileStructureContext,
} from "./inventoryFileStructureContext";

/**
 * Read-only join of P1-H repeated file names with P1-L file structure context.
 *
 * Same file name still means only the same name at several paths.
 * Observation only — not identical content, not a duplicate claim, not an action.
 *
 * P1-H remains the sole authority for which names are repeated.
 * Not in this slice: size comparison, hashing, content, patterns, KI, SOLL, UI, or actions.
 */
export interface RepeatedFileNameOccurrenceContext {
  path: string;
  joinFound: boolean;
  fileContext: FileStructureContext | null;
}

export interface RepeatedFileNameContextGroup {
  name: string;
  count: number;
  occurrences: RepeatedFileNameOccurrenceContext[];
}

export function analyzeRepeatedFileNameContext(
  analysis: InventoryAnalysis,
  fileStructure: InventoryFileStructureContext,
): RepeatedFileNameContextGroup[] {
  const byPath = fileContextIndex(fileStructure);
  return analysis.repeatedFileNames.map((group) => ({
    name: group.name,
    count: group.count,
    occurrences: occurrencesOf(group, byPath),
  }));
}

function occurrencesOf(
  group: RepeatedNameGroup,
  byPath: ReadonlyMap<string, FileStructureContext>,
): RepeatedFileNameOccurrenceContext[] {
  return group.paths.map((path) => occurrenceOf(path, byPath.get(path))).sort(compareOccurrence);
}

function occurrenceOf(
  path: string,
  fileContext: FileStructureContext | undefined,
): RepeatedFileNameOccurrenceContext {
  if (fileContext === undefined) {
    return {
      path,
      joinFound: false,
      fileContext: null,
    };
  }
  return {
    path,
    joinFound: true,
    fileContext,
  };
}

function fileContextIndex(
  fileStructure: InventoryFileStructureContext,
): Map<string, FileStructureContext> {
  const index = new Map<string, FileStructureContext>();
  for (const item of fileStructure.files) {
    index.set(item.path, item);
  }
  return index;
}

function compareOccurrence(
  left: RepeatedFileNameOccurrenceContext,
  right: RepeatedFileNameOccurrenceContext,
): number {
  const leftRelative = left.fileContext?.relativePath ?? null;
  const rightRelative = right.fileContext?.relativePath ?? null;
  if (leftRelative !== null && rightRelative !== null) {
    const byRelative = compareText(leftRelative, rightRelative);
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
