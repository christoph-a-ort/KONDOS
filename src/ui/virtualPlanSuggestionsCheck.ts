/**
 * P2-K.3b virtual reorganization proposal checks — synthetic fixtures only.
 */

import type { DirectoryNode, FileNode, ScanConfig, ScanResult } from "../model";
import {
  STRUCTURE_INSIGHT_VIEW_MODEL_SCHEMA_VERSION,
  type StructureInsightViewModel,
} from "./structureInsightViewModel";
import { PRINCIPLE_RECURRING_FILE_NAME_FORM } from "./structureRuleCandidate";
import { makeSnapshotBinding } from "./virtualPlan";
import { buildVirtualSollPreview } from "./virtualPlanPreview";
import {
  buildVirtualReorgProposals,
  candidatePrefixesFromStem,
  countPreviewCoveredSourceIds,
  extractPlausibleYearsFromName,
  proposalsHaveAdoptedChanges,
} from "./virtualPlanSuggestions";

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(label);
  }
}

const config: ScanConfig = {
  rootPath: "C:\\Fixture",
  maxDepth: 10,
  excludeHidden: true,
  extensions: [],
  includeSize: true,
  includeCreatedAt: false,
  includeModifiedAt: true,
};

function file(id: string, name: string, depth: number): FileNode {
  return { id, path: id, name, depth, kind: "file", sizeBytes: 1, modifiedAtMs: 1 };
}

function dir(
  id: string,
  name: string,
  depth: number,
  children: Array<DirectoryNode | FileNode>,
  listing: DirectoryNode["listing"] = "read",
): DirectoryNode {
  return { id, path: id, name, depth, kind: "directory", listing, children };
}

function emptyVm(
  overrides: Partial<StructureInsightViewModel> = {},
): StructureInsightViewModel {
  return {
    schemaVersion: STRUCTURE_INSIGHT_VIEW_MODEL_SCHEMA_VERSION,
    locations: [],
    insights: [],
    countsByEvidence: { high: 0, medium: 0, low: 0, unassessed: 0, total: 0 },
    countsByCategory: {
      "file-names": 0,
      "folder-structure": 0,
      "time-years": 0,
      "file-distribution": 0,
    },
    globallyIncomplete: false,
    ...overrides,
  };
}

