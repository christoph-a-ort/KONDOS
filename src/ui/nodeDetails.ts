import {
  isDirectory,
  isFile,
  type DirectoryListing,
  type DirectoryNode,
  type FsNode,
  type ScanWarning,
} from "../model";
import { fileExtensionKey } from "./displayFilter";
import { findNodeById } from "./treeRows";
import { formatByteSize, formatDateTime } from "./treeFormat";
import { warningsForExactPath } from "./warningNavigation";

export const DETAIL_NONE_LABEL = "Kein Element ausgewählt.";
export const META_NOT_CAPTURED = "nicht beim Einlesen erfasst";
export const META_UNAVAILABLE = "nicht verfügbar";

export type DetailValueState = "present" | "not-captured" | "unavailable";

export interface DetailValue {
  state: DetailValueState;
  text: string;
}

export interface SubtreeSizeDetail {
  text: string;
  incomplete: boolean;
}

export interface NodeDetailModel {
  selected: boolean;
  kind: "file" | "directory" | null;
  name: string | null;
  typeLabel: string | null;
  path: string | null;
  extension: string | null;
  depth: number | null;
  size: DetailValue | null;
  modified: DetailValue | null;
  created: DetailValue | null;
  listingLabel: string | null;
  directDirectories: number | null;
  directFiles: number | null;
  containedDirectories: number | null;
  containedFiles: number | null;
  subtreeSize: SubtreeSizeDetail | null;
  warningCount: number;
  warningSummary: string | null;
}

export function emptyNodeDetailModel(): NodeDetailModel {
  return {
    selected: false,
    kind: null,
    name: null,
    typeLabel: null,
    path: null,
    extension: null,
    depth: null,
    size: null,
    modified: null,
    created: null,
    listingLabel: null,
    directDirectories: null,
    directFiles: null,
    containedDirectories: null,
    containedFiles: null,
    subtreeSize: null,
    warningCount: 0,
    warningSummary: null,
  };
}

export function listingStatusLabel(listing: DirectoryListing): string {
  switch (listing) {
    case "read":
      return "Eingelesen";
    case "depthLimited":
      return "Maximale Einlesetiefe erreicht";
    case "incomplete":
      return "Unvollständig eingelesen";
  }
}

export function snapshotHasField(
  root: FsNode,
  field: "sizeBytes" | "modifiedAtMs" | "createdAtMs",
): boolean {
  function walk(node: FsNode): boolean {
    if (node[field] !== undefined) {
      return true;
    }
    return isDirectory(node) && node.children.some(walk);
  }
  return walk(root);
}

export function buildNodeDetails(
  snapshotRoot: FsNode,
  selectedId: string | null,
  warnings: readonly ScanWarning[],
  scanExtensionsUsed: boolean,
): NodeDetailModel {
  if (selectedId === null) {
    return emptyNodeDetailModel();
  }
  const node = findNodeById(snapshotRoot, selectedId);
  if (node === undefined) {
    return emptyNodeDetailModel();
  }
  const related = warningsForExactPath(warnings, node.path);
  const warningSummary =
    related.length === 0
      ? null
      : related.length === 1
        ? `1 Warnung: ${related[0].message}`
        : `${related.length} Warnungen zu diesem Pfad`;

  if (isFile(node)) {
    return {
      selected: true,
      kind: "file",
      name: node.name,
      typeLabel: "Datei",
      path: node.path,
      extension: fileExtensionLabel(node.name),
      depth: node.depth,
      size: metadataValue(node.sizeBytes, snapshotHasField(snapshotRoot, "sizeBytes"), formatByteSize),
      modified: metadataValue(
        node.modifiedAtMs,
        snapshotHasField(snapshotRoot, "modifiedAtMs"),
        formatDateTime,
      ),
      created: metadataValue(
        node.createdAtMs,
        snapshotHasField(snapshotRoot, "createdAtMs"),
        formatDateTime,
      ),
      listingLabel: null,
      directDirectories: null,
      directFiles: null,
      containedDirectories: null,
      containedFiles: null,
      subtreeSize: null,
      warningCount: related.length,
      warningSummary,
    };
  }

  const counts = inspectDirectory(node);
  return {
    selected: true,
    kind: "directory",
    name: node.name,
    typeLabel: "Ordner",
    path: node.path,
    extension: null,
    depth: node.depth,
    size: null,
    modified: metadataValue(
      node.modifiedAtMs,
      snapshotHasField(snapshotRoot, "modifiedAtMs"),
      formatDateTime,
    ),
    created: metadataValue(
      node.createdAtMs,
      snapshotHasField(snapshotRoot, "createdAtMs"),
      formatDateTime,
    ),
    listingLabel: listingStatusLabel(node.listing),
    directDirectories: counts.directDirectories,
    directFiles: counts.directFiles,
    containedDirectories: counts.containedDirectories,
    containedFiles: counts.containedFiles,
    subtreeSize: formatSubtreeSize(
      counts,
      scanExtensionsUsed,
      snapshotHasField(snapshotRoot, "sizeBytes"),
    ),
    warningCount: related.length,
    warningSummary,
  };
}

