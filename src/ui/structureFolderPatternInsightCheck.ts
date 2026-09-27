/**
 * P2-D folder-pattern checks — synthetic fixtures only (FALL A–AD).
 * No RuleCandidates, Suggestions, confirmedExceptions, private Realtest names.
 */

import { type DirectoryListing, type DirectoryNode, type FileNode, type FsNode, type ScanResult } from "../model";
import { buildStructureComparisonContexts } from "./structureComparisonContext";
import { observationClaimsMissingElements } from "./structureInsightModel";
import {
  FOLDER_PATTERN_NAME_OBSERVATION_TYPE,
  FOLDER_PATTERN_SET_OBSERVATION_TYPE,
  STRUCTURE_FOLDER_PATTERN_DETECTOR_ID,
  STRUCTURE_FOLDER_PATTERN_DETECTOR_VERSION,
  STRUCTURE_FOLDER_PATTERN_SCHEMA_VERSION,
  buildStructureFolderPatternInsight,
  compareFolderPatternText,
  createEmptyStructureFolderPatternInsightResult,
  folderPatternNameKey,
  structureFolderPatternInsightJsonRoundTrip,
  structureFolderPatternResultHasForbiddenClaims,
  type StructureFolderPatternInsightResult,
} from "./structureFolderPatternInsight";

function file(id: string, name: string, depth: number): FileNode {
  return { id, name, path: id, depth, kind: "file" };
}

function dir(
  id: string,
  name: string,
  depth: number,
  children: FsNode[] = [],
  listing: DirectoryListing = "read",
): DirectoryNode {
  return {
    id,
    name,
    path: id,
    depth,
    kind: "directory",
    listing,
    children,
  };
}

function resultOf(root: DirectoryNode): ScanResult {
  return {
    root,
    warnings: [],
    stats: { directoryCount: 0, fileCount: 0, skippedCount: 0, durationMs: 0 },
  };
}

function assert(condition: boolean, label: string): asserts condition {
  if (!condition) {
    throw new Error(label);
  }
}

function nameObs(built: StructureFolderPatternInsightResult, nameKey: string) {
  return built.insight.observations.filter(
    (observation) =>
      observation.observationType === FOLDER_PATTERN_NAME_OBSERVATION_TYPE &&
      observation.patternFeatures.nameKey === nameKey,
  );
}

function setObs(built: StructureFolderPatternInsightResult) {
  return built.insight.observations.filter(
    (observation) => observation.observationType === FOLDER_PATTERN_SET_OBSERVATION_TYPE,
  );
}

function setObsAt(built: StructureFolderPatternInsightResult, contextId: string) {
  return setObs(built).filter(
    (observation) => observation.patternFeatures.comparisonContextId === contextId,
  );
}

function nameObsAt(built: StructureFolderPatternInsightResult, contextId: string, nameKey: string) {
  return nameObs(built, nameKey).filter(
    (observation) => observation.patternFeatures.comparisonContextId === contextId,
  );
}

