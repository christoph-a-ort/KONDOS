/**
 * P2-A model checks — synthetic fixtures only (no real private inventory names).
 * No detectors: cases assemble model objects directly.
 */

import {
  createEmptyStructureInsightResult,
  evidence,
  nodeRef,
  observationClaimsMissingElements,
  STRUCTURE_INSIGHT_SCHEMA_VERSION,
  structureInsightJsonRoundTrip,
  suggestionTypeLooksLikeFilesystemAction,
  type StructureInsightObservation,
  type StructureInsightResult,
  type StructureInsightRuleCandidate,
  type StructureInsightSuggestion,
} from "./structureInsightModel";

function assert(condition: boolean, label: string): asserts condition {
  if (!condition) {
    throw new Error(label);
  }
}

function peers(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) =>
    nodeRef(`${prefix}-${String(i + 1).padStart(2, "0")}`, {
      name: `Bereich-${String(i + 1).padStart(2, "0")}`,
      relativePath: `Bereiche/Bereich-${String(i + 1).padStart(2, "0")}`,
    }),
  );
}

/** FALL A – dominant year-structure as model example (7/8), no real detector. */
function caseA_yearStructureModelExample(): StructureInsightResult {
  const group = peers("ins", 8);
  const supporting = group.slice(0, 7).map((el) => evidence(el, "supports"));
  const counter = [evidence(group[7], "counter")];

  const observation: StructureInsightObservation = {
    id: "obs-a-year-peers",
    category: "folderStructure",
    observationType: "year-folders-among-peers",
    scope: { kind: "comparisonSet", nodeIds: group.map((g) => g.nodeId) },
    comparisonGroup: group,
    supportingEvidence: supporting,
    counterEvidence: counter,
    matchedCount: 7,
    totalCount: 8,
    provenance: { detectorId: "year-folder-detector", detectorVersion: 1 },
    patternFeatures: {
      pattern: "year-folders",
      claimsMissingElements: false,
    },
  };

  const rule: StructureInsightRuleCandidate = {
    id: "rule-a-year-based",
    category: "filingPrinciple",
    principle: "year-based-filing-within-peers",
    label: "Jahresbasierte Ablage innerhalb vergleichbarer Bereiche",
    scope: observation.scope,
    observationIds: [observation.id],
    supportingEvidence: supporting,
    counterEvidence: counter,
    support: { matchedCount: 7, totalCount: 8 },
    confidence: {
      level: "high",
      factors: [
        { id: "comparisonGroupSize", value: 8 },
        { id: "matchedCount", value: 7 },
        { id: "totalCount", value: 8 },
        { id: "supportRatio", value: 7 / 8 },
        { id: "counterEvidenceCount", value: 1 },
      ],
    },
    status: "detected",
  };

  const suggestion: StructureInsightSuggestion = {
    id: "sug-a-review",
    ruleCandidateId: rule.id,
    affectedElements: [group[7]],
    suggestionType: "review-structure-alignment",
    rationale: {
      basedOnObservationId: observation.id,
      matchedCount: 7,
      totalCount: 8,
    },
    confidence: rule.confidence,
    status: "proposed",
  };

  return {
    schemaVersion: STRUCTURE_INSIGHT_SCHEMA_VERSION,
    observations: [observation],
    ruleCandidates: [rule],
    suggestions: [suggestion],
    confirmedExceptions: [],
  };
}

/** FALL B – filename schema with same core model. */
function caseB_fileNamePattern(): StructureInsightResult {
  const files = Array.from({ length: 64 }, (_, i) =>
    nodeRef(`doc-${i + 1}`, {
      name: i < 52 ? `Dokument-2025-${String((i % 12) + 1).padStart(2, "0")}.pdf` : `Notiz-${i + 1}.txt`,
    }),
  );
  const observation: StructureInsightObservation = {
    id: "obs-b-date-names",
    category: "fileNamePattern",
    observationType: "date-like-file-names",
    scope: { kind: "scanRoot" },
    comparisonGroup: files,
    supportingEvidence: files.slice(0, 52).map((el) => evidence(el, "supports")),
    counterEvidence: files.slice(52).map((el) => evidence(el, "counter")),
    matchedCount: 52,
    totalCount: 64,
    provenance: { detectorId: "filename-pattern-detector", detectorVersion: 1 },
    patternFeatures: {
      pattern: "date-like-file-name",
      claimsMissingElements: false,
    },
  };
  return {
    schemaVersion: STRUCTURE_INSIGHT_SCHEMA_VERSION,
    observations: [observation],
    ruleCandidates: [],
    suggestions: [],
    confirmedExceptions: [],
  };
}

