/**
 * P2-G parallel structure checks — synthetic fixtures only (FALL A–AH).
 * No RuleCandidates, Suggestions, confirmedExceptions, private Realtest names.
 */

import { type DirectoryListing, type DirectoryNode, type FileNode, type FsNode, type ScanResult } from "../model";
import { buildStructureComparisonContexts } from "./structureComparisonContext";
import { buildStructureFileNameInsight } from "./structureFileNameInsight";
import { buildStructureFileTypeInsight } from "./structureFileTypeInsight";
import { buildStructureFolderPatternInsight } from "./structureFolderPatternInsight";
import { observationClaimsMissingElements } from "./structureInsightModel";
import {
  PARALLEL_FILE_NAME_FORM_SET_OBSERVATION_TYPE,
  PARALLEL_FILE_TYPE_BUCKET_OBSERVATION_TYPE,
  STRUCTURE_PARALLEL_DETECTOR_ID,
  STRUCTURE_PARALLEL_DETECTOR_VERSION,
  STRUCTURE_PARALLEL_SCHEMA_VERSION,
  buildFileNameFormSetSignature,
  buildFileTypeBucketSignature,
  buildStructureParallelInsight,
  compareParallelText,
  createEmptyStructureParallelInsightResult,
  structureParallelInsightJsonRoundTrip,
  structureParallelInsightRoundTripEquals,
  structureParallelResultHasForbiddenClaims,
  type StructureParallelInsightResult,
} from "./structureParallelInsight";

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

function peerDir(
  parentId: string,
  name: string,
  fileNames: readonly string[],
  listing: DirectoryListing = "read",
): DirectoryNode {
  const id = `${parentId}/${name}`;
  return dir(
    id,
    name,
    1,
    fileNames.map((fileName, index) => file(`${id}/f${index}`, fileName, 2)),
    listing,
  );
}

function typeBucketObs(built: StructureParallelInsightResult) {
  return built.insight.observations.filter(
    (observation) => observation.observationType === PARALLEL_FILE_TYPE_BUCKET_OBSERVATION_TYPE,
  );
}

function formSetObs(built: StructureParallelInsightResult) {
  return built.insight.observations.filter(
    (observation) => observation.observationType === PARALLEL_FILE_NAME_FORM_SET_OBSERVATION_TYPE,
  );
}

function folderObsFromParallel(built: StructureParallelInsightResult) {
  return built.insight.observations.filter(
    (observation) =>
      observation.observationType.includes("folder") ||
      observation.observationType.includes("child-folder"),
  );
}

function profileAt(built: StructureParallelInsightResult, nodeId: string) {
  return built.profiles.find((profile) => profile.member.nodeId === nodeId);
}

