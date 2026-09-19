import { clampDepth, createDefaultScanConfig, type ScanConfig } from "../model";
import { formatExtensionInput, parseExtensionInput } from "../filter";
import {
  COLUMN_MIN_WIDTH,
  DEFAULT_COLUMN_VISIBILITY,
  DEFAULT_COLUMN_WIDTHS,
  type ColumnVisibility,
  type ColumnWidths,
} from "./treeColumns";
import { DEFAULT_TREE_SORT, type SortColumn, type SortDirection, type TreeSort } from "./treeSort";

export const WORKBENCH_PREFS_KEY = "kondos.workbench-prefs.v1";
export const WORKBENCH_PREFS_VERSION = 1;

export interface WorkbenchPrefs {
  version: number;
  rootPath: string;
  maxDepth: number;
  excludeHidden: boolean;
  extensionInput: string;
  includeSize: boolean;
  includeCreatedAt: boolean;
  includeModifiedAt: boolean;
  columnVisibility: ColumnVisibility;
  columnWidths: ColumnWidths;
  sort: TreeSort;
}

export interface WorkbenchStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SORT_COLUMNS: readonly SortColumn[] = ["name", "size", "modified", "created"];
const SORT_DIRECTIONS: readonly SortDirection[] = ["asc", "desc"];

export function defaultWorkbenchPrefs(): WorkbenchPrefs {
  const config = createDefaultScanConfig();
  return {
    version: WORKBENCH_PREFS_VERSION,
    rootPath: "",
    maxDepth: config.maxDepth,
    excludeHidden: config.excludeHidden,
    extensionInput: "",
    includeSize: config.includeSize,
    includeCreatedAt: config.includeCreatedAt,
    includeModifiedAt: config.includeModifiedAt,
    columnVisibility: { ...DEFAULT_COLUMN_VISIBILITY },
    columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
    sort: { ...DEFAULT_TREE_SORT },
  };
}

export function prefsToScanConfig(prefs: WorkbenchPrefs): ScanConfig {
  return {
    rootPath: prefs.rootPath,
    maxDepth: prefs.maxDepth,
    excludeHidden: prefs.excludeHidden,
    extensions: parseExtensionInput(prefs.extensionInput),
    includeSize: prefs.includeSize,
    includeCreatedAt: prefs.includeCreatedAt,
    includeModifiedAt: prefs.includeModifiedAt,
  };
}

export function workbenchPrefsFromState(input: {
  config: ScanConfig;
  extensionInput: string;
  columnVisibility: ColumnVisibility;
  columnWidths: ColumnWidths;
  sort: TreeSort;
}): WorkbenchPrefs {
  return sanitizeWorkbenchPrefs({
    version: WORKBENCH_PREFS_VERSION,
    rootPath: input.config.rootPath,
    maxDepth: input.config.maxDepth,
    excludeHidden: input.config.excludeHidden,
    extensionInput: input.extensionInput,
    includeSize: input.config.includeSize,
    includeCreatedAt: input.config.includeCreatedAt,
    includeModifiedAt: input.config.includeModifiedAt,
    columnVisibility: input.columnVisibility,
    columnWidths: input.columnWidths,
    sort: input.sort,
  });
}

export function sanitizeWorkbenchPrefs(raw: unknown): WorkbenchPrefs {
  const defaults = defaultWorkbenchPrefs();
  if (raw === null || typeof raw !== "object") {
    return defaults;
  }
  const value = raw as Record<string, unknown>;
  const visibility = asRecord(value.columnVisibility);
  const widths = asRecord(value.columnWidths);
  const sort = asRecord(value.sort);

  const extensionInput =
    typeof value.extensionInput === "string"
      ? formatExtensionInput(parseExtensionInput(value.extensionInput))
      : Array.isArray(value.extensions)
        ? formatExtensionInput(
            value.extensions.filter((item): item is string => typeof item === "string"),
          )
        : defaults.extensionInput;

  return {
    version: WORKBENCH_PREFS_VERSION,
    rootPath: typeof value.rootPath === "string" ? value.rootPath : defaults.rootPath,
    maxDepth: clampDepth(typeof value.maxDepth === "number" ? value.maxDepth : defaults.maxDepth),
    excludeHidden: typeof value.excludeHidden === "boolean" ? value.excludeHidden : defaults.excludeHidden,
    extensionInput,
    includeSize: typeof value.includeSize === "boolean" ? value.includeSize : defaults.includeSize,
    includeCreatedAt:
      typeof value.includeCreatedAt === "boolean" ? value.includeCreatedAt : defaults.includeCreatedAt,
    includeModifiedAt:
      typeof value.includeModifiedAt === "boolean" ? value.includeModifiedAt : defaults.includeModifiedAt,
    columnVisibility: {
      size: typeof visibility.size === "boolean" ? visibility.size : defaults.columnVisibility.size,
      modified:
        typeof visibility.modified === "boolean" ? visibility.modified : defaults.columnVisibility.modified,
      created:
        typeof visibility.created === "boolean" ? visibility.created : defaults.columnVisibility.created,
    },
    columnWidths: {
      name: sanitizeWidth("name", widths.name, defaults.columnWidths.name),
      size: sanitizeWidth("size", widths.size, defaults.columnWidths.size),
      modified: sanitizeWidth("modified", widths.modified, defaults.columnWidths.modified),
      created: sanitizeWidth("created", widths.created, defaults.columnWidths.created),
    },
    sort: {
      column: isSortColumn(sort.column) ? sort.column : defaults.sort.column,
      direction: isSortDirection(sort.direction) ? sort.direction : defaults.sort.direction,
    },
  };
}

export function hadStoredWorkbenchPrefs(storage: WorkbenchStorage | null = browserStorage()): boolean {
  if (storage === null) {
    return false;
  }
  try {
    const raw = storage.getItem(WORKBENCH_PREFS_KEY);
    return raw !== null && raw.trim().length > 0;
  } catch {
    return false;
  }
}

export function loadWorkbenchPrefs(storage: WorkbenchStorage | null = browserStorage()): WorkbenchPrefs {
  if (storage === null) {
    return defaultWorkbenchPrefs();
  }
  try {
    const raw = storage.getItem(WORKBENCH_PREFS_KEY);
    if (raw === null || raw.trim().length === 0) {
      return defaultWorkbenchPrefs();
    }
    return sanitizeWorkbenchPrefs(JSON.parse(raw) as unknown);
  } catch {
    return defaultWorkbenchPrefs();
  }
}

export function saveWorkbenchPrefs(
  prefs: WorkbenchPrefs,
  storage: WorkbenchStorage | null = browserStorage(),
): boolean {
  if (storage === null) {
    return false;
  }
  try {
    storage.setItem(WORKBENCH_PREFS_KEY, JSON.stringify(sanitizeWorkbenchPrefs(prefs)));
    return true;
  } catch {
    return false;
  }
}

export function browserStorage(): WorkbenchStorage | null {
  try {
    if (typeof localStorage === "undefined") {
      return null;
    }
    return localStorage;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return {};
  }
  return value as Record<string, unknown>;
}

function sanitizeWidth(column: keyof ColumnWidths, value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(COLUMN_MIN_WIDTH[column], Math.round(value));
}

function isSortColumn(value: unknown): value is SortColumn {
  return typeof value === "string" && SORT_COLUMNS.includes(value as SortColumn);
}

function isSortDirection(value: unknown): value is SortDirection {
  return typeof value === "string" && SORT_DIRECTIONS.includes(value as SortDirection);
}
