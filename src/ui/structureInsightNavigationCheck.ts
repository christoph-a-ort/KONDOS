/**
 * P2-J-F navigation / marker helper checks.
 * Synthetic fixtures only. No filesystem. No UI mounting.
 */

import type { DirectoryNode, FileNode, FsNode } from "../model";
import {
  INSIGHT_SHOW_IN_TREE_LABEL,
  buildFolderInsightIdsByLocation,
  canNavigateToScanNode,
  firstInsightIdForLocation,
  insightCountForFolder,
  insightMarkerAriaLabel,
  insightMarkerCountLabel,
  insightMarkerTooltip,
  shouldAcceptInsightFocusRequest,
  shouldAcceptTreeRevealRequest,
  type InsightFocusRequest,
  type TreeRevealRequest,
} from "./structureInsightNavigation";
import type { InsightCardModel, InsightLocationGroup, StructureInsightViewModel } from "./structureInsightViewModel";
import { STRUCTURE_INSIGHT_VIEW_MODEL_SCHEMA_VERSION } from "./structureInsightViewModel";

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(label);
  }
}

function file(id: string, name: string, depth = 2): FileNode {
  return { id, name, path: id, depth, kind: "file" };
}

function dir(id: string, name: string, depth: number, children: FsNode[]): DirectoryNode {
  return { id, name, path: id, depth, kind: "directory", listing: "read", children };
}

function card(id: string, locationId: string): InsightCardModel {
  return {
    id,
    locationId,
    principle: "p",
    category: "file-names",
    categoryLabel: "Dateinamen",
    title: "t",
    factLine: "f",
    evidenceLevel: "high",
    evidenceLabel: "Hoch",
    incompleteData: false,
    explanationBullets: [],
    structureSummary: { plainDescription: "", examples: [] },
    primaryElements: [],
    secondaryRecurringGroups: [],
    otherElements: [],
    searchText: "",
  };
}

function loc(
  locationId: string,
  kind: InsightLocationGroup["kind"],
  insightIds: string[],
): InsightLocationGroup {
  return {
    locationId,
    kind,
    insightIds,
    displayPathSegments:
      kind === "root"
        ? []
        : [{ nodeId: locationId, displayName: locationId.split("/").pop() ?? locationId }],
    rootContextLabel: kind === "root" ? "Eingelesener Hauptordner" : undefined,
  };
}

export function runStructureInsightNavigationCheck(): void {
  assert(INSIGHT_SHOW_IN_TREE_LABEL === "Im Strukturbaum anzeigen", "show in tree label");

  const root = dir("root", "Root", 0, [
    dir("root/A", "A", 1, [
      file("root/A/f1.txt", "f1.txt", 2),
      dir("root/A/B", "B", 2, [file("root/A/B/f2.txt", "f2.txt", 3)]),
    ]),
    dir("root/C", "C", 1, []),
  ]);

  assert(canNavigateToScanNode(root, "root/A/B/f2.txt"), "file node exists");
  assert(canNavigateToScanNode(root, "root"), "root exists");
  assert(!canNavigateToScanNode(root, "missing"), "missing node");

  const vm: StructureInsightViewModel = {
    schemaVersion: STRUCTURE_INSIGHT_VIEW_MODEL_SCHEMA_VERSION,
    locations: [
      loc("root/A", "folder", ["i1", "i2"]),
      loc("root", "root", ["i3"]),
      loc("root/C", "folder", []),
    ],
    insights: [card("i1", "root/A"), card("i2", "root/A"), card("i3", "root")],
    countsByEvidence: { high: 3, medium: 0, low: 0, unassessed: 0, total: 3 },
    countsByCategory: {
      "file-names": 3,
      "folder-structure": 0,
      "time-years": 0,
      "file-distribution": 0,
    },
    globallyIncomplete: false,
  };

  const index = buildFolderInsightIdsByLocation(vm);
  assert(insightCountForFolder(index, "root/A") === 2, "folder local count 2");
  assert(insightCountForFolder(index, "root") === 1, "root local count 1");
  assert(insightCountForFolder(index, "root/C") === 0, "empty location omitted/zero");
  assert(insightCountForFolder(index, "root/A/B") === 0, "no child aggregation");
  assert(index.get("root/A")?.[0] === "i1", "insight order first");
  assert(index.get("root/A")?.[1] === "i2", "insight order second");
  assert(!index.has("root/C"), "zero-insight location not in map");

  assert(insightMarkerTooltip(1) === "1 Erkenntnis von Dotty", "tooltip singular");
  assert(insightMarkerTooltip(2) === "2 Erkenntnisse von Dotty", "tooltip plural");
  assert(insightMarkerCountLabel(1) === "", "count label empty for one");
  assert(insightMarkerCountLabel(3) === "3", "count label for many");
  assert(insightMarkerAriaLabel(1, "A").includes("1 Erkenntnis"), "aria singular");
  assert(insightMarkerAriaLabel(2, "A").includes("2 Erkenntnisse"), "aria plural");

  assert(firstInsightIdForLocation(vm, "root/A") === "i1", "first insight");
  assert(firstInsightIdForLocation(vm, "root/C") === null, "no first for empty");

  const revealOk: TreeRevealRequest = { id: 1, scanId: 9, nodeId: "root/A" };
  assert(shouldAcceptTreeRevealRequest(revealOk, 9), "accept reveal");
  assert(!shouldAcceptTreeRevealRequest(revealOk, 8), "reject stale scan reveal");
  assert(!shouldAcceptTreeRevealRequest(null, 9), "reject null reveal");

  const focusOk: InsightFocusRequest = {
    id: 2,
    scanId: 9,
    locationId: "root/A",
    firstInsightId: "i1",
  };
  assert(shouldAcceptInsightFocusRequest(focusOk, 9), "accept focus");
  assert(!shouldAcceptInsightFocusRequest(focusOk, null), "reject null scan focus");

  assert(buildFolderInsightIdsByLocation(null).size === 0, "null vm empty map");
}
