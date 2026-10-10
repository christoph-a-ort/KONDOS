/**
 * P2-J-E structure insight details checks — presentation helpers only.
 * No private paths. No filesystem. No UI mounting.
 */

import {
  INSIGHT_LIST_INITIAL_LIMIT,
  INSIGHT_OTHER_ELEMENTS_HEADING,
  INSIGHT_PRIMARY_ELEMENTS_HEADING,
  displayableExamples,
  displayableExplanationBullets,
  displayableStructuralParts,
  insightElementDisplayLines,
  insightElementListHasMore,
  insightNestedListKey,
  otherElementsHeading,
  visibleInsightElements,
} from "./structureInsightDetailsHelpers";
import type { InsightElementRef } from "./structureInsightViewModel";

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(label);
  }
}

function el(id: string, name: string, path?: string): InsightElementRef {
  return {
    nodeId: id,
    displayName: name,
    role: "primary",
    ...(path !== undefined ? { relativePath: path } : {}),
  };
}

export function runStructureInsightDetailsCheck(): void {
  assert(INSIGHT_LIST_INITIAL_LIMIT === 6, "initial list limit");
  assert(
    INSIGHT_PRIMARY_ELEMENTS_HEADING === "Elemente der erkannten Hauptstruktur",
    "primary heading",
  );
  assert(
    INSIGHT_OTHER_ELEMENTS_HEADING === "Elemente mit anderer erkannter Struktur",
    "other heading",
  );

  assert(displayableStructuralParts(undefined).length === 0, "parts undefined empty");
  assert(displayableStructuralParts([]).length === 0, "parts empty");
  assert(
    displayableStructuralParts(["  A  ", "", "B"]).join("|") === "A|B",
    "parts trimmed",
  );
  assert(displayableExamples(["x", "  ", "y"]).join("|") === "x|y", "examples trimmed");
  assert(
    displayableExplanationBullets([" eins ", "", "zwei"]).join("|") === "eins|zwei",
    "bullets trimmed",
  );

  const eight = Array.from({ length: 8 }, (_, i) => el(`n${i}`, `Name ${i}`));
  assert(insightElementListHasMore(eight.length), "has more when > limit");
  assert(!insightElementListHasMore(6), "no more at limit");
  assert(!insightElementListHasMore(3), "no more below limit");

  const collapsed = visibleInsightElements(eight, false);
  assert(collapsed.length === 6, "collapsed shows limit");
  assert(collapsed[0]!.nodeId === "n0", "order preserved first");
  assert(collapsed[5]!.nodeId === "n5", "order preserved last visible");
  assert(!collapsed.some((x) => x.nodeId === "n6"), "collapsed omits rest");

  const expanded = visibleInsightElements(eight, true);
  assert(expanded.length === 8, "expanded shows all");
  assert(expanded.map((x) => x.nodeId).join(",") === "n0,n1,n2,n3,n4,n5,n6,n7", "no resort");

  const lines = insightElementDisplayLines(el("a", "Rechnung.pdf", "2024/Rechnung.pdf"));
  assert(lines.name === "Rechnung.pdf", "element name");
  assert(lines.path === "2024/Rechnung.pdf", "element path");
  assert(!lines.name.includes("nodeId"), "no nodeId in name");

  const noPath = insightElementDisplayLines(el("b", "Ordner"));
  assert(noPath.path === null, "optional path null");

  assert(otherElementsHeading(eight) === INSIGHT_OTHER_ELEMENTS_HEADING, "other heading helper");
  assert(
    insightNestedListKey("card-1", "primary") === "card-1\u0001primary",
    "primary nested key",
  );
  assert(
    insightNestedListKey("card-1", "secondary", "g1") === "card-1\u0001secondary\u0001g1",
    "secondary nested key",
  );

  // Duplicate-free visible slice
  const ids = collapsed.map((x) => x.nodeId);
  assert(new Set(ids).size === ids.length, "no duplicate elements in slice");
}
