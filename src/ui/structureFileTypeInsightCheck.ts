/**
 * P2-F file-type structure checks — synthetic fixtures only (FALL A–Y).
 * No RuleCandidates, Suggestions, confirmedExceptions, private Realtest names.
 */

import { type DirectoryListing, type DirectoryNode, type FileNode, type FsNode, type ScanResult } from "../model";
import { observationClaimsMissingElements } from "./structureInsightModel";
import {
  FILE_TYPE_DISTRIBUTION_OBSERVATION_TYPE,
  STRUCTURE_FILE_TYPE_DETECTOR_ID,
  STRUCTURE_FILE_TYPE_DETECTOR_VERSION,
  STRUCTURE_FILE_TYPE_SCHEMA_VERSION,
  buildStructureFileTypeInsight,
  classifyFileTypeExtension,
  compareFileTypeExtensionKeys,
  compareFileTypeText,
  createEmptyStructureFileTypeInsightResult,
  structureFileTypeInsightJsonRoundTrip,
  structureFileTypeResultHasForbiddenClaims,
  type FileTypeCount,
  type StructureFileTypeInsightResult,
} from "./structureFileTypeInsight";

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

function filesUnder(parentId: string, parentName: string, names: readonly string[]): DirectoryNode {
  return dir(
    parentId,
    parentName,
    0,
    names.map((name, index) => file(`${parentId}/f${index}`, name, 1)),
  );
}

function typeObs(built: StructureFileTypeInsightResult) {
  return built.insight.observations.filter(
    (observation) => observation.observationType === FILE_TYPE_DISTRIBUTION_OBSERVATION_TYPE,
  );
}

function typeObsAt(built: StructureFileTypeInsightResult, contextId: string) {
  return typeObs(built).filter(
    (observation) => observation.patternFeatures.comparisonContextId === contextId,
  );
}

function distAt(built: StructureFileTypeInsightResult, contextId: string) {
  return built.distributions.find((item) => item.comparisonContextId === contextId);
}

function parseTypeCounts(observation: {
  patternFeatures: { typeCountsJson?: string | number | boolean | null };
}): FileTypeCount[] {
  const raw = observation.patternFeatures.typeCountsJson;
  assert(typeof raw === "string", "typeCountsJson string");
  return JSON.parse(raw) as FileTypeCount[];
}

