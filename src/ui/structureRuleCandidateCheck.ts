/**
 * P2-H rule-candidate checks — synthetic fixtures only (FALL A–AV+).
 * No Suggestions, ConfirmedExceptions, private Realtest names.
 */

import { type DirectoryListing, type DirectoryNode, type FileNode, type FsNode, type ScanResult } from "../model";
import { buildStructureComparisonContexts } from "./structureComparisonContext";
import { buildStructureTimeInsight } from "./structureTimeInsight";
import { buildStructureFolderPatternInsight } from "./structureFolderPatternInsight";
import { buildStructureFileNameInsight } from "./structureFileNameInsight";
import { buildStructureFileTypeInsight } from "./structureFileTypeInsight";
import { buildStructureParallelInsight } from "./structureParallelInsight";
import { runStructureInsightModelCheck } from "./structureInsightModelCheck";
import {
  PRINCIPLE_PARALLEL_FILE_NAME_FORM_SET,
  PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET,
  PRINCIPLE_RECURRING_CHILD_FOLDER_NAME,
  PRINCIPLE_RECURRING_CHILD_FOLDER_SET,
  PRINCIPLE_RECURRING_FILE_NAME_FORM,
  PRINCIPLE_RECURRING_YEAR,
  STRUCTURE_RULE_CANDIDATE_DETECTOR_ID,
  STRUCTURE_RULE_CANDIDATE_DETECTOR_VERSION,
  STRUCTURE_RULE_CANDIDATE_SCHEMA_VERSION,
  buildStructureRuleCandidateInsight,
  compareRuleCandidateText,
  createEmptyStructureRuleCandidateInsightResult,
  passesRepetitionGate,
  passesRivalGate,
  structureRuleCandidateInsightJsonRoundTrip,
  structureRuleCandidateInsightRoundTripEquals,
  structureRuleCandidateResultHasForbiddenClaims,
  type StructureRuleCandidateInsightResult,
} from "./structureRuleCandidate";

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
  return { id, name, path: id, depth, kind: "directory", listing, children };
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

function peerWithFiles(parentId: string, name: string, fileNames: readonly string[]): DirectoryNode {
  const id = `${parentId}/${name}`;
  return dir(
    id,
    name,
    1,
    fileNames.map((fileName, index) => file(`${id}/f${index}`, fileName, 2)),
  );
}

function peerWithChildDirs(parentId: string, name: string, childNames: readonly string[]): DirectoryNode {
  const id = `${parentId}/${name}`;
  return dir(
    id,
    name,
    1,
    childNames.map((childName) => dir(`${id}/${childName}`, childName, 2)),
  );
}

function candidatesOf(built: StructureRuleCandidateInsightResult, principle?: string) {
  return built.insight.ruleCandidates.filter((candidate) =>
    principle === undefined ? true : candidate.principle === principle,
  );
}

function assertCandidateBasics(candidate: StructureRuleCandidateInsightResult["insight"]["ruleCandidates"][number], label: string): void {
  assert(candidate.status === "detected", `${label}: status detected`);
  assert(candidate.confidence.level === "unassessed", `${label}: unassessed`);
  assert(candidate.confidence.factors.length === 0, `${label}: empty factors`);
  assert(candidate.observationIds.length === 1, `${label}: one obs id`);
  assert(candidate.id.startsWith("rule:"), `${label}: id prefix`);
}

