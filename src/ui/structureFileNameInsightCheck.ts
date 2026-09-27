/**
 * P2-E file-name structure checks — synthetic fixtures only (FALL A–AK).
 * No RuleCandidates, Suggestions, confirmedExceptions, private Realtest names.
 */

import { type DirectoryListing, type DirectoryNode, type FileNode, type FsNode, type ScanResult } from "../model";
import { observationClaimsMissingElements } from "./structureInsightModel";
import {
  FILE_NAME_FORM_OBSERVATION_TYPE,
  STRUCTURE_FILE_NAME_DETECTOR_ID,
  STRUCTURE_FILE_NAME_DETECTOR_VERSION,
  STRUCTURE_FILE_NAME_SCHEMA_VERSION,
  buildStructureFileNameInsight,
  compareFileNameText,
  createEmptyStructureFileNameInsightResult,
  formSignatureFromTokens,
  splitFileName,
  structureFileNameInsightJsonRoundTrip,
  structureFileNameResultHasForbiddenClaims,
  tokenizeFileNameStem,
  tokensReconstructStem,
  type FileNameFormPositionAnalysis,
  type StructureFileNameInsightResult,
} from "./structureFileNameInsight";

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

function assertTokensLossFree(stem: string, label: string): void {
  const tokens = tokenizeFileNameStem(stem);
  assert(tokensReconstructStem(tokens) === stem, `${label}: reconstruct`);
}

function formObs(built: StructureFileNameInsightResult) {
  return built.insight.observations.filter(
    (observation) => observation.observationType === FILE_NAME_FORM_OBSERVATION_TYPE,
  );
}

function formObsAt(built: StructureFileNameInsightResult, contextId: string) {
  return formObs(built).filter(
    (observation) => observation.patternFeatures.comparisonContextId === contextId,
  );
}

function parsePositions(observation: { patternFeatures: { positionsJson?: string | number | boolean | null } }): FileNameFormPositionAnalysis[] {
  const raw = observation.patternFeatures.positionsJson;
  assert(typeof raw === "string", "positionsJson string");
  return JSON.parse(raw) as FileNameFormPositionAnalysis[];
}

function filesUnder(parentId: string, parentName: string, names: readonly string[]): DirectoryNode {
  return dir(
    parentId,
    parentName,
    0,
    names.map((name, index) => file(`${parentId}/f${index}`, name, 1)),
  );
}