/** FALL C – repeated substructure; deviation must not invent missing elements. */
function caseC_structureDeviation(): StructureInsightResult {
  const projects = peers("proj", 5);
  const observation: StructureInsightObservation = {
    id: "obs-c-substructure",
    category: "folderStructure",
    observationType: "repeated-direct-subdirectory-set",
    scope: { kind: "comparisonSet", nodeIds: projects.map((p) => p.nodeId) },
    comparisonGroup: projects,
    supportingEvidence: projects.slice(0, 4).map((el) => evidence(el, "supports")),
    counterEvidence: [
      evidence(projects[4], "counter", {
        deviationKind: "structureDiffers",
        // Explicitly false: do not claim missing Angebote/Auftrag/…
        claimsMissingElements: false,
      }),
    ],
    matchedCount: 4,
    totalCount: 5,
    provenance: { detectorId: "folder-structure-detector", detectorVersion: 1 },
    patternFeatures: {
      pattern: "shared-subdirectory-set",
      claimsMissingElements: false,
      signatureExample: "Angebote|Auftrag|Rechnungen|Schriftverkehr",
    },
  };
  assert(!observationClaimsMissingElements(observation), "C: no missing-element claim");
  return {
    schemaVersion: STRUCTURE_INSIGHT_SCHEMA_VERSION,
    observations: [observation],
    ruleCandidates: [],
    suggestions: [],
    confirmedExceptions: [],
  };
}

/** FALL D – competing rules; no forced winner; suggestions may stay empty. */
function caseD_competingRules(): StructureInsightResult {
  const areas = peers("area", 10);
  const obsYear: StructureInsightObservation = {
    id: "obs-d-year",
    category: "folderStructure",
    observationType: "year-folders-among-peers",
    scope: { kind: "comparisonSet", nodeIds: areas.map((a) => a.nodeId) },
    comparisonGroup: areas,
    supportingEvidence: areas.slice(0, 4).map((el) => evidence(el, "supports")),
    counterEvidence: areas.slice(4).map((el) => evidence(el, "counter")),
    matchedCount: 4,
    totalCount: 10,
    provenance: { detectorId: "year-folder-detector", detectorVersion: 1 },
    patternFeatures: { pattern: "year-folders", claimsMissingElements: false },
  };
  const obsDoc: StructureInsightObservation = {
    id: "obs-d-doc-kind",
    category: "folderStructure",
    observationType: "document-kind-folders-among-peers",
    scope: obsYear.scope,
    comparisonGroup: areas,
    supportingEvidence: areas.slice(4, 8).map((el) => evidence(el, "supports")),
    counterEvidence: [...areas.slice(0, 4), ...areas.slice(8)].map((el) => evidence(el, "counter")),
    matchedCount: 4,
    totalCount: 10,
    provenance: { detectorId: "folder-structure-detector", detectorVersion: 1 },
    patternFeatures: { pattern: "document-kind-folders", claimsMissingElements: false },
  };
  const ruleYear: StructureInsightRuleCandidate = {
    id: "rule-d-year",
    category: "filingPrinciple",
    principle: "year-based-filing-within-peers",
    scope: obsYear.scope,
    observationIds: [obsYear.id],
    supportingEvidence: obsYear.supportingEvidence,
    counterEvidence: obsYear.counterEvidence,
    support: { matchedCount: 4, totalCount: 10 },
    confidence: {
      level: "medium",
      factors: [
        { id: "matchedCount", value: 4 },
        { id: "totalCount", value: 10 },
        { id: "competingPatterns", value: 2 },
      ],
    },
    status: "detected",
  };
  const ruleDoc: StructureInsightRuleCandidate = {
    id: "rule-d-doc",
    category: "filingPrinciple",
    principle: "document-kind-filing-within-peers",
    scope: obsDoc.scope,
    observationIds: [obsDoc.id],
    supportingEvidence: obsDoc.supportingEvidence,
    counterEvidence: obsDoc.counterEvidence,
    support: { matchedCount: 4, totalCount: 10 },
    confidence: {
      level: "medium",
      factors: [
        { id: "matchedCount", value: 4 },
        { id: "totalCount", value: 10 },
        { id: "competingPatterns", value: 2 },
      ],
    },
    status: "detected",
  };
  return {
    schemaVersion: STRUCTURE_INSIGHT_SCHEMA_VERSION,
    observations: [obsYear, obsDoc],
    ruleCandidates: [ruleYear, ruleDoc],
    suggestions: [],
    confirmedExceptions: [],
  };
}

