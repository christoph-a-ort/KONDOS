import { isDirectory, isFile, type DirectoryNode, type FileNode, type FsNode } from "../model";
import { sortedChildren, type TreeSort } from "./treeSort";

export const NO_EXTENSION_KEY = "";
export const NO_EXTENSION_LABEL = "Ohne Dateiendung";

export interface DisplayFilterDraft {
  extensions: string[];
  modifiedFrom: string;
  modifiedUntil: string;
}

export interface AppliedDisplayFilter extends DisplayFilterDraft {}

export interface DisplayExtensionOption {
  key: string;
  label: string;
}

export interface DisplayFilterView {
  tree: FsNode | null;
  fileMatchCount: number;
  constrained: boolean;
}

export function emptyDisplayFilterDraft(): DisplayFilterDraft {
  return { extensions: [], modifiedFrom: "", modifiedUntil: "" };
}

export function displayFilterHasConstraint(filter: DisplayFilterDraft): boolean {
  return filter.extensions.length > 0 || filter.modifiedFrom.length > 0 || filter.modifiedUntil.length > 0;
}

export function isDateRangeInvalid(from: string, until: string): boolean {
  if (from.length === 0 || until.length === 0) {
    return false;
  }
  const start = startOfLocalDay(from);
  const end = startOfLocalDay(until);
  return start !== null && end !== null && start > end;
}

export function fileExtensionKey(name: string): string | null {
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === name.length - 1) {
    return null;
  }
  return name.slice(lastDot).toLocaleLowerCase();
}

export function collectDisplayExtensionOptions(root: FsNode): DisplayExtensionOption[] {
  const keys = new Set<string>();
  function walk(node: FsNode): void {
    if (isFile(node)) {
      const key = fileExtensionKey(node.name);
      keys.add(key ?? NO_EXTENSION_KEY);
    } else if (isDirectory(node)) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }
  walk(root);
  const named = [...keys]
    .filter((key) => key !== NO_EXTENSION_KEY)
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }))
    .map((key) => ({ key, label: key.slice(1).toLocaleUpperCase() }));
  if (keys.has(NO_EXTENSION_KEY)) {
    named.push({ key: NO_EXTENSION_KEY, label: NO_EXTENSION_LABEL });
  }
  return named;
}

export function snapshotHasModifiedTimestamps(root: FsNode): boolean {
  function walk(node: FsNode): boolean {
    if (isFile(node) && node.modifiedAtMs !== undefined) {
      return true;
    }
    if (isDirectory(node)) {
      return node.children.some(walk);
    }
    return false;
  }
  return walk(root);
}

export function fileMatchesDisplayFilter(node: FileNode, filter: AppliedDisplayFilter): boolean {
  if (!extensionMatches(node.name, filter.extensions)) {
    return false;
  }
  return modifiedMatches(node.modifiedAtMs, filter.modifiedFrom, filter.modifiedUntil);
}

export function buildDisplayFilterView(
  root: FsNode,
  filter: AppliedDisplayFilter | null,
  sort: TreeSort,
): DisplayFilterView {
  if (filter === null || !displayFilterHasConstraint(filter)) {
    return { tree: root, fileMatchCount: countFiles(root), constrained: false };
  }
  const pruned = pruneNode(root, filter, sort, true);
  return {
    tree: pruned.node,
    fileMatchCount: pruned.fileMatchCount,
    constrained: true,
  };
}

export function nodeVisibleInDisplayTree(root: FsNode | null, id: string): boolean {
  if (root === null) {
    return false;
  }
  return findId(root, id);
}

export function formatActiveFilterSummary(filter: AppliedDisplayFilter, options: readonly DisplayExtensionOption[]): string | null {
  if (!displayFilterHasConstraint(filter)) {
    return null;
  }
  const labels = filter.extensions.map((key) => {
    const option = options.find((item) => item.key === key);
    if (option !== undefined) {
      return option.label;
    }
    return key === NO_EXTENSION_KEY ? NO_EXTENSION_LABEL : key.replace(/^\./, "").toLocaleUpperCase();
  });
  const parts: string[] = [];
  if (labels.length > 0) {
    parts.push(labels.join(", "));
  }
  const from = formatDayDe(filter.modifiedFrom);
  const until = formatDayDe(filter.modifiedUntil);
  if (from !== null && until !== null) {
    parts.push(`${from}–${until}`);
  } else if (from !== null) {
    parts.push(`ab ${from}`);
  } else if (until !== null) {
    parts.push(`bis ${until}`);
  }
  return `Filter aktiv · ${parts.join(" · ")}`;
}

