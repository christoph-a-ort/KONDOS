// Dev-side P0-C2 check. Mirrors src/ui/treeRows.ts (ROW_HEIGHT, OVERSCAN, deriveVisibleRows, computeTreeWindow).
// Not imported by the app. No extra dependency.

const ROW_HEIGHT = 28;
const OVERSCAN = 12;

function isDirectory(node) {
  return node.kind === "directory";
}

function deriveVisibleRows(root, expandedIds) {
  const rows = [];

  function walk(node, depth) {
    const directory = isDirectory(node);
    rows.push({
      id: node.id,
      node,
      depth,
      directory,
    });
    if (directory && expandedIds.has(node.id)) {
      for (const child of sortedChildren(node.children)) {
        walk(child, depth + 1);
      }
    }
  }

  walk(root, 0);
  return rows;
}

function sortedChildren(children) {
  return children.slice().sort((left, right) => {
    const leftDir = isDirectory(left);
    const rightDir = isDirectory(right);
    if (leftDir !== rightDir) {
      return leftDir ? -1 : 1;
    }
    if (left.name !== right.name) {
      return left.name < right.name ? -1 : 1;
    }
    return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
  });
}

function computeTreeWindow(rowCount, scrollTop, viewportHeight) {
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

function fileNode(id, name, depth) {
  return { id, name, path: id, depth, kind: "file" };
}

function directoryNode(id, name, depth, children) {
  return { id, name, path: id, depth, kind: "directory", listing: "read", children };
}

function collectDirectoryIds(root, into = new Set()) {
  if (root.kind === "directory") {
    into.add(root.id);
    for (const child of root.children) {
      collectDirectoryIds(child, into);
    }
  }
  return into;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function buildOrderFixture() {
  return directoryNode("root", "root", 0, [
    directoryNode("root/A", "A", 1, [
      fileNode("root/A/a1", "a1", 2),
      fileNode("root/A/a2", "a2", 2),
    ]),
    fileNode("root/B", "B", 1),
    directoryNode("root/C", "C", 1, [fileNode("root/C/c1", "c1", 2)]),
  ]);
}

function buildSynthetic100kTree() {
  const directories = [];
  for (let index = 0; index < 100; index += 1) {
    const files = [];
    for (let fileIndex = 0; fileIndex < 999; fileIndex += 1) {
      files.push(fileNode(`/d${index}/f${fileIndex}`, `f${fileIndex}`, 2));
    }
    directories.push(directoryNode(`/d${index}`, `d${index}`, 1, files));
  }
  return directoryNode("/", "root", 0, directories);
}

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
const rootExpandedIds = new Set(["/"]);
const fullyExpandedIds = collectDirectoryIds(tree);
const TIMED_RUNS = 7;

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function timeRuns(fn, runs) {
  const timesMs = [];
  let last;
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    last = fn();
    timesMs.push(performance.now() - started);
  }
  return { timesMs, last };
}

const rootTimed = timeRuns(() => deriveVisibleRows(tree, rootExpandedIds), TIMED_RUNS);
const defaultVisibleRows = rootTimed.last.length;
assertEqual(defaultVisibleRows, 101, "default 100k visible rows");

const fullTimed = timeRuns(() => deriveVisibleRows(tree, fullyExpandedIds), TIMED_RUNS);
const fullyExpandedVisibleRows = fullTimed.last.length;
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
const topWindowTimed = timeRuns(
  () => computeTreeWindow(fullyExpandedVisibleRows, 0, viewportHeight),
  TIMED_RUNS,
);
const middleWindowTimed = timeRuns(
  () => computeTreeWindow(fullyExpandedVisibleRows, middleScrollTop, viewportHeight),
  TIMED_RUNS,
);
const middleWindow = middleWindowTimed.last;
const renderedAtMiddle = middleWindow.end - middleWindow.start;
assertEqual(middleWindow.start, 40_000 - OVERSCAN, "middle start");
assertEqual(middleWindow.end, 40_000 + visibleCount + OVERSCAN, "middle end");
assertEqual(middleWindow.topSpacerHeight, (40_000 - OVERSCAN) * ROW_HEIGHT, "middle top spacer");
assertEqual(
  middleWindow.bottomSpacerHeight,
  (fullyExpandedVisibleRows - middleWindow.end) * ROW_HEIGHT,
  "middle bottom spacer",
);

console.log(
  JSON.stringify(
    {
      nodeCount,
      defaultVisibleRows,
      fullyExpandedVisibleRows,
      viewportHeight,
      rowHeight: ROW_HEIGHT,
      overscan: OVERSCAN,
      renderedAtTop,
      renderedAtMiddle,
      fullTreeDom: false,
      timing: {
        runs: TIMED_RUNS,
        treeBuildOutsideTimer: true,
        expandedIdSetOutsideTimer: true,
        rootExpandedMs: rootTimed.timesMs,
        rootExpandedMedianMs: median(rootTimed.timesMs),
        fullyExpandedMs: fullTimed.timesMs,
        fullyExpandedMedianMs: median(fullTimed.timesMs),
        windowTopMs: topWindowTimed.timesMs,
        windowTopMedianMs: median(topWindowTimed.timesMs),
        windowMiddleMs: middleWindowTimed.timesMs,
        windowMiddleMedianMs: median(middleWindowTimed.timesMs),
      },
    },
    null,
    2,
  ),
);
