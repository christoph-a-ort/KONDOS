import { isDirectory, type FsNode } from "../model";

export const ROW_HEIGHT = 28;
export const OVERSCAN = 12;
export const TREE_INDENT_PX = 16;

export interface VisibleTreeRow {
  id: string;
  node: FsNode;
  depth: number;
  directory: boolean;
}

export interface TreeWindow {
  start: number;
  end: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
}

export function deriveVisibleRows(
  root: FsNode,
  expandedIds: ReadonlySet<string>,
): VisibleTreeRow[] {
  const rows: VisibleTreeRow[] = [];

  function walk(node: FsNode, depth: number): void {
    const directory = isDirectory(node);
    rows.push({
      id: node.id,
      node,
      depth,
      directory,
    });

    if (directory && expandedIds.has(node.id)) {
      for (const child of node.children) {
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
