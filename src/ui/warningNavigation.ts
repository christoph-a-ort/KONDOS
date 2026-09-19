import { isDirectory, type FsNode, type ScanWarning } from "../model";
import { deriveVisibleRows, findNodeById, rowIndexById } from "./treeRows";
import { ancestorDirectoryIds, withAncestorsExpanded } from "./treeSearch";
import { DEFAULT_TREE_SORT, type TreeSort } from "./treeSort";

export const WARNING_EXACT_NOTICE = null;

export const WARNING_ANCESTOR_NOTICE =
  "Das betroffene Element ist nicht im eingelesenen Ergebnis enthalten. Der zugehörige Ordner wurde ausgewählt.";

export const WARNING_HIDDEN_BY_FILTER_NOTICE =
  "Das betroffene Element ist durch den aktuellen Anzeigefilter ausgeblendet.";

export const WARNING_NO_TARGET_NOTICE =
  "Zum betroffenen Pfad ist im eingelesenen Ergebnis kein Element auffindbar.";

export type WarningJumpKind = "exact" | "ancestor" | "hidden-by-filter" | "none";

export interface WarningJump {
  kind: WarningJumpKind;
  targetId: string | null;
  ancestorIds: string[];
  notice: string | null;
  applySelection: boolean;
  offerFilterReset: boolean;
}

export function normalizeFsPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function isStrictPathAncestor(ancestorPath: string, descendantPath: string): boolean {
  const ancestor = normalizeFsPath(ancestorPath);
  const descendant = normalizeFsPath(descendantPath);
  if (ancestor.length === 0 || descendant.length === 0 || ancestor === descendant) {
    return false;
  }
  return descendant.startsWith(`${ancestor}/`);
}

export function findNodeByStoredOrNormalizedPath(root: FsNode, path: string): FsNode | undefined {
  const exact = findNodeById(root, path);
  if (exact !== undefined) {
    return exact;
  }
  const needle = normalizeFsPath(path);
  if (needle.length === 0) {
    return undefined;
  }
  return findByNormalizedPath(root, needle);
}

export function nearestExistingAncestorDirectory(root: FsNode, path: string): FsNode | undefined {
  let best: FsNode | undefined;
  let bestLength = -1;
  function walk(node: FsNode): void {
    if (isDirectory(node) && isStrictPathAncestor(node.path, path)) {
      const length = normalizeFsPath(node.path).length;
      if (length > bestLength) {
        best = node;
        bestLength = length;
      }
    }
    if (isDirectory(node)) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }
  walk(root);
  return best;
}

export function resolveWarningJump(
  snapshotRoot: FsNode,
  viewRoot: FsNode | null,
  warningPath: string,
): WarningJump {
  const exact = findNodeByStoredOrNormalizedPath(snapshotRoot, warningPath);
  if (exact !== undefined) {
    if (viewRoot === null || findNodeByStoredOrNormalizedPath(viewRoot, exact.id) === undefined) {
      return {
        kind: "hidden-by-filter",
        targetId: exact.id,
        ancestorIds: [],
        notice: WARNING_HIDDEN_BY_FILTER_NOTICE,
        applySelection: false,
        offerFilterReset: true,
      };
    }
    return {
      kind: "exact",
      targetId: exact.id,
      ancestorIds: ancestorDirectoryIds(viewRoot, exact.id),
      notice: WARNING_EXACT_NOTICE,
      applySelection: true,
      offerFilterReset: false,
    };
  }

  const ancestor = nearestExistingAncestorDirectory(snapshotRoot, warningPath);
  if (ancestor === undefined) {
    return {
      kind: "none",
      targetId: null,
      ancestorIds: [],
      notice: WARNING_NO_TARGET_NOTICE,
      applySelection: false,
      offerFilterReset: false,
    };
  }

  if (viewRoot === null || findNodeByStoredOrNormalizedPath(viewRoot, ancestor.id) === undefined) {
    return {
      kind: "hidden-by-filter",
      targetId: ancestor.id,
      ancestorIds: [],
      notice: WARNING_HIDDEN_BY_FILTER_NOTICE,
      applySelection: false,
      offerFilterReset: true,
    };
  }

  return {
    kind: "ancestor",
    targetId: ancestor.id,
    ancestorIds: ancestorDirectoryIds(viewRoot, ancestor.id),
    notice: WARNING_ANCESTOR_NOTICE,
    applySelection: true,
    offerFilterReset: false,
  };
}

export function warningRevealPlan(
  viewRoot: FsNode,
  expandedIds: ReadonlySet<string>,
  targetId: string,
  sort: TreeSort = DEFAULT_TREE_SORT,
): { ancestorIds: string[]; rowIndex: number } {
  const ancestorIds = ancestorDirectoryIds(viewRoot, targetId);
  const nextExpanded = withAncestorsExpanded(expandedIds, ancestorIds);
  const rows = deriveVisibleRows(viewRoot, nextExpanded, sort);
  return {
    ancestorIds,
    rowIndex: rowIndexById(rows, targetId),
  };
}

export function warningsForExactPath(
  warnings: readonly ScanWarning[],
  path: string,
): ScanWarning[] {
  const needle = normalizeFsPath(path);
  return warnings.filter((warning) => normalizeFsPath(warning.path) === needle);
}

function findByNormalizedPath(node: FsNode, needle: string): FsNode | undefined {
  if (normalizeFsPath(node.path) === needle || normalizeFsPath(node.id) === needle) {
    return node;
  }
  if (isDirectory(node)) {
    for (const child of node.children) {
      const found = findByNormalizedPath(child, needle);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}
