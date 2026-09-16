export type {
  AppError,
  AppErrorKind,
  DirectoryNode,
  ExportFormat,
  FileNode,
  FsNode,
  ScanConfig,
  ScanProgress,
  ScanResult,
  ScanStats,
  ScanStatus,
  ScanWarning,
  WarningCode,
} from "./types";

export {
  DEFAULT_DEPTH,
  MAX_DEPTH,
  MIN_DEPTH,
  SCAN_PROGRESS_EVENT,
  isDirectory,
  isFile,
} from "./types";

export { clampDepth, createDefaultScanConfig } from "./scanConfig";
