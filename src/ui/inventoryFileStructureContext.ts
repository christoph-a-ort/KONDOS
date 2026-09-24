import { isDirectory, isFile, type DirectoryListing, type FileNode, type FsNode, type ScanResult } from "../model";
import type { InventoryNodeRef } from "./inventoryAnalysis";
import { fileExtensionKey, NO_EXTENSION_KEY } from "./displayFilter";
import { displayInventoryPath } from "./inventoryOverview";
import {
  isYearFolderName,
  type FolderStructureContext,
  type InventoryStructureContext,
  type YearFolderGroup,
} from "./inventoryStructureContext";

/**
 * Read-only structure context for every file in one ScanResult.
 *
 * Joins FileNode metadata with FolderStructureContext / P1-I / P1-J.
 * Observation only — not a rating, classification, or placement judgment.
 *
 * Not in this slice: repeated-file-name context, size equality, name patterns,
 * technical companions, content, hashing, KI, SOLL, UI, or actions.
 */
export interface FileYearGroupContext {
  parent: InventoryNodeRef;
  parentRelativePath: string;
  years: number[];
  minYear: number;
  maxYear: number;
}

export interface FileStructureContext {
  path: string;
  joinFound: boolean;
  file: InventoryNodeRef | null;
  relativePath: string | null;
  depth: number | null;
  extensionKey: string | null;
  hasExtension: boolean;
  sizeBytes: number | null;
  createdAtMs: number | null;
  modifiedAtMs: number | null;
  parent: InventoryNodeRef | null;
  parentRelativePath: string | null;
  parentDepth: number | null;
  parentListing: DirectoryListing | null;
  siblingFileCount: number;
  siblingFileNames: string[];
  childDirectoryCount: number;
  childDirectoryNames: string[];
  parentIsYearFolderName: boolean;
  yearGroup: FileYearGroupContext | null;
  parentInRepeatedChildDirectoryStructure: boolean;
  parentRepeatedChildDirectoryStructureSignature: string | null;
  grandparentInRepeatedChildDirectoryStructure: boolean;
  grandparentRepeatedChildDirectoryStructureSignature: string | null;
  parentInFolderChain: boolean;
  parentIsFolderChainEnd: boolean;
}

export interface InventoryFileStructureContext {
  files: FileStructureContext[];
}

export function analyzeFileStructureContext(
  result: ScanResult,
  structure: InventoryStructureContext,
): InventoryFileStructureContext {
  const yearGroupByFolderPath = yearGroupIndex(structure);
  const structureSignatureByParentPath = parentStructureIndex(structure);
  const chainFolderPaths = chainPathSet(structure);
  const chainEndPaths = chainEndPathSet(structure);
  const parentByFilePath = parentFolderByFilePath(structure);
  const rootPath = result.root.path;
  const files: FileStructureContext[] = [];

  function visit(node: FsNode): void {
    if (isFile(node)) {
      files.push(
        contextOf(
          node,
          parentByFilePath.get(node.path),
          rootPath,
          yearGroupByFolderPath,
          structureSignatureByParentPath,
          chainFolderPaths,
          chainEndPaths,
        ),
      );
      return;
    }
    if (isDirectory(node)) {
      for (const child of node.children) {
        visit(child);
      }
    }
  }

  visit(result.root);
  files.sort(compareFileContext);
  return { files };
}

