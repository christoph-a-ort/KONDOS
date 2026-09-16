import {
  DEFAULT_DEPTH,
  MAX_DEPTH,
  MIN_DEPTH,
  type ScanConfig,
} from "./types";

export function createDefaultScanConfig(): ScanConfig {
  return {
    rootPath: "",
    maxDepth: DEFAULT_DEPTH,
    excludeHidden: true,
    extensions: [],
    includeSize: false,
    includeCreatedAt: false,
    includeModifiedAt: false,
  };
}

export function clampDepth(value: number): number {
  if (Number.isNaN(value)) {
    return DEFAULT_DEPTH;
  }
  return Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, Math.trunc(value)));
}
