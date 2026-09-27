/**
 * P2-B comparison-context checks — synthetic fixtures only.
 * No year rules, no RuleCandidate, no suggestions, no ratings.
 */

import { type DirectoryNode, type FileNode, type FsNode, type ScanResult } from "../model";
import {
  buildStructureComparisonContexts,
  createEmptyStructureComparisonResult,
  STRUCTURE_COMPARISON_BUILDER_ID,
  STRUCTURE_COMPARISON_SCHEMA_VERSION,
  structureComparisonJsonRoundTrip,
  type StructureComparisonResult,
} from "./structureComparisonContext";

function file(id: string, name: string, depth: number): FileNode {
  return { id, name, path: id, depth, kind: "file" };
}

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

function assertNoP2cLeakage(serialized: string, label: string): void {
  assert(!serialized.includes("StructureInsightRuleCandidate"), `${label}: no rule type`);
  assert(!serialized.includes("ruleCandidate"), `${label}: no ruleCandidate`);
  assert(!serialized.includes("suggestionType"), `${label}: no suggestion`);
  assert(!/"similarity"\s*:/.test(serialized), `${label}: no similarity score`);
  assert(!serialized.toLowerCase().includes("richtig"), `${label}: no richtig`);
  assert(!serialized.toLowerCase().includes("falsch"), `${label}: no falsch`);
  assert(!serialized.includes("year-folder-detector"), `${label}: no year detector`);
}