function contextOf(
  node: FileNode,
  parentFolder: FolderStructureContext | undefined,
  rootPath: string,
  yearGroupByFolderPath: ReadonlyMap<string, YearFolderGroup>,
  structureSignatureByParentPath: ReadonlyMap<string, string>,
  chainFolderPaths: ReadonlySet<string>,
  chainEndPaths: ReadonlySet<string>,
): FileStructureContext {
  const extension = fileExtensionKey(node.name);
  const hasExtension = extension !== null;
  const extensionKey = hasExtension ? extension : NO_EXTENSION_KEY;
  if (parentFolder === undefined) {
    return missingContext(node, rootPath, extensionKey, hasExtension);
  }

  const siblingFileNames = parentFolder.childFiles
    .filter((item) => item.path !== node.path)
    .map((item) => item.name)
    .sort(compareText);
  const childDirectoryNames = parentFolder.childDirectories
    .map((item) => item.name)
    .slice()
    .sort(compareText);
  const parentSignature = structureSignatureByParentPath.get(parentFolder.folder.path);
  const grandparentPath = parentFolder.parent?.path;
  const grandparentSignature =
    grandparentPath === undefined ? undefined : structureSignatureByParentPath.get(grandparentPath);
  const yearGroup = yearGroupByFolderPath.get(parentFolder.folder.path);

  return {
    path: node.path,
    joinFound: true,
    file: fileRef(node),
    relativePath: displayInventoryPath(rootPath, node.path),
    depth: node.depth,
    extensionKey,
    hasExtension,
    sizeBytes: node.sizeBytes ?? null,
    createdAtMs: node.createdAtMs ?? null,
    modifiedAtMs: node.modifiedAtMs ?? null,
    parent: parentFolder.folder,
    parentRelativePath: parentFolder.relativePath,
    parentDepth: parentFolder.depth,
    parentListing: parentFolder.listing,
    siblingFileCount: siblingFileNames.length,
    siblingFileNames,
    childDirectoryCount: childDirectoryNames.length,
    childDirectoryNames,
    parentIsYearFolderName: isYearFolderName(parentFolder.folder.name),
    yearGroup: yearGroup === undefined ? null : yearGroupContext(yearGroup),
    parentInRepeatedChildDirectoryStructure: parentSignature !== undefined,
    parentRepeatedChildDirectoryStructureSignature: parentSignature ?? null,
    grandparentInRepeatedChildDirectoryStructure: grandparentSignature !== undefined,
    grandparentRepeatedChildDirectoryStructureSignature: grandparentSignature ?? null,
    parentInFolderChain: chainFolderPaths.has(parentFolder.folder.path),
    parentIsFolderChainEnd: chainEndPaths.has(parentFolder.folder.path),
  };
}

function missingContext(
  node: FileNode,
  rootPath: string,
  extensionKey: string,
  hasExtension: boolean,
): FileStructureContext {
  return {
    path: node.path,
    joinFound: false,
    file: fileRef(node),
    relativePath: displayInventoryPath(rootPath, node.path),
    depth: node.depth,
    extensionKey,
    hasExtension,
    sizeBytes: node.sizeBytes ?? null,
    createdAtMs: node.createdAtMs ?? null,
    modifiedAtMs: node.modifiedAtMs ?? null,
    parent: null,
    parentRelativePath: null,
    parentDepth: null,
    parentListing: null,
    siblingFileCount: 0,
    siblingFileNames: [],
    childDirectoryCount: 0,
    childDirectoryNames: [],
    parentIsYearFolderName: false,
    yearGroup: null,
    parentInRepeatedChildDirectoryStructure: false,
    parentRepeatedChildDirectoryStructureSignature: null,
    grandparentInRepeatedChildDirectoryStructure: false,
    grandparentRepeatedChildDirectoryStructureSignature: null,
    parentInFolderChain: false,
    parentIsFolderChainEnd: false,
  };
}

function fileRef(node: FileNode): InventoryNodeRef {
  return {
    id: node.id,
    name: node.name,
    path: node.path,
    depth: node.depth,
  };
}

function yearGroupContext(group: YearFolderGroup): FileYearGroupContext {
  return {
    parent: group.parent,
    parentRelativePath: group.parentRelativePath,
    years: group.years,
    minYear: group.minYear,
    maxYear: group.maxYear,
  };
}

function parentFolderByFilePath(
  structure: InventoryStructureContext,
): Map<string, FolderStructureContext> {
  const index = new Map<string, FolderStructureContext>();
  for (const folder of structure.folders) {
    for (const child of folder.childFiles) {
      index.set(child.path, folder);
    }
  }
  return index;
}

function yearGroupIndex(structure: InventoryStructureContext): Map<string, YearFolderGroup> {
  const index = new Map<string, YearFolderGroup>();
  for (const group of structure.yearGroups) {
    for (const yearFolder of group.yearFolders) {
      index.set(yearFolder.folder.path, group);
    }
  }
  return index;
}

function parentStructureIndex(structure: InventoryStructureContext): Map<string, string> {
  const index = new Map<string, string>();
  for (const group of structure.repeatedChildDirectoryStructures) {
    for (const parent of group.parents) {
      index.set(parent.folder.path, group.signature);
    }
  }
  return index;
}

function chainPathSet(structure: InventoryStructureContext): Set<string> {
  const paths = new Set<string>();
  for (const chain of structure.folderChains) {
    for (const folder of chain.folders) {
      paths.add(folder.path);
    }
  }
  return paths;
}

function chainEndPathSet(structure: InventoryStructureContext): Set<string> {
  const paths = new Set<string>();
  for (const chain of structure.folderChains) {
    paths.add(chain.end.path);
  }
  return paths;
}

function compareFileContext(left: FileStructureContext, right: FileStructureContext): number {
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

export function fileContextByPath(
  context: InventoryFileStructureContext,
  path: string,
): FileStructureContext | undefined {
  return context.files.find((item) => item.path === path);
}