export function runStructureFileNameInsightCheck(): void {
  assert(STRUCTURE_FILE_NAME_SCHEMA_VERSION === 1, "schema");
  assert(STRUCTURE_FILE_NAME_DETECTOR_ID === "file-name-structure", "detector id");
  assert(STRUCTURE_FILE_NAME_DETECTOR_VERSION === 1, "detector version");
  assert(createEmptyStructureFileNameInsightResult().features.length === 0, "empty");
  assert(compareFileNameText("a", "b") < 0, "ascii order");
  assert(compareFileNameText("B", "a") < 0, "code unit B < a");

  // Stem / extension contract + AF loss-free on key names
  {
    assert(splitFileName("rechnung.pdf").stem === "rechnung", "ext stem");
    assert(splitFileName("rechnung.pdf").extensionKey === ".pdf", "ext key");
    assert(splitFileName("archiv.tar.gz").stem === "archiv.tar", "multi stem");
    assert(splitFileName("archiv.tar.gz").extensionKey === ".gz", "multi ext");
    assert(splitFileName("README").hasExtension === false, "no ext README");
    assert(splitFileName(".datei").hasExtension === false, "AB leading");
    assert(splitFileName("datei.").hasExtension === false, "AB trailing");
    const stems = [
      "Rechnung_001",
      "001_Rechnung",
      "2025_01_Rechnung_001",
      "KundeA_Rechnung",
      "rechnung.final.2025",
      "Rechnung _001",
      "Rechnung-_001",
      "__",
      "-_",
      "Rechnung 001",
      "Bücher_01",
      "😀_file",
      "20250131",
      "4711",
    ];
    for (const stem of stems) {
      assertTokensLossFree(stem, `AF:${stem}`);
    }
  }

  // FALL A – Rechnung_001/002/003 same form; text constant; digits variable
  {
    const scan = resultOf(
      filesUnder("X:/R", "R", ["Rechnung_001.pdf", "Rechnung_002.pdf", "Rechnung_003.pdf"]),
    );
    const built = buildStructureFileNameInsight(scan);
    const obs = formObsAt(built, "files:X:/R");
    assert(obs.length === 1, "A: one form obs");
    assert(obs[0].matchedCount === 3, "A: matched 3");
    const positions = parsePositions(obs[0]);
    assert(positions.length === 3, "A: 3 tokens");
    assert(positions[0].kind === "text" && positions[0].constant === true, "A: text const");
    assert(positions[1].kind === "separator" && positions[1].constant === true, "A: sep const");
    assert(positions[2].kind === "digits" && positions[2].constant === false, "A: digits var");
    assert(positions[2].distinctValueCount === 3, "A: 3 digit values");
  }

  // FALL B – leading digits
  {
    const scan = resultOf(filesUnder("X:/B", "B", ["001_Rechnung.pdf", "002_Rechnung.pdf"]));
    const built = buildStructureFileNameInsight(scan);
    const obs = formObsAt(built, "files:X:/B");
    assert(obs.length === 1 && obs[0].matchedCount === 2, "B: form");
    const positions = parsePositions(obs[0]);
    assert(positions[0].kind === "digits" && positions[0].constant === false, "B: digits var");
    assert(positions[2].kind === "text" && positions[2].constant === true, "B: text const");
  }

  // FALL C – 2025_01_Rechnung_001 shape
  {
    const tokens = tokenizeFileNameStem("2025_01_Rechnung_001");
    assert(tokensReconstructStem(tokens) === "2025_01_Rechnung_001", "C: loss-free");
    assert(formSignatureFromTokens(tokens) === 'digits:4|sep:"_"|digits:2|sep:"_"|text|sep:"_"|digits:3', "C: sig");
    const scan = resultOf(
      filesUnder("X:/C", "C", ["2025_01_Rechnung_001.pdf", "2025_01_Rechnung_002.pdf"]),
    );
    const built = buildStructureFileNameInsight(scan);
    assert(formObsAt(built, "files:X:/C").length === 1, "C: obs");
  }

  // FALL D – Kunde*_Rechnung text0 variable, Rechnung constant
  {
    const scan = resultOf(
      filesUnder("X:/D", "D", ["KundeA_Rechnung.pdf", "KundeB_Rechnung.pdf", "KundeC_Rechnung.pdf"]),
    );
    const built = buildStructureFileNameInsight(scan);
    const obs = formObsAt(built, "files:X:/D");
    assert(obs.length === 1, "D: obs");
    const positions = parsePositions(obs[0]);
    assert(positions[0].kind === "text" && positions[0].constant === false, "D: first text var");
    assert(positions[0].distinctValueCount === 3, "D: 3 customers");
    assert(positions[2].kind === "text" && positions[2].constant === true, "D: Rechnung const");
    assert(positions[2].constantValue === "rechnung", "D: normalized");
  }

  // FALL E – different separators → different forms
  {
    const scan = resultOf(filesUnder("X:/E", "E", ["Rechnung-001.pdf", "Rechnung_001.pdf"]));
    const built = buildStructureFileNameInsight(scan);
    assert(formObsAt(built, "files:X:/E").length === 0, "E: no recurring");
    assert(built.features.length === 2, "E: features");
    assert(built.features[0].formSignature !== built.features[1].formSignature, "E: different sig");
  }

  // FALL F / AD – digit length in signature
  {
    const a = formSignatureFromTokens(tokenizeFileNameStem("Rechnung_001"));
    const b = formSignatureFromTokens(tokenizeFileNameStem("Rechnung_12"));
    assert(a !== b, "F/AD: different digit length forms");
    const scan = resultOf(filesUnder("X:/F", "F", ["Rechnung_001.pdf", "Rechnung_12.pdf"]));
    const built = buildStructureFileNameInsight(scan);
    assert(formObsAt(built, "files:X:/F").length === 0, "F: no shared form obs");
  }

  // FALL G – case fold on text position
  {
    const scan = resultOf(
      filesUnder("X:/G", "G", ["Rechnung_001.pdf", "rechnung_002.pdf", "RECHNUNG_003.pdf"]),
    );
    const built = buildStructureFileNameInsight(scan);
    const obs = formObsAt(built, "files:X:/G");
    assert(obs.length === 1, "G: one form");
    const positions = parsePositions(obs[0]);
    assert(positions[0].constant === true && positions[0].constantValue === "rechnung", "G: text folded");
  }

  // FALL H – whitespace differences → different forms
  {
    const a = formSignatureFromTokens(tokenizeFileNameStem("Rechnung_001"));
    const b = formSignatureFromTokens(tokenizeFileNameStem("Rechnung _001"));
    const c = formSignatureFromTokens(tokenizeFileNameStem("Rechnung_ 001"));
    const d = formSignatureFromTokens(tokenizeFileNameStem("Rechnung 001"));
    assert(new Set([a, b, c, d]).size === 4, "H: four forms");
    assertTokensLossFree("Rechnung _001", "H");
  }

  // FALL I – file without extension
  {
    const scan = resultOf(filesUnder("X:/I", "I", ["Rechnung_001", "Rechnung_002"]));
    const built = buildStructureFileNameInsight(scan);
    assert(built.features.every((feature) => feature.hasExtension === false), "I: no ext");
    assert(formObsAt(built, "files:X:/I").length === 1, "I: form obs");
  }

  // FALL J – multiple dots in stem
  {
    const split = splitFileName("rechnung.final.2025.pdf");
    assert(split.stem === "rechnung.final.2025", "J: stem");
    assert(split.extensionKey === ".pdf", "J: ext");
    const tokens = tokenizeFileNameStem(split.stem);
    assert(tokensReconstructStem(tokens) === split.stem, "J: loss-free");
    assert(tokens.some((token) => token.kind === "separator" && token.value === "."), "J: dots tokenized");
  }

  // FALL K – umlauts stay text
  {
    const tokens = tokenizeFileNameStem("Bücher_01");
    assert(tokens[0].kind === "text" && tokens[0].value === "Bücher", "K: umlaut text");
    assert(tokensReconstructStem(tokens) === "Bücher_01", "K: loss-free");
  }

  // FALL L – emoji text
  {
    const tokens = tokenizeFileNameStem("😀_file");
    assert(tokens[0].kind === "text" && tokens[0].value === "😀", "L: emoji text");
    assert(tokensReconstructStem(tokens) === "😀_file", "L: loss-free");
  }

  // FALL M – single file → feature, no observation
  {
    const scan = resultOf(filesUnder("X:/M", "M", ["Rechnung_001.pdf"]));
    const built = buildStructureFileNameInsight(scan);
    assert(built.features.length === 1, "M: feature");
    assert(formObsAt(built, "files:X:/M").length === 0, "M: no obs");
    assert(built.contexts[0].comparisonPossible === false, "M: not comparable");
  }

  // FALL N – two identical forms
  {
    const scan = resultOf(filesUnder("X:/N", "N", ["Alpha_01.txt", "Alpha_02.txt"]));
    const built = buildStructureFileNameInsight(scan);
    assert(formObsAt(built, "files:X:/N").length === 1, "N: one obs");
    assert(formObsAt(built, "files:X:/N")[0].matchedCount === 2, "N: matched 2");
  }

  // FALL O / AC – multiple competing recurring forms; stable form-NNNN
  {
    const scan = resultOf(
      filesUnder("X:/O", "O", [
        "A_01.pdf",
        "A_02.pdf",
        "B-01.pdf",
        "B-02.pdf",
        "lonely.pdf",
      ]),
    );
    const built = buildStructureFileNameInsight(scan);
    const obs = formObsAt(built, "files:X:/O");
    assert(obs.length === 2, "O: two recurring");
    const qualifiers = obs.map((item) => String(item.patternFeatures.formQualifier)).sort(compareFileNameText);
    assert(qualifiers[0] !== qualifiers[1], "AC: distinct qualifiers");
    assert(obs.every((item) => /^form-\d{4}$/.test(String(item.patternFeatures.formQualifier))), "AC: form-NNNN");
    const ids = obs.map((item) => item.id);
    assert(new Set(ids).size === ids.length, "O: unique ids");
  }

  // FALL P – singleton form as counterEvidence only
  {
    const scan = resultOf(
      filesUnder("X:/P", "P", ["Rechnung_001.pdf", "Rechnung_002.pdf", "OtherStyle.pdf"]),
    );
    const built = buildStructureFileNameInsight(scan);
    const obs = formObsAt(built, "files:X:/P");
    assert(obs.length === 1, "P: only recurring form");
    assert(obs[0].matchedCount === 2, "P: matched 2");
    assert(obs[0].counterEvidence.length === 1, "P: one counter");
    assert(obs[0].counterEvidence[0].element.name === "OtherStyle.pdf", "P: counter file");
  }

  // FALL Q – listing != read
  {
    const scan = resultOf(
      dir(
        "X:/Q",
        "Q",
        0,
        [file("X:/Q/a", "Rechnung_001.pdf", 1), file("X:/Q/b", "Rechnung_002.pdf", 1)],
        "incomplete",
      ),
    );
    const built = buildStructureFileNameInsight(scan);
    assert(built.contexts[0].evaluable === false, "Q: not evaluable");
    assert(built.contexts[0].comparisonPossible === false, "Q: no comparison");
    assert(built.features.length === 0, "Q: no features claimed");
    assert(formObsAt(built, "files:X:/Q").length === 0, "Q: no peer obs");
    assert(built.contexts[0].totalCount === 2, "Q: not treated as empty");
  }

  // FALL R / S – multiple parent contexts; same form separated
  {
    const scan = resultOf(
      dir("X:/Root", "Root", 0, [
        dir("X:/Root/A", "A", 1, [
          file("X:/Root/A/1", "Rechnung_001.pdf", 2),
          file("X:/Root/A/2", "Rechnung_002.pdf", 2),
        ]),
        dir("X:/Root/B", "B", 1, [
          file("X:/Root/B/1", "Rechnung_001.pdf", 2),
          file("X:/Root/B/2", "Rechnung_002.pdf", 2),
        ]),
      ]),
    );
    const built = buildStructureFileNameInsight(scan);
    const a = formObsAt(built, "files:X:/Root/A");
    const b = formObsAt(built, "files:X:/Root/B");
    assert(a.length === 1 && b.length === 1, "R: both contexts");
    assert(a[0].id !== b[0].id, "S: distinct obs ids");
    assert(String(a[0].patternFeatures.formSignature) === String(b[0].patternFeatures.formSignature), "S: same form");
  }

  // FALL T – 10_000 synthetic files, no truncation, linear grouping
  {
    const names: string[] = [];
    for (let i = 0; i < 10000; i += 1) {
      names.push(`Item_${String(i).padStart(5, "0")}.txt`);
    }
    const scan = resultOf(filesUnder("X:/T", "T", names));
    const started = Date.now();
    const built = buildStructureFileNameInsight(scan);
    const elapsed = Date.now() - started;
    assert(built.features.length === 10000, "T: all features");
    const obs = formObsAt(built, "files:X:/T");
    assert(obs.length === 1 && obs[0].matchedCount === 10000, "T: one form all");
    assert(obs[0].supportingEvidence.length === 10000, "T: no evidence truncation");
    assert(elapsed < 15000, `T: performance bound (${elapsed}ms)`);
  }

  // FALL U / V – JSON roundtrip + identical serialization
  {
    const scan = resultOf(filesUnder("X:/U", "U", ["A_01.pdf", "A_02.pdf"]));
    const first = buildStructureFileNameInsight(scan);
    const second = buildStructureFileNameInsight(scan);
    assert(JSON.stringify(first) === JSON.stringify(second), "V: identical");
    const round = structureFileNameInsightJsonRoundTrip(first);
    assert(JSON.stringify(round) === JSON.stringify(first), "U: roundtrip");
  }

  // FALL W / X / AE – missing guard + no rules + counter not missing
  {
    const scan = resultOf(
      filesUnder("X:/W", "W", ["Rechnung_001.pdf", "Rechnung_002.pdf", "Andere.pdf"]),
    );
    const built = buildStructureFileNameInsight(scan);
    assert(built.insight.ruleCandidates.length === 0, "X: rules 0");
    assert(built.insight.suggestions.length === 0, "X: suggestions 0");
    assert(built.insight.confirmedExceptions.length === 0, "X: exceptions 0");
    assert(!structureFileNameResultHasForbiddenClaims(built), "W: no forbidden");
    for (const observation of built.insight.observations) {
      assert(observationClaimsMissingElements(observation) === false, "W: missing guard");
      assert(observation.patternFeatures.claimsMissingElements === false, "W: claims false");
    }
    const obs = formObsAt(built, "files:X:/W")[0];
    assert(obs.counterEvidence.length === 1, "AE: counter present");
    assert(obs.counterEvidence[0].attributes?.sameForm === false, "AE: other form only");
  }

  // FALL Y – identity via nodeId, not path reconstruction
  {
    const scan = resultOf(
      dir("X:/Y", "Y", 0, [
        { id: "node-a", name: "Rechnung_001.pdf", path: "DISPLAY/A", depth: 1, kind: "file" },
        { id: "node-b", name: "Rechnung_002.pdf", path: "DISPLAY/B", depth: 1, kind: "file" },
      ]),
    );
    const built = buildStructureFileNameInsight(scan);
    assert(built.contexts[0].id === "files:X:/Y", "Y: context nodeId");
    assert(built.features.every((feature) => feature.file.nodeId.startsWith("node-")), "Y: file nodeIds");
  }

  // FALL Z – no locale-dependent fach normalization
  {
    const tokens = tokenizeFileNameStem("Rechnung");
    assert(tokens[0].normalizedValue === "rechnung", "Z: toLowerCase");
    assert(!("toLocaleLowerCase" in tokenizeFileNameStem), "Z: no locale API on fn");
  }

  // FALL AA – "__" lossless structural token
  {
    const tokens = tokenizeFileNameStem("A__B");
    assert(tokens.length === 3, "AA: three tokens");
    assert(tokens[1].kind === "separator" && tokens[1].value === "__", "AA: double underscore");
    assert(tokensReconstructStem(tokens) === "A__B", "AA: reconstruct");
  }

  // FALL AB covered above with splitFileName

  // FALL AG – mixed separators "-_"
  {
    const tokens = tokenizeFileNameStem("A-_B");
    assert(tokens.length === 4, "AG: four tokens");
    assert(tokens[1].value === "-" && tokens[2].value === "_", "AG: two seps");
    assert(tokensReconstructStem(tokens) === "A-_B", "AG: reconstruct");
  }

  // FALL AH – whitespace sequences exact
  {
    const tokens = tokenizeFileNameStem("A  B");
    assert(tokens[1].kind === "whitespace" && tokens[1].value === "  ", "AH: double space");
    assert(tokensReconstructStem(tokens) === "A  B", "AH: reconstruct");
  }

  // FALL AI – pdf vs docx same stem form; extension only on feature
  {
    const scan = resultOf(filesUnder("X:/AI", "AI", ["Rechnung_001.pdf", "Rechnung_002.docx"]));
    const built = buildStructureFileNameInsight(scan);
    const obs = formObsAt(built, "files:X:/AI");
    assert(obs.length === 1, "AI: same stem form");
    assert(built.features[0].extensionKey === ".pdf", "AI: pdf feature");
    assert(built.features[1].extensionKey === ".docx", "AI: docx feature");
    assert(
      !built.insight.observations.some((item) => String(item.observationType).includes("extension")),
      "AI: no extension observation",
    );
  }

  // FALL AJ – 20250131 digits(8), no date semantics
  {
    const tokens = tokenizeFileNameStem("20250131");
    assert(tokens.length === 1 && tokens[0].kind === "digits" && tokens[0].length === 8, "AJ: digits8");
    assert(formSignatureFromTokens(tokens) === "digits:8", "AJ: sig");
  }

  // FALL AK – 4711 digits(4), no year/number semantics
  {
    const tokens = tokenizeFileNameStem("4711");
    assert(tokens.length === 1 && tokens[0].kind === "digits" && tokens[0].length === 4, "AK: digits4");
  }

  // Unique observation IDs across a multi-form multi-context build
  {
    const scan = resultOf(
      dir("X:/Ids", "Ids", 0, [
        dir("X:/Ids/A", "A", 1, [
          file("X:/Ids/A/1", "A_01.pdf", 2),
          file("X:/Ids/A/2", "A_02.pdf", 2),
          file("X:/Ids/A/3", "B-01.pdf", 2),
          file("X:/Ids/A/4", "B-02.pdf", 2),
        ]),
        dir("X:/Ids/B", "B", 1, [
          file("X:/Ids/B/1", "A_01.pdf", 2),
          file("X:/Ids/B/2", "A_02.pdf", 2),
        ]),
      ]),
    );
    const built = buildStructureFileNameInsight(scan);
    const ids = built.insight.observations.map((observation) => observation.id);
    assert(new Set(ids).size === ids.length, "ids unique");
    const again = buildStructureFileNameInsight(scan);
    assert(JSON.stringify(ids) === JSON.stringify(again.insight.observations.map((o) => o.id)), "ids deterministic");
  }
}
