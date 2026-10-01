/**
 * P2-J-A structure insight view-model checks — synthetic fixtures only.
 * No private real paths. No filesystem mutations. No UI.
 */

import {
  type DirectoryListing,
  type DirectoryNode,
  type FileNode,
  type FsNode,
  type ScanResult,
} from "../model";
import type { StructureInsightRuleCandidate } from "./structureInsightModel";
import {
  PRINCIPLE_PARALLEL_FILE_NAME_FORM_SET,
  PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET,
  PRINCIPLE_RECURRING_CHILD_FOLDER_NAME,
  PRINCIPLE_RECURRING_CHILD_FOLDER_SET,
  PRINCIPLE_RECURRING_FILE_NAME_FORM,
  PRINCIPLE_RECURRING_YEAR,
  compareRuleCandidateText,
} from "./structureRuleCandidate";
import {
  STRUCTURE_INSIGHT_VIEW_MODEL_SCHEMA_VERSION,
  buildStructureInsightViewModel,
  createEmptyStructureInsightViewModel,
  describeFormSignatureStructurally,
  evidenceLevelLabel,
  mapPrincipleToUserCategory,
  structureInsightViewModelHasForbiddenVisibleClaims,
  structureInsightViewModelRoundTripEquals,
  userCategoryLabel,
  visibleTextHasForbiddenClaim,
  type InsightCardModel,
} from "./structureInsightViewModel";

function assert(condition: boolean, label: string): asserts condition {
  if (!condition) {
    throw new Error(label);
  }
}

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

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

function candidateBase(
  id: string,
  principle: string,
  extras: {
    matched?: number;
    evaluable?: number;
    total?: number;
    level?: StructureInsightRuleCandidate["confidence"]["level"];
    listing?: string;
    supporting?: StructureInsightRuleCandidate["supportingEvidence"];
    counter?: StructureInsightRuleCandidate["counterEvidence"];
    scopeNodeIds?: string[];
    features?: Record<string, string | number | boolean | null>;
    maxRival?: number;
    rivalGroups?: number;
  } = {},
): StructureInsightRuleCandidate {
  const matched = extras.matched ?? extras.supporting?.length ?? 0;
  const evaluable = extras.evaluable ?? matched;
  const supporting = extras.supporting ?? [];
  const counter = extras.counter ?? [];
  return {
    id,
    category: "other",
    principle,
    scope: { kind: "comparisonSet", nodeIds: extras.scopeNodeIds ?? supporting.map((item) => item.element.nodeId) },
    observationIds: [`obs:${id}`],
    supportingEvidence: supporting,
    counterEvidence: counter,
    support: { matchedCount: matched, totalCount: extras.total ?? evaluable },
    confidence: { level: extras.level ?? "high", factors: [] },
    status: "detected",
    candidateFeatures: {
      sourceObservationType: "test",
      evaluableCount: evaluable,
      rivalGroupCount: extras.rivalGroups ?? 0,
      maxRivalMatchedCount: extras.maxRival ?? 0,
      listingCompleteness: extras.listing ?? "allEvaluableRead",
      ...(extras.features ?? {}),
    },
  };
}

