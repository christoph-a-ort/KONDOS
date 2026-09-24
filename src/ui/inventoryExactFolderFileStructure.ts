import { fileExtensionKey, NO_EXTENSION_KEY } from "./displayFilter";
import type { InventoryNodeRef } from "./inventoryAnalysis";
import type { FolderStructureContext, InventoryStructureContext } from "./inventoryStructureContext";

/**
 * Read-only exact folder file-structure observations (P1-M Häppchen 1).
 *
 * Two separate exact equalities over DIRECT child files only:
 * - same normalized direct file-name set
 * - same extensionKey multiset (counts included)
 *
 * Observation only — not content equality, not a duplicate claim, not a rating.
 * Counterpart to P1-J exact child-directory signatures, for files.
 *
 * Not in this slice: similarity, name syntax, byte equality,
 * size/time comparison, content, KI, SOLL, UI, or actions.
 */
export const MIN_EXACT_FOLDER_FILE_STRUCTURE_FOLDERS = 2;

export interface ExactFolderFileStructureFolder {
  folder: InventoryNodeRef;
  relativePath: string;
  depth: number;
}

export interface ExactDirectFileNameStructureGroup {
  /** Sorted unique lowercased direct file names, joined with newlines. */
  signature: string;
  /** Display names from the first folder after relativePath sort. */
  directFileNames: string[];
  directFileCount: number;
  folders: ExactFolderFileStructureFolder[];
  folderCount: number;
}

export interface ExtensionCount {
  extensionKey: string;
  count: number;
}

export interface ExactExtensionMultisetGroup {
  /** Sorted "extensionKey\\tcount" lines joined with newlines. */
  signature: string;
  extensionCounts: ExtensionCount[];
  directFileCount: number;
  folders: ExactFolderFileStructureFolder[];
  folderCount: number;
}

export interface InventoryExactFolderFileStructureContext {
  exactDirectFileNameStructures: ExactDirectFileNameStructureGroup[];
  exactExtensionMultisets: ExactExtensionMultisetGroup[];
}

export function analyzeExactFolderFileStructures(
  structure: InventoryStructureContext,
): InventoryExactFolderFileStructureContext {
  return {
    exactDirectFileNameStructures: buildExactDirectFileNameStructures(structure.folders),
    exactExtensionMultisets: buildExactExtensionMultisets(structure.folders),
  };
}

function isEligibleFolder(folder: FolderStructureContext): boolean {
  // Same reliability rule as P1-J repeated child-directory structures:
  // only fully read listings participate in exact equality claims.
  return folder.listing === "read" && folder.childFiles.length >= 1;
}

function structureNameKey(name: string): string {
  return name.toLocaleLowerCase();
}

function uniqueDirectFileNameEntries(
  childFiles: readonly InventoryNodeRef[],
): { key: string; original: string }[] {
  const byKey = new Map<string, string>();
  const sorted = childFiles.slice().sort((left, right) => compareText(left.name, right.name));
  for (const child of sorted) {
    const key = structureNameKey(child.name);
    if (!byKey.has(key)) {
      byKey.set(key, child.name);
    }
  }
  return [...byKey.entries()]
    .map(([key, original]) => ({ key, original }))
    .sort((left, right) => compareText(left.key, right.key) || compareText(left.original, right.original));
}

function directFileNameSignature(childFiles: readonly InventoryNodeRef[]): {
  signature: string;
  directFileNames: string[];
  directFileCount: number;
} {
  const entries = uniqueDirectFileNameEntries(childFiles);
  return {
    signature: entries.map((item) => item.key).join("\n"),
    directFileNames: entries.map((item) => item.original),
    directFileCount: entries.length,
  };
}