export function runStructureParallelInsightCheck(): void {
  assert(STRUCTURE_PARALLEL_SCHEMA_VERSION === 1, "schema");
  assert(STRUCTURE_PARALLEL_DETECTOR_ID === "parallel-structure", "detector id");
  assert(STRUCTURE_PARALLEL_DETECTOR_VERSION === 1, "detector version");
  assert(createEmptyStructureParallelInsightResult().profiles.length === 0, "empty");
  assert(compareParallelText("a", "b") < 0, "ascii order");
  assert(compareParallelText("B", "a") < 0, "code unit B < a");
  assert(buildFileTypeBucketSignature([".pdf"]) === '[".pdf"]', "bucket sig pdf");
  assert(buildFileTypeBucketSignature([".pdf", ".jpg"]) === '[".jpg",".pdf"]', "bucket sig sort");
  assert(buildFileTypeBucketSignature([".pdf", null]) === '[".pdf",null]', "bucket sig null last");
  assert(buildFileTypeBucketSignature([]) === "[]", "bucket empty");
  assert(buildFileNameFormSetSignature([]) === "[]", "form empty");
  assert(buildFileNameFormSetSignature(["text", "digits:2"]) === '["digits:2","text"]', "form sort");

  // FALL A – kein P2-B-Kontext (root ohne Child-Dirs)
  {
    const scan = resultOf(dir("X:/Root", "Root", 0, [file("X:/Root/a.pdf", "a.pdf", 1)]));
    const built = buildStructureParallelInsight(scan);
    assert(built.profiles.length === 0, "A: no profiles");
    assert(built.insight.observations.length === 0, "A: no obs");
  }

  // FALL B – 1 Peer → Profil, keine Obs
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [peerDir("X:/Parent", "Only", ["a.pdf", "b.pdf"])]),
    );
    const built = buildStructureParallelInsight(scan);
    assert(built.profiles.length === 1, "B: one profile");
    assert(built.insight.observations.length === 0, "B: no obs");
    const profile = built.profiles[0];
    assert(profile.evaluableByFamily.fileType === true, "B: type evaluable");
    assert(profile.fileTypeBucketSignature === '[".pdf"]', "B: bucket");
  }

  // FALL C/D – Folder-Struktur → keine P2-G-Folder-Obs (P2-D zuständig)
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        dir("X:/Parent/A", "A", 1, [
          dir("X:/Parent/A/Rechnungen", "Rechnungen", 2),
          dir("X:/Parent/A/Vertrag", "Vertrag", 2),
        ]),
        dir("X:/Parent/B", "B", 1, [
          dir("X:/Parent/B/Vertrag", "Vertrag", 2),
          dir("X:/Parent/B/Rechnungen", "Rechnungen", 2),
        ]),
      ]),
    );
    const parallel = buildStructureParallelInsight(scan);
    assert(folderObsFromParallel(parallel).length === 0, "C: no P2-G folder obs");
    const folder = buildStructureFolderPatternInsight(scan);
    assert(folder.insight.observations.some((o) => o.observationType.includes("folder")), "C: P2-D has folder");

    const different = resultOf(
      dir("X:/Parent2", "Parent2", 0, [
        dir("X:/Parent2/A", "A", 1, [dir("X:/Parent2/A/Rechnungen", "Rechnungen", 2)]),
        dir("X:/Parent2/B", "B", 1, [dir("X:/Parent2/B/Vertrag", "Vertrag", 2)]),
      ]),
    );
    assert(folderObsFromParallel(buildStructureParallelInsight(different)).length === 0, "D: no folder obs");
  }

  // FALL E – 3 Peers, 2 gleiche Buckets
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        peerDir("X:/Parent", "2021", ["a.jpg", "b.pdf"]),
        peerDir("X:/Parent", "2022", ["c.pdf"]),
        peerDir("X:/Parent", "2023", ["d.pdf", "e.pdf"]),
      ]),
    );
    const built = buildStructureParallelInsight(scan);
    const buckets = typeBucketObs(built);
    assert(buckets.length === 1, "E: one bucket obs");
    assert(buckets[0].matchedCount === 2, "E: matched 2");
    assert(buckets[0].totalCount === 3, "E: total 3");
    assert(buckets[0].patternFeatures.signature === '[".pdf"]', "E: pdf signature");
    assert(buckets[0].counterEvidence.length === 0, "E: no counter");
    assert(buckets[0].supportingEvidence.length === 2, "E: two supports");
  }

  // FALL F – Extension-Reihenfolge unterschiedlich → gleiche Signatur
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        peerDir("X:/Parent", "A", ["z.xlsx", "a.pdf"]),
        peerDir("X:/Parent", "B", ["b.pdf", "c.xlsx"]),
      ]),
    );
    const built = buildStructureParallelInsight(scan);
    const buckets = typeBucketObs(built);
    assert(buckets.length === 1, "F: one group");
    assert(buckets[0].patternFeatures.signature === '[".pdf",".xlsx"]', "F: sorted buckets");
  }

  // FALL G – .PDF/.pdf via P2-F
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        peerDir("X:/Parent", "A", ["Doc.PDF"]),
        peerDir("X:/Parent", "B", ["other.pdf"]),
      ]),
    );
    const built = buildStructureParallelInsight(scan);
    assert(typeBucketObs(built).length === 1, "G: same bucket after lower");
    assert(typeBucketObs(built)[0].patternFeatures.signature === '[".pdf"]', "G: .pdf");
  }

  // FALL H – 2 Peers 0 Dateien → "[]" Obs, keine Missing-Semantik
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        peerDir("X:/Parent", "EmptyA", []),
        peerDir("X:/Parent", "EmptyB", []),
      ]),
    );
    const built = buildStructureParallelInsight(scan);
    for (const profile of built.profiles) {
      assert(profile.fileTypeBucketSignature === "[]", "H: type []");
      assert(profile.fileNameFormSetSignature === "[]", "H: form []");
      assert(profile.evaluableByFamily.fileType === true, "H: type evaluable");
      assert(profile.evaluableByFamily.fileName === true, "H: form evaluable");
    }
    assert(typeBucketObs(built).length === 1, "H: type obs");
    assert(formSetObs(built).length === 1, "H: form obs");
    assert(
      built.insight.observations.every((o) => o.patternFeatures.claimsMissingElements === false),
      "H: no missing",
    );
    assert(structureParallelResultHasForbiddenClaims(built) === false, "H: no forbidden claims");
  }

  // FALL I – listing != read
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        peerDir("X:/Parent", "Read", ["a.pdf"]),
        dir("X:/Parent/Unread", "Unread", 1, [], "incomplete"),
      ]),
    );
    const built = buildStructureParallelInsight(scan);
    assert(built.profiles.length === 2, "I: both members profiled");
    const unread = profileAt(built, "X:/Parent/Unread");
    assert(unread !== undefined, "I: unread profile");
    assert(unread.evaluableByFamily.fileType === false, "I: type not evaluable");
    assert(unread.evaluableByFamily.fileName === false, "I: form not evaluable");
    assert(unread.fileTypeBucketSignature === null, "I: not []");
    assert(unread.fileNameFormSetSignature === null, "I: form null");
    assert(typeBucketObs(built).length === 0, "I: no type group obs");
  }

  // FALL J – .pdf×5 vs .pdf×3 gleiche Bucket-Gruppe, Counts verschieden
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        peerDir("X:/Parent", "A", ["1.pdf", "2.pdf", "3.pdf", "4.pdf", "5.pdf"]),
        peerDir("X:/Parent", "B", ["a.pdf", "b.pdf", "c.pdf"]),
      ]),
    );
    const built = buildStructureParallelInsight(scan);
    const buckets = typeBucketObs(built);
    assert(buckets.length === 1, "J: one bucket obs");
    assert(buckets[0].matchedCount === 2, "J: matched");
    const counts = buckets[0].supportingEvidence.map((item) => item.attributes?.fileTypeCountsJson);
    assert(counts[0] !== counts[1], "J: different counts in evidence");
    assert(buckets[0].patternFeatures.typeCountsJsonSample === undefined, "J: no group count sample");
  }

  // FALL K – exakt gleiche Counts → keine Count-Observation
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        peerDir("X:/Parent", "A", ["1.pdf", "2.pdf"]),
        peerDir("X:/Parent", "B", ["a.pdf", "b.pdf"]),
      ]),
    );
    const built = buildStructureParallelInsight(scan);
    assert(
      !built.insight.observations.some((o) => o.observationType.includes("count-group")),
      "K: no count-group obs",
    );
    assert(typeBucketObs(built).length === 1, "K: still bucket obs");
  }

  // FALL L – unterschiedliche Buckets → Singleton ohne Obs
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        peerDir("X:/Parent", "A", ["a.pdf"]),
        peerDir("X:/Parent", "B", ["b.xlsx"]),
      ]),
    );
    const built = buildStructureParallelInsight(scan);
    assert(typeBucketObs(built).length === 0, "L: no bucket obs");
  }

  // FALL M – gleiche Form-Sets
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        peerDir("X:/Parent", "A", ["20250101_Rechnung.pdf", "20250202_Notiz.pdf"]),
        peerDir("X:/Parent", "B", ["20250303_Rechnung.pdf", "20250404_Notiz.pdf"]),
      ]),
    );
    const built = buildStructureParallelInsight(scan);
    assert(formSetObs(built).length >= 1, "M: form set obs");
    const obs = formSetObs(built)[0];
    assert(obs.matchedCount === 2, "M: matched 2");
    assert(typeof obs.patternFeatures.signature === "string", "M: signature string");
    const parsed = JSON.parse(String(obs.patternFeatures.signature)) as string[];
    assert(Array.isArray(parsed) && parsed.length >= 1, "M: AH form json array");
  }

  // FALL N – unterschiedliche Form-Sets
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        peerDir("X:/Parent", "A", ["20250101_Rechnung.pdf"]),
        peerDir("X:/Parent", "B", ["Rechnung-001.pdf"]),
      ]),
    );
    const built = buildStructureParallelInsight(scan);
    assert(formSetObs(built).length === 0, "N: different forms no obs");
  }

  // FALL O – je Peer 1 Datei gleiche Form → Form-Set-Obs
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        peerDir("X:/Parent", "A", ["20250101_Rechnung.pdf"]),
        peerDir("X:/Parent", "B", ["20250202_Notiz.pdf"]),
      ]),
    );
    const built = buildStructureParallelInsight(scan);
    assert(formSetObs(built).length === 1, "O: singleton forms still match");
    assert(formSetObs(built)[0].matchedCount === 2, "O: matched 2");
  }

  // FALL P/Q – strikte P2-B-Trennung; gleiche Signatur in zwei Kontexten
  {
    const scan = resultOf(
      dir("X:/Root", "Root", 0, [
        dir("X:/Root/Left", "Left", 1, [
          peerDir("X:/Root/Left", "A", ["a.pdf"]),
          peerDir("X:/Root/Left", "B", ["b.pdf"]),
        ]),
        dir("X:/Root/Right", "Right", 1, [
          peerDir("X:/Root/Right", "C", ["c.pdf"]),
          peerDir("X:/Root/Right", "D", ["d.pdf"]),
        ]),
      ]),
    );
    const built = buildStructureParallelInsight(scan);
    const leftId = "siblings:X:/Root/Left";
    const rightId = "siblings:X:/Root/Right";
    const leftObs = typeBucketObs(built).filter(
      (observation) => observation.patternFeatures.comparisonContextId === leftId,
    );
    const rightObs = typeBucketObs(built).filter(
      (observation) => observation.patternFeatures.comparisonContextId === rightId,
    );
    assert(leftObs.length === 1, "Q: left context obs");
    assert(rightObs.length === 1, "Q: right context obs");
    assert(leftObs[0].id !== rightObs[0].id, "Q: distinct ids");
    assert(leftObs[0].matchedCount === 2 && rightObs[0].matchedCount === 2, "Q: matched per context");
    assert(
      !built.insight.observations.some(
        (observation) =>
          observation.patternFeatures.comparisonContextId === leftId &&
          observation.supportingEvidence.some((item) => item.element.nodeId.startsWith("X:/Root/Right")),
      ),
      "P: no cross-context members",
    );
  }

  // FALL R – Determinismus
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        peerDir("X:/Parent", "A", ["a.pdf", "b.xlsx"]),
        peerDir("X:/Parent", "B", ["c.pdf", "d.xlsx"]),
        peerDir("X:/Parent", "C", ["e.jpg"]),
      ]),
    );
    const first = buildStructureParallelInsight(scan);
    const second = buildStructureParallelInsight(scan);
    assert(JSON.stringify(first) === JSON.stringify(second), "R: byte identical");
    assert(structureParallelInsightRoundTripEquals(first), "R: roundtrip");
  }

  // FALL S/T – negative Verträge
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        peerDir("X:/Parent", "A", ["a.pdf"]),
        peerDir("X:/Parent", "B", ["b.pdf"]),
      ]),
    );
    const built = buildStructureParallelInsight(scan);
    assert(built.insight.ruleCandidates.length === 0, "S: no rules");
    assert(built.insight.suggestions.length === 0, "S: no suggestions");
    assert(built.insight.confirmedExceptions.length === 0, "S: no exceptions");
    assert(
      built.insight.observations.every((o) => observationClaimsMissingElements(o) === false),
      "T: claimsMissing false",
    );
    assert(structureParallelResultHasForbiddenClaims(built) === false, "S: guard clean");
  }

  // FALL U – 120 Peers gleiche Signatur
  {
    const peers = Array.from({ length: 120 }, (_, index) =>
      peerDir("X:/Parent", `P${String(index).padStart(3, "0")}`, [`f${index}.pdf`]),
    );
    const scan = resultOf(dir("X:/Parent", "Parent", 0, peers));
    const built = buildStructureParallelInsight(scan);
    const buckets = typeBucketObs(built);
    assert(buckets.length === 1, "U: one obs");
    assert(buckets[0].matchedCount === 120, "U: matched 120");
    assert(buckets[0].totalCount === 120, "U: total 120");
  }

  // FALL V – 1.000 Peers Map-basiert (Smoke)
  {
    const peers = Array.from({ length: 1000 }, (_, index) =>
      peerDir("X:/Parent", `P${String(index).padStart(4, "0")}`, index % 2 === 0 ? [`e${index}.pdf`] : [`e${index}.xlsx`]),
    );
    const scan = resultOf(dir("X:/Parent", "Parent", 0, peers));
    const started = Date.now();
    const built = buildStructureParallelInsight(scan);
    const elapsed = Date.now() - started;
    assert(built.profiles.length === 1000, "V: 1000 profiles");
    assert(typeBucketObs(built).length === 2, "V: two bucket groups");
    assert(elapsed < 15_000, `V: finished in time (${elapsed}ms)`);
  }

  // FALL W – keine Similarity-Prozente
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        peerDir("X:/Parent", "A", ["a.pdf"]),
        peerDir("X:/Parent", "B", ["b.pdf"]),
      ]),
    );
    const serialized = JSON.stringify(buildStructureParallelInsight(scan));
    assert(!/"similarity"\s*:/.test(serialized), "W: no similarity");
    assert(!serialized.includes("similarityScore"), "W: no similarityScore");
    assert(!/"confidenceScore"\s*:/.test(serialized), "W: no confidenceScore");
    assert(!/"\d+%"/.test(serialized), "W: no percent scores");
  }

  // FALL X – struktureller Unterschied ≠ Missing
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        peerDir("X:/Parent", "A", ["a.pdf"]),
        peerDir("X:/Parent", "B", ["b.pdf", "c.xlsx"]),
      ]),
    );
    const built = buildStructureParallelInsight(scan);
    assert(
      built.insight.observations.every((o) => o.patternFeatures.claimsMissingElements === false),
      "X: no missing claim",
    );
  }

  // FALL Y – 0 Files vs Files → unterschiedliche Signaturen, kein Counter
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        peerDir("X:/Parent", "Empty", []),
        peerDir("X:/Parent", "Files", ["a.pdf"]),
      ]),
    );
    const built = buildStructureParallelInsight(scan);
    const empty = profileAt(built, "X:/Parent/Empty");
    const files = profileAt(built, "X:/Parent/Files");
    assert(empty?.fileTypeBucketSignature === "[]", "Y: empty []");
    assert(files?.fileTypeBucketSignature === '[".pdf"]', "Y: pdf bucket");
    assert(typeBucketObs(built).length === 0, "Y: no joint obs");
    assert(built.insight.observations.every((o) => o.counterEvidence.length === 0), "Y: AE no counter");
  }

  // FALL Z – P2-E/F Produktdateien unverändert: indirekt via gleiche Builder-Outputs
  // (git diff in report); hier fachliche Ableitung aus denselben Results prüfen.

  // FALL AA – vorgefertigte Results vs intern gebaut
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        peerDir("X:/Parent", "A", ["20250101_Rechnung.pdf", "note.pdf"]),
        peerDir("X:/Parent", "B", ["20250202_Notiz.pdf", "x.pdf"]),
      ]),
    );
    const comparison = buildStructureComparisonContexts(scan);
    const fileName = buildStructureFileNameInsight(scan);
    const fileType = buildStructureFileTypeInsight(scan);
    const withPrepared = buildStructureParallelInsight(scan, { comparison, fileName, fileType });
    const internal = buildStructureParallelInsight(scan);
    assert(JSON.stringify(withPrepared) === JSON.stringify(internal), "AA: prepared === internal");
  }

  // FALL AB – null-Extension Buckets
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        peerDir("X:/Parent", "A", ["a.pdf", "README"]),
        peerDir("X:/Parent", "B", ["b.pdf", "LICENSE"]),
      ]),
    );
    const built = buildStructureParallelInsight(scan);
    const buckets = typeBucketObs(built);
    assert(buckets.length === 1, "AB: one group");
    assert(buckets[0].patternFeatures.signature === '[".pdf",null]', "AB: null in signature");
    const keys = JSON.parse(String(buckets[0].patternFeatures.signature)) as unknown[];
    assert(keys.includes(null), "AB: real JSON null");
  }

  // FALL AC – Counts beeinflussen Bucket-Signatur nicht
  {
    assert(
      buildFileTypeBucketSignature([".pdf", ".pdf", ".pdf"]) === buildFileTypeBucketSignature([".pdf"]),
      "AC: unique buckets",
    );
  }

  // FALL AD – keine Folder-Observation aus P2-G
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        dir("X:/Parent/A", "A", 1, [
          dir("X:/Parent/A/Rechnungen", "Rechnungen", 2),
          file("X:/Parent/A/a.pdf", "a.pdf", 2),
        ]),
        dir("X:/Parent/B", "B", 1, [
          dir("X:/Parent/B/Rechnungen", "Rechnungen", 2),
          file("X:/Parent/B/b.pdf", "b.pdf", 2),
        ]),
      ]),
    );
    assert(folderObsFromParallel(buildStructureParallelInsight(scan)).length === 0, "AD: no folder");
  }

  // FALL AE – counterEvidence immer []
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        peerDir("X:/Parent", "A", ["a.pdf"]),
        peerDir("X:/Parent", "B", ["b.pdf"]),
        peerDir("X:/Parent", "C", ["c.xlsx"]),
      ]),
    );
    const built = buildStructureParallelInsight(scan);
    assert(
      built.insight.observations.every((observation) => observation.counterEvidence.length === 0),
      "AE: all counters empty",
    );
  }

  // FALL AF – Qualifier stabil aus ALLEN Signaturgruppen vor >=2-Filter
  {
    // Signatures sorted: ["\.jpg"] then ["\.pdf"] → jpg=group-0001 (singleton skipped),
    // pdf=group-0002 (emitted). Adding another jpg peer later would change thresholds but
    // with current peers pdf qualifier must be group-0002.
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        peerDir("X:/Parent", "JpgOnly", ["a.jpg"]),
        peerDir("X:/Parent", "PdfA", ["a.pdf"]),
        peerDir("X:/Parent", "PdfB", ["b.pdf"]),
      ]),
    );
    const built = buildStructureParallelInsight(scan);
    const buckets = typeBucketObs(built);
    assert(buckets.length === 1, "AF: one emitted");
    assert(String(buckets[0].id).endsWith(":group-0002"), "AF: pdf is group-0002");
    assert(buckets[0].patternFeatures.groupQualifier === "group-0002", "AF: qualifier field");
  }

  // FALL AG – keine konkreten Dateinamen/Pfade in Signaturidentität
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        peerDir("X:/Parent", "A", ["SuperSpezifischerName_123456.pdf"]),
        peerDir("X:/Parent", "B", ["AndererName_654321.pdf"]),
      ]),
    );
    const built = buildStructureParallelInsight(scan);
    for (const observation of built.insight.observations) {
      const signature = String(observation.patternFeatures.signature);
      assert(!signature.includes("SuperSpezifischerName"), "AG: no file name in sig");
      assert(!signature.includes("X:/Parent"), "AG: no path in sig");
    }
  }

  // FALL AH – FormSet-Signatur JSON-Array roundtrip
  {
    const signature = buildFileNameFormSetSignature([
      'digits:8|sep:"_"|text',
      'digits:6|sep:"_"|text',
    ]);
    const round = JSON.parse(signature) as string[];
    assert(Array.isArray(round), "AH: array");
    assert(round.length === 2, "AH: two forms");
    assert(JSON.stringify(round) === signature, "AH: roundtrip");
  }

  // Extra: category / scope / comparisonGroup
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        peerDir("X:/Parent", "A", ["a.pdf"]),
        peerDir("X:/Parent", "B", ["b.pdf"]),
      ]),
    );
    const built = buildStructureParallelInsight(scan);
    const obs = typeBucketObs(built)[0];
    assert(obs.category === "other", "cat: type other");
    assert(obs.comparisonGroup.length === 2, "scope: full comparison group");
    assert(obs.scope.kind === "comparisonSet", "scope kind");
    assert(Number(obs.patternFeatures.evaluableCount) === 2, "evaluableCount");
  }

  // Extra: form category
  {
    const scan = resultOf(
      dir("X:/Parent", "Parent", 0, [
        peerDir("X:/Parent", "A", ["20250101_Rechnung.pdf"]),
        peerDir("X:/Parent", "B", ["20250202_Notiz.pdf"]),
      ]),
    );
    assert(formSetObs(buildStructureParallelInsight(scan))[0].category === "fileNamePattern", "form cat");
  }

  // Roundtrip helper
  {
    const empty = createEmptyStructureParallelInsightResult();
    assert(
      JSON.stringify(structureParallelInsightJsonRoundTrip(empty)) === JSON.stringify(empty),
      "roundtrip empty",
    );
  }
}
