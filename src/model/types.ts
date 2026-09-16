export const MIN_DEPTH = 1;
export const MAX_DEPTH = 8;
export const DEFAULT_DEPTH = 8;

export const SCAN_PROGRESS_EVENT = "scan://progress";

export type NodeKind = "file" | "directory";

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
