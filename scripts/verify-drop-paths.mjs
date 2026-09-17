// Dev-side P0-F check. Mirrors src/scan/dropPaths.ts. Not imported by the app.

function decideDroppedPaths(paths) {
  if (paths.length !== 1) {
    return { action: "reject-count" };
  }

  const path = paths[0];
  if (typeof path !== "string" || path.length === 0) {
    return { action: "reject-count" };
  }

  return { action: "accept", path };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

assertEqual(decideDroppedPaths([]).action, "reject-count", "empty");
assertEqual(decideDroppedPaths(["a", "b"]).action, "reject-count", "multiple");
assertEqual(decideDroppedPaths([""]).action, "reject-count", "blank");
assertEqual(decideDroppedPaths(["C:\\Ordner äöü"]).action, "accept", "single");
assertEqual(decideDroppedPaths(["C:\\Ordner äöü"]).path, "C:\\Ordner äöü", "path preserved");

console.log("drop path checks passed");
