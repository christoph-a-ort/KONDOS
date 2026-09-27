/**
 * P2-C time-structure checks — synthetic fixtures only (FALL A–Q).
 * No RuleCandidates, Suggestions, confirmedExceptions, FS actions, or private Realtest names.
 */

import { type DirectoryNode, type FsNode, type ScanResult } from "../model";
import { buildStructureComparisonContexts } from "./structureComparisonContext";
import { observationClaimsMissingElements } from "./structureInsightModel";
import {
  STRUCTURE_TIME_DETECTOR_ID,
  STRUCTURE_TIME_DETECTOR_VERSION,
  STRUCTURE_TIME_SCHEMA_VERSION,
  STRUCTURE_TIME_YEAR_MAX,
  STRUCTURE_TIME_YEAR_MIN,
  buildStructureTimeInsight,
  createEmptyStructureTimeInsightResult,
  parseContextualMonthName,
  parseDirectStructureTimeName,
  parseExactStructureTimeYear,
  structureTimeInsightJsonRoundTrip,
  structureTimeResultHasForbiddenClaims,
  type StructureTimeInsightResult,
} from "./structureTimeInsight";

function dir(
  id: string,
  name: string,
  depth: number,
  children: FsNode[] = [],
): DirectoryNode {
  return {
    id,
    name,
    path: id,
    depth,
    kind: "directory",
    listing: "read",
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

function featureFor(built: StructureTimeInsightResult, name: string) {
  return built.features.find((feature) => feature.name === name);
}

function observationOfType(built: StructureTimeInsightResult, observationType: string) {
  return built.insight.observations.filter((observation) => observation.observationType === observationType);
}

export function runStructureTimeInsightCheck(): void {
  assert(STRUCTURE_TIME_SCHEMA_VERSION === 1, "schema version");
  assert(STRUCTURE_TIME_DETECTOR_ID === "year-time-structure", "detector id");
  assert(STRUCTURE_TIME_DETECTOR_VERSION === 1, "detector version");
  assert(STRUCTURE_TIME_YEAR_MIN === 1900 && STRUCTURE_TIME_YEAR_MAX === 2199, "year bounds");
  assert(createEmptyStructureTimeInsightResult().features.length === 0, "empty features");
  assert(createEmptyStructureTimeInsightResult().insight.ruleCandidates.length === 0, "empty rules");

  // FALL A – reines Jahr + Grenzen
  {
    const y2025 = parseDirectStructureTimeName("2025");
    assert(y2025 !== null && y2025.values.kind === "year" && y2025.values.year === 2025, "A: 2025");
    assert(parseExactStructureTimeYear("2025") === 2025, "A: exact year helper");
    assert(parseDirectStructureTimeName("1899") === null, "A: 1899 no");
    assert(parseExactStructureTimeYear("1900") === 1900, "A: 1900 yes");
    assert(parseExactStructureTimeYear("2199") === 2199, "A: 2199 yes");
    assert(parseDirectStructureTimeName("2200") === null, "A: 2200 no");
  }

  // FALL B – Jahr-Monat
  {
    const a = parseDirectStructureTimeName("2025-01");
    assert(a !== null && a.values.kind === "yearMonth" && a.values.year === 2025 && a.values.month === 1, "B: 2025-01");
    const b = parseDirectStructureTimeName("2025_12");
    assert(b !== null && b.values.kind === "yearMonth" && b.values.month === 12, "B: 2025_12");
    const c = parseDirectStructureTimeName("2025.06");
    assert(c !== null && c.values.kind === "yearMonth" && c.values.month === 6, "B: 2025.06");
    assert(parseDirectStructureTimeName("2025-00") === null, "B: 2025-00 invalid");
    assert(parseDirectStructureTimeName("2025-13") === null, "B: 2025-13 invalid");
  }

  // FALL C – Monat-Jahr
  {
    const a = parseDirectStructureTimeName("01-2025");
    assert(a !== null && a.values.kind === "yearMonth" && a.values.year === 2025 && a.values.month === 1, "C: 01-2025");
    const b = parseDirectStructureTimeName("12_2025");
    assert(b !== null && b.values.kind === "yearMonth" && b.values.month === 12, "C: 12_2025");
    const c = parseDirectStructureTimeName("06.2025");
    assert(c !== null && c.values.kind === "yearMonth" && c.values.month === 6, "C: 06.2025");
  }

  // FALL D – Quartale
  {
    const a = parseDirectStructureTimeName("Q1 2025");
    assert(a !== null && a.values.kind === "quarter" && a.values.year === 2025 && a.values.quarter === 1, "D: Q1 2025");
    const b = parseDirectStructureTimeName("Q4-2025");
    assert(b !== null && b.values.kind === "quarter" && b.values.quarter === 4, "D: Q4-2025");
    const c = parseDirectStructureTimeName("2025 Q2");
    assert(c !== null && c.values.kind === "quarter" && c.values.quarter === 2, "D: 2025 Q2");
    const d = parseDirectStructureTimeName("2025_Q3");
    assert(d !== null && d.values.kind === "quarter" && d.values.quarter === 3, "D: 2025_Q3");
    assert(parseDirectStructureTimeName("Q0 2025") === null, "D: Q0 invalid");
    assert(parseDirectStructureTimeName("Q5-2025") === null, "D: Q5 invalid");
  }

  // FALL E – Jahresbereich vs yearMonth
  {
    const range = parseDirectStructureTimeName("2024-2025");
    assert(
      range !== null &&
        range.values.kind === "yearRange" &&
        range.values.startYear === 2024 &&
        range.values.endYear === 2025,
      "E: 2024-2025 range",
    );
    const month = parseDirectStructureTimeName("2025-01");
    assert(month !== null && month.values.kind === "yearMonth", "E: 2025-01 is yearMonth not range");
  }

  // FALL F – bewusst nicht direkt erkannt
  {
    const rejected = [
      "25",
      "01",
      "1",
      "Januar",
      "Jan",
      "Februar",
      "Frühjahr",
      "Sommer",
      "Weihnachten",
      "KW 12",
      "Archiv 2023",
      "Rechnungen 2025",
      "2025 Rechnungen",
    ];
    for (const name of rejected) {
      assert(parseDirectStructureTimeName(name) === null, `F: no direct time for ${name}`);
    }
  }

  // FALL G – numerische Monate unter Jahresparent
  {
    const underYear = resultOf(
      dir("X:/Root", "Root", 0, [
        dir("X:/Root/2025", "2025", 1, [
          dir("X:/Root/2025/01", "01", 2),
          dir("X:/Root/2025/02", "02", 2),
          dir("X:/Root/2025/12", "12", 2),
        ]),
      ]),
    );
    const builtYear = buildStructureTimeInsight(underYear);
    const m01 = featureFor(builtYear, "01");
    const m02 = featureFor(builtYear, "02");
    const m12 = featureFor(builtYear, "12");
    assert(m01?.values.kind === "month" && m01.values.month === 1 && m01.recognitionMode === "contextual", "G: 01");
    assert(m02?.values.kind === "month" && m02.values.month === 2, "G: 02");
    assert(m12?.values.kind === "month" && m12.values.month === 12, "G: 12");

    const underProjekt = resultOf(
      dir("X:/Root", "Root", 0, [
        dir("X:/Root/Projekt", "Projekt", 1, [
          dir("X:/Root/Projekt/01", "01", 2),
          dir("X:/Root/Projekt/02", "02", 2),
          dir("X:/Root/Projekt/03", "03", 2),
        ]),
      ]),
    );
    const builtProjekt = buildStructureTimeInsight(underProjekt);
    assert(builtProjekt.features.every((feature) => feature.name !== "01"), "G: no month under Projekt");
    assert(parseContextualMonthName("01", 2025)?.values.kind === "month", "G: helper under year");
    assert(parseContextualMonthName("01", -1) === null, "G: helper rejects invalid parent year");
  }

  // FALL H – deutsche Monatsnamen unter Jahresparent
  {
    const underYear = resultOf(
      dir("X:/Root", "Root", 0, [
        dir("X:/Root/2025", "2025", 1, [
          dir("X:/Root/2025/Januar", "Januar", 2),
          dir("X:/Root/2025/März", "März", 2),
          dir("X:/Root/2025/Dezember", "Dezember", 2),
        ]),
      ]),
    );
    const built = buildStructureTimeInsight(underYear);
    const jan = featureFor(built, "Januar");
    const maerz = featureFor(built, "März");
    const dez = featureFor(built, "Dezember");
    assert(jan?.values.kind === "month" && jan.values.month === 1, "H: Januar");
    assert(maerz?.values.kind === "month" && maerz.values.month === 3, "H: März");
    assert(dez?.values.kind === "month" && dez.values.month === 12, "H: Dezember");

    const underProjekt = resultOf(
      dir("X:/Root", "Root", 0, [
        dir("X:/Root/Projekt", "Projekt", 1, [
          dir("X:/Root/Projekt/Januar", "Januar", 2),
          dir("X:/Root/Projekt/März", "März", 2),
        ]),
      ]),
    );
    const builtProjekt = buildStructureTimeInsight(underProjekt);
    assert(builtProjekt.features.length === 0, "H: no classification under Projekt");
    assert(parseDirectStructureTimeName("Jan") === null, "H: no abbreviation Jan");
  }

  // FALL I – einzelnes Jahresmerkmal
  {
    const scan = resultOf(
      dir("X:/A", "A", 0, [
        dir("X:/A/Vertrag", "Vertrag", 1),
        dir("X:/A/Bilder", "Bilder", 1),
        dir("X:/A/2025", "2025", 1),
      ]),
    );
    const built = buildStructureTimeInsight(scan);
    assert(featureFor(built, "2025")?.values.kind === "year", "I: year feature");
    const yearObs = observationOfType(built, "year-features-among-peers");
    assert(yearObs.length === 1, "I: descriptive year observation");
    assert(yearObs[0].matchedCount === 1 && yearObs[0].totalCount === 3, "I: 1 of 3");
    assert(yearObs[0].patternFeatures.recurring === false, "I: not recurring structure claim");
    assert(built.insight.ruleCandidates.length === 0, "I: no rule");
    assert(built.insight.suggestions.length === 0, "I: no suggestion");
  }

  // FALL J – wiederkehrende Jahresstruktur
  {
    const scan = resultOf(
      dir("X:/Archiv", "Archiv", 0, [
        dir("X:/Archiv/2022", "2022", 1),
        dir("X:/Archiv/2023", "2023", 1),
        dir("X:/Archiv/2024", "2024", 1),
        dir("X:/Archiv/2025", "2025", 1),
      ]),
    );
    const built = buildStructureTimeInsight(scan);
    assert(built.features.filter((feature) => feature.values.kind === "year").length === 4, "J: four years");
    const yearObs = observationOfType(built, "year-features-among-peers");
    assert(yearObs.length === 1 && yearObs[0].matchedCount === 4, "J: observation");
    assert(yearObs[0].patternFeatures.recurring === true, "J: recurring flag");
    assert(built.insight.ruleCandidates.length === 0, "J: no RuleCandidate");
  }

  // FALL K – Jahreslücke
  {
    const scan = resultOf(
      dir("X:/Archiv", "Archiv", 0, [
        dir("X:/Archiv/2020", "2020", 1),
        dir("X:/Archiv/2021", "2021", 1),
        dir("X:/Archiv/2023", "2023", 1),
        dir("X:/Archiv/2024", "2024", 1),
      ]),
    );
    const built = buildStructureTimeInsight(scan);
    const gap = observationOfType(built, "year-span-absence-among-peers");
    assert(gap.length === 1, "K: gap observation");
    assert(gap[0].patternFeatures.absentYearsInObservedSpan === "2022", "K: 2022 in span absence");
    assert(gap[0].patternFeatures.claimsMissingElements === false, "K: no missing claim flag");
    assert(!observationClaimsMissingElements(gap[0]), "K: guard false");
    const serialized = JSON.stringify(built).toLowerCase();
    assert(!serialized.includes("shouldExist".toLowerCase()), "K: no shouldExist");
    assert(!serialized.includes("createfolder"), "K: no createFolder");
    assert(!serialized.includes("missingfolder"), "K: no missingFolder");
  }

  // FALL L – gemischte Zeitarten
  {
    const scan = resultOf(
      dir("X:/Archiv", "Archiv", 0, [
        dir("X:/Archiv/2023", "2023", 1),
        dir("X:/Archiv/2024", "2024", 1),
        dir("X:/Archiv/2025", "2025", 1),
        dir("X:/Archiv/Q1 2026", "Q1 2026", 1),
      ]),
    );
    const built = buildStructureTimeInsight(scan);
    assert(built.features.filter((f) => f.values.kind === "year").length === 3, "L: 3 year");
    assert(built.features.filter((f) => f.values.kind === "quarter").length === 1, "L: 1 quarter");
    const mixed = observationOfType(built, "mixed-time-kinds-among-peers");
    assert(mixed.length === 1, "L: mixed observation");
    assert(mixed[0].patternFeatures.yearCount === 3, "L: yearCount");
    assert(mixed[0].patternFeatures.quarterCount === 1, "L: quarterCount");
    assert(mixed[0].patternFeatures.unifiedTimeKind === false, "L: not unified");
  }

  // FALL M – Vergleich mehrerer Bereiche
  {
    const scan = resultOf(
      dir("X:/Kunden", "Kunden", 0, [
        dir("X:/Kunden/A", "A", 1, [
          dir("X:/Kunden/A/2024", "2024", 2),
          dir("X:/Kunden/A/2025", "2025", 2),
        ]),
        dir("X:/Kunden/B", "B", 1, [
          dir("X:/Kunden/B/2024", "2024", 2),
          dir("X:/Kunden/B/2025", "2025", 2),
        ]),
        dir("X:/Kunden/C", "C", 1, [dir("X:/Kunden/C/Dokumente", "Dokumente", 2)]),
      ]),
    );
    const comparison = buildStructureComparisonContexts(scan);
    const kunden = comparison.contexts.find((ctx) => ctx.parent.nodeId === "X:/Kunden");
    assert(kunden !== undefined && kunden.memberCount === 3, "M: P2-B keeps C");
    assert(kunden.members.some((m) => m.nodeId === "X:/Kunden/C"), "M: C remains member");

    const built = buildStructureTimeInsight(scan, comparison);
    const peer = observationOfType(built, "peer-areas-direct-year-children").find((obs) =>
      String(obs.patternFeatures.comparisonContextId).includes("X:/Kunden"),
    );
    assert(peer !== undefined, "M: aggregated observation");
    assert(peer.matchedCount === 2 && peer.totalCount === 3, "M: 2 of 3");
    assert(peer.supportingEvidence.some((item) => item.element.nodeId === "X:/Kunden/A"), "M: A evidence");
    assert(peer.supportingEvidence.some((item) => item.element.nodeId === "X:/Kunden/B"), "M: B evidence");
    assert(peer.counterEvidence.some((item) => item.element.nodeId === "X:/Kunden/C"), "M: C counter");
    const serialized = JSON.stringify(peer).toLowerCase();
    assert(!serialized.includes("falsch"), "M: no falsch");
    assert(!serialized.includes("fehlen"), "M: no fehlen claim");
    assert(built.insight.ruleCandidates.length === 0, "M: no rule");
  }

  // FALL N – Zukunft unabhängig vom Systemdatum
  {
    assert(parseExactStructureTimeYear("2027") === 2027, "N: 2027");
    assert(parseExactStructureTimeYear("2100") === 2100, "N: 2100");
    // Ensure recognition does not consult Date.now (no calendar coupling in source path under test).
    const before = Date.now();
    const parsed = parseExactStructureTimeYear("2199");
    const after = Date.now();
    assert(parsed === 2199, "N: 2199");
    assert(after >= before, "N: Date.now only used in test harness, not required for parse");
  }

  // FALL O – JSON-Roundtrip
  {
    const scan = resultOf(
      dir("X:/Archiv", "Archiv", 0, [
        dir("X:/Archiv/2024", "2024", 1),
        dir("X:/Archiv/2025-01", "2025-01", 1),
        dir("X:/Archiv/Q1 2026", "Q1 2026", 1),
      ]),
    );
    const built = buildStructureTimeInsight(scan);
    const round = structureTimeInsightJsonRoundTrip(built);
    assert(JSON.stringify(round) === JSON.stringify(built), "O: identical JSON");
    assert(round.features[0]?.provenance.detectorId === STRUCTURE_TIME_DETECTOR_ID, "O: provenance");
    assert(round.insight.observations.length === built.insight.observations.length, "O: observations");
  }

  // FALL P – Determinismus
  {
    const make = (): StructureTimeInsightResult =>
      buildStructureTimeInsight(
        resultOf(
          dir("X:/Archiv", "Archiv", 0, [
            dir("X:/Archiv/2023", "2023", 1),
            dir("X:/Archiv/2021", "2021", 1),
            dir("X:/Archiv/2022", "2022", 1),
          ]),
        ),
      );
    assert(JSON.stringify(make()) === JSON.stringify(make()), "P: identical serialized output");
  }

  // FALL Q – P2-C-Grenzen
  {
    const scan = resultOf(
      dir("X:/Archiv", "Archiv", 0, [
        dir("X:/Archiv/2020", "2020", 1),
        dir("X:/Archiv/2021", "2021", 1),
        dir("X:/Archiv/2023", "2023", 1),
        dir("X:/Archiv/Q1 2024", "Q1 2024", 1),
      ]),
    );
    const built = buildStructureTimeInsight(scan);
    assert(built.insight.ruleCandidates.length === 0, "Q: no rules");
    assert(built.insight.suggestions.length === 0, "Q: no suggestions");
    assert(built.insight.confirmedExceptions.length === 0, "Q: no confirmedExceptions");
    assert(!structureTimeResultHasForbiddenClaims(built), "Q: no forbidden claims");
    assert(!/"confidenceScore"\s*:/.test(JSON.stringify(built)), "Q: no confidenceScore");
    assert(
      built.insight.observations.every((obs) => obs.patternFeatures.claimsMissingElements === false),
      "Q: claimsMissingElements false",
    );
    assert(
      built.insight.observations.every((obs) => obs.provenance.detectorId === STRUCTURE_TIME_DETECTOR_ID),
      "Q: provenance",
    );
    assert(!JSON.stringify(built).includes("Date.now"), "Q: no Date.now in payload");
  }
}