function extensionMultisetOf(childFiles: readonly InventoryNodeRef[]): {
  signature: string;
  extensionCounts: ExtensionCount[];
  directFileCount: number;
} {
  const counts = new Map<string, number>();
  for (const child of childFiles) {
    const key = fileExtensionKey(child.name) ?? NO_EXTENSION_KEY;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const extensionCounts = [...counts.entries()]
    .map(([extensionKey, count]) => ({ extensionKey, count }))
    .sort(
      (left, right) =>
        compareText(left.extensionKey, right.extensionKey) || left.count - right.count,
    );
  return {
    signature: extensionCounts.map((item) => `${item.extensionKey}\t${item.count}`).join("\n"),
    extensionCounts,
    directFileCount: childFiles.length,
  };
}

function toFolderRef(folder: FolderStructureContext): ExactFolderFileStructureFolder {
  return {
    folder: folder.folder,
    relativePath: folder.relativePath,
    depth: folder.depth,
  };
}

function buildExactDirectFileNameStructures(
  folders: readonly FolderStructureContext[],
): ExactDirectFileNameStructureGroup[] {
  const buckets = new Map<string, FolderStructureContext[]>();
  for (const folder of folders) {
    if (!isEligibleFolder(folder)) {
      continue;
    }
    const { signature } = directFileNameSignature(folder.childFiles);
    const existing = buckets.get(signature);
    if (existing === undefined) {
      buckets.set(signature, [folder]);
    } else {
      existing.push(folder);
    }
  }

  const groups: ExactDirectFileNameStructureGroup[] = [];
  for (const [signature, members] of buckets) {
    if (members.length < MIN_EXACT_FOLDER_FILE_STRUCTURE_FOLDERS) {
      continue;
    }
    const folderRefs = members.map(toFolderRef).sort((left, right) =>
      compareText(left.relativePath, right.relativePath),
    );
    const first = folderRefs[0];
    const firstFolder =
      members.find((item) => item.folder.path === first?.folder.path) ?? members[0];
    const named = directFileNameSignature(firstFolder.childFiles);
    groups.push({
      signature,
      directFileNames: named.directFileNames,
      directFileCount: named.directFileCount,
      folders: folderRefs,
      folderCount: folderRefs.length,
    });
  }

  groups.sort((left, right) => {
    if (left.directFileCount !== right.directFileCount) {
      return right.directFileCount - left.directFileCount;
    }
    if (left.folderCount !== right.folderCount) {
      return right.folderCount - left.folderCount;
    }
    return compareText(left.signature, right.signature);
  });
  return groups;
}

function buildExactExtensionMultisets(
  folders: readonly FolderStructureContext[],
): ExactExtensionMultisetGroup[] {
  const buckets = new Map<string, FolderStructureContext[]>();
  for (const folder of folders) {
    if (!isEligibleFolder(folder)) {
      continue;
    }
    const { signature } = extensionMultisetOf(folder.childFiles);
    const existing = buckets.get(signature);
    if (existing === undefined) {
      buckets.set(signature, [folder]);
    } else {
      existing.push(folder);
    }
  }

  const groups: ExactExtensionMultisetGroup[] = [];
  for (const [signature, members] of buckets) {
    if (members.length < MIN_EXACT_FOLDER_FILE_STRUCTURE_FOLDERS) {
      continue;
    }
    const folderRefs = members.map(toFolderRef).sort((left, right) =>
      compareText(left.relativePath, right.relativePath),
    );
    const first = folderRefs[0];
    const firstFolder =
      members.find((item) => item.folder.path === first?.folder.path) ?? members[0];
    const multiset = extensionMultisetOf(firstFolder.childFiles);
    groups.push({
      signature,
      extensionCounts: multiset.extensionCounts,
      directFileCount: multiset.directFileCount,
      folders: folderRefs,
      folderCount: folderRefs.length,
    });
  }

  groups.sort((left, right) => {
    if (left.directFileCount !== right.directFileCount) {
      return right.directFileCount - left.directFileCount;
    }
    if (left.folderCount !== right.folderCount) {
      return right.folderCount - left.folderCount;
    }
    return compareText(left.signature, right.signature);
  });
  return groups;
}

function compareText(left: string, right: string): number {
  const order = left.localeCompare(right, undefined, { sensitivity: "base" });
  if (order !== 0) {
    return order;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}
