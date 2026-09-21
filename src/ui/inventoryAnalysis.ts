import { isDirectory, isFile, type DirectoryListing, type DirectoryNode, type FsNode, type ScanResult, type ScanWarning } from "../model";
import { fileExtensionKey, NO_EXTENSION_KEY, NO_EXTENSION_LABEL } from "./displayFilter";
import { normalizeFsPath } from "./warningNavigation";

export interface InventoryNodeRef {
  id: string;
  name: string;
  path: string;
  depth: number;
}

export interface FileTypeStat {
  /** Normalized extension including the dot, or `""` for files without an extension. */
  extension: string;
  label: string;
  fileCount: number;
  knownSizeBytes: number;
}

export interface FolderOccupancy {
  id: string;
  name: string;
  path: string;
  depth: number;
  listing: DirectoryListing;
  directFileCount: number;
  directDirectoryCount: number;
  /** Sum of known sizes of files that are direct children only. */
  directKnownSizeBytes: number;
}

export interface RepeatedNameGroup {
  name: string;
  count: number;
  paths: string[];
}

/**
 * Derived inventory of one ScanResult.
 * Equal names only mean the same file or folder name, not confirmed identical content.
 */
export interface InventoryAnalysis {
  fileCount: number;
  directoryCount: number;
  knownSizeBytes: number;
  filesWithoutKnownSize: number;
  maxObservedDepth: number;
  depthLimitedFolderCount: number;
  fileTypes: FileTypeStat[];
  folderOccupancy: FolderOccupancy[];
  emptyFolders: InventoryNodeRef[];
  singleDirectFileFolders: InventoryNodeRef[];
  foldersByDirectFileCount: FolderOccupancy[];
  repeatedFolderNames: RepeatedNameGroup[];
  repeatedFileNames: RepeatedNameGroup[];
  /**
   * Folders that look empty in FsNode (no children, listing=read) but have a scan warning
   * on the same path. Includes unfollowed reparse/junction leaves. Not classified as empty.
   */
  unconfirmedEmptyLookingFolders: InventoryNodeRef[];
}

interface NameBucket {
  name: string;
  paths: string[];
}

interface TypeBucket {
  extension: string;
  label: string;
  fileCount: number;
  knownSizeBytes: number;
}

