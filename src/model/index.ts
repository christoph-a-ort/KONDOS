export type {
  AppError,
  AppErrorKind,
  ContentFormat,
  ContentPrepareStatus,
  ContentProgress,
  ContentSearchHit,
  ContentSearchResult,
  DirectoryListing,
  OcrProgress,
  DirectoryNode,
  ExportFormat,
  FileNode,
  FsNode,
  HighlightRange,
  ScanConfig,
  ScanProgress,
  ScanResult,
  ScanStats,
  ScanStatus,
  ScanWarning,
  WarningCode,
} from "./types";

export {
  CONTENT_PROGRESS_EVENT,
  DEFAULT_DEPTH,
  MAX_DEPTH,
  MIN_DEPTH,
  OCR_PROGRESS_EVENT,
  SCAN_PROGRESS_EVENT,
  isDirectory,
  isFile,
} from "./types";

export { clampDepth, createDefaultScanConfig, withRequiredScanIdentityMetadata } from "./scanConfig";