/** FALL E – observation without rule; rule without suggestion; empty suggestions OK. */
function caseE_noForcefulOutcome(): StructureInsightResult {
  const observation: StructureInsightObservation = {
    id: "obs-e-weak",
    category: "other",
    observationType: "sparse-signal",
    scope: { kind: "labeled", label: "Projekt-A" },
    comparisonGroup: [nodeRef("proj-a", { name: "Projekt-A" })],
    supportingEvidence: [],
    counterEvidence: [],
    matchedCount: 0,
    totalCount: 3,
    provenance: { detectorId: "folder-structure-detector", detectorVersion: 1 },
    patternFeatures: { pattern: "none-dominant", claimsMissingElements: false },
  };
  const orphanRule: StructureInsightRuleCandidate = {
    id: "rule-e-tentative",
    category: "filingPrinciple",
    principle: "tentative-unconfirmed",
    scope: observation.scope,
    observationIds: [],
    supportingEvidence: [],
    counterEvidence: [],
    support: { matchedCount: 0, totalCount: 0 },
    confidence: {
      level: "low",
      factors: [{ id: "insufficientEvidence", value: 1 }],
    },
    status: "reviewLater",
  };
  return {
    schemaVersion: STRUCTURE_INSIGHT_SCHEMA_VERSION,
    observations: [observation],
    ruleCandidates: [orphanRule],
    suggestions: [],
    confirmedExceptions: [],
  };
}

/** FALL F – confirmed exception distinct from analytical counterEvidence. */
function caseF_confirmedException(): StructureInsightResult {
  const base = caseA_yearStructureModelExample();
  const rule = base.ruleCandidates[0];
  const counterElement = base.observations[0].counterEvidence[0].element;
  return {
    ...base,
    confirmedExceptions: [
      {
        id: "exc-f-dkv-like",
        ruleCandidateId: rule.id,
        element: counterElement,
        confirmed: true,
        note: "Benutzer bestätigt bewusst abweichende Organisation.",
        attributes: { source: "userDecision" },
      },
    ],
  };
}

/** FALL G – hash observation type fits the same core model (no hashing implemented). */
function caseG_hashObservationShape(): StructureInsightResult {
  const observation: StructureInsightObservation = {
    id: "obs-g-hash",
    category: "contentHash",
    observationType: "identical-content-hash",
    scope: { kind: "scanRoot" },
    comparisonGroup: [
      nodeRef("file-a", { name: "Dokument-A.pdf" }),
      nodeRef("file-b", { name: "Dokument-B.pdf" }),
    ],
    supportingEvidence: [
      evidence(nodeRef("file-a", { name: "Dokument-A.pdf" }), "supports", {
        hashAlgorithm: "sha256",
        hashDigest: "synthetic-digest-0001",
      }),
      evidence(nodeRef("file-b", { name: "Dokument-B.pdf" }), "supports", {
        hashAlgorithm: "sha256",
        hashDigest: "synthetic-digest-0001",
      }),
    ],
    counterEvidence: [],
    matchedCount: 2,
    totalCount: 2,
    provenance: { detectorId: "hash-duplicate-detector", detectorVersion: 1 },
    patternFeatures: {
      pattern: "identical-content-hash",
      claimsMissingElements: false,
    },
  };
  return {
    schemaVersion: STRUCTURE_INSIGHT_SCHEMA_VERSION,
    observations: [observation],
    ruleCandidates: [],
    suggestions: [],
    confirmedExceptions: [],
  };
}