export function runStructureFolderPatternInsightCheck(): void {
  assert(STRUCTURE_FOLDER_PATTERN_SCHEMA_VERSION === 1, "schema");
  assert(STRUCTURE_FOLDER_PATTERN_DETECTOR_ID === "folder-pattern-structure", "detector id");
  assert(STRUCTURE_FOLDER_PATTERN_DETECTOR_VERSION === 1, "detector version");
  assert(createEmptyStructureFolderPatternInsightResult().features.length === 0, "empty");
  assert(folderPatternNameKey("Vertrag") === "vertrag", "normalize lower");
  assert(folderPatternNameKey("Vertrag") === folderPatternNameKey("vertrag"), "case fold");
  assert(folderPatternNameKey("Rechnung") !== folderPatternNameKey("Rechnungen"), "no stemming");
  assert(compareFolderPatternText("a", "b") < 0, "ascii order");
  assert(compareFolderPatternText("B", "a") < 0, "code unit B < a");

  // FALL A – all peers 0 dir children
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [dir("X:/P/A", "A", 1), dir("X:/P/B", "B", 1), dir("X:/P/C", "C", 1)]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    assert(nameObs(built, "vertrag").length === 0, "A: no name obs");
    const sets = setObs(built);
    assert(sets.length === 1, "A: one empty-set obs");
    assert(sets[0].matchedCount === 3 && sets[0].patternFeatures.evaluableCount === 3, "A: 3/3 empty");
    assert(sets[0].patternFeatures.signature === "", "A: empty signature");
    assert(sets[0].patternFeatures.nameKeyCount === 0, "A: zero keys");
  }

  // FALL B – single peer
  {
    const scan = resultOf(dir("X:/P", "P", 0, [dir("X:/P/A", "A", 1, [dir("X:/P/A/V", "Vertrag", 2)])]));
    const comparison = buildStructureComparisonContexts(scan);
    assert(comparison.contexts[0].comparisonPossible === false, "B: not comparable");
    const built = buildStructureFolderPatternInsight(scan, comparison);
    assert(built.insight.observations.length === 0, "B: no peer observations");
  }

  // FALL C – 2 peers shared names
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/A", "A", 1, [dir("X:/P/A/V", "Vertrag", 2), dir("X:/P/A/R", "Rechnungen", 2)]),
        dir("X:/P/B", "B", 1, [dir("X:/P/B/V", "Vertrag", 2), dir("X:/P/B/R", "Rechnungen", 2)]),
      ]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    assert(nameObsAt(built, "siblings:X:/P", "vertrag")[0]?.matchedCount === 2, "C: vertrag 2");
    assert(nameObsAt(built, "siblings:X:/P", "rechnungen")[0]?.matchedCount === 2, "C: rechnungen 2");
    assert(setObsAt(built, "siblings:X:/P").length === 1 && setObsAt(built, "siblings:X:/P")[0].matchedCount === 2, "C: set");
  }

  // FALL D – all identical
  {
    const kids = (prefix: string) => [
      dir(`${prefix}/V`, "Vertrag", 2),
      dir(`${prefix}/R`, "Rechnungen", 2),
      dir(`${prefix}/S`, "Schriftverkehr", 2),
    ];
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/A", "A", 1, kids("X:/P/A")),
        dir("X:/P/B", "B", 1, kids("X:/P/B")),
        dir("X:/P/C", "C", 1, kids("X:/P/C")),
      ]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    assert(nameObsAt(built, "siblings:X:/P", "vertrag")[0]?.matchedCount === 3, "D: 3/3");
    const parentSet = setObsAt(built, "siblings:X:/P");
    assert(parentSet.length === 1 && parentSet[0].matchedCount === 3, "D: set 3");
    assert(parentSet[0].counterEvidence.length === 0, "D: no counter");
    assert(String(parentSet[0].patternFeatures.signature).includes("vertrag"), "D: non-empty set");
  }

  // FALL E – partial overlap
  {
    const scan = resultOf(
      dir("X:/Kunden", "Kunden", 0, [
        dir("X:/Kunden/A", "A", 1, [
          dir("X:/Kunden/A/V", "Vertrag", 2),
          dir("X:/Kunden/A/R", "Rechnungen", 2),
          dir("X:/Kunden/A/S", "Schriftverkehr", 2),
        ]),
        dir("X:/Kunden/B", "B", 1, [
          dir("X:/Kunden/B/V", "Vertrag", 2),
          dir("X:/Kunden/B/R", "Rechnungen", 2),
          dir("X:/Kunden/B/S", "Schriftverkehr", 2),
        ]),
        dir("X:/Kunden/C", "C", 1, [
          dir("X:/Kunden/C/V", "Vertrag", 2),
          dir("X:/Kunden/C/R", "Rechnungen", 2),
          dir("X:/Kunden/C/N", "Notizen", 2),
        ]),
      ]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    assert(nameObsAt(built, "siblings:X:/Kunden", "vertrag")[0]?.matchedCount === 3, "E: vertrag 3/3");
    assert(nameObsAt(built, "siblings:X:/Kunden", "schriftverkehr")[0]?.matchedCount === 2, "E: schriftverkehr 2/3");
    assert(nameObsAt(built, "siblings:X:/Kunden", "notizen")[0]?.matchedCount === 1, "E: notizen 1/3");
    assert(
      nameObsAt(built, "siblings:X:/Kunden", "schriftverkehr")[0]?.counterEvidence.some(
        (item) => item.element.nodeId === "X:/Kunden/C",
      ),
      "E: counter C",
    );
    assert(setObsAt(built, "siblings:X:/Kunden").some((obs) => obs.matchedCount === 2), "E: A/B set");
    assert(built.insight.ruleCandidates.length === 0, "E: no rules");
  }

  // FALL F – fully different
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/A", "A", 1, [dir("X:/P/A/X", "Alpha", 2)]),
        dir("X:/P/B", "B", 1, [dir("X:/P/B/Y", "Beta", 2)]),
      ]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    assert(nameObsAt(built, "siblings:X:/P", "alpha")[0]?.matchedCount === 1, "F: alpha 1");
    assert(nameObsAt(built, "siblings:X:/P", "beta")[0]?.matchedCount === 1, "F: beta 1");
    assert(setObsAt(built, "siblings:X:/P").length === 0, "F: no repeated set");
  }

  // FALL G – one reliably empty peer
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/A", "A", 1, [dir("X:/P/A/V", "Vertrag", 2)]),
        dir("X:/P/B", "B", 1, [dir("X:/P/B/V", "Vertrag", 2)]),
        dir("X:/P/C", "C", 1),
      ]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    const vertrag = nameObs(built, "vertrag")[0];
    assert(vertrag?.matchedCount === 2 && vertrag.patternFeatures.totalCount === 3, "G: 2/3");
    assert(vertrag?.counterEvidence.some((item) => item.element.nodeId === "X:/P/C"), "G: C counter");
  }

  // FALL H – peer with only files
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/A", "A", 1, [dir("X:/P/A/V", "Vertrag", 2)]),
        dir("X:/P/B", "B", 1, [file("X:/P/B/f.txt", "f.txt", 2)]),
      ]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    const featureB = built.features.find((feature) => feature.member.nodeId === "X:/P/B");
    assert(featureB?.evaluable === true && featureB.signature === "", "H: files-only = empty dirs");
    assert(nameObs(built, "vertrag")[0]?.counterEvidence.some((item) => item.element.nodeId === "X:/P/B"), "H: B counter");
  }

  // FALL I – files + dirs
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/A", "A", 1, [
          file("X:/P/A/a.txt", "a.txt", 2),
          dir("X:/P/A/V", "Vertrag", 2),
        ]),
        dir("X:/P/B", "B", 1, [dir("X:/P/B/V", "Vertrag", 2)]),
      ]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    assert(nameObsAt(built, "siblings:X:/P", "vertrag")[0]?.matchedCount === 2, "I: vertrag despite files");
    assert(setObsAt(built, "siblings:X:/P")[0]?.matchedCount === 2, "I: same set");
  }

  // FALL J – extra individual folder
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/A", "A", 1, [dir("X:/P/A/V", "Vertrag", 2), dir("X:/P/A/R", "Rechnungen", 2)]),
        dir("X:/P/B", "B", 1, [
          dir("X:/P/B/V", "Vertrag", 2),
          dir("X:/P/B/R", "Rechnungen", 2),
          dir("X:/P/B/Alt", "Altbestand", 2),
        ]),
      ]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    assert(nameObsAt(built, "siblings:X:/P", "altbestand")[0]?.matchedCount === 1, "J: altbestand 1");
    assert(setObsAt(built, "siblings:X:/P").length === 0, "J: no identical set");
  }

  // FALL K – different order same names
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/A", "A", 1, [
          dir("X:/P/A/R", "Rechnungen", 2),
          dir("X:/P/A/S", "Schriftverkehr", 2),
          dir("X:/P/A/V", "Vertrag", 2),
        ]),
        dir("X:/P/B", "B", 1, [
          dir("X:/P/B/V", "Vertrag", 2),
          dir("X:/P/B/R", "Rechnungen", 2),
          dir("X:/P/B/S", "Schriftverkehr", 2),
        ]),
      ]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    const fa = built.features.find((feature) => feature.member.nodeId === "X:/P/A");
    const fb = built.features.find((feature) => feature.member.nodeId === "X:/P/B");
    assert(fa?.signature === fb?.signature, "K: identical signature");
    assert(setObsAt(built, "siblings:X:/P").length === 1, "K: set obs");
  }

  // FALL L – case fold
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/A", "A", 1, [dir("X:/P/A/V", "Vertrag", 2)]),
        dir("X:/P/B", "B", 1, [dir("X:/P/B/V", "vertrag", 2)]),
      ]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    assert(nameObs(built, "vertrag").length === 1, "L: one nameKey");
    assert(nameObsAt(built, "siblings:X:/P", "vertrag")[0]?.matchedCount === 2, "L: matched 2");
    assert(setObsAt(built, "siblings:X:/P").length === 1, "L: set match");
  }

  // FALL M – whitespace significant
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/A", "A", 1, [dir("X:/P/A/V", "Vertrag", 2)]),
        dir("X:/P/B", "B", 1, [dir("X:/P/B/V", " Vertrag", 2)]),
        dir("X:/P/C", "C", 1, [dir("X:/P/C/V", "Vertrag ", 2)]),
      ]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    assert(nameObs(built, "vertrag").length === 1, "M: exact vertrag");
    assert(nameObs(built, "vertrag")[0]?.matchedCount === 1, "M: only A");
    assert(nameObs(built, " vertrag").length === 1, "M: leading space key");
    assert(nameObs(built, "vertrag ").length === 1, "M: trailing space key");
    assert(setObsAt(built, "siblings:X:/P").length === 0, "M: no identical set");
  }

  // FALL N – 500 peers
  {
    const children = Array.from({ length: 500 }, (_, index) => {
      const n = String(index + 1).padStart(3, "0");
      return dir(`X:/Wide/P-${n}`, `P-${n}`, 1, [dir(`X:/Wide/P-${n}/V`, "Vertrag", 2)]);
    });
    const scan = resultOf(dir("X:/Wide", "Wide", 0, children));
    const built = buildStructureFolderPatternInsight(scan);
    const wideFeatures = built.features.filter(
      (feature) => feature.comparisonContextId === "siblings:X:/Wide",
    );
    assert(wideFeatures.length === 500, "N: no truncation features");
    assert(nameObsAt(built, "siblings:X:/Wide", "vertrag")[0]?.matchedCount === 500, "N: 500 matched");
    assert(setObsAt(built, "siblings:X:/Wide")[0]?.matchedCount === 500, "N: set 500");
  }

  // FALL O – many direct children
  {
    const many = Array.from({ length: 40 }, (_, index) => {
      const n = String(index + 1).padStart(2, "0");
      return dir(`X:/P/A/D${n}`, `Dir${n}`, 2);
    });
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/A", "A", 1, many),
        dir(
          "X:/P/B",
          "B",
          1,
          many.map((child) => dir(child.id.replace("/A/", "/B/"), child.name, 2)),
        ),
      ]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    assert(setObsAt(built, "siblings:X:/P")[0]?.patternFeatures.nameKeyCount === 40, "O: 40 keys");
  }

  // FALL P – different nesting not equal
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/A", "A", 1, [
          dir("X:/P/A/R", "Rechnungen", 2, [dir("X:/P/A/R/2025", "2025", 3)]),
        ]),
        dir("X:/P/B", "B", 1, [
          dir("X:/P/B/Y", "2025", 2, [dir("X:/P/B/Y/R", "Rechnungen", 3)]),
        ]),
      ]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    const fa = built.features.find((feature) => feature.member.nodeId === "X:/P/A");
    const fb = built.features.find((feature) => feature.member.nodeId === "X:/P/B");
    assert(fa?.signature !== fb?.signature, "P: nesting differs at direct level");
    assert(setObsAt(built, "siblings:X:/P").length === 0, "P: no set match");
  }

  // FALL Q/R/S – multiple contexts, same name / signature separated
  {
    const scan = resultOf(
      dir("X:/Root", "Root", 0, [
        dir("X:/Root/K1", "K1", 1, [
          dir("X:/Root/K1/A", "A", 2, [dir("X:/Root/K1/A/V", "Vertrag", 3)]),
          dir("X:/Root/K1/B", "B", 2, [dir("X:/Root/K1/B/V", "Vertrag", 3)]),
        ]),
        dir("X:/Root/K2", "K2", 1, [
          dir("X:/Root/K2/A", "A", 2, [dir("X:/Root/K2/A/V", "Vertrag", 3)]),
          dir("X:/Root/K2/B", "B", 2, [dir("X:/Root/K2/B/V", "Vertrag", 3)]),
        ]),
      ]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    // Local peer contexts under K1 and K2 (not Root alone)
    const k1 = nameObsAt(built, "siblings:X:/Root/K1", "vertrag");
    const k2 = nameObsAt(built, "siblings:X:/Root/K2", "vertrag");
    assert(k1.length === 1 && k2.length === 1, "R: two local name obs");
    assert(k1[0].id !== k2[0].id, "R: distinct ids by context");
    const setK1 = setObsAt(built, "siblings:X:/Root/K1");
    const setK2 = setObsAt(built, "siblings:X:/Root/K2");
    assert(setK1.length === 1 && setK2.length === 1, "S: two local set obs");
    assert(setK1[0].id !== setK2[0].id, "S: distinct set ids");
  }

  // FALL T/U/V – no stemming/synonyms
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/A", "A", 1, [
          dir("X:/P/A/R1", "Rechnung", 2),
          dir("X:/P/A/V1", "Vertrag", 2),
          dir("X:/P/A/S1", "Schriftverkehr", 2),
        ]),
        dir("X:/P/B", "B", 1, [
          dir("X:/P/B/R2", "Rechnungen", 2),
          dir("X:/P/B/V2", "Verträge", 2),
          dir("X:/P/B/S2", "Korrespondenz", 2),
        ]),
      ]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    assert(nameObs(built, "rechnung")[0]?.matchedCount === 1, "T: Rechnung alone");
    assert(nameObs(built, "rechnungen")[0]?.matchedCount === 1, "T: Rechnungen alone");
    assert(nameObs(built, "vertrag")[0]?.matchedCount === 1, "U: Vertrag");
    assert(nameObs(built, "verträge")[0]?.matchedCount === 1, "U: Verträge");
    assert(nameObs(built, "schriftverkehr")[0]?.matchedCount === 1, "V: Schriftverkehr");
    assert(nameObs(built, "korrespondenz")[0]?.matchedCount === 1, "V: Korrespondenz");
    assert(setObsAt(built, "siblings:X:/P").length === 0, "TUV: no set");
  }

  // FALL W – listing != read
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/A", "A", 1, [dir("X:/P/A/V", "Vertrag", 2)]),
        dir("X:/P/B", "B", 1, [dir("X:/P/B/V", "Vertrag", 2)]),
        dir("X:/P/C", "C", 1, [], "incomplete"),
        dir("X:/P/D", "D", 1, [dir("X:/P/D/X", "Maybe", 2)], "depthLimited"),
      ]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    const vertrag = nameObs(built, "vertrag")[0];
    assert(vertrag?.patternFeatures.totalCount === 4, "W: total 4");
    assert(vertrag?.patternFeatures.evaluableCount === 2, "W: evaluable 2");
    assert(vertrag?.matchedCount === 2, "W: matched 2");
    assert(
      !vertrag?.supportingEvidence.some((item) => item.element.nodeId === "X:/P/C") &&
        !vertrag?.counterEvidence.some((item) => item.element.nodeId === "X:/P/C"),
      "W: C neither support nor counter",
    );
    assert(
      !vertrag?.supportingEvidence.some((item) => item.element.nodeId === "X:/P/D") &&
        !vertrag?.counterEvidence.some((item) => item.element.nodeId === "X:/P/D"),
      "W: D neither support nor counter",
    );
    const featureC = built.features.find((feature) => feature.member.nodeId === "X:/P/C");
    assert(featureC?.evaluable === false && featureC.signature === "", "W: C not empty known");
    assert(!setObs(built).some((obs) => obs.matchedCount === 3), "W: incomplete not empty set peer");
  }

  // FALL X – two different repeated sets in one context
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/A", "A", 1, [dir("X:/P/A/V", "Vertrag", 2)]),
        dir("X:/P/B", "B", 1, [dir("X:/P/B/V", "Vertrag", 2)]),
        dir("X:/P/C", "C", 1, [dir("X:/P/C/N", "Notizen", 2)]),
        dir("X:/P/D", "D", 1, [dir("X:/P/D/N", "Notizen", 2)]),
      ]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    const sets = setObsAt(built, "siblings:X:/P").sort((left, right) =>
      compareFolderPatternText(String(left.patternFeatures.setQualifier), String(right.patternFeatures.setQualifier)),
    );
    assert(sets.length === 2, "X: two set groups");
    assert(sets[0].patternFeatures.setQualifier === "set-0001", "X: set-0001");
    assert(sets[1].patternFeatures.setQualifier === "set-0002", "X: set-0002");
    assert(sets[0].id !== sets[1].id, "X: distinct ids");
  }

  // FALL Y – JSON roundtrip
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/A", "A", 1, [dir("X:/P/A/V", "Vertrag", 2)]),
        dir("X:/P/B", "B", 1, [dir("X:/P/B/V", "Vertrag", 2)]),
      ]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    const round = structureFolderPatternInsightJsonRoundTrip(built);
    assert(JSON.stringify(round) === JSON.stringify(built), "Y: roundtrip");
  }

  // FALL Z – determinism
  {
    const make = (): StructureFolderPatternInsightResult =>
      buildStructureFolderPatternInsight(
        resultOf(
          dir("X:/P", "P", 0, [
            dir("X:/P/B", "B", 1, [dir("X:/P/B/V", "Vertrag", 2), dir("X:/P/B/R", "Rechnungen", 2)]),
            dir("X:/P/A", "A", 1, [dir("X:/P/A/R", "Rechnungen", 2), dir("X:/P/A/V", "Vertrag", 2)]),
          ]),
        ),
      );
    assert(JSON.stringify(make()) === JSON.stringify(make()), "Z: identical");
  }

  // FALL AA – missing guard
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/A", "A", 1, [dir("X:/P/A/V", "Vertrag", 2)]),
        dir("X:/P/B", "B", 1),
        dir("X:/P/C", "C", 1, [dir("X:/P/C/N", "Notizen", 2)]),
      ]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    assert(
      built.insight.observations.every((observation) => !observationClaimsMissingElements(observation)),
      "AA: guard false",
    );
    assert(
      built.insight.observations.every((observation) => observation.patternFeatures.claimsMissingElements === false),
      "AA: flag false",
    );
  }

  // FALL AB – boundaries
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/A", "A", 1, [dir("X:/P/A/V", "Vertrag", 2)]),
        dir("X:/P/B", "B", 1, [dir("X:/P/B/V", "Vertrag", 2)]),
      ]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    assert(built.insight.ruleCandidates.length === 0, "AB: rules");
    assert(built.insight.suggestions.length === 0, "AB: suggestions");
    assert(built.insight.confirmedExceptions.length === 0, "AB: exceptions");
    assert(!structureFolderPatternResultHasForbiddenClaims(built), "AB: no forbidden");
  }

  // FALL AC – no path join (identity via nodeId attributes)
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/A", "A", 1, [dir("X:/P/A/V", "Vertrag", 2)]),
        dir("X:/P/B", "B", 1, [dir("X:/P/B/V", "Vertrag", 2)]),
      ]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    const vertrag = nameObs(built, "vertrag")[0];
    assert(
      vertrag?.supportingEvidence.every(
        (item) => typeof item.attributes?.childNodeId === "string" && item.element.nodeId.startsWith("X:/P/"),
      ),
      "AC: evidence uses nodeId",
    );
  }

  // FALL AD – nameKey collision keeps all childRefs; signature is set
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/A", "A", 1, [
          dir("X:/P/A/V1", "Vertrag", 2),
          dir("X:/P/A/V2", "vertrag", 2),
        ]),
        dir("X:/P/B", "B", 1, [dir("X:/P/B/V", "Vertrag", 2)]),
      ]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    const featureA = built.features.find((feature) => feature.member.nodeId === "X:/P/A");
    assert(featureA?.childRefs.length === 2, "AD: both childRefs kept");
    assert(featureA?.normalizedNameKeys.length === 1, "AD: set one key");
    assert(featureA?.normalizedNameKeys[0] === "vertrag", "AD: key");
    assert(featureA?.signature === "vertrag", "AD: signature set-based");
  }

  // Ensure no overlapping observation type exists
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/A", "A", 1, [dir("X:/P/A/V", "Vertrag", 2)]),
        dir("X:/P/B", "B", 1, [dir("X:/P/B/N", "Notizen", 2)]),
      ]),
    );
    const built = buildStructureFolderPatternInsight(scan);
    assert(
      !built.insight.observations.some((observation) => observation.observationType.includes("overlapping")),
      "no overlap type",
    );
  }
}
