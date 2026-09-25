import { type DirectoryNode, type FileNode, type FsNode } from "../model";
import {
  OVERSCAN,
  ROW_HEIGHT,
  computeTreeWindow,
  deriveVisibleRows,
} from "./treeRows";
import { runTreeWorkbenchCheck } from "./treeWorkbenchCheck";

function fileNode(id: string, name: string, depth: number): FileNode {
  return { id, name, path: id, depth, kind: "file" };
}

function directoryNode(
  id: string,
  name: string,
  depth: number,
  children: FsNode[],
): DirectoryNode {
  return { id, name, path: id, depth, kind: "directory", listing: "read", children };
}

function collectDirectoryIds(root: FsNode, into: Set<string> = new Set()): Set<string> {
  if (root.kind === "directory") {
    into.add(root.id);
    for (const child of root.children) {
      collectDirectoryIds(child, into);
    }
  }
  return into;
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function buildOrderFixture(): DirectoryNode {
  return directoryNode("root", "root", 0, [
    directoryNode("root/A", "A", 1, [
      fileNode("root/A/a1", "a1", 2),
      fileNode("root/A/a2", "a2", 2),
    ]),
    fileNode("root/B", "B", 1),
    directoryNode("root/C", "C", 1, [fileNode("root/C/c1", "c1", 2)]),
  ]);
}

/** 1 root + 100 directories + 100 * 999 files = 100_001 nodes. */
export function buildSynthetic100kTree(): DirectoryNode {
  const directories: FsNode[] = [];
  for (let index = 0; index < 100; index += 1) {
    const files: FsNode[] = [];
    for (let fileIndex = 0; fileIndex < 999; fileIndex += 1) {
      files.push(fileNode(`/d${index}/f${fileIndex}`, `f${fileIndex}`, 2));
    }
    directories.push(directoryNode(`/d${index}`, `d${index}`, 1, files));
  }
  return directoryNode("/", "root", 0, directories);
}

export async function runTreeVirtualizationCheck(): Promise<{
  nodeCount: number;
  defaultVisibleRows: number;
  fullyExpandedVisibleRows: number;
  viewportHeight: number;
  rowHeight: number;
  overscan: number;
  renderedAtTop: number;
  renderedAtMiddle: number;
  fullTreeDom: boolean;
}> {
  await runTreeWorkbenchCheck();

  const fixture = buildOrderFixture();
  const defaultRows = deriveVisibleRows(fixture, new Set(["root"]));
  assertEqual(defaultRows.map((row) => row.id).join(","), "root,root/A,root/C,root/B", "default order");
  assertEqual(defaultRows[0]?.depth, 0, "root depth");
  assertEqual(defaultRows[1]?.depth, 1, "child depth");

  const expandedA = deriveVisibleRows(fixture, new Set(["root", "root/A"]));
  assertEqual(
    expandedA.map((row) => row.id).join(","),
    "root,root/A,root/A/a1,root/A/a2,root/C,root/B",
    "expanded A order",
  );

  const fullySmall = deriveVisibleRows(fixture, collectDirectoryIds(fixture));
  assertEqual(
    fullySmall.map((row) => row.id).join(","),
    "root,root/A,root/A/a1,root/A/a2,root/C,root/C/c1,root/B",
    "fully expanded order",
  );

  const tree = buildSynthetic100kTree();
  const nodeCount = 1 + 100 + 100 * 999;
  const defaultVisibleRows = deriveVisibleRows(tree, new Set(["/"])).length;
  assertEqual(defaultVisibleRows, 101, "default 100k visible rows");

  const fullyExpandedVisibleRows = deriveVisibleRows(tree, collectDirectoryIds(tree)).length;
  assertEqual(fullyExpandedVisibleRows, nodeCount, "fully expanded 100k visible rows");

  const viewportHeight = 560;
  const topWindow = computeTreeWindow(fullyExpandedVisibleRows, 0, viewportHeight);
  const renderedAtTop = topWindow.end - topWindow.start;
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT);
  assertEqual(topWindow.start, 0, "top start");
  assertEqual(topWindow.end, visibleCount + OVERSCAN, "top end");
  assertEqual(topWindow.topSpacerHeight, 0, "top spacer");
  assertEqual(
    topWindow.bottomSpacerHeight,
    (fullyExpandedVisibleRows - topWindow.end) * ROW_HEIGHT,
    "bottom spacer at top",
  );

  const middleScrollTop = 40_000 * ROW_HEIGHT;
  const middleWindow = computeTreeWindow(
    fullyExpandedVisibleRows,
    middleScrollTop,
    viewportHeight,
  );
  const renderedAtMiddle = middleWindow.end - middleWindow.start;
  assertEqual(middleWindow.start, 40_000 - OVERSCAN, "middle start");
  assertEqual(middleWindow.end, 40_000 + visibleCount + OVERSCAN, "middle end");
  assertEqual(middleWindow.topSpacerHeight, (40_000 - OVERSCAN) * ROW_HEIGHT, "middle top spacer");
  assertEqual(
    middleWindow.bottomSpacerHeight,
    (fullyExpandedVisibleRows - middleWindow.end) * ROW_HEIGHT,
    "middle bottom spacer",
  );

  return {
    nodeCount,
    defaultVisibleRows,
    fullyExpandedVisibleRows,
    viewportHeight,
    rowHeight: ROW_HEIGHT,
    overscan: OVERSCAN,
    renderedAtTop,
    renderedAtMiddle,
    fullTreeDom: false,
  };
}
