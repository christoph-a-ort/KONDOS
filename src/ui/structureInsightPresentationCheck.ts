/**
 * P2-J-I presentation helper checks.
 * Synthetic fixtures only. No filesystem. No UI mounting.
 */

import type { InsightElementRef } from "./structureInsightViewModel";
import {
  INSIGHT_EXAMPLES_INITIAL_LIMIT,
  countDisplayNames,
  formatInsightLocationCountLabel,
  insightElementDirectoryPath,
  insightElementPathPresentation,
  insightExamplesHaveMore,
  isElementPathCoveredByLocation,
  visibleInsightExamples,
} from "./structureInsightPresentation";

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

export function runStructureInsightPresentationCheck(): void {
  assert(INSIGHT_EXAMPLES_INITIAL_LIMIT === 3, "examples UI limit");

  const examples = ["a", "b", "c", "d", "e"];
  assert(visibleInsightExamples(examples, false).length === 3, "examples collapsed");
  assert(visibleInsightExamples(examples, false)[0] === "a", "examples order");
  assert(visibleInsightExamples(examples, true).length === 5, "examples expanded");
  assert(insightExamplesHaveMore(5), "examples have more");
  assert(!insightExamplesHaveMore(3), "examples at limit");

  assert(
    insightElementDirectoryPath("Strom/Gasag_Gas/file.pdf", "file.pdf") === "Strom/Gasag_Gas",
    "directory from path",
  );
  assert(insightElementDirectoryPath("file.pdf", "file.pdf") === "", "filename only");
  assert(
    isElementPathCoveredByLocation("Strom/Gasag_Gas/file.pdf", "file.pdf", ["Strom", "Gasag_Gas"]),
    "covered by location",
  );
  assert(
    !isElementPathCoveredByLocation("Andere/Ordner/file.pdf", "file.pdf", ["Strom", "Gasag_Gas"]),
    "not covered by location",
  );

  const list = [
    el("1", "Rechnung.pdf", "Strom/Gasag_Gas/Rechnung.pdf"),
    el("2", "Rechnung.pdf", "Strom/Andere/Rechnung.pdf"),
    el("3", "Notiz.txt", "Strom/Gasag_Gas/Notiz.txt"),
  ];
  const counts = countDisplayNames(list);
  assert(counts.get("rechnung.pdf") === 2, "duplicate name count");
  assert(counts.get("notiz.txt") === 1, "unique name count");

  const loc = ["Strom", "Gasag_Gas"];
  const dup = insightElementPathPresentation(list[0]!, loc, counts);
  assert(dup.secondaryPath !== null, "duplicate keeps path");
  assert(dup.fullPathTitle === "Strom/Gasag_Gas/Rechnung.pdf", "full path title");

  const uniqueCovered = insightElementPathPresentation(list[2]!, loc, counts);
  assert(uniqueCovered.secondaryPath === null, "covered unique hides secondary");
  assert(uniqueCovered.fullPathTitle === "Strom/Gasag_Gas/Notiz.txt", "title retained");

  const noPath = insightElementPathPresentation(el("x", "Alone"), loc, countDisplayNames([el("x", "Alone")]));
  assert(noPath.secondaryPath === null, "missing path");
  assert(noPath.fullPathTitle === null, "missing title");

  const longName = "a".repeat(80) + "_über_Datei.pdf";
  const long = insightElementPathPresentation(
    el("L", longName, `Root/${longName}`),
    ["Root"],
    countDisplayNames([el("L", longName, `Root/${longName}`)]),
  );
  assert(long.name === longName, "long name preserved");
  assert(long.secondaryPath === null, "long covered path hidden");

  assert(formatInsightLocationCountLabel(1) === "1 Erkenntnis", "count singular");
  assert(formatInsightLocationCountLabel(11) === "11 Erkenntnisse", "count plural");

  // No invented path from nodeId
  const fromId = insightElementPathPresentation(
    el("X:/Root/A/file.txt", "file.txt"),
    ["Root", "A"],
    countDisplayNames([el("X:/Root/A/file.txt", "file.txt")]),
  );
  assert(fromId.secondaryPath === null, "no path invented from nodeId");
  assert(fromId.fullPathTitle === null, "no title invented");
}