export function canScanFromHere(node: FsNode | undefined): boolean {
  return node !== undefined && isDirectory(node);
}

export function withScanRootPath<T extends { rootPath: string }>(config: T, path: string): T {
  if (config.rootPath === path) {
    return config;
  }
  return { ...config, rootPath: path };
}

export function displayFilterApplyError(
  draft: DisplayFilterDraft,
  hasModifiedTimestamps: boolean,
): string | null {
  if (isDateRangeInvalid(draft.modifiedFrom, draft.modifiedUntil)) {
    return "Das Von-Datum darf nicht nach dem Bis-Datum liegen.";
  }
  const wantsDate = draft.modifiedFrom.length > 0 || draft.modifiedUntil.length > 0;
  if (wantsDate && !hasModifiedTimestamps) {
    return "Datumsfilter benötigt Änderungsdaten. Beim Einlesen „Geändert“ aktivieren.";
  }
  return null;
}

function pruneNode(
  node: FsNode,
  filter: AppliedDisplayFilter,
  sort: TreeSort,
  isRoot: boolean,
): { node: FsNode | null; fileMatchCount: number } {
  if (isFile(node)) {
    if (fileMatchesDisplayFilter(node, filter)) {
      return { node, fileMatchCount: 1 };
    }
    return { node: null, fileMatchCount: 0 };
  }

  let fileMatchCount = 0;
  const kept: FsNode[] = [];
  for (const child of sortedChildren(node.children, sort)) {
    const pruned = pruneNode(child, filter, sort, false);
    fileMatchCount += pruned.fileMatchCount;
    if (pruned.node !== null) {
      kept.push(pruned.node);
    }
  }

  if (fileMatchCount === 0) {
    return { node: isRoot ? null : null, fileMatchCount: 0 };
  }

  const next: DirectoryNode = {
    ...node,
    children: kept,
  };
  return { node: next, fileMatchCount };
}

function extensionMatches(name: string, selected: readonly string[]): boolean {
  if (selected.length === 0) {
    return true;
  }
  const key = fileExtensionKey(name) ?? NO_EXTENSION_KEY;
  return selected.includes(key);
}

function modifiedMatches(modifiedAtMs: number | undefined, from: string, until: string): boolean {
  if (from.length === 0 && until.length === 0) {
    return true;
  }
  if (modifiedAtMs === undefined) {
    return false;
  }
  if (from.length > 0) {
    const start = startOfLocalDay(from);
    if (start !== null && modifiedAtMs < start) {
      return false;
    }
  }
  if (until.length > 0) {
    const end = endOfLocalDay(until);
    if (end !== null && modifiedAtMs > end) {
      return false;
    }
  }
  return true;
}

export function startOfLocalDay(ymd: string): number | null {
  const parts = parseYmd(ymd);
  if (parts === null) {
    return null;
  }
  return new Date(parts.year, parts.month - 1, parts.day).getTime();
}

export function endOfLocalDay(ymd: string): number | null {
  const parts = parseYmd(ymd);
  if (parts === null) {
    return null;
  }
  return new Date(parts.year, parts.month - 1, parts.day, 23, 59, 59, 999).getTime();
}

function parseYmd(ymd: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(year, month - 1, day);
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
    return null;
  }
  return { year, month, day };
}

function formatDayDe(ymd: string): string | null {
  const parts = parseYmd(ymd);
  if (parts === null) {
    return null;
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(parts.day)}.${pad(parts.month)}.${parts.year}`;
}

function countFiles(root: FsNode): number {
  let count = 0;
  function walk(node: FsNode): void {
    if (isFile(node)) {
      count += 1;
      return;
    }
    if (isDirectory(node)) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }
  walk(root);
  return count;
}

function findId(node: FsNode, id: string): boolean {
  if (node.id === id) {
    return true;
  }
  if (isDirectory(node)) {
    return node.children.some((child) => findId(child, id));
  }
  return false;
}
