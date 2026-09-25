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

export const WORKBENCH_PREFS_KEY = "dottyfm.workbench-prefs.v1";
export const LEGACY_WORKBENCH_PREFS_KEY = "kondos.workbench-prefs.v1";
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
    return storedRaw(storage, WORKBENCH_PREFS_KEY) !== null || storedRaw(storage, LEGACY_WORKBENCH_PREFS_KEY) !== null;
  } catch {
    return false;
  }
}

export function loadWorkbenchPrefs(storage: WorkbenchStorage | null = browserStorage()): WorkbenchPrefs {
  if (storage === null) {
    return defaultWorkbenchPrefs();
  }
  try {
    const current = storedRaw(storage, WORKBENCH_PREFS_KEY);
    if (current !== null) {
      return parseStoredPrefs(current) ?? defaultWorkbenchPrefs();
    }
    const legacy = storedRaw(storage, LEGACY_WORKBENCH_PREFS_KEY);
    if (legacy === null) {
      return defaultWorkbenchPrefs();
    }
    const migrated = parseStoredPrefs(legacy);
    if (migrated === null) {
      return defaultWorkbenchPrefs();
    }
    saveWorkbenchPrefs(migrated, storage);
    return migrated;
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

export type WorkbenchPrefsSource = "json" | "localStorage" | "legacy" | "default";

export interface WorkbenchPrefsJsonStore {
  load(): Promise<string | null>;
  save(json: string): Promise<void>;
}

export interface WorkbenchPrefsHydration {
  prefs: WorkbenchPrefs;
  source: WorkbenchPrefsSource;
  preferStoredWidths: boolean;
  /** True when a prefs file existed but was unusable; file must not be overwritten immediately. */
  corruptedJson: boolean;
  notice: string | null;
}

/** Persist gate: never write prefs until hydration finished. */
export function canPersistWorkbenchPrefs(prefsReady: boolean): boolean {
  return prefsReady;
}

/**
 * Resolve start prefs.
 * - With `jsonStore` (Tauri): JSON file is authority; localStorage is migration-only.
 * - Without `jsonStore` (browser-only dev): localStorage remains the store.
 */
export async function hydrateWorkbenchPrefs(
  jsonStore: WorkbenchPrefsJsonStore | null,
  storage: WorkbenchStorage | null = browserStorage(),
): Promise<WorkbenchPrefsHydration> {
  if (jsonStore === null) {
    const prefs = loadWorkbenchPrefs(storage);
    const preferStoredWidths = hadStoredWorkbenchPrefs(storage);
    return {
      prefs,
      source: preferStoredWidths ? "localStorage" : "default",
      preferStoredWidths,
      corruptedJson: false,
      notice: null,
    };
  }

  let raw: string | null;
  try {
    raw = await jsonStore.load();
  } catch (cause) {
    return {
      prefs: defaultWorkbenchPrefs(),
      source: "default",
      preferStoredWidths: false,
      corruptedJson: true,
      notice: prefsUserMessage(
        cause,
        "Die Workbench-Einstellungen konnten nicht geladen werden. Es werden Standardeinstellungen verwendet.",
      ),
    };
  }

  if (raw !== null) {
    const parsed = parseStoredPrefs(raw);
    if (parsed === null) {
      return {
        prefs: defaultWorkbenchPrefs(),
        source: "default",
        preferStoredWidths: false,
        corruptedJson: true,
        notice:
          "Die Workbench-Einstellungen sind beschädigt. Es werden Standardeinstellungen verwendet. Die Datei bleibt zur Diagnose erhalten.",
      };
    }
    return {
      prefs: parsed,
      source: "json",
      preferStoredWidths: true,
      corruptedJson: false,
      notice: null,
    };
  }

  const migrated = tryMigrateFromLocalStorage(storage);
  if (migrated !== null) {
    const json = JSON.stringify(migrated.prefs);
    try {
      await jsonStore.save(json);
    } catch (cause) {
      return {
        prefs: migrated.prefs,
        source: migrated.source,
        preferStoredWidths: true,
        corruptedJson: false,
        notice: prefsUserMessage(
          cause,
          "Die Workbench-Einstellungen wurden geladen, konnten aber nicht dauerhaft gespeichert werden.",
        ),
      };
    }
    return {
      prefs: migrated.prefs,
      source: migrated.source,
      preferStoredWidths: true,
      corruptedJson: false,
      notice: null,
    };
  }

  return {
    prefs: defaultWorkbenchPrefs(),
    source: "default",
    preferStoredWidths: false,
    corruptedJson: false,
    notice: null,
  };
}

/** Persist after hydration. Tauri → JSON only. Browser-only → localStorage only. */
export async function persistWorkbenchPrefs(
  prefs: WorkbenchPrefs,
  jsonStore: WorkbenchPrefsJsonStore | null,
  storage: WorkbenchStorage | null = browserStorage(),
): Promise<void> {
  const sanitized = sanitizeWorkbenchPrefs(prefs);
  const json = JSON.stringify(sanitized);
  if (jsonStore !== null) {
    await jsonStore.save(json);
    return;
  }
  if (!saveWorkbenchPrefs(sanitized, storage)) {
    throw new Error("Die Workbench-Einstellungen konnten nicht gespeichert werden.");
  }
}

function tryMigrateFromLocalStorage(
  storage: WorkbenchStorage | null,
): { prefs: WorkbenchPrefs; source: "localStorage" | "legacy" } | null {
  if (storage === null) {
    return null;
  }
  try {
    const current = storedRaw(storage, WORKBENCH_PREFS_KEY);
    if (current !== null) {
      const prefs = parseStoredPrefs(current);
      return prefs === null ? null : { prefs, source: "localStorage" };
    }
    const legacy = storedRaw(storage, LEGACY_WORKBENCH_PREFS_KEY);
    if (legacy === null) {
      return null;
    }
    const prefs = parseStoredPrefs(legacy);
    if (prefs === null) {
      return null;
    }
    // Keep legacy key; also mirror into current key as non-authoritative backup.
    saveWorkbenchPrefs(prefs, storage);
    return { prefs, source: "legacy" };
  } catch {
    return null;
  }
}

function prefsUserMessage(cause: unknown, fallback: string): string {
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === "string" && message.trim() !== "") {
      return message;
    }
  }
  if (typeof cause === "string" && cause.trim() !== "") {
    return cause;
  }
  return fallback;
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

function storedRaw(storage: WorkbenchStorage, key: string): string | null {
  const raw = storage.getItem(key);
  if (raw === null || raw.trim().length === 0) {
    return null;
  }
  return raw;
}

function parseStoredPrefs(raw: string): WorkbenchPrefs | null {
  try {
    return sanitizeWorkbenchPrefs(JSON.parse(raw) as unknown);
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