export function runStructureRuleCandidateCheck(): void {
  assert(STRUCTURE_RULE_CANDIDATE_SCHEMA_VERSION === 1, "schema");
  assert(STRUCTURE_RULE_CANDIDATE_DETECTOR_ID === "rule-candidate", "detector");
  assert(STRUCTURE_RULE_CANDIDATE_DETECTOR_VERSION === 1, "version");
  assert(createEmptyStructureRuleCandidateInsightResult().insight.ruleCandidates.length === 0, "empty");
  assert(compareRuleCandidateText("a", "b") < 0, "utf16");
  assert(passesRepetitionGate(2, 2) === true, "gate 2/2");
  assert(passesRepetitionGate(2, 3) === false, "gate 2/3");
  assert(passesRepetitionGate(3, 4) === true, "gate 3/4");
  assert(passesRepetitionGate(1, 1) === false, "gate 1/1");
  assert(passesRivalGate(5, 1) === true, "rival 5>1");
  assert(passesRivalGate(3, 3) === false, "rival 3=3");

  // Ensure P2-A unassessed checks still run as part of suite wiring elsewhere;
  // call once here for local confidence that imports remain consistent.
  runStructureInsightModelCheck();

  // FALL A – keine Observations → 0 Candidates
  {
    const scan = resultOf(dir("X:/Root", "Root", 0, [file("X:/Root/a.pdf", "a.pdf", 1)]));
    const built = buildStructureRuleCandidateInsight(scan);
    assert(built.insight.ruleCandidates.length === 0, "A: 0 candidates");
    assert(built.insight.suggestions.length === 0, "A: no suggestions");
    assert(built.insight.confirmedExceptions.length === 0, "A: no exceptions");
  }

  // FALL B – matched=2 evaluable=3 → 0 (via P2-G 2 pdf + 1 jpg peer)
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        peerWithFiles("X:/P", "A", ["a.pdf"]),
        peerWithFiles("X:/P", "B", ["b.pdf"]),
        peerWithFiles("X:/P", "C", ["c.jpg"]),
      ]),
    );
    const built = buildStructureRuleCandidateInsight(scan);
    assert(candidatesOf(built, PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET).length === 0, "B: 2/3 no candidate");
  }

  // FALL C – 2/2 einstimmig
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        peerWithFiles("X:/P", "A", ["a.pdf"]),
        peerWithFiles("X:/P", "B", ["b.pdf"]),
      ]),
    );
    const built = buildStructureRuleCandidateInsight(scan);
    const buckets = candidatesOf(built, PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET);
    assert(buckets.length === 1, "C: one candidate");
    assert(buckets[0].support.matchedCount === 2, "C: matched 2");
    assertCandidateBasics(buckets[0], "C");
  }

  // FALL D – 3/3
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        peerWithFiles("X:/P", "A", ["a.pdf"]),
        peerWithFiles("X:/P", "B", ["b.pdf"]),
        peerWithFiles("X:/P", "C", ["c.pdf"]),
      ]),
    );
    const built = buildStructureRuleCandidateInsight(scan);
    assert(candidatesOf(built, PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET).length === 1, "D: 3/3");
  }

  // FALL E – 7/7
  {
    const peers = Array.from({ length: 7 }, (_, index) =>
      peerWithFiles("X:/P", `Y${index}`, [`f${index}.pdf`]),
    );
    const built = buildStructureRuleCandidateInsight(resultOf(dir("X:/P", "P", 0, peers)));
    const buckets = candidatesOf(built, PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET);
    assert(buckets.length === 1 && buckets[0].support.matchedCount === 7, "E: 7/7");
  }

  // FALL F – 5 vs 1
  {
    const peers = [
      ...Array.from({ length: 5 }, (_, index) => peerWithFiles("X:/P", `P${index}`, [`a${index}.pdf`])),
      peerWithFiles("X:/P", "Mixed", ["x.jpg", "y.pdf"]),
    ];
    const built = buildStructureRuleCandidateInsight(resultOf(dir("X:/P", "P", 0, peers)));
    const buckets = candidatesOf(built, PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET);
    assert(buckets.length === 1, "F: one winner");
    assert(buckets[0].support.matchedCount === 5, "F: matched 5");
    assert(buckets[0].candidateFeatures?.maxRivalMatchedCount === 1, "F: rival 1");
    assert(buckets[0].counterEvidence.length === 0, "F/X: no counter from P2-G");
  }

  // FALL G – 4 vs 2
  {
    const peers = [
      ...Array.from({ length: 4 }, (_, index) => peerWithFiles("X:/P", `P${index}`, [`a${index}.pdf`])),
      peerWithFiles("X:/P", "X1", ["a.xlsx"]),
      peerWithFiles("X:/P", "X2", ["b.xlsx"]),
    ];
    const built = buildStructureRuleCandidateInsight(resultOf(dir("X:/P", "P", 0, peers)));
    const buckets = candidatesOf(built, PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET);
    assert(buckets.length === 1 && buckets[0].support.matchedCount === 4, "G: 4 vs 2");
  }

  // FALL H – 3 vs 3 → 0
  {
    const peers = [
      peerWithFiles("X:/P", "A", ["a.pdf"]),
      peerWithFiles("X:/P", "B", ["b.pdf"]),
      peerWithFiles("X:/P", "C", ["c.pdf"]),
      peerWithFiles("X:/P", "D", ["d.xlsx"]),
      peerWithFiles("X:/P", "E", ["e.xlsx"]),
      peerWithFiles("X:/P", "F", ["f.xlsx"]),
    ];
    const built = buildStructureRuleCandidateInsight(resultOf(dir("X:/P", "P", 0, peers)));
    assert(candidatesOf(built, PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET).length === 0, "H/AR: 3 vs 3");
  }

  // FALL I – 3 vs 2 vs 1 → candidate for 3
  {
    const peers = [
      peerWithFiles("X:/P", "A", ["a.pdf"]),
      peerWithFiles("X:/P", "B", ["b.pdf"]),
      peerWithFiles("X:/P", "C", ["c.pdf"]),
      peerWithFiles("X:/P", "D", ["d.xlsx"]),
      peerWithFiles("X:/P", "E", ["e.xlsx"]),
      peerWithFiles("X:/P", "F", ["f.jpg"]),
    ];
    const built = buildStructureRuleCandidateInsight(resultOf(dir("X:/P", "P", 0, peers)));
    const buckets = candidatesOf(built, PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET);
    assert(buckets.length === 1 && buckets[0].support.matchedCount === 3, "I: 3 wins");
  }

  // FALL J – 2 vs 2 → 0
  {
    const peers = [
      peerWithFiles("X:/P", "A", ["a.pdf"]),
      peerWithFiles("X:/P", "B", ["b.pdf"]),
      peerWithFiles("X:/P", "C", ["c.xlsx"]),
      peerWithFiles("X:/P", "D", ["d.xlsx"]),
    ];
    assert(
      candidatesOf(buildStructureRuleCandidateInsight(resultOf(dir("X:/P", "P", 0, peers))), PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET)
        .length === 0,
      "J: 2 vs 2",
    );
  }

  // FALL K – 2 vs 1 → 0
  {
    const peers = [
      peerWithFiles("X:/P", "A", ["a.pdf"]),
      peerWithFiles("X:/P", "B", ["b.pdf"]),
      peerWithFiles("X:/P", "C", ["c.xlsx"]),
    ];
    assert(
      candidatesOf(buildStructureRuleCandidateInsight(resultOf(dir("X:/P", "P", 0, peers))), PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET)
        .length === 0,
      "K: 2 vs 1",
    );
  }

  // FALL L/M – P2-C recurring year vs non-recurring
  {
    const recurring = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/2021", "2021", 1),
        dir("X:/P/2022", "2022", 1),
        dir("X:/P/2023", "2023", 1),
      ]),
    );
    const builtRecurring = buildStructureRuleCandidateInsight(recurring);
    assert(candidatesOf(builtRecurring, PRINCIPLE_RECURRING_YEAR).length === 1, "L: recurring year");

    const nonRecurring = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/2021", "2021", 1),
        dir("X:/P/Other", "Other", 1),
        dir("X:/P/Notes", "Notes", 1),
      ]),
    );
    assert(
      candidatesOf(buildStructureRuleCandidateInsight(nonRecurring), PRINCIPLE_RECURRING_YEAR).length === 0,
      "M: non-recurring year",
    );
  }

  // FALL N/O – gap / mixed excluded (no candidates from those types)
  {
    const gapScan = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/2021", "2021", 1),
        dir("X:/P/2023", "2023", 1),
        dir("X:/P/2024", "2024", 1),
      ]),
    );
    const built = buildStructureRuleCandidateInsight(gapScan);
    assert(
      !built.insight.ruleCandidates.some((candidate) =>
        JSON.stringify(candidate).includes("year-span-absence"),
      ),
      "N: no gap candidate",
    );
    assert(
      !built.insight.ruleCandidates.some((candidate) => candidate.principle.includes("mixed")),
      "O: no mixed candidate",
    );
  }

  // FALL P – P2-D child-name matched=1 → 0
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        peerWithChildDirs("X:/P", "A", ["Rechnungen"]),
        peerWithChildDirs("X:/P", "B", ["Vertrag"]),
        peerWithChildDirs("X:/P", "C", ["Notizen"]),
      ]),
    );
    assert(
      candidatesOf(buildStructureRuleCandidateInsight(scan), PRINCIPLE_RECURRING_CHILD_FOLDER_NAME).length === 0,
      "P: singleton names",
    );
  }

  // FALL Q – additive recurring child names both candidates
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        peerWithChildDirs("X:/P", "A", ["Rechnungen", "Vertrag"]),
        peerWithChildDirs("X:/P", "B", ["Rechnungen", "Vertrag"]),
        peerWithChildDirs("X:/P", "C", ["Rechnungen", "Vertrag"]),
      ]),
    );
    const names = candidatesOf(buildStructureRuleCandidateInsight(scan), PRINCIPLE_RECURRING_CHILD_FOLDER_NAME);
    assert(names.length === 2, "Q: two additive name candidates");
    const keys = names.map((candidate) => String(candidate.candidateFeatures?.sourcePatternKey)).sort(compareRuleCandidateText);
    assert(keys.join(",") === "rechnungen,vertrag", "Q: both names");
  }

  // FALL R – P2-D set rival gate
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        peerWithChildDirs("X:/P", "A", ["Rechnungen", "Vertrag"]),
        peerWithChildDirs("X:/P", "B", ["Rechnungen", "Vertrag"]),
        peerWithChildDirs("X:/P", "C", ["Rechnungen", "Vertrag"]),
        peerWithChildDirs("X:/P", "D", ["Alt"]),
        peerWithChildDirs("X:/P", "E", ["Alt"]),
      ]),
    );
    const sets = candidatesOf(buildStructureRuleCandidateInsight(scan), PRINCIPLE_RECURRING_CHILD_FOLDER_SET);
    assert(sets.length === 1 && sets[0].support.matchedCount === 3, "R: set 3 beats 2");
  }

  // FALL S – P2-E file-name-form
  {
    const scan = resultOf(
      dir(
        "X:/Parent",
        "Parent",
        0,
        [
          file("X:/Parent/a", "20250101_Rechnung.pdf", 1),
          file("X:/Parent/b", "20250202_Notiz.pdf", 1),
          file("X:/Parent/c", "20250303_Brief.pdf", 1),
        ],
      ),
    );
    const forms = candidatesOf(buildStructureRuleCandidateInsight(scan), PRINCIPLE_RECURRING_FILE_NAME_FORM);
    assert(forms.length === 1, "S: form candidate");
    assertCandidateBasics(forms[0], "S");
  }

  // FALL T – P2-F alone → 0 (10 PDFs, all unique name forms → no P2-E recurrence either)
  {
    const scan = resultOf(
      dir("X:/Only", "Only", 0, [
        file("X:/Only/f0", "20250101_Rechnung.pdf", 1),
        file("X:/Only/f1", "note-x.pdf", 1),
        file("X:/Only/f2", "report 12.pdf", 1),
        file("X:/Only/f3", "a_b_c_d.pdf", 1),
        file("X:/Only/f4", "1-2-3.pdf", 1),
        file("X:/Only/f5", "x.y.z.pdf", 1),
        file("X:/Only/f6", "final (copy).pdf", 1),
        file("X:/Only/f7", "123_foo.pdf", 1),
        file("X:/Only/f8", "2025-01-01_doc.pdf", 1),
        file("X:/Only/f9", "v1.2.3-beta.pdf", 1),
      ]),
    );
    const built = buildStructureRuleCandidateInsight(scan);
    assert(built.insight.ruleCandidates.length === 0, "T: P2-F alone no candidate");
    assert(
      built.insight.ruleCandidates.every(
        (c) => c.candidateFeatures?.sourceObservationType !== "local-direct-file-type-distribution",
      ),
      "T: no candidate from P2-F distribution type",
    );
  }

  // FALL U/V – P2-G bucket / formset covered above; explicit formset peer case
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        peerWithFiles("X:/P", "A", ["20250101_Rechnung.pdf"]),
        peerWithFiles("X:/P", "B", ["20250202_Notiz.pdf"]),
        peerWithFiles("X:/P", "C", ["20250303_Brief.pdf"]),
      ]),
    );
    const forms = candidatesOf(buildStructureRuleCandidateInsight(scan), PRINCIPLE_PARALLEL_FILE_NAME_FORM_SET);
    assert(forms.length === 1, "V: parallel form set");
  }

  // FALL W – empty [] signature no candidate
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [peerWithFiles("X:/P", "EmptyA", []), peerWithFiles("X:/P", "EmptyB", [])]),
    );
    const built = buildStructureRuleCandidateInsight(scan);
    assert(candidatesOf(built, PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET).length === 0, "W: empty bucket");
    assert(candidatesOf(built, PRINCIPLE_PARALLEL_FILE_NAME_FORM_SET).length === 0, "W: empty form");
  }

  // FALL Y – same signature two scopes → two candidates
  {
    const scan = resultOf(
      dir("X:/Root", "Root", 0, [
        dir("X:/Root/Left", "Left", 1, [
          peerWithFiles("X:/Root/Left", "A", ["a.pdf"]),
          peerWithFiles("X:/Root/Left", "B", ["b.pdf"]),
        ]),
        dir("X:/Root/Right", "Right", 1, [
          peerWithFiles("X:/Root/Right", "C", ["c.pdf"]),
          peerWithFiles("X:/Root/Right", "D", ["d.pdf"]),
        ]),
      ]),
    );
    const buckets = candidatesOf(buildStructureRuleCandidateInsight(scan), PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET);
    assert(buckets.length === 2, "Y: two scopes");
    assert(buckets[0].id !== buckets[1].id, "Y: distinct ids");
  }

  // FALL Z – multiple families in one scope
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        dir("X:/P/2021", "2021", 1, [
          dir("X:/P/2021/Rechnungen", "Rechnungen", 2),
          file("X:/P/2021/a.pdf", "a.pdf", 2),
        ]),
        dir("X:/P/2022", "2022", 1, [
          dir("X:/P/2022/Rechnungen", "Rechnungen", 2),
          file("X:/P/2022/b.pdf", "b.pdf", 2),
        ]),
        dir("X:/P/2023", "2023", 1, [
          dir("X:/P/2023/Rechnungen", "Rechnungen", 2),
          file("X:/P/2023/c.pdf", "c.pdf", 2),
        ]),
      ]),
    );
    const built = buildStructureRuleCandidateInsight(scan);
    assert(candidatesOf(built, PRINCIPLE_RECURRING_YEAR).length === 1, "Z: year");
    assert(candidatesOf(built, PRINCIPLE_RECURRING_CHILD_FOLDER_NAME).length >= 1, "Z: name");
    assert(candidatesOf(built, PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET).length === 1, "Z: bucket");
  }

  // FALL AA–AF / AG / AH / AI / AJ / AK / AL / AM / AN
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        peerWithFiles("X:/P", "A", ["a.pdf", "b.pdf"]),
        peerWithFiles("X:/P", "B", ["c.pdf", "d.pdf"]),
        peerWithFiles("X:/P", "C", ["e.pdf"]),
      ]),
    );
    const built = buildStructureRuleCandidateInsight(scan);
    assert(built.insight.suggestions.length === 0, "AE: suggestions");
    assert(built.insight.confirmedExceptions.length === 0, "AF: exceptions");
    assert(structureRuleCandidateResultHasForbiddenClaims(built) === false, "AG: no forbidden");
    for (const candidate of built.insight.ruleCandidates) {
      assert(candidate.confidence.level === "unassessed", "AA");
      assert(candidate.confidence.factors.length === 0, "AB");
      assert(String(candidate.confidence.level) !== "low", "AC");
      assert(String(candidate.confidence.level) !== "medium", "AC");
      assert(String(candidate.confidence.level) !== "high", "AC");
      assert(candidate.status === "detected", "AD");
      assert(candidate.observationIds.length === 1, "AI");
      assert(typeof candidate.support.matchedCount === "number", "AJ");
      assert(candidate.candidateFeatures !== undefined, "AK");
      assert(candidate.candidateFeatures?.supportRatio === undefined, "AL/AS");
      assert(candidate.id.includes(candidate.observationIds[0]), "AM");
    }
    const ids = built.insight.ruleCandidates.map((candidate) => candidate.id);
    assert(new Set(ids).size === ids.length, "AN: unique ids");
  }

  // FALL AO – Determinismus
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        peerWithFiles("X:/P", "A", ["a.pdf"]),
        peerWithFiles("X:/P", "B", ["b.pdf"]),
        peerWithFiles("X:/P", "C", ["c.pdf"]),
      ]),
    );
    const first = buildStructureRuleCandidateInsight(scan);
    const second = buildStructureRuleCandidateInsight(scan);
    assert(JSON.stringify(first) === JSON.stringify(second), "AO: identical");
    assert(structureRuleCandidateInsightRoundTripEquals(first), "AO: roundtrip");
  }

  // FALL AP – prepared vs internal
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        peerWithFiles("X:/P", "A", ["20250101_Rechnung.pdf"]),
        peerWithFiles("X:/P", "B", ["20250202_Notiz.pdf"]),
        peerWithFiles("X:/P", "C", ["20250303_Brief.pdf"]),
      ]),
    );
    const comparison = buildStructureComparisonContexts(scan);
    const time = buildStructureTimeInsight(scan, comparison);
    const folderPattern = buildStructureFolderPatternInsight(scan, comparison);
    const fileName = buildStructureFileNameInsight(scan);
    const fileType = buildStructureFileTypeInsight(scan);
    const parallel = buildStructureParallelInsight(scan, { comparison, fileName, fileType });
    const prepared = buildStructureRuleCandidateInsight(scan, {
      time,
      folderPattern,
      fileName,
      fileType,
      parallel,
    });
    const internal = buildStructureRuleCandidateInsight(scan);
    assert(JSON.stringify(prepared) === JSON.stringify(internal), "AP: prepared === internal");
  }

  // FALL AQ – 1000 peers smoke
  {
    const peers = Array.from({ length: 1000 }, (_, index) =>
      peerWithFiles("X:/P", `P${String(index).padStart(4, "0")}`, [`f${index}.pdf`]),
    );
    const started = Date.now();
    const built = buildStructureRuleCandidateInsight(resultOf(dir("X:/P", "P", 0, peers)));
    const elapsed = Date.now() - started;
    const buckets = candidatesOf(built, PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET);
    assert(buckets.length === 1 && buckets[0].support.matchedCount === 1000, "AQ: 1000");
    assert(elapsed < 20_000, `AQ: timely (${elapsed}ms)`);
  }

  // FALL AT/AU/AV covered via runStructureInsightModelCheck + existing P2-A cases

  // Extra: AH minority not exception
  {
    const scan = resultOf(
      dir("X:/P", "P", 0, [
        ...Array.from({ length: 5 }, (_, index) => peerWithFiles("X:/P", `P${index}`, [`a${index}.pdf`])),
        peerWithFiles("X:/P", "Mixed", ["x.jpg", "y.pdf"]),
      ]),
    );
    const built = buildStructureRuleCandidateInsight(scan);
    assert(built.insight.confirmedExceptions.length === 0, "AH: no auto exceptions");
  }

  // Roundtrip helper
  {
    const empty = createEmptyStructureRuleCandidateInsightResult();
    assert(
      JSON.stringify(structureRuleCandidateInsightJsonRoundTrip(empty)) === JSON.stringify(empty),
      "roundtrip empty",
    );
  }
}
