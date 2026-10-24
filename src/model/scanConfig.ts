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
    // Always on for capture/safety; UI no longer toggles these.
    includeSize: true,
    includeCreatedAt: false,
    includeModifiedAt: true,
  };
}

/** Legacy prefs may store false; capture must not be disabled. */
export function withRequiredScanIdentityMetadata(config: ScanConfig): ScanConfig {
  return {
    ...config,
    includeSize: true,
    includeModifiedAt: true,
  };
}

export function clampDepth(value: number): number {
  if (Number.isNaN(value)) {
    return DEFAULT_DEPTH;
  }
  return Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, Math.trunc(value)));
}