export function runStructureInsightModelCheck(): void {
  assert(STRUCTURE_INSIGHT_SCHEMA_VERSION === 1, "schema version");
  assert(createEmptyStructureInsightResult().suggestions.length === 0, "empty result valid");

  // FALL A
  const a = caseA_yearStructureModelExample();
  assert(a.observations[0].matchedCount === 7 && a.observations[0].totalCount === 8, "A: 7/8");
  assert(a.observations[0].counterEvidence.length === 1, "A: counter kept");
  assert(a.ruleCandidates[0].observationIds.includes("obs-a-year-peers"), "A: rule refs observation");
  assert(a.ruleCandidates[0].confidence.factors.length >= 2, "A: structured confidence");
  assert(a.suggestions.length === 1, "A: suggestion may exist separately");
  assert(a.suggestions[0].ruleCandidateId === a.ruleCandidates[0].id, "A: suggestion refs rule");
  assert(
    !suggestionTypeLooksLikeFilesystemAction(a.suggestions[0].suggestionType),
    "A: no FS action type",
  );

  // FALL B
  const b = caseB_fileNamePattern();
  assert(b.observations[0].category === "fileNamePattern", "B: same core, other category");
  assert(b.observations[0].matchedCount === 52 && b.observations[0].totalCount === 64, "B: 52/64");
  assert(b.observations[0].observationType !== "year-folders-among-peers", "B: not year-coupled");

  // FALL C
  const c = caseC_structureDeviation();
  assert(c.observations[0].counterEvidence.length === 1, "C: deviation present");
  assert(!observationClaimsMissingElements(c.observations[0]), "C: not missing-elements");
  assert(
    c.observations[0].counterEvidence[0].attributes?.claimsMissingElements === false,
    "C: counter attrs deny missing claim",
  );

  // FALL D
  const d = caseD_competingRules();
  assert(d.ruleCandidates.length === 2, "D: two competing candidates");
  assert(d.suggestions.length === 0, "D: no forced suggestion");
  assert(d.ruleCandidates[0].principle !== d.ruleCandidates[1].principle, "D: distinct principles");
  // No dominant winner field exists on the result — both remain detected.
  assert(
    d.ruleCandidates.every((r) => r.status === "detected"),
    "D: no auto-confirmed winner",
  );

  // FALL E
  const e = caseE_noForcefulOutcome();
  assert(e.observations.length === 1, "E: observation without needing a rule link");
  assert(e.ruleCandidates[0].observationIds.length === 0, "E: rule without observation ok");
  assert(e.suggestions.length === 0, "E: empty suggestions ok");

  // FALL F
  const f = caseF_confirmedException();
  assert(f.observations[0].counterEvidence.length === 1, "F: analytical deviation remains");
  assert(f.confirmedExceptions.length === 1, "F: confirmed exception separate");
  assert(f.confirmedExceptions[0].confirmed === true, "F: confirmed flag");
  assert(
    f.confirmedExceptions[0].ruleCandidateId === f.ruleCandidates[0].id,
    "F: exception refs rule",
  );
  assert(
    f.confirmedExceptions[0].element.nodeId === f.observations[0].counterEvidence[0].element.nodeId,
    "F: exception refs element",
  );
  assert(
    f.confirmedExceptions[0].id !== f.observations[0].counterEvidence[0].element.nodeId,
    "F: exception id distinct from mere counter evidence",
  );

  // FALL G
  const g = caseG_hashObservationShape();
  assert(g.observations[0].category === "contentHash", "G: hash category accepted");
  assert(g.observations[0].provenance.detectorId === "hash-duplicate-detector", "G: provenance");
  assert(g.observations[0].supportingEvidence.length === 2, "G: two hash peers");

  // FALL H
  const roundTripped = structureInsightJsonRoundTrip(f);
  assert(roundTripped.schemaVersion === f.schemaVersion, "H: schemaVersion");
  assert(roundTripped.observations[0].matchedCount === 7, "H: observation counts");
  assert(roundTripped.ruleCandidates[0].confidence.level === "high", "H: confidence");
  assert(roundTripped.confirmedExceptions[0].confirmed === true, "H: exception");
  assert(
    JSON.stringify(roundTripped.observations[0].patternFeatures) ===
      JSON.stringify(f.observations[0].patternFeatures),
    "H: features preserved",
  );

  // FALL I – unassessed confidence (P2-H / pre-P2-I)
  {
    const unassessed: StructureInsightRuleCandidate = {
      id: "rule-i-unassessed",
      category: "folderStructure",
      principle: "parallel-local-file-type-bucket-structure",
      scope: { kind: "comparisonSet", nodeIds: ["n1", "n2"] },
      observationIds: ["obs-i"],
      supportingEvidence: [],
      counterEvidence: [],
      support: { matchedCount: 5, totalCount: 6 },
      confidence: { level: "unassessed", factors: [] },
      status: "detected",
      candidateFeatures: {
        evaluableCount: 6,
        rivalGroupCount: 1,
        maxRivalMatchedCount: 1,
        listingCompleteness: "allEvaluableRead",
        sourceObservationType: "parallel-file-type-bucket-group",
      },
    };
    const payload: StructureInsightResult = {
      schemaVersion: STRUCTURE_INSIGHT_SCHEMA_VERSION,
      observations: [],
      ruleCandidates: [unassessed],
      suggestions: [],
      confirmedExceptions: [],
    };
    const round = structureInsightJsonRoundTrip(payload);
    assert(round.ruleCandidates[0].confidence.level === "unassessed", "I: unassessed roundtrip");
    assert(round.ruleCandidates[0].confidence.factors.length === 0, "I: empty factors");
    assert(round.ruleCandidates[0].candidateFeatures?.evaluableCount === 6, "I: features roundtrip");
    assert(unassessed.confidence.level !== "low", "I: unassessed != low");
    assert(String(unassessed.confidence.level) !== "low", "I: unassessed string != low");
  }

  // FALL J – existing low still valid and distinct from unassessed
  {
    assert(e.ruleCandidates[0].confidence.level === "low", "J: existing low case");
    assert(String(e.ruleCandidates[0].confidence.level) !== "unassessed", "J: low != unassessed");
  }

  // FALL K – optional factor.kind roundtrip (P2-I additive; legacy factors without kind remain valid)
  {
    const withKind: StructureInsightRuleCandidate = {
      id: "rule-k-kind",
      category: "folderStructure",
      principle: "test-principle",
      scope: { kind: "scanRoot" },
      observationIds: ["obs-k"],
      supportingEvidence: [],
      counterEvidence: [],
      support: { matchedCount: 7, totalCount: 7 },
      confidence: {
        level: "high",
        factors: [
          { id: "evidence-breadth", value: 7, kind: "supporting" },
          { id: "support-unanimity", value: 1, kind: "supporting" },
          { id: "counter-evidence-present", value: 1, kind: "limiting" },
        ],
      },
      status: "detected",
    };
    const payload: StructureInsightResult = {
      schemaVersion: STRUCTURE_INSIGHT_SCHEMA_VERSION,
      observations: [],
      ruleCandidates: [withKind, e.ruleCandidates[0]],
      suggestions: [],
      confirmedExceptions: [],
    };
    const round = structureInsightJsonRoundTrip(payload);
    assert(round.ruleCandidates[0].confidence.factors[0].kind === "supporting", "K: kind supporting");
    assert(round.ruleCandidates[0].confidence.factors[2].kind === "limiting", "K: kind limiting");
    assert(round.ruleCandidates[1].confidence.factors[0].kind === undefined, "K: legacy kind absent");
  }
}