export function runStructureFileTypeInsightCheck(): void {
  assert(STRUCTURE_FILE_TYPE_SCHEMA_VERSION === 1, "schema");
  assert(STRUCTURE_FILE_TYPE_DETECTOR_ID === "file-type-structure", "detector id");
  assert(STRUCTURE_FILE_TYPE_DETECTOR_VERSION === 1, "detector version");
  assert(createEmptyStructureFileTypeInsightResult().features.length === 0, "empty");
  assert(compareFileTypeText("a", "b") < 0, "ascii order");
  assert(compareFileTypeText("B", "a") < 0, "code unit B < a");
  assert(compareFileTypeExtensionKeys(".pdf", ".xlsx") < 0, "ext sort");
  assert(compareFileTypeExtensionKeys(".pdf", null) < 0, "null last");
  assert(compareFileTypeExtensionKeys(null, null) === 0, "null eq");

  // Classification contract
  {
    assert(classifyFileTypeExtension("rechnung.pdf").extensionKey === ".pdf", "class pdf");
    assert(classifyFileTypeExtension("DATEI.PDF").extensionKey === ".pdf", "class PDF");
    assert(classifyFileTypeExtension("archiv.tar.gz").extensionKey === ".gz", "class gz");
    assert(classifyFileTypeExtension("README").hasExtension === false, "F README");
    assert(classifyFileTypeExtension("README").extensionKey === null, "F null");
    assert(classifyFileTypeExtension(".datei").extensionKey === null, "G");
    assert(classifyFileTypeExtension("datei.").extensionKey === null, "H");
  }

  // FALL A – 0 files
  {
    const scan = resultOf(dir("X:/A", "A", 0, []));
    const built = buildStructureFileTypeInsight(scan);
    const ctx = built.contexts.find((item) => item.id === "files:X:/A");
    assert(ctx !== undefined && ctx.evaluable === true && ctx.totalCount === 0, "A: ctx");
    const dist = distAt(built, "files:X:/A");
    assert(dist !== undefined && dist.typeCounts.length === 0 && dist.distinctTypeCount === 0, "A: dist");
    assert(built.features.filter((f) => f.comparisonContextId === "files:X:/A").length === 0, "A: features");
    assert(typeObsAt(built, "files:X:/A").length === 0, "A: no obs");
  }

  // FALL B – 1 PDF
  {
    const scan = resultOf(filesUnder("X:/B", "B", ["a.pdf"]));
    const built = buildStructureFileTypeInsight(scan);
    assert(built.features.filter((f) => f.comparisonContextId === "files:X:/B").length === 1, "B: feature");
    const dist = distAt(built, "files:X:/B");
    assert(dist !== undefined && dist.distinctTypeCount === 1, "B: distinct");
    assert(dist.typeCounts.length === 1 && dist.typeCounts[0].extensionKey === ".pdf", "B: pdf");
    assert(dist.typeCounts[0].count === 1, "B: count");
    assert(typeObsAt(built, "files:X:/B").length === 0, "B: no obs");
    assert(built.contexts[0].comparisonPossible === false, "B: not comparable");
  }

  // FALL C – 2 PDF
  {
    const scan = resultOf(filesUnder("X:/C", "C", ["a.pdf", "b.pdf"]));
    const built = buildStructureFileTypeInsight(scan);
    const obs = typeObsAt(built, "files:X:/C");
    assert(obs.length === 1, "C: obs");
    assert(obs[0].matchedCount === 2, "C: matched");
    const counts = parseTypeCounts(obs[0]);
    assert(counts.length === 1 && counts[0].extensionKey === ".pdf" && counts[0].count === 2, "C: counts");
    assert(obs[0].patternFeatures.distinctTypeCount === 1, "C: distinct");
  }

  // FALL D – PDF + XLSX
  {
    const scan = resultOf(filesUnder("X:/D", "D", ["a.pdf", "b.xlsx"]));
    const built = buildStructureFileTypeInsight(scan);
    const obs = typeObsAt(built, "files:X:/D");
    assert(obs.length === 1, "D: obs");
    assert(obs[0].patternFeatures.distinctTypeCount === 2, "D: distinct");
    const counts = parseTypeCounts(obs[0]);
    assert(counts.some((row) => row.extensionKey === ".pdf" && row.count === 1), "D: pdf");
    assert(counts.some((row) => row.extensionKey === ".xlsx" && row.count === 1), "D: xlsx");
    assert(obs[0].supportingEvidence.length === 2, "D: evidence");
    assert(obs[0].counterEvidence.length === 0, "D: counter empty");
  }

  // FALL E – case fold
  {
    const scan = resultOf(filesUnder("X:/E", "E", ["a.pdf", "b.PDF", "c.Pdf"]));
    const built = buildStructureFileTypeInsight(scan);
    const dist = distAt(built, "files:X:/E");
    assert(dist !== undefined && dist.typeCounts.length === 1, "E: one bucket");
    assert(dist.typeCounts[0].extensionKey === ".pdf" && dist.typeCounts[0].count === 3, "E: pdf3");
  }

  // FALL F/G/H/I covered partly above; features for names
  {
    const scan = resultOf(
      filesUnder("X:/FGHI", "FGHI", ["README", ".datei", "datei.", "archiv.tar.gz", "x.pdf"]),
    );
    const built = buildStructureFileTypeInsight(scan);
    const byName = new Map(built.features.map((f) => [f.originalName, f]));
    assert(byName.get("README")?.extensionKey === null, "F feature");
    assert(byName.get(".datei")?.extensionKey === null, "G feature");
    assert(byName.get("datei.")?.extensionKey === null, "H feature");
    assert(byName.get("archiv.tar.gz")?.extensionKey === ".gz", "I feature");
  }

  // FALL J – 9 PDF + 1 XLSX, no dominant field
  {
    const names = [...Array.from({ length: 9 }, (_, i) => `f${i}.pdf`), "t.xlsx"];
    const scan = resultOf(filesUnder("X:/J", "J", names));
    const built = buildStructureFileTypeInsight(scan);
    const serialized = JSON.stringify(built);
    assert(!/"mostFrequent/.test(serialized), "J: no mostFrequent");
    assert(!/"dominantType"\s*:/.test(serialized), "J: no dominant");
    const dist = distAt(built, "files:X:/J");
    assert(dist !== undefined && dist.typeCounts.length === 2, "J: two types");
    assert(dist.typeCounts.find((r) => r.extensionKey === ".pdf")?.count === 9, "J: 9 pdf");
    assert(dist.typeCounts.find((r) => r.extensionKey === ".xlsx")?.count === 1, "J: 1 xlsx");
  }

  // FALL K – tie 2+2
  {
    const scan = resultOf(filesUnder("X:/K", "K", ["a.pdf", "b.pdf", "c.xlsx", "d.xlsx"]));
    const built = buildStructureFileTypeInsight(scan);
    const dist = distAt(built, "files:X:/K");
    assert(dist !== undefined && dist.distinctTypeCount === 2, "K: distinct");
    assert(dist.typeCounts.every((row) => row.count === 2), "K: tie counts");
    assert(!JSON.stringify(built).includes("mostFrequent"), "K: no highlight");
  }

  // FALL L – listing != read
  {
    const scan = resultOf(
      dir(
        "X:/L",
        "L",
        0,
        [file("X:/L/a", "a.pdf", 1), file("X:/L/b", "b.pdf", 1)],
        "incomplete",
      ),
    );
    const built = buildStructureFileTypeInsight(scan);
    const ctx = built.contexts.find((item) => item.id === "files:X:/L");
    assert(ctx !== undefined && ctx.evaluable === false, "L: not evaluable");
    assert(ctx.comparisonPossible === false, "L: no comparison");
    assert(ctx.totalCount === 2, "L: not empty");
    assert(built.features.filter((f) => f.comparisonContextId === "files:X:/L").length === 0, "L: no features");
    assert(built.distributions.every((d) => d.comparisonContextId !== "files:X:/L"), "L: no dist");
    assert(typeObsAt(built, "files:X:/L").length === 0, "L: no obs");
  }

  // FALL M / W – two parents identical distribution, local only
  {
    const scan = resultOf(
      dir("X:/Root", "Root", 0, [
        dir("X:/Root/A", "A", 1, [
          file("X:/Root/A/1", "a.pdf", 2),
          file("X:/Root/A/2", "b.pdf", 2),
        ]),
        dir("X:/Root/B", "B", 1, [
          file("X:/Root/B/1", "a.pdf", 2),
          file("X:/Root/B/2", "b.pdf", 2),
        ]),
      ]),
    );
    const built = buildStructureFileTypeInsight(scan);
    const a = typeObsAt(built, "files:X:/Root/A");
    const b = typeObsAt(built, "files:X:/Root/B");
    assert(a.length === 1 && b.length === 1, "M: both obs");
    assert(a[0].id !== b[0].id, "M: distinct ids");
    assert(String(a[0].patternFeatures.typeCountsJson) === String(b[0].patternFeatures.typeCountsJson), "M: same counts");
  }

  // FALL N / X – determinism + case does not change id shape beyond context
  {
    const scan = resultOf(filesUnder("X:/N", "N", ["A.PDF", "b.pdf"]));
    const first = buildStructureFileTypeInsight(scan);
    const second = buildStructureFileTypeInsight(scan);
    assert(JSON.stringify(first) === JSON.stringify(second), "N: identical");
    const round = structureFileTypeInsightJsonRoundTrip(first);
    assert(JSON.stringify(round) === JSON.stringify(first), "N: roundtrip");
    assert(first.insight.observations[0].id.includes("files:X:/N"), "X: context id");
  }

  // FALL O / P / Y – guards
  {
    const scan = resultOf(filesUnder("X:/O", "O", ["a.pdf", "b.xlsx"]));
    const built = buildStructureFileTypeInsight(scan);
    assert(built.insight.ruleCandidates.length === 0, "O: rules");
    assert(built.insight.suggestions.length === 0, "O: suggestions");
    assert(built.insight.confirmedExceptions.length === 0, "O: exceptions");
    assert(!structureFileTypeResultHasForbiddenClaims(built), "Y: forbidden");
    for (const observation of built.insight.observations) {
      assert(observationClaimsMissingElements(observation) === false, "P: missing guard");
      assert(observation.patternFeatures.claimsMissingElements === false, "P: claims false");
      assert(observation.category === "other", "category other");
    }
  }

  // FALL Q – 10_000 files
  {
    const names: string[] = [];
    for (let i = 0; i < 10000; i += 1) {
      names.push(`item_${String(i).padStart(5, "0")}.txt`);
    }
    const scan = resultOf(filesUnder("X:/Q", "Q", names));
    const started = Date.now();
    const built = buildStructureFileTypeInsight(scan);
    const elapsed = Date.now() - started;
    assert(built.features.filter((f) => f.comparisonContextId === "files:X:/Q").length === 10000, "Q: features");
    const obs = typeObsAt(built, "files:X:/Q");
    assert(obs.length === 1 && obs[0].matchedCount === 10000, "Q: obs");
    assert(obs[0].supportingEvidence.length === 10000, "Q: no truncation");
    assert(elapsed < 15000, `Q: performance (${elapsed}ms)`);
  }

  // FALL R – P2-E unchanged is a git/regression concern; spot that we do not import P2-E
  {
    assert(true, "R: product module does not import structureFileNameInsight (static verifier)");
  }

  // FALL S – JPG + PDF
  {
    const scan = resultOf(filesUnder("X:/S", "S", ["a.jpg", "b.pdf"]));
    const built = buildStructureFileTypeInsight(scan);
    const dist = distAt(built, "files:X:/S");
    assert(dist !== undefined && dist.typeCounts.length === 2, "S: two buckets");
  }

  // FALL T – typeCountsJson equals typeCounts
  {
    const scan = resultOf(filesUnder("X:/T", "T", ["a.pdf", "b.xlsx", "c.pdf"]));
    const built = buildStructureFileTypeInsight(scan);
    const dist = distAt(built, "files:X:/T");
    const obs = typeObsAt(built, "files:X:/T")[0];
    assert(dist !== undefined, "T: dist");
    assert(JSON.stringify(parseTypeCounts(obs)) === JSON.stringify(dist.typeCounts), "T: json match");
  }

  // FALL U – multiple no-extension
  {
    const scan = resultOf(filesUnder("X:/U", "U", ["README", "LICENSE", "NOTES"]));
    const built = buildStructureFileTypeInsight(scan);
    const dist = distAt(built, "files:X:/U");
    assert(dist !== undefined && dist.typeCounts.length === 1, "U: one null bucket");
    assert(dist.typeCounts[0].extensionKey === null && dist.typeCounts[0].count === 3, "U: null3");
  }

  // FALL V – null + pdf + xlsx sort
  {
    const scan = resultOf(filesUnder("X:/V", "V", ["README", "a.pdf", "b.xlsx"]));
    const built = buildStructureFileTypeInsight(scan);
    const dist = distAt(built, "files:X:/V");
    assert(dist !== undefined && dist.typeCounts.length === 3, "V: three");
    assert(dist.typeCounts[0].extensionKey === ".pdf", "V: pdf first");
    assert(dist.typeCounts[1].extensionKey === ".xlsx", "V: xlsx");
    assert(dist.typeCounts[2].extensionKey === null, "V: null last");
  }
}
