export const MIN_DEPTH = 1;
export const MAX_DEPTH = 32;
export const DEFAULT_DEPTH = 16;

export const SCAN_PROGRESS_EVENT = "scan://progress";
export const CONTENT_PROGRESS_EVENT = "content://progress";

export type NodeKind = "file" | "directory";

export type DirectoryListing = "read" | "depthLimited" | "incomplete";

export interface NodeMetadata {
  sizeBytes?: number;
  createdAtMs?: number;
  modifiedAtMs?: number;
}

interface NodeBase extends NodeMetadata {
  id: string;
  name: string;
  path: string;
  depth: number;
}

export interface DirectoryNode extends NodeBase {
  kind: "directory";
  listing: DirectoryListing;
  children: FsNode[];
}

export interface FileNode extends NodeBase {
  kind: "file";
}

export type FsNode = DirectoryNode | FileNode;

export function isDirectory(node: FsNode): node is DirectoryNode {
  return node.kind === "directory";
}

export function isFile(node: FsNode): node is FileNode {
  return node.kind === "file";
}

export interface ScanConfig {
  rootPath: string;
  maxDepth: number;
  excludeHidden: boolean;
  extensions: string[];
  includeSize: boolean;
  includeCreatedAt: boolean;
  includeModifiedAt: boolean;
}

export type WarningCode =
  | "permissionDenied"
  | "notFound"
  | "notReadable"
  | "ioError"
  | "skipped";

export interface ScanWarning {
  path: string;
  code: WarningCode;
  message: string;
}

export type ScanStatus = "running" | "completed" | "cancelled" | "failed";

export interface ScanProgress {
  scanId: number;
  processedCount: number;
  currentPath: string;
  status: ScanStatus;
}

export interface ScanStats {
  directoryCount: number;
  fileCount: number;
  skippedCount: number;
  durationMs: number;
}

export interface ScanResult {
  root: DirectoryNode;
  warnings: ScanWarning[];
  stats: ScanStats;
}

export type AppErrorKind =
  | "invalidPath"
  | "invalidConfig"
  | "rootInaccessible"
  | "cancelled"
  | "exportFailed"
  | "internal";

export interface AppError {
  kind: AppErrorKind;
  message: string;
  targetPath?: string;
  cause?: string;
}

export type ExportFormat = "txt" | "json" | "csv";

export type ContentPrepareStatus = "running" | "completed" | "cancelled" | "failed";

export type ContentFormat = "pdf" | "docx" | "xlsx";

/** Inclusive `start`, exclusive `end`, UTF-16 code units of `snippet` (JS `substring`). */
export interface HighlightRange {
  start: number;
  end: number;
}

export interface ContentSearchHit {
  nodeId: string;
  path: string;
  name: string;
  format: ContentFormat;
  /** Non-overlapping substring hits of all deduped terms, summed. Not a phrase count. */
  matchCount: number;
  snippet: string;
  highlights: HighlightRange[];
}

export interface ContentSearchResult {
  scanId: number;
  query: string;
  cacheComplete: boolean;
  processedDocumentCount: number;
  totalDocumentCount: number;
  totalHitCount: number;
  returnedHitCount: number;
  hits: ContentSearchHit[];
}

export interface ContentProgress {
  scanId: number;
  totalDocumentCount: number;
  processedDocumentCount: number;
  searchableCount: number;
  noTextCount: number;
  problemCount: number;
  currentFileName: string;
  status: ContentPrepareStatus;
}