export function runStructureInsightViewModelCheck(): void {
  assert(STRUCTURE_INSIGHT_VIEW_MODEL_SCHEMA_VERSION === 1, "schema");
  assert(createEmptyStructureInsightViewModel().insights.length === 0, "empty");

  // 1 Principle → category
  assert(mapPrincipleToUserCategory(PRINCIPLE_RECURRING_FILE_NAME_FORM) === "file-names", "cat file form");
  assert(mapPrincipleToUserCategory(PRINCIPLE_PARALLEL_FILE_NAME_FORM_SET) === "file-names", "cat form set");
  assert(mapPrincipleToUserCategory(PRINCIPLE_RECURRING_YEAR) === "time-years", "cat year");
  assert(mapPrincipleToUserCategory(PRINCIPLE_RECURRING_CHILD_FOLDER_NAME) === "folder-structure", "cat name");
  assert(mapPrincipleToUserCategory(PRINCIPLE_RECURRING_CHILD_FOLDER_SET) === "folder-structure", "cat set");
  assert(mapPrincipleToUserCategory(PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET) === "file-distribution", "cat bucket");
  assert(mapPrincipleToUserCategory("unknown-principle") === null, "cat unknown");
  assert(userCategoryLabel("file-names") === "Dateinamen", "label file-names");
  assert(userCategoryLabel("folder-structure") === "Ordnerstruktur", "label folder");
  assert(userCategoryLabel("time-years") === "Zeit/Jahre", "label years");
  assert(userCategoryLabel("file-distribution") === "Dateiaufteilung", "label distribution");

  // 2–3 Evidence labels / unassessed
  assert(evidenceLevelLabel("high") === "Hoch", "ev high");
  assert(evidenceLevelLabel("medium") === "Mittel", "ev medium");
  assert(evidenceLevelLabel("low") === "Niedrig", "ev low");
  assert(evidenceLevelLabel("unassessed") === "Noch nicht bewertet", "ev unassessed");
  assert(evidenceLevelLabel("unassessed") !== evidenceLevelLabel("low"), "unassessed != low");

  // Form signature structural only
  const parts = describeFormSignatureStructurally('digits:8|sep:"_"|text');
  assert(parts.some((part) => part.includes("Ziffernfolge")), "form digits");
  assert(parts.some((part) => part.includes("Trennzeichen")), "form sep");
  assert(parts.some((part) => part.includes("Textbestandteil")), "form text");
  assert(!parts.join(" ").toLowerCase().includes("rechnung"), "form no semantic");

  // Shared scan fixture
  const root = dir("X:/Root", "Root", 0, [
    dir("X:/Root/Alpha", "Alpha", 1, [
      file("X:/Root/Alpha/20111124_gasag_jahresrechnung.pdf", "20111124_gasag_jahresrechnung.pdf", 2),
      file("X:/Root/Alpha/20121122_gasag_jahresrechnung.pdf", "20121122_gasag_jahresrechnung.pdf", 2),
      file("X:/Root/Alpha/20131120_gasag_jahresrechnung.pdf", "20131120_gasag_jahresrechnung.pdf", 2),
      file("X:/Root/Alpha/notiz.txt", "notiz.txt", 2),
      file("X:/Root/Alpha/sonst.pdf", "sonst.pdf", 2),
    ]),
    dir("X:/Root/2021", "2021", 1),
    dir("X:/Root/2022", "2022", 1),
    dir("X:/Root/2023", "2023", 1),
    dir("X:/Root/Misc", "Misc", 1),
    dir("X:/Root/PeerA", "PeerA", 1, [dir("X:/Root/PeerA/Rechnungen", "Rechnungen", 2)]),
    dir("X:/Root/PeerB", "PeerB", 1, [dir("X:/Root/PeerB/Rechnungen", "Rechnungen", 2)]),
    dir("X:/Root/PeerC", "PeerC", 1, [dir("X:/Root/PeerC/Vertrag", "Vertrag", 2)]),
  ]);
  const scan = resultOf(root);

  const formCand = candidateBase("rule:form-alpha", PRINCIPLE_RECURRING_FILE_NAME_FORM, {
    matched: 3,
    evaluable: 5,
    level: "high",
    maxRival: 0,
    supporting: [
      {
        element: { nodeId: "X:/Root/Alpha/20111124_gasag_jahresrechnung.pdf", name: "20111124_gasag_jahresrechnung.pdf" },
        attributes: { formSignature: 'digits:8|sep:"_"|text|sep:"_"|text', extensionKey: ".pdf" },
      },
      {
        element: { nodeId: "X:/Root/Alpha/20121122_gasag_jahresrechnung.pdf", name: "20121122_gasag_jahresrechnung.pdf" },
        attributes: { formSignature: 'digits:8|sep:"_"|text|sep:"_"|text', extensionKey: ".pdf" },
      },
      {
        element: { nodeId: "X:/Root/Alpha/20131120_gasag_jahresrechnung.pdf", name: "20131120_gasag_jahresrechnung.pdf" },
        attributes: { formSignature: 'digits:8|sep:"_"|text|sep:"_"|text', extensionKey: ".pdf" },
      },
    ],
    counter: [
      {
        element: { nodeId: "X:/Root/Alpha/notiz.txt", name: "notiz.txt" },
        attributes: { formSignature: "text", sameForm: false },
      },
      {
        element: { nodeId: "X:/Root/Alpha/sonst.pdf", name: "sonst.pdf" },
        attributes: { formSignature: "text", sameForm: false },
      },
    ],
    scopeNodeIds: [
      "X:/Root/Alpha/20111124_gasag_jahresrechnung.pdf",
      "X:/Root/Alpha/20121122_gasag_jahresrechnung.pdf",
      "X:/Root/Alpha/20131120_gasag_jahresrechnung.pdf",
      "X:/Root/Alpha/notiz.txt",
      "X:/Root/Alpha/sonst.pdf",
    ],
  });

  const yearCand = candidateBase("rule:year-root", PRINCIPLE_RECURRING_YEAR, {
    matched: 3,
    evaluable: 4,
    level: "medium",
    supporting: [
      { element: { nodeId: "X:/Root/2021", name: "2021" } },
      { element: { nodeId: "X:/Root/2022", name: "2022" } },
      { element: { nodeId: "X:/Root/2023", name: "2023" } },
    ],
    counter: [{ element: { nodeId: "X:/Root/Misc", name: "Misc" } }],
    scopeNodeIds: ["X:/Root/2021", "X:/Root/2022", "X:/Root/2023", "X:/Root/Misc"],
  });

  const nameCand = candidateBase("rule:name-rechnungen", PRINCIPLE_RECURRING_CHILD_FOLDER_NAME, {
    matched: 2,
    evaluable: 3,
    level: "low",
    features: { sourcePatternKey: "rechnungen" },
    supporting: [
      {
        element: { nodeId: "X:/Root/PeerA", name: "PeerA" },
        attributes: { childNodeId: "X:/Root/PeerA/Rechnungen", childDisplayName: "Rechnungen" },
      },
      {
        element: { nodeId: "X:/Root/PeerB", name: "PeerB" },
        attributes: { childNodeId: "X:/Root/PeerB/Rechnungen", childDisplayName: "Rechnungen" },
      },
    ],
    counter: [{ element: { nodeId: "X:/Root/PeerC", name: "PeerC" }, attributes: { nameObserved: false } }],
    scopeNodeIds: ["X:/Root/PeerA", "X:/Root/PeerB", "X:/Root/PeerC"],
  });

  const setCand = candidateBase("rule:set-peers", PRINCIPLE_RECURRING_CHILD_FOLDER_SET, {
    matched: 2,
    evaluable: 3,
    level: "medium",
    features: { signature: "rechnungen" },
    supporting: [
      { element: { nodeId: "X:/Root/PeerA", name: "PeerA" }, attributes: { signature: "rechnungen" } },
      { element: { nodeId: "X:/Root/PeerB", name: "PeerB" }, attributes: { signature: "rechnungen" } },
    ],
    counter: [
      { element: { nodeId: "X:/Root/PeerC", name: "PeerC" }, attributes: { signature: "vertrag", sameSignature: false } },
    ],
    scopeNodeIds: ["X:/Root/PeerA", "X:/Root/PeerB", "X:/Root/PeerC"],
  });

  const bucketA = candidateBase("rule:bucket-a", PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET, {
    matched: 2,
    evaluable: 3,
    level: "high",
    maxRival: 1,
    features: { signature: '[".pdf"]' },
    supporting: [
      { element: { nodeId: "X:/Root/PeerA", name: "PeerA" }, attributes: { signature: '[".pdf"]' } },
      { element: { nodeId: "X:/Root/PeerB", name: "PeerB" }, attributes: { signature: '[".pdf"]' } },
    ],
    counter: [],
    scopeNodeIds: ["X:/Root/PeerA", "X:/Root/PeerB", "X:/Root/PeerC"],
  });

  const bucketB = candidateBase("rule:bucket-b", PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET, {
    matched: 1,
    evaluable: 3,
    level: "low",
    maxRival: 0,
    features: { signature: '[".txt"]' },
    supporting: [
      { element: { nodeId: "X:/Root/PeerC", name: "PeerC" }, attributes: { signature: '[".txt"]' } },
    ],
    counter: [],
    scopeNodeIds: ["X:/Root/PeerA", "X:/Root/PeerB", "X:/Root/PeerC"],
  });

  const unassessedCand = candidateBase("rule:unassessed-year", PRINCIPLE_RECURRING_YEAR, {
    matched: 3,
    evaluable: 3,
    level: "unassessed",
    supporting: [
      { element: { nodeId: "X:/Root/2021", name: "2021" } },
      { element: { nodeId: "X:/Root/2022", name: "2022" } },
      { element: { nodeId: "X:/Root/2023", name: "2023" } },
    ],
    scopeNodeIds: ["X:/Root/2021", "X:/Root/2022", "X:/Root/2023"],
  });

  const incompleteCand = candidateBase("rule:incomplete-form", PRINCIPLE_RECURRING_FILE_NAME_FORM, {
    matched: 3,
    evaluable: 3,
    level: "medium",
    listing: "partial",
    supporting: [
      {
        element: { nodeId: "X:/Root/Alpha/20111124_gasag_jahresrechnung.pdf", name: "20111124_gasag_jahresrechnung.pdf" },
        attributes: { formSignature: "digits:8", extensionKey: ".pdf" },
      },
      {
        element: { nodeId: "X:/Root/Alpha/20121122_gasag_jahresrechnung.pdf", name: "20121122_gasag_jahresrechnung.pdf" },
        attributes: { formSignature: "digits:8", extensionKey: ".pdf" },
      },
      {
        element: { nodeId: "X:/Root/Alpha/20131120_gasag_jahresrechnung.pdf", name: "20131120_gasag_jahresrechnung.pdf" },
        attributes: { formSignature: "digits:8", extensionKey: ".pdf" },
      },
    ],
    scopeNodeIds: [
      "X:/Root/Alpha/20111124_gasag_jahresrechnung.pdf",
      "X:/Root/Alpha/20121122_gasag_jahresrechnung.pdf",
      "X:/Root/Alpha/20131120_gasag_jahresrechnung.pdf",
    ],
  });

  const formSetCand = candidateBase("rule:formset", PRINCIPLE_PARALLEL_FILE_NAME_FORM_SET, {
    matched: 2,
    evaluable: 3,
    level: "medium",
    features: { signature: '["digits:4"]' },
    supporting: [
      { element: { nodeId: "X:/Root/PeerA", name: "PeerA" }, attributes: { signature: '["digits:4"]' } },
      { element: { nodeId: "X:/Root/PeerB", name: "PeerB" }, attributes: { signature: '["digits:4"]' } },
    ],
    counter: [],
    scopeNodeIds: ["X:/Root/PeerA", "X:/Root/PeerB", "X:/Root/PeerC"],
  });

  const candidates = [
    formCand,
    yearCand,
    nameCand,
    setCand,
    bucketA,
    bucketB,
    unassessedCand,
    incompleteCand,
    formSetCand,
  ];

  const scanSnapshot = JSON.stringify(scan);
  const candSnapshot = JSON.stringify(candidates);
  deepFreeze(scan);
  deepFreeze(candidates);

  const model = buildStructureInsightViewModel(scan, candidates);
  const modelAgain = buildStructureInsightViewModel(scan, candidates);

  // 23 Determinism
  assert(JSON.stringify(model) === JSON.stringify(modelAgain), "determinism");
  assert(structureInsightViewModelRoundTripEquals(model), "roundtrip");

  // 24 Immutability
  assert(JSON.stringify(scan) === scanSnapshot, "scan immutable");
  assert(JSON.stringify(candidates) === candSnapshot, "candidates immutable");

  // 4–5 Counts
  assert(model.countsByEvidence.high >= 1, "count high");
  assert(model.countsByEvidence.medium >= 1, "count medium");
  assert(model.countsByEvidence.low >= 1, "count low");
  assert(model.countsByEvidence.unassessed === 1, "count unassessed exact");
  assert(
    model.countsByEvidence.high +
      model.countsByEvidence.medium +
      model.countsByEvidence.low +
      model.countsByEvidence.unassessed ===
      model.countsByEvidence.total,
    "count sum",
  );
  assert(model.countsByEvidence.total === model.insights.length, "count total");
  assert(model.countsByCategory["file-names"] >= 1, "cat count file");
  assert(model.countsByCategory["time-years"] >= 1, "cat count year");
  assert(model.countsByCategory["folder-structure"] >= 1, "cat count folder");
  assert(model.countsByCategory["file-distribution"] >= 1, "cat count dist");

  // unassessed not mapped to low
  const unassessedCard = model.insights.find((insight) => insight.id === "rule:unassessed-year");
  assert(unassessedCard !== undefined, "unassessed card");
  assert(unassessedCard!.evidenceLevel === "unassessed", "unassessed level");
  assert(unassessedCard!.evidenceLabel === "Noch nicht bewertet", "unassessed label");

  // 6 Location P2-E
  const formCard = model.insights.find((insight) => insight.id === "rule:form-alpha");
  assert(formCard !== undefined, "form card");
  assert(formCard!.locationId === "X:/Root/Alpha", "form location parent");

  // 7 Location peer / 8 Root
  const yearCard = model.insights.find((insight) => insight.id === "rule:year-root");
  assert(yearCard !== undefined, "year card");
  assert(yearCard!.locationId === "X:/Root", "year location root");
  const rootLoc = model.locations.find((location) => location.locationId === "X:/Root");
  assert(rootLoc !== undefined, "root location group");
  assert(rootLoc!.kind === "root", "root kind");
  assert(rootLoc!.rootContextLabel === "Eingelesener Hauptordner", "root label");

  // 9 DisplayPathSegments
  assert(rootLoc!.displayPathSegments.length >= 1, "root segments");
  assert(rootLoc!.displayPathSegments[0]?.nodeId === "X:/Root", "root segment id");
  const alphaLoc = model.locations.find((location) => location.locationId === "X:/Root/Alpha");
  assert(alphaLoc !== undefined, "alpha loc");
  assert(alphaLoc!.displayPathSegments.some((segment) => segment.nodeId === "X:/Root/Alpha"), "alpha segment");
  assert(alphaLoc!.displayPathSegments[0]?.nodeId === "X:/Root", "alpha path starts root");

  // 10 Stable location grouping
  for (const location of model.locations) {
    for (const insightId of location.insightIds) {
      const insight = model.insights.find((item) => item.id === insightId);
      assert(insight !== undefined && insight.locationId === location.locationId, `group ${insightId}`);
    }
  }

  // 11 Sort high→medium→low→unassessed within location
  for (const location of model.locations) {
    const cards = location.insightIds.map((id) => model.insights.find((item) => item.id === id)!);
    for (let index = 1; index < cards.length; index += 1) {
      const prev = rankEvidence(cards[index - 1]!.evidenceLevel);
      const next = rankEvidence(cards[index]!.evidenceLevel);
      assert(prev <= next, `sort ${location.locationId} ${index}`);
    }
  }

  // 12–13 Primary + dedupe
  assert(formCard!.primaryElements.length === 3, "form primary 3");
  assert(
    new Set(formCard!.primaryElements.map((element) => element.nodeId)).size === 3,
    "form primary dedupe",
  );
  assert(
    formCard!.primaryElements.every((element) => element.role === "primary"),
    "form primary role",
  );

  // 14 P2-E counter grouping (2x form "text" → secondary)
  assert(formCard!.secondaryRecurringGroups.length === 1, "form secondary group");
  assert(formCard!.secondaryRecurringGroups[0]!.elements.length === 2, "form secondary 2");
  assert(formCard!.secondaryRecurringGroups[0]!.label === "Weitere Struktur erkannt", "form secondary label");

  // 15 P2-G conservative rivals via peer candidates
  const bucketCardA = model.insights.find((insight) => insight.id === "rule:bucket-a");
  assert(bucketCardA !== undefined, "bucket a");
  assert(
    bucketCardA!.secondaryRecurringGroups.some((group) => group.groupKey === "rule:bucket-b"),
    "bucket secondary peer",
  );
  assert(
    bucketCardA!.otherElements.every((element) => element.role === "other"),
    "bucket other role",
  );
  // PeerC is in bucket-b primary → should be covered as secondary, not invent signatures on other
  assert(
    !bucketCardA!.otherElements.some((element) => element.nodeId === "X:/Root/PeerC"),
    "bucket PeerC not leftover other",
  );

  // 16 otherElements year
  assert(yearCard!.otherElements.some((element) => element.nodeId === "X:/Root/Misc"), "year other");
  assert(yearCard!.secondaryRecurringGroups.length === 0, "year no invented secondary");

  // 17–18 incomplete
  const incompleteCard = model.insights.find((insight) => insight.id === "rule:incomplete-form");
  assert(incompleteCard !== undefined && incompleteCard.incompleteData === true, "incomplete flag");
  assert(model.globallyIncomplete === true, "globally incomplete");

  // 19 titles / fact lines no percent
  for (const insight of model.insights) {
    assert(insight.title.length > 0, "title");
    assert(insight.factLine.includes("von"), "fact von");
    assert(!/\d+\s*%/.test(insight.factLine), "no percent fact");
    assert(!insight.factLine.toLowerCase().includes("score"), "no score fact");
  }
  assert(formCard!.title === "Wiederkehrende Dateinamensstruktur erkannt", "form title");
  assert(yearCard!.title === "Wiederkehrende Jahresstruktur erkannt", "year title");

  // structure summary no semantic invention
  assert(!/rechnung(sdatum|snummer)/i.test(formCard!.structureSummary.plainDescription), "no invoice semantic");
  assert(!/kundennummer/i.test(formCard!.structureSummary.plainDescription), "no customer semantic");
  assert(formCard!.structureSummary.examples.length > 0, "form examples");
  assert(yearCard!.structureSummary.plainDescription.includes("Jahresordner"), "year summary");

  // 20–21 forbidden visible
  assert(!structureInsightViewModelHasForbiddenVisibleClaims(model), "no forbidden visible");
  assert(!visibleTextHasForbiddenClaim(formCard!.factLine), "fact clean");
  for (const insight of model.insights) {
    for (const bullet of insight.explanationBullets) {
      assert(!bullet.includes("support-"), "no factor id bullet");
      assert(!bullet.includes("rival-"), "no rival id bullet");
    }
  }

  // 22 searchText includes closed element data
  assert(formCard!.searchText.includes("notiz.txt".toLowerCase()), "search secondary/other name");
  assert(formCard!.searchText.includes("alpha"), "search path");
  assert(formCard!.searchText.includes("dateinamensstruktur"), "search title");

  // name/set categories
  const nameCard = model.insights.find((insight) => insight.id === "rule:name-rechnungen");
  assert(nameCard !== undefined && nameCard.category === "folder-structure", "name category");
  assert(
    nameCard.primaryElements.some((element) => element.nodeId === "X:/Root/PeerA"),
    "name primary member",
  );

  const setCard = model.insights.find((insight) => insight.id === "rule:set-peers");
  assert(
    setCard !== undefined && setCard.structureSummary.plainDescription.includes("rechnungen"),
    "set summary names",
  );

  const formSetCard = model.insights.find((insight) => insight.id === "rule:formset");
  assert(formSetCard !== undefined && formSetCard.category === "file-names", "formset category");
  assert(formSetCard.title === "Ähnliche Dateinamensstrukturen erkannt", "formset title");

  // Unknown location: evidence nodes missing from scan → skipped, no guess
  const orphan = candidateBase("rule:orphan", PRINCIPLE_RECURRING_FILE_NAME_FORM, {
    matched: 2,
    evaluable: 2,
    level: "high",
    supporting: [
      { element: { nodeId: "X:/Missing/a.pdf", name: "a.pdf" }, attributes: { formSignature: "text" } },
      { element: { nodeId: "X:/Missing/b.pdf", name: "b.pdf" }, attributes: { formSignature: "text" } },
    ],
    scopeNodeIds: ["X:/Missing/a.pdf", "X:/Missing/b.pdf"],
  });
  const orphanModel = buildStructureInsightViewModel(scan, [orphan]);
  assert(orphanModel.insights.length === 0, "orphan skipped");
  assert(orphanModel.locations.length === 0, "orphan no location guess");

  // Input order independence for same set
  const shuffled = [...candidates].sort((left, right) => compareRuleCandidateText(right.id, left.id));
  const shuffledModel = buildStructureInsightViewModel(scan, shuffled);
  assert(JSON.stringify(shuffledModel.insights.map((item) => item.id)) === JSON.stringify(model.insights.map((item) => item.id)), "order independent ids");

  // 25 no normative in explanations
  for (const insight of model.insights) {
    const blob = [insight.title, insight.factLine, ...insight.explanationBullets, insight.structureSummary.plainDescription].join("\n");
    assert(!/\bfalsch\b/i.test(blob), "no falsch");
    assert(!/\bausreisser\b/i.test(blob) && !/\bausreißer\b/i.test(blob), "no outlier");
  }
}

function rankEvidence(level: InsightCardModel["evidenceLevel"]): number {
  switch (level) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "low":
      return 2;
    case "unassessed":
      return 3;
  }
}
