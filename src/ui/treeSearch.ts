import { isDirectory, type FsNode } from "../model";
import { sortedChildren, type TreeSort } from "./treeSort";

export function normalizeSearchQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

export function nodeMatchesQuery(node: Pick<FsNode, "name">, needle: string): boolean {
  if (needle.length === 0) {
    return false;
  }
  return node.name.toLocaleLowerCase().includes(needle);
}

export function collectMatchIds(root: FsNode, query: string, sort: TreeSort): string[] {
  const needle = normalizeSearchQuery(query);
  if (needle.length === 0) {
    return [];
  }
  const matches: string[] = [];
  function walk(node: FsNode): void {
    if (nodeMatchesQuery(node, needle)) {
      matches.push(node.id);
    }
    if (isDirectory(node) && node.children.length > 0) {
      for (const child of sortedChildren(node.children, sort)) {
        walk(child);
      }
    }
  }
  walk(root);
  return matches;
}

export function createMatchIdSet(matchIds: readonly string[]): Set<string> {
  return new Set(matchIds);
}

export function matchIndexAfterReorder(matchIds: readonly string[], previousId: string | null): number {
  if (matchIds.length === 0) {
    return -1;
  }
  if (previousId !== null) {
    const index = matchIds.indexOf(previousId);
    if (index >= 0) {
      return index;
    }
  }
  return 0;
}

export function matchIndexForNewQuery(matchIds: readonly string[]): number {
  return matchIds.length === 0 ? -1 : 0;
}

export function stepMatchIndex(currentIndex: number, matchCount: number, delta: number): number {
  if (matchCount <= 0) {
    return -1;
  }
  const start = currentIndex < 0 ? 0 : currentIndex;
  return (start + delta + matchCount * 8) % matchCount;
}

export function nextMatchIndex(currentIndex: number, matchCount: number, jumped: boolean): number {
  if (matchCount <= 0) {
    return -1;
  }
  if (!jumped) {
    return currentIndex < 0 ? 0 : currentIndex;
  }
  return stepMatchIndex(currentIndex, matchCount, 1);
}

export function previousMatchIndex(currentIndex: number, matchCount: number, jumped: boolean): number {
  if (matchCount <= 0) {
    return -1;
  }
  if (!jumped) {
    return currentIndex < 0 ? 0 : currentIndex;
  }
  return stepMatchIndex(currentIndex, matchCount, -1);
}

export function ancestorDirectoryIds(root: FsNode, targetId: string): string[] {
  const chain: string[] = [];
  function walk(node: FsNode, ancestors: string[]): boolean {
    if (node.id === targetId) {
      chain.push(...ancestors);
      return true;
    }
    if (!isDirectory(node)) {
      return false;
    }
    const next = [...ancestors, node.id];
    for (const child of node.children) {
      if (walk(child, next)) {
        return true;
      }
    }
    return false;
  }
  walk(root, []);
  return chain;
}

export function withAncestorsExpanded(
  expandedIds: ReadonlySet<string>,
  ancestorIds: readonly string[],
): Set<string> {
  const next = new Set(expandedIds);
  for (const id of ancestorIds) {
    next.add(id);
  }
  return next;
}

export function searchCountLabel(query: string, matchCount: number, currentIndex: number): string | null {
  if (normalizeSearchQuery(query).length === 0) {
    return null;
  }
  if (matchCount === 0) {
    return "0 Treffer";
  }
  return `${currentIndex + 1} von ${matchCount}`;
}

export function clipboardPath(node: Pick<FsNode, "path">): string {
  return node.path;
}

export function emptySearchQuery(): string {
  return "";
}
