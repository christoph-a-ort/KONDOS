import { isDirectory, type DirectoryNode, type FsNode } from "../model";
import { DEFAULT_TREE_SORT, sortedChildren, type TreeSort } from "./treeSort";

export const ROW_HEIGHT = 28;
export const OVERSCAN = 12;
export const TREE_INDENT_PX = 16;

export interface VisibleTreeRow {
  id: string;
  node: FsNode;
  depth: number;
  directory: boolean;
  expandable: boolean;
}

export interface TreeWindow {
  start: number;
  end: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
}

export function canExpandDirectory(node: DirectoryNode): boolean {
  return node.children.length > 0;
}

export function listingHint(node: FsNode): "depthLimited" | "incomplete" | null {
  if (!isDirectory(node)) {
    return null;
  }
  if (node.listing === "depthLimited") {
    return "depthLimited";
  }
  if (node.listing === "incomplete") {
    return "incomplete";
  }
  return null;
}

export function selectedIdAfterClick(
  currentSelectedId: string | null,
  clickedId: string,
  keepCurrent: boolean,
): string | null {
  return keepCurrent ? currentSelectedId : clickedId;
}

export function selectedIdAfterCollapseAll(rootId: string): string {
  return rootId;
}

export function collapseAllExpandedIds(rootId: string): Set<string> {
  return new Set([rootId]);
}

export function collectExpandableDirectoryIds(
  root: FsNode,
  into: Set<string> = new Set(),
): Set<string> {
  if (isDirectory(root)) {
    if (canExpandDirectory(root)) {
      into.add(root.id);
    }
    for (const child of root.children) {
      collectExpandableDirectoryIds(child, into);
    }
  }
  return into;
}

export function deriveVisibleRows(
  root: FsNode,
  expandedIds: ReadonlySet<string>,
  sort: TreeSort = DEFAULT_TREE_SORT,
): VisibleTreeRow[] {
  const rows: VisibleTreeRow[] = [];

  function walk(node: FsNode, depth: number): void {
    const directory = isDirectory(node);
    rows.push({
      id: node.id,
      node,
      depth,
      directory,
      expandable: directory && canExpandDirectory(node),
    });

    if (directory && expandedIds.has(node.id) && node.children.length > 0) {
      for (const child of sortedChildren(node.children, sort)) {
        walk(child, depth + 1);
      }
    }
  }

  walk(root, 0);
  return rows;
}

export function computeTreeWindow(
  rowCount: number,
  scrollTop: number,
  viewportHeight: number,
): TreeWindow {
  if (rowCount <= 0) {
    return {
      start: 0,
      end: 0,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
    };
  }

  const firstVisible = Math.min(
    rowCount - 1,
    Math.max(0, Math.floor(Math.max(0, scrollTop) / ROW_HEIGHT)),
  );
  const visibleCount = Math.max(1, Math.ceil(Math.max(0, viewportHeight) / ROW_HEIGHT));
  const start = Math.max(0, firstVisible - OVERSCAN);
  const end = Math.min(rowCount, firstVisible + visibleCount + OVERSCAN);

  return {
    start,
    end,
    topSpacerHeight: start * ROW_HEIGHT,
    bottomSpacerHeight: (rowCount - end) * ROW_HEIGHT,
  };
}

export function rowIndexById(rows: readonly VisibleTreeRow[], id: string): number {
  return rows.findIndex((row) => row.id === id);
}

export function findNodeById(root: FsNode, id: string): FsNode | undefined {
  if (root.id === id) {
    return root;
  }
  if (isDirectory(root)) {
    for (const child of root.children) {
      const found = findNodeById(child, id);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}