function compareText(left: string, right: string): number {
  const order = left.localeCompare(right, undefined, { sensitivity: "base" });
  if (order !== 0) {
    return order;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCountThenText(leftCount: number, rightCount: number, leftText: string, rightText: string): number {
  if (leftCount !== rightCount) {
    return rightCount - leftCount;
  }
  return compareText(leftText, rightText);
}

function warnedPathSet(warnings: readonly ScanWarning[]): Set<string> {
  const paths = new Set<string>();
  for (const warning of warnings) {
    const normalized = normalizeFsPath(warning.path);
    if (normalized.length > 0) {
      paths.add(normalized);
    }
  }
  return paths;
}

function nodeRef(node: DirectoryNode): InventoryNodeRef {
  return {
    id: node.id,
    name: node.name,
    path: node.path,
    depth: node.depth,
  };
}

function toRepeatedGroups(buckets: Map<string, NameBucket>): RepeatedNameGroup[] {
  const groups: RepeatedNameGroup[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.paths.length < 2) {
      continue;
    }
    groups.push({
      name: bucket.name,
      count: bucket.paths.length,
      paths: bucket.paths.slice().sort(compareText),
    });
  }
  groups.sort((left, right) => compareCountThenText(left.count, right.count, left.name, right.name));
  return groups;
}

function addName(buckets: Map<string, NameBucket>, name: string, path: string): void {
  const key = name.toLocaleLowerCase();
  const existing = buckets.get(key);
  if (existing === undefined) {
    buckets.set(key, { name, paths: [path] });
    return;
  }
  existing.paths.push(path);
}

export function analyzeInventory(result: ScanResult): InventoryAnalysis {
  const warnedPaths = warnedPathSet(result.warnings);
  let fileCount = 0;
  let directoryCount = 0;
  let knownSizeBytes = 0;
  let filesWithoutKnownSize = 0;
  let maxObservedDepth = result.root.depth;
  let depthLimitedFolderCount = 0;
  const typeBuckets = new Map<string, TypeBucket>();
  const folderNames = new Map<string, NameBucket>();
  const fileNames = new Map<string, NameBucket>();
  const occupancy: FolderOccupancy[] = [];
  const emptyFolders: InventoryNodeRef[] = [];
  const singleDirectFileFolders: InventoryNodeRef[] = [];
  const unconfirmedEmptyLookingFolders: InventoryNodeRef[] = [];

  function visit(node: FsNode): void {
    if (node.depth > maxObservedDepth) {
      maxObservedDepth = node.depth;
    }
    if (isFile(node)) {
      fileCount += 1;
      const size = node.sizeBytes;
      if (size !== undefined) {
        knownSizeBytes += size;
      } else {
        filesWithoutKnownSize += 1;
      }
      const extension = fileExtensionKey(node.name) ?? NO_EXTENSION_KEY;
      const label = extension === NO_EXTENSION_KEY ? NO_EXTENSION_LABEL : extension;
      const bucket = typeBuckets.get(extension);
      if (bucket === undefined) {
        typeBuckets.set(extension, {
          extension,
          label,
          fileCount: 1,
          knownSizeBytes: size ?? 0,
        });
      } else {
        bucket.fileCount += 1;
        if (size !== undefined) {
          bucket.knownSizeBytes += size;
        }
      }
      addName(fileNames, node.name, node.path);
      return;
    }
    if (!isDirectory(node)) {
      return;
    }

    directoryCount += 1;
    if (node.listing === "depthLimited") {
      depthLimitedFolderCount += 1;
    }
    addName(folderNames, node.name, node.path);

    let directFileCount = 0;
    let directDirectoryCount = 0;
    let directKnownSizeBytes = 0;
    for (const child of node.children) {
      if (isDirectory(child)) {
        directDirectoryCount += 1;
      } else {
        directFileCount += 1;
        if (isFile(child) && child.sizeBytes !== undefined) {
          directKnownSizeBytes += child.sizeBytes;
        }
      }
    }

    occupancy.push({
      id: node.id,
      name: node.name,
      path: node.path,
      depth: node.depth,
      listing: node.listing,
      directFileCount,
      directDirectoryCount,
      directKnownSizeBytes,
    });

    if (node.children.length === 0) {
      const looksEmpty = node.listing === "read";
      const hasWarning = warnedPaths.has(normalizeFsPath(node.path)) || warnedPaths.has(normalizeFsPath(node.id));
      if (looksEmpty && hasWarning) {
        unconfirmedEmptyLookingFolders.push(nodeRef(node));
      } else if (looksEmpty && !hasWarning) {
        emptyFolders.push(nodeRef(node));
      }
    }
    if (directFileCount === 1) {
      singleDirectFileFolders.push(nodeRef(node));
    }

    for (const child of node.children) {
      visit(child);
    }
  }

  visit(result.root);

  const fileTypes = [...typeBuckets.values()].sort((left, right) =>
    compareCountThenText(left.fileCount, right.fileCount, left.extension, right.extension),
  );
  emptyFolders.sort((left, right) => compareText(left.path, right.path));
  singleDirectFileFolders.sort((left, right) => compareText(left.path, right.path));
  unconfirmedEmptyLookingFolders.sort((left, right) => compareText(left.path, right.path));
  const foldersByDirectFileCount = occupancy.slice().sort((left, right) => {
    const byCount = compareCountThenText(left.directFileCount, right.directFileCount, left.path, right.path);
    if (byCount !== 0) {
      return byCount;
    }
    return compareText(left.path, right.path);
  });

  return {
    fileCount,
    directoryCount,
    knownSizeBytes,
    filesWithoutKnownSize,
    maxObservedDepth,
    depthLimitedFolderCount,
    fileTypes,
    folderOccupancy: occupancy,
    emptyFolders,
    singleDirectFileFolders,
    foldersByDirectFileCount,
    repeatedFolderNames: toRepeatedGroups(folderNames),
    repeatedFileNames: toRepeatedGroups(fileNames),
    unconfirmedEmptyLookingFolders,
  };
}