export function runVirtualPlanSuggestionsCheck(): void {
  assert(
    candidatePrefixesFromStem("Rechnung_2024_01").includes("Rechnung_2024"),
    "prefix candidates",
  );
  assert(isWeakCheck(), "weak prefix helper covered via proposals");

  assert(extractPlausibleYearsFromName("Rechnung_2024_01.pdf").includes(2024), "year extract");
  assert(extractPlausibleYearsFromName("foto_1234.jpg").length === 0, "implausible year");
  assert(
    extractPlausibleYearsFromName("Mix_2024_2025.pdf").length === 2,
    "ambiguous multi-year",
  );

  const prefixRoot = dir("C:\\Fixture", "Fixture", 0, [
    dir("C:\\Fixture\\Rechnungen", "Rechnungen", 1, [
      file("C:\\Fixture\\Rechnungen\\Rechnung_2024_01.pdf", "Rechnung_2024_01.pdf", 2),
      file("C:\\Fixture\\Rechnungen\\Rechnung_2024_02.pdf", "Rechnung_2024_02.pdf", 2),
      file("C:\\Fixture\\Rechnungen\\Rechnung_2024_03.pdf", "Rechnung_2024_03.pdf", 2),
      file("C:\\Fixture\\Rechnungen\\Notiz.txt", "Notiz.txt", 2),
    ]),
  ]);
  const prefixScan: ScanResult = {
    root: prefixRoot,
    warnings: [],
    stats: { directoryCount: 2, fileCount: 4, skippedCount: 0, durationMs: 1 },
  };
  const binding = makeSnapshotBinding(prefixScan, config, 21);
  const prefixProposals = buildVirtualReorgProposals({
    scanResult: prefixScan,
    binding,
  });
  assert(
    prefixProposals.some((p) => p.category === "virtualFolderGroup"),
    "prefix group found",
  );
  const group = prefixProposals.find((p) => p.category === "virtualFolderGroup")!;
  assert(group.affectedFileNames.length === 3, "three prefix files");
  assert(group.unchangedObjectNames.includes("Notiz.txt"), "outlier unchanged");
  assert(group.completeness.sourceObjectCount === 4, "prefix source count");
  assert(group.completeness.regroupedObjectCount === 3, "prefix regrouped");
  assert(group.completeness.unchangedObjectCount === 1, "prefix unchanged");
  assert(group.completeness.complete, "prefix complete");
  assert(group.actionKind === "createVirtualSubfolder", "prefix action kind");
  assert(!group.actionLabel.toLowerCase().includes("umbenennen"), "not a rename");
  assert(group.virtualTarget.lines.some((line) => line.includes("Bleibt unverändert")), "unchanged marker");
  assert(group.adopted === false, "not adopted");
  assert(group.title.includes("Rechnung"), "prefix in title");

  // Weak evidence: only two files — no proposal
  const weakRoot = dir("C:\\Fixture", "Fixture", 0, [
    dir("C:\\Fixture\\Docs", "Docs", 1, [
      file("C:\\Fixture\\Docs\\Rechnung_01.pdf", "Rechnung_01.pdf", 2),
      file("C:\\Fixture\\Docs\\Rechnung_02.pdf", "Rechnung_02.pdf", 2),
    ]),
  ]);
  const weakScan: ScanResult = {
    root: weakRoot,
    warnings: [],
    stats: { directoryCount: 2, fileCount: 2, skippedCount: 0, durationMs: 1 },
  };
  const weakProposals = buildVirtualReorgProposals({
    scanResult: weakScan,
    binding: makeSnapshotBinding(weakScan, config, 22),
  });
  assert(
    !weakProposals.some((p) => p.category === "virtualFolderGroup"),
    "no weak prefix proposal",
  );

  // Year grouping
  const yearRoot = dir("C:\\Fixture", "Fixture", 0, [
    dir("C:\\Fixture\\Belege", "Belege", 1, [
      file("C:\\Fixture\\Belege\\a_2024.pdf", "a_2024.pdf", 2),
      file("C:\\Fixture\\Belege\\b_2024.pdf", "b_2024.pdf", 2),
      file("C:\\Fixture\\Belege\\c_2025.pdf", "c_2025.pdf", 2),
      file("C:\\Fixture\\Belege\\d_2025.pdf", "d_2025.pdf", 2),
      file("C:\\Fixture\\Belege\\readme.txt", "readme.txt", 2),
      file("C:\\Fixture\\Belege\\mix_2024_2025.pdf", "mix_2024_2025.pdf", 2),
    ]),
  ]);
  const yearScan: ScanResult = {
    root: yearRoot,
    warnings: [],
    stats: { directoryCount: 2, fileCount: 6, skippedCount: 0, durationMs: 1 },
  };
  const yearProposals = buildVirtualReorgProposals({
    scanResult: yearScan,
    binding: makeSnapshotBinding(yearScan, config, 23),
  });
  const yearProp = yearProposals.find((p) => p.category === "virtualYearGroup");
  assert(yearProp !== undefined, "year proposal");
  assert(yearProp!.affectedFileNames.includes("mix_2024_2025.pdf") === false, "ambiguous excluded");
  assert(yearProp!.unchangedObjectNames.includes("mix_2024_2025.pdf"), "ambiguous unchanged");
  assert(yearProp!.unchangedObjectNames.includes("readme.txt"), "no-year unchanged");
  assert(yearProp!.completeness.sourceObjectCount === 6, "year source count");
  assert(yearProp!.completeness.complete, "year complete");
  assert(yearProp!.actionKind === "groupFilesByYear", "year action kind");
  assert(yearProp!.uncertainties.some((u) => u.includes("unverändert")), "unchanged note");
  assert(
    yearProp!.virtualTarget.lines.some((line) => line.includes("readme.txt")),
    "unassigned listed unchanged",
  );

  // Name-form insight alone → no incomplete structure variant (hints only)
  const insightVm = emptyVm({
    insights: [
      {
        id: "ins-form",
        locationId: "C:\\Fixture\\Rechnungen",
        principle: PRINCIPLE_RECURRING_FILE_NAME_FORM,
        category: "file-names",
        categoryLabel: "Dateinamen",
        title: "Wiederkehrendes Dateinamenmuster",
        factLine: "Mehrere Dateien folgen derselben Form.",
        evidenceLevel: "medium",
        evidenceLabel: "Mittel",
        incompleteData: true,
        explanationBullets: [],
        structureSummary: { plainDescription: "", examples: [] },
        primaryElements: [
          {
            nodeId: "C:\\Fixture\\Rechnungen\\Rechnung_2024_01.pdf",
            displayName: "Rechnung_2024_01.pdf",
            role: "primary",
          },
        ],
        secondaryRecurringGroups: [],
        otherElements: [],
        searchText: "",
      },
    ],
    countsByEvidence: { high: 0, medium: 1, low: 0, unassessed: 0, total: 1 },
  });
  const variantProposals = buildVirtualReorgProposals({
    scanResult: prefixScan,
    binding,
    insightViewModel: insightVm,
  });
  assert(
    !variantProposals.some((p) => p.category === "reviewableStructureVariant"),
    "no structure variant from name pattern alone",
  );
  assert(
    variantProposals.some((p) => p.category === "virtualFolderGroup"),
    "prefix still proposed beside insight",
  );

  // Determinism
  const again = buildVirtualReorgProposals({
    scanResult: prefixScan,
    binding,
    insightViewModel: insightVm,
  });
  assert(JSON.stringify(variantProposals) === JSON.stringify(again), "deterministic proposals");

  // SOLL projection unchanged + proposals attached, no adopt
  const preview = buildVirtualSollPreview({
    scanResult: prefixScan,
    scanConfig: config,
    sourceScanId: 21,
    insightViewModel: insightVm,
  });
  assert(preview.proposals.length > 0, "preview carries proposals");
  assert(
    preview.nodes.every((node) => node.changeKind === "unchanged"),
    "soll nodes unchanged",
  );
  assert(preview.nodes.length === preview.observedNodeCount, "no lost objects");
  assert(!proposalsHaveAdoptedChanges(preview.proposals), "nothing adopted");

  // Incomplete listing directory: no prefix proposal from that folder
  const incompleteDir = dir("C:\\Fixture", "Fixture", 0, [
    dir(
      "C:\\Fixture\\Partial",
      "Partial",
      1,
      [
        file("C:\\Fixture\\Partial\\Rechnung_01.pdf", "Rechnung_01.pdf", 2),
        file("C:\\Fixture\\Partial\\Rechnung_02.pdf", "Rechnung_02.pdf", 2),
        file("C:\\Fixture\\Partial\\Rechnung_03.pdf", "Rechnung_03.pdf", 2),
      ],
      "incomplete",
    ),
  ]);
  const incompleteScan: ScanResult = {
    root: incompleteDir,
    warnings: [],
    stats: { directoryCount: 2, fileCount: 3, skippedCount: 0, durationMs: 1 },
  };
  const incompleteProps = buildVirtualReorgProposals({
    scanResult: incompleteScan,
    binding: makeSnapshotBinding(incompleteScan, config, 30),
  });
  assert(
    !incompleteProps.some((p) => p.category === "virtualFolderGroup"),
    "no proposal from incomplete listing",
  );

  // Overlap linking when prefix + year in same folder
  const overlapRoot = dir("C:\\Fixture", "Fixture", 0, [
    dir("C:\\Fixture\\Mix", "Mix", 1, [
      file("C:\\Fixture\\Mix\\Rechnung_2024_01.pdf", "Rechnung_2024_01.pdf", 2),
      file("C:\\Fixture\\Mix\\Rechnung_2024_02.pdf", "Rechnung_2024_02.pdf", 2),
      file("C:\\Fixture\\Mix\\Rechnung_2024_03.pdf", "Rechnung_2024_03.pdf", 2),
      file("C:\\Fixture\\Mix\\Rechnung_2025_01.pdf", "Rechnung_2025_01.pdf", 2),
      file("C:\\Fixture\\Mix\\Rechnung_2025_02.pdf", "Rechnung_2025_02.pdf", 2),
      file("C:\\Fixture\\Mix\\Rechnung_2025_03.pdf", "Rechnung_2025_03.pdf", 2),
    ]),
  ]);
  const overlapScan: ScanResult = {
    root: overlapRoot,
    warnings: [],
    stats: { directoryCount: 2, fileCount: 6, skippedCount: 0, durationMs: 1 },
  };
  const overlapProps = buildVirtualReorgProposals({
    scanResult: overlapScan,
    binding: makeSnapshotBinding(overlapScan, config, 31),
  });
  const hasOverlap = overlapProps.some((p) => p.overlapsWithProposalIds.length > 0);
  assert(hasOverlap, "overlapping proposals linked");
  assert(
    overlapProps
      .filter((p) => p.overlapsWithProposalIds.length > 0)
      .every((p) => p.uncertainties.some((u) => u.includes("nicht unabhängig"))),
    "overlap uncertainty",
  );

  // Gasag-style 9+1: nine matching, one outlier — full preview must keep all ten
  const gasagFiles = [
    ...Array.from({ length: 9 }, (_, index) => {
      const year = 2016 + index;
      const name = `Gasag_Rechnung_${year}.pdf`;
      return file(`C:\\Fixture\\gasag_gas - beendet\\${name}`, name, 2);
    }),
    file(
      "C:\\Fixture\\gasag_gas - beendet\\191125 Übermittlung Zählerstand.pdf",
      "191125 Übermittlung Zählerstand.pdf",
      2,
    ),
  ];
  const gasagRoot = dir("C:\\Fixture", "Fixture", 0, [
    dir("C:\\Fixture\\gasag_gas - beendet", "gasag_gas - beendet", 1, gasagFiles),
  ]);
  const gasagScan: ScanResult = {
    root: gasagRoot,
    warnings: [],
    stats: { directoryCount: 2, fileCount: 10, skippedCount: 0, durationMs: 1 },
  };
  const gasagProps = buildVirtualReorgProposals({
    scanResult: gasagScan,
    binding: makeSnapshotBinding(gasagScan, config, 40),
  });
  const gasagGroup = gasagProps.find((p) => p.category === "virtualFolderGroup");
  assert(gasagGroup !== undefined, "gasag prefix proposal");
  assert(gasagGroup!.completeness.sourceObjectCount === 10, "gasag 10 source");
  assert(gasagGroup!.completeness.regroupedObjectCount === 9, "gasag 9 grouped");
  assert(gasagGroup!.completeness.unchangedObjectCount === 1, "gasag 1 unchanged");
  assert(gasagGroup!.completeness.complete, "gasag complete");
  assert(!gasagGroup!.completeness.lossDetected, "gasag no loss");
  assert(!gasagGroup!.completeness.hasDuplicates, "gasag no dup");
  assert(
    countPreviewCoveredSourceIds(gasagGroup!.virtualTarget.tree) === 10,
    "gasag preview covers 10",
  );
  assert(
    gasagGroup!.unchangedObjectNames.some((name) => name.includes("Übermittlung Zählerstand")),
    "gasag outlier named unchanged",
  );
  assert(
    gasagGroup!.virtualTarget.lines.some((line) => line.includes("Übermittlung Zählerstand")),
    "gasag outlier in preview lines",
  );
  assert(
    gasagGroup!.virtualTarget.lines.some((line) => line.includes("Bleibt unverändert")),
    "gasag unchanged label",
  );
  assert(
    !gasagProps.some((p) => p.category === "reviewableStructureVariant"),
    "gasag no partial variant",
  );

  // Multiple outliers + existing subfolder preserved
  const multiRoot = dir("C:\\Fixture", "Fixture", 0, [
    dir("C:\\Fixture\\Archiv", "Archiv", 1, [
      file("C:\\Fixture\\Archiv\\Bericht_01.pdf", "Bericht_01.pdf", 2),
      file("C:\\Fixture\\Archiv\\Bericht_02.pdf", "Bericht_02.pdf", 2),
      file("C:\\Fixture\\Archiv\\Bericht_03.pdf", "Bericht_03.pdf", 2),
      file("C:\\Fixture\\Archiv\\Notiz_A.txt", "Notiz_A.txt", 2),
      file("C:\\Fixture\\Archiv\\Notiz_B.txt", "Notiz_B.txt", 2),
      dir("C:\\Fixture\\Archiv\\Alt", "Alt", 2, [
        file("C:\\Fixture\\Archiv\\Alt\\x.txt", "x.txt", 3),
      ]),
    ]),
  ]);
  const multiScan: ScanResult = {
    root: multiRoot,
    warnings: [],
    stats: { directoryCount: 3, fileCount: 6, skippedCount: 0, durationMs: 1 },
  };
  const multiProps = buildVirtualReorgProposals({
    scanResult: multiScan,
    binding: makeSnapshotBinding(multiScan, config, 41),
  });
  const multiGroup = multiProps.find((p) => p.category === "virtualFolderGroup");
  assert(multiGroup !== undefined, "multi prefix");
  assert(multiGroup!.completeness.sourceObjectCount === 6, "multi source=6 (5 files+1 dir)");
  assert(multiGroup!.completeness.regroupedObjectCount === 3, "multi 3 grouped");
  assert(multiGroup!.completeness.unchangedObjectCount === 3, "multi 3 unchanged");
  assert(multiGroup!.unchangedObjectNames.includes("Alt"), "subfolder preserved");
  assert(multiGroup!.completeness.complete, "multi complete");
  assert(
    multiGroup!.virtualTarget.lines.some((line) => line.includes("Unterordner")),
    "subfolder marker",
  );

  // Large folder: still complete, collapsed virtual group listing
  const largeFiles = Array.from({ length: 40 }, (_, index) => {
    const name = `Serie_${String(index).padStart(2, "0")}.pdf`;
    return file(`C:\\Fixture\\Large\\${name}`, name, 2);
  });
  largeFiles.push(file("C:\\Fixture\\Large\\Sonstiges.txt", "Sonstiges.txt", 2));
  const largeRoot = dir("C:\\Fixture", "Fixture", 0, [
    dir("C:\\Fixture\\Large", "Large", 1, largeFiles),
  ]);
  const largeScan: ScanResult = {
    root: largeRoot,
    warnings: [],
    stats: { directoryCount: 2, fileCount: 41, skippedCount: 0, durationMs: 1 },
  };
  const largeProps = buildVirtualReorgProposals({
    scanResult: largeScan,
    binding: makeSnapshotBinding(largeScan, config, 42),
  });
  const largeGroup = largeProps.find((p) => p.category === "virtualFolderGroup");
  assert(largeGroup !== undefined, "large prefix");
  assert(largeGroup!.completeness.sourceObjectCount === 41, "large source");
  assert(largeGroup!.completeness.complete, "large complete");
  assert(
    largeGroup!.virtualTarget.lines.some((line) => line.includes("weitere")),
    "large collapsed",
  );
  assert(
    countPreviewCoveredSourceIds(largeGroup!.virtualTarget.tree) === 41,
    "large tree covers all",
  );
}

function isWeakCheck(): boolean {
  const root = dir("C:\\Fixture", "Fixture", 0, [
    dir("C:\\Fixture\\X", "X", 1, [
      file("C:\\Fixture\\X\\a_1.txt", "a_1.txt", 2),
      file("C:\\Fixture\\X\\a_2.txt", "a_2.txt", 2),
      file("C:\\Fixture\\X\\a_3.txt", "a_3.txt", 2),
    ]),
  ]);
  const scan: ScanResult = {
    root,
    warnings: [],
    stats: { directoryCount: 2, fileCount: 3, skippedCount: 0, durationMs: 1 },
  };
  const proposals = buildVirtualReorgProposals({
    scanResult: scan,
    binding: makeSnapshotBinding(scan, config, 99),
  });
  return !proposals.some((p) => p.category === "virtualFolderGroup");
}