function fileExtensionLabel(name: string): string {
  const key = fileExtensionKey(name);
  return key === null ? "ohne Dateiendung" : key;
}

function metadataValue(
  value: number | undefined,
  capturedSomewhere: boolean,
  format: (value: number) => string,
): DetailValue {
  if (value !== undefined) {
    return { state: "present", text: format(value) };
  }
  if (!capturedSomewhere) {
    return { state: "not-captured", text: META_NOT_CAPTURED };
  }
  return { state: "unavailable", text: META_UNAVAILABLE };
}

interface DirectoryInspect {
  directDirectories: number;
  directFiles: number;
  containedDirectories: number;
  containedFiles: number;
  filesWithSize: number;
  sizeBytes: number;
  listingIncomplete: boolean;
}

function inspectDirectory(node: DirectoryNode): DirectoryInspect {
  let directDirectories = 0;
  let directFiles = 0;
  for (const child of node.children) {
    if (isDirectory(child)) {
      directDirectories += 1;
    } else {
      directFiles += 1;
    }
  }

  let containedDirectories = 0;
  let containedFiles = 0;
  let filesWithSize = 0;
  let sizeBytes = 0;
  let listingIncomplete = node.listing !== "read";

  function walk(current: DirectoryNode): void {
    if (current.listing === "depthLimited" || current.listing === "incomplete") {
      listingIncomplete = true;
    }
    for (const child of current.children) {
      if (isFile(child)) {
        containedFiles += 1;
        if (child.sizeBytes !== undefined) {
          filesWithSize += 1;
          sizeBytes += child.sizeBytes;
        }
      } else if (isDirectory(child)) {
        containedDirectories += 1;
        walk(child);
      }
    }
  }
  walk(node);

  return {
    directDirectories,
    directFiles,
    containedDirectories,
    containedFiles,
    filesWithSize,
    sizeBytes,
    listingIncomplete,
  };
}

function formatSubtreeSize(
  counts: DirectoryInspect,
  scanExtensionsUsed: boolean,
  sizeCapturedSomewhere: boolean,
): SubtreeSizeDetail {
  const incomplete =
    scanExtensionsUsed ||
    counts.listingIncomplete ||
    (counts.containedFiles > 0 && counts.filesWithSize < counts.containedFiles);

  if (counts.containedFiles === 0) {
    if (counts.listingIncomplete) {
      return {
        text: "Größe im eingelesenen Ergebnis: nicht vollständig bestimmbar",
        incomplete: true,
      };
    }
    return { text: "Größe im eingelesenen Ergebnis: 0 B", incomplete: scanExtensionsUsed };
  }

  if (counts.filesWithSize === 0) {
    const reason = sizeCapturedSomewhere ? META_UNAVAILABLE : META_NOT_CAPTURED;
    return {
      text: `Größe im eingelesenen Ergebnis: ${reason}`,
      incomplete: true,
    };
  }

  const formatted = formatByteSize(counts.sizeBytes);
  if (incomplete) {
    return {
      text: `Größe im eingelesenen Ergebnis: ${formatted} (unvollständig)`,
      incomplete: true,
    };
  }
  return {
    text: `Größe im eingelesenen Ergebnis: ${formatted}`,
    incomplete: false,
  };
}