export function runStructureComparisonContextCheck(): void {
  assert(STRUCTURE_COMPARISON_SCHEMA_VERSION === 1, "schema version");
  assert(createEmptyStructureComparisonResult().contexts.length === 0, "empty result");

  // FALL A – normal siblings
  {
    const root = dir("X:/Parent", "Parent", 0, [
      dir("X:/Parent/A", "A", 1),
      dir("X:/Parent/B", "B", 1),
      dir("X:/Parent/C", "C", 1),
    ]);
    const built = buildStructureComparisonContexts(resultOf(root));
    assert(built.contexts.length === 1, "A: one context");
    const ctx = built.contexts[0];
    assert(ctx.parent.nodeId === "X:/Parent", "A: parent");
    assert(ctx.memberCount === 3, "A: 3 members");
    assert(ctx.comparisonPossible === true, "A: comparison possible");
    assert(ctx.ineligibilityReason === null, "A: eligible");
    assert(ctx.members.every((m) => typeof m.directDirectoryCount === "number"), "A: features");
    assert(ctx.id === "siblings:X:/Parent", "A: deterministic id");
  }

  // FALL B – single child
  {
    const root = dir("X:/Parent", "Parent", 0, [dir("X:/Parent/A", "A", 1)]);
    const built = buildStructureComparisonContexts(resultOf(root));
    assert(built.contexts.length === 1, "B: context exists to express insufficiency");
    assert(built.contexts[0].memberCount === 1, "B: one member");
    assert(built.contexts[0].comparisonPossible === false, "B: not comparable");
    assert(built.contexts[0].ineligibilityReason === "singleDirectDirectory", "B: reason");
  }

  // FALL C – two children
  {
    const root = dir("X:/Parent", "Parent", 0, [
      dir("X:/Parent/A", "A", 1),
      dir("X:/Parent/B", "B", 1),
    ]);
    const built = buildStructureComparisonContexts(resultOf(root));
    assert(built.contexts[0].memberCount === 2, "C: two members");
    assert(built.contexts[0].comparisonPossible === true, "C: possible");
    // No rule / confidence / suggestion fields on the context itself.
    assert(!("confidence" in built.contexts[0]), "C: no confidence on context");
  }

  // FALL D – empty outlier stays
  {
    const root = dir("X:/Parent", "Parent", 0, [
      dir("X:/Parent/A", "A", 1, [file("X:/Parent/A/a.txt", "a.txt", 2)]),
      dir("X:/Parent/B", "B", 1, [file("X:/Parent/B/b.txt", "b.txt", 2)]),
      dir("X:/Parent/C", "C", 1),
    ]);
    const built = buildStructureComparisonContexts(resultOf(root));
    const ids = built.contexts[0].members.map((m) => m.nodeId);
    assert(ids.includes("X:/Parent/C"), "D: empty C remains");
    const empty = built.contexts[0].members.find((m) => m.nodeId === "X:/Parent/C");
    assert(empty !== undefined && empty.isEmpty === true, "D: empty feature");
  }

  // FALL E – different subtree depths
  {
    const root = dir("X:/Parent", "Parent", 0, [
      dir("X:/Parent/A", "A", 1, [dir("X:/Parent/A/2025", "2025", 2)]),
      dir("X:/Parent/B", "B", 1, [
        dir("X:/Parent/B/Rechnungen", "Rechnungen", 2, [
          dir("X:/Parent/B/Rechnungen/2025", "2025", 3),
        ]),
      ]),
    ]);
    const built = buildStructureComparisonContexts(resultOf(root));
    const members = built.contexts[0].members;
    assert(members.length === 2, "E: both members");
    const a = members.find((m) => m.name === "A");
    const b = members.find((m) => m.name === "B");
    assert(a !== undefined && b !== undefined, "E: A and B present");
    assert(a.maxRelativeSubtreeDepth === 1, "E: A depth 1");
    assert(b.maxRelativeSubtreeDepth === 2, "E: B depth 2");
    assert(a.subtreeDirectoryCount === 1, "E: A subtree dirs");
    assert(b.subtreeDirectoryCount === 2, "E: B subtree dirs");
  }

  // FALL F – files among folders
  {
    const root = dir("X:/Kunden", "Kunden", 0, [
      dir("X:/Kunden/A", "Kunde A", 1),
      dir("X:/Kunden/B", "Kunde B", 1),
      dir("X:/Kunden/C", "Kunde C", 1),
      file("X:/Kunden/Uebersicht.xlsx", "Uebersicht.xlsx", 1),
      file("X:/Kunden/Hinweise.pdf", "Hinweise.pdf", 1),
    ]);
    const built = buildStructureComparisonContexts(resultOf(root));
    assert(built.contexts[0].memberCount === 3, "F: only folders");
    assert(
      built.contexts[0].members.every((m) => !m.name.endsWith(".pdf") && !m.name.endsWith(".xlsx")),
      "F: no file members",
    );
  }

  // FALL G – nested contexts
  {
    const root = dir("X:/Kunden", "Kunden", 0, [
      dir("X:/Kunden/A", "A", 1, [
        dir("X:/Kunden/A/2024", "2024", 2),
        dir("X:/Kunden/A/2025", "2025", 2),
      ]),
      dir("X:/Kunden/B", "B", 1, [
        dir("X:/Kunden/B/2024", "2024", 2),
        dir("X:/Kunden/B/2025", "2025", 2),
      ]),
    ]);
    const built = buildStructureComparisonContexts(resultOf(root));
    assert(built.contexts.length === 3, "G: three contexts");
    const byParent = new Map(built.contexts.map((c) => [c.parent.nodeId, c]));
    assert(byParent.get("X:/Kunden")?.memberCount === 2, "G: A/B");
    assert(byParent.get("X:/Kunden/A")?.memberCount === 2, "G: years under A");
    assert(byParent.get("X:/Kunden/B")?.memberCount === 2, "G: years under B");
    assert(byParent.get("X:/Kunden")?.id !== byParent.get("X:/Kunden/A")?.id, "G: distinct ids");
  }

  // FALL H – mixed structures; no auto cull
  {
    const root = dir("X:/Dokumente", "Dokumente", 0, [
      dir("X:/Dokumente/Versicherungen", "Versicherungen", 1, [
        dir("X:/Dokumente/Versicherungen/2024", "2024", 2),
      ]),
      dir("X:/Dokumente/Steuer", "Steuer", 1),
      dir("X:/Dokumente/Fotos", "Fotos", 1, [
        file("X:/Dokumente/Fotos/a.jpg", "a.jpg", 2),
        file("X:/Dokumente/Fotos/b.jpg", "b.jpg", 2),
      ]),
      dir("X:/Dokumente/Software", "Software", 1, [
        dir("X:/Dokumente/Software/Install", "Install", 2, [
          file("X:/Dokumente/Software/Install/setup.exe", "setup.exe", 3),
        ]),
      ]),
      dir("X:/Dokumente/Rechnungen", "Rechnungen", 1, [file("X:/Dokumente/Rechnungen/r.pdf", "r.pdf", 2)]),
      dir("X:/Dokumente/Privat", "Privat", 1),
    ]);
    const built = buildStructureComparisonContexts(resultOf(root));
    assert(built.contexts[0].memberCount === 6, "H: all six remain");
    assert(built.contexts[0].comparisonPossible === true, "H: still a structural peer set");
  }

  // FALL I – large group, no truncation
  {
    const children = Array.from({ length: 120 }, (_, i) => {
      const n = String(i + 1).padStart(3, "0");
      return dir(`X:/Wide/Bereich-${n}`, `Bereich-${n}`, 1);
    });
    const root = dir("X:/Wide", "Wide", 0, children);
    const built = buildStructureComparisonContexts(resultOf(root));
    assert(built.contexts[0].memberCount === 120, "I: no truncation");
    const names = built.contexts[0].members.map((m) => m.name);
    const sorted = names.slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    assert(names.join("|") === sorted.join("|"), "I: deterministic order");
  }

  // FALL J – JSON roundtrip
  {
    const root = dir("X:/Parent", "Parent", 0, [
      dir("X:/Parent/A", "A", 1, [file("X:/Parent/A/a.txt", "a.txt", 2)]),
      dir("X:/Parent/B", "B", 1),
    ]);
    const built = buildStructureComparisonContexts(resultOf(root));
    const round = structureComparisonJsonRoundTrip(built);
    assert(round.schemaVersion === built.schemaVersion, "J: schema");
    assert(round.contexts[0].memberCount === 2, "J: members");
    assert(round.contexts[0].provenance.builderId === STRUCTURE_COMPARISON_BUILDER_ID, "J: provenance");
    assert(
      JSON.stringify(round.contexts[0].members[0]) === JSON.stringify(built.contexts[0].members[0]),
      "J: member features",
    );
  }

  // FALL K – determinism
  {
    const make = (): StructureComparisonResult =>
      buildStructureComparisonContexts(
        resultOf(
          dir("X:/Parent", "Parent", 0, [
            dir("X:/Parent/B", "B", 1),
            dir("X:/Parent/A", "A", 1),
            dir("X:/Parent/C", "C", 1),
          ]),
        ),
      );
    assert(JSON.stringify(make()) === JSON.stringify(make()), "K: identical output");
  }

  // FALL L – no P2-C leakage
  {
    const root = dir("X:/Parent", "Parent", 0, [
      dir("X:/Parent/A", "A", 1, [dir("X:/Parent/A/2024", "2024", 2)]),
      dir("X:/Parent/B", "B", 1, [dir("X:/Parent/B/2025", "2025", 2)]),
    ]);
    const built = buildStructureComparisonContexts(resultOf(root));
    assertNoP2cLeakage(JSON.stringify(built), "L");
    assert(built.contexts.every((c) => c.provenance.builderId === STRUCTURE_COMPARISON_BUILDER_ID), "L: builder only");
  }

  // Parent with zero directory children → no context
  {
    const root = dir("X:/Leafish", "Leafish", 0, [file("X:/Leafish/only.txt", "only.txt", 1)]);
    const built = buildStructureComparisonContexts(resultOf(root));
    assert(built.contexts.length === 0, "zero dirs: no context");
  }
}
