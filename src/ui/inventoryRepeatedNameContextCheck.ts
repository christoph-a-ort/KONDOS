import { type DirectoryNode, type FileNode, type FsNode, type ScanResult } from "../model";
import { analyzeInventory, type InventoryAnalysis } from "./inventoryAnalysis";
import {
  analyzeRepeatedFolderNameContext,
  type RepeatedFolderNameContextGroup,
} from "./inventoryRepeatedNameContext";
import { analyzeStructureContext, type InventoryStructureContext } from "./inventoryStructureContext";

function file(id: string, name: string, extras: Partial<FileNode> = {}): FileNode {
  return { id, name, path: id, depth: 1, kind: "file", ...extras };
}

function dir(
  id: string,
  name: string,
  children: FsNode[],
  extras: Partial<DirectoryNode> = {},
): DirectoryNode {
  return { id, name, path: id, depth: 0, kind: "directory", listing: "read", children, ...extras };
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

function derived(root: DirectoryNode): {
  analysis: InventoryAnalysis;
  structure: InventoryStructureContext;
  groups: RepeatedFolderNameContextGroup[];
} {
  const scan = resultOf(root);
  const analysis = analyzeInventory(scan);
  const structure = analyzeStructureContext(scan);
  return {
    analysis,
    structure,
    groups: analyzeRepeatedFolderNameContext(analysis, structure),
  };
}

function groupNamed(
  groups: readonly RepeatedFolderNameContextGroup[],
  name: string,
): RepeatedFolderNameContextGroup {
  const group = groups.find((item) => item.name === name);
  assert(group !== undefined, `missing repeated name group ${name}`);
  return group;
}

export function runInventoryRepeatedNameContextCheck(): void {
  const banks = derived(
    dir("C:/bestand", "bestand", [
      dir("C:/bestand/Dad", "Dad", [dir("C:/bestand/Dad/Bank", "Bank", [], { depth: 2 })], { depth: 1 }),
      dir(
        "C:/bestand/Mom",
        "Mom",
        [
          dir("C:/bestand/Mom/Bank", "Bank", [], { depth: 2 }),
          dir("C:/bestand/Mom/Fotos", "Fotos", [], { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  const bank = groupNamed(banks.groups, "Bank");
  assert(bank.count === 2 && bank.occurrences.length === 2, "A: two Bank occurrences");
  assert(bank.occurrences[0]?.parent?.name === "Dad" && bank.occurrences[1]?.parent?.name === "Mom", "A: different parents");
  assert(bank.occurrences[0]?.relativePath === "Dad\\Bank", "A: relative path Dad");
  assert(bank.occurrences[1]?.relativePath === "Mom\\Bank", "A: relative path Mom");
  assert(bank.occurrences.every((item) => item.joinFound && item.listing === "read"), "A: joined read folders");
  assert(bank.occurrences.every((item) => item.isYearFolderName === false && item.yearGroup === null), "M: Bank has no year context");

  const years = derived(
    dir("C:/versorger", "versorger", [
      dir(
        "C:/versorger/Gas",
        "Gas",
        [
          dir("C:/versorger/Gas/2023", "2023", [], { depth: 2 }),
          dir("C:/versorger/Gas/2024", "2024", [], { depth: 2 }),
          dir("C:/versorger/Gas/2025", "2025", [], { depth: 2 }),
        ],
        { depth: 1 },
      ),
      dir(
        "C:/versorger/Wasser",
        "Wasser",
        [
          dir("C:/versorger/Wasser/2023", "2023", [], { depth: 2 }),
          dir("C:/versorger/Wasser/2024", "2024", [], { depth: 2 }),
          dir("C:/versorger/Wasser/2025", "2025", [], { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  const year2023 = groupNamed(years.groups, "2023");
  assert(year2023.count === 2, "B: two 2023 folders");
  assert(year2023.occurrences.every((item) => item.isYearFolderName), "B: year folder name");
  assert(year2023.occurrences[0]?.parent?.name === "Gas", "B: first parent Gas");
  assert(year2023.occurrences[1]?.parent?.name === "Wasser", "B: second parent Wasser");
  assert(year2023.occurrences.every((item) => item.yearGroup !== null), "C: both 2023s belong to a yearGroup");
  assert(year2023.occurrences[0]?.yearGroup?.years.join(",") === "2023,2024,2025", "C: Gas years");
  assert(year2023.occurrences[0]?.yearGroup?.minYear === 2023 && year2023.occurrences[0]?.yearGroup?.maxYear === 2025, "C: span");
  assert(year2023.occurrences[0]?.yearGroup?.parent.name === "Gas", "C: year group parent");
  assert(
    year2023.occurrences.every((item) => item.parentInRepeatedChildDirectoryStructure),
    "E: both parents belong to the exact child-directory structure",
  );
  assert(
    year2023.occurrences[0]?.parentRepeatedChildDirectoryStructureSignature ===
      year2023.occurrences[1]?.parentRepeatedChildDirectoryStructureSignature,
    "E: same parent structure signature",
  );
  const structureBefore = JSON.stringify({
    yearGroups: years.structure.yearGroups,
    repeatedChildDirectoryStructures: years.structure.repeatedChildDirectoryStructures,
    folderChains: years.structure.folderChains,
  });
  analyzeRepeatedFolderNameContext(years.analysis, years.structure);
  const structureAfter = JSON.stringify({
    yearGroups: years.structure.yearGroups,
    repeatedChildDirectoryStructures: years.structure.repeatedChildDirectoryStructures,
    folderChains: years.structure.folderChains,
  });
  assert(structureBefore === structureAfter, "O/P/Q: join does not mutate yearGroups, structures, or chains");
  assert(years.structure.yearGroups.length === 2, "O: yearGroups still two");
  assert(years.structure.repeatedChildDirectoryStructures.length === 1, "P: one child-directory structure");
  assert(years.structure.folderChains.length === 0, "Q: no folder chains in this fixture");

  const loneYears = derived(
    dir("C:/docs", "docs", [
      dir("C:/docs/A", "A", [dir("C:/docs/A/2023", "2023", [], { depth: 2 })], { depth: 1 }),
      dir("C:/docs/B", "B", [dir("C:/docs/B/2023", "2023", [], { depth: 2 })], { depth: 1 }),
    ]),
  );
  const lone2023 = groupNamed(loneYears.groups, "2023");
  assert(lone2023.occurrences.every((item) => item.isYearFolderName), "D: name is a year folder");
  assert(lone2023.occurrences.every((item) => item.yearGroup === null), "D: not a yearGroup member");
  assert(loneYears.structure.yearGroups.length === 0, "D: no year groups in structure");
  assert(
    lone2023.occurrences.every((item) => item.parentInRepeatedChildDirectoryStructure === false),
    "F: parents with a single child are not a P1-J structure",
  );

  const chainTree = derived(
    dir("C:/root", "root", [
      dir(
        "C:/root/A",
        "A",
        [
          dir(
            "C:/root/A/B",
            "B",
            [dir("C:/root/A/B/C", "C", [file("C:/root/A/B/C/x.pdf", "x.pdf", { depth: 3 })], { depth: 3 })],
            { depth: 2 },
          ),
        ],
        { depth: 1 },
      ),
      dir("C:/root/sonst", "sonst", [dir("C:/root/sonst/C", "C", [], { depth: 2 })], { depth: 1 }),
    ]),
  );
  const chainC = groupNamed(chainTree.groups, "C");
  assert(chainC.occurrences.length === 2, "G/H: two C folders");
  const chained = chainC.occurrences.find((item) => item.relativePath === "A\\B\\C");
  const notChained = chainC.occurrences.find((item) => item.relativePath === "sonst\\C");
  assert(chained?.inFolderChain === true, "G: A>B>C member is in a folder chain");
  assert(notChained?.inFolderChain === false, "H: the other C is not in a folder chain");
  assert(chainTree.structure.folderChains.length === 1, "Q: one maximal chain remains");
  assert(chainTree.structure.folderChains[0]?.folderCount === 3, "Q: chain length 3");

  const rootNamed = derived(
    dir("C:/Bank", "Bank", [dir("C:/Bank/Bank", "Bank", [], { depth: 1 })]),
  );
  const rootBank = groupNamed(rootNamed.groups, "Bank");
  const start = rootBank.occurrences.find((item) => item.relativePath === "Startordner");
  const nested = rootBank.occurrences.find((item) => item.relativePath === "Bank");
  assert(start?.parent === null && start.parentRelativePath === null, "I: root parent is null");
  assert(start?.depth === 0, "I: root depth 0");
  assert(nested?.parent?.name === "Bank", "I: nested Bank keeps parent");

  const listing = derived(
    dir("C:/docs", "docs", [
      dir("C:/docs/A", "A", [dir("C:/docs/A/Fotos", "Fotos", [], { depth: 2, listing: "depthLimited" })], { depth: 1 }),
      dir("C:/docs/B", "B", [dir("C:/docs/B/Fotos", "Fotos", [], { depth: 2, listing: "incomplete" })], { depth: 1 }),
    ]),
  );
  const fotos = groupNamed(listing.groups, "Fotos");
  assert(fotos.occurrences[0]?.listing === "depthLimited", "J: depthLimited preserved");
  assert(fotos.occurrences[1]?.listing === "incomplete", "J: incomplete preserved");
  assert(fotos.occurrences.every((item) => item.isYearFolderName === false && item.yearGroup === null), "M: Fotos has no year context");

  const siblings = derived(
    dir("C:/haus", "haus", [
      dir(
        "C:/haus/A",
        "A",
        [
          dir("C:/haus/A/Privates", "Privates", [], { depth: 2 }),
          dir("C:/haus/A/Fotos", "Fotos", [], { depth: 2 }),
          dir("C:/haus/A/Bank", "Bank", [], { depth: 2 }),
        ],
        { depth: 1 },
      ),
      dir("C:/haus/B", "B", [dir("C:/haus/B/Privates", "Privates", [], { depth: 2 })], { depth: 1 }),
    ]),
  );
  const privates = groupNamed(siblings.groups, "Privates");
  const withSiblings = privates.occurrences.find((item) => item.parent?.name === "A");
  assert(withSiblings?.siblingDirectoryCount === 2, "K: two sibling directories");
  assert(withSiblings?.siblingDirectoryNames.join(",") === "Bank,Fotos", "K: sibling names sorted");
  const alone = privates.occurrences.find((item) => item.parent?.name === "B");
  assert(alone?.siblingDirectoryCount === 0, "K: no siblings under B");

  const ordered = derived(
    dir("C:/docs", "docs", [
      dir("C:/docs/Zed", "Zed", [dir("C:/docs/Zed/Bank", "Bank", [], { depth: 2 })], { depth: 1 }),
      dir("C:/docs/Abel", "Abel", [dir("C:/docs/Abel/Bank", "Bank", [], { depth: 2 })], { depth: 1 }),
    ]),
  );
  const orderedBank = groupNamed(ordered.groups, "Bank");
  assert(
    orderedBank.occurrences.map((item) => item.relativePath).join(",") === "Abel\\Bank,Zed\\Bank",
    "L: occurrences sorted by relative path",
  );
  const orderedAgain = derived(
    dir("C:/docs", "docs", [
      dir("C:/docs/Abel", "Abel", [dir("C:/docs/Abel/Bank", "Bank", [], { depth: 2 })], { depth: 1 }),
      dir("C:/docs/Zed", "Zed", [dir("C:/docs/Zed/Bank", "Bank", [], { depth: 2 })], { depth: 1 }),
    ]),
  );
  assert(JSON.stringify(ordered.groups) === JSON.stringify(orderedAgain.groups), "L: deterministic serialization");

  const missingBase = derived(
    dir("C:/docs", "docs", [
      dir("C:/docs/A", "A", [dir("C:/docs/A/Bank", "Bank", [], { depth: 2 })], { depth: 1 }),
      dir("C:/docs/B", "B", [dir("C:/docs/B/Bank", "Bank", [], { depth: 2 })], { depth: 1 }),
    ]),
  );
  const patchedAnalysis: InventoryAnalysis = {
    ...missingBase.analysis,
    repeatedFolderNames: missingBase.analysis.repeatedFolderNames.map((item) =>
      item.name === "Bank"
        ? { ...item, count: 3, paths: [...item.paths, "C:/missing/Bank"] }
        : item,
    ),
  };
  const withMissing = analyzeRepeatedFolderNameContext(patchedAnalysis, missingBase.structure);
  const missingBank = groupNamed(withMissing, "Bank");
  const missing = missingBank.occurrences.find((item) => item.path === "C:/missing/Bank");
  assert(missing?.joinFound === false, "N: missing join is marked");
  assert(missing.folder === null && missing.relativePath === null && missing.parent === null, "N: no invented folder or parent");
  assert(missing.yearGroup === null && missing.isYearFolderName === false, "N: no invented year context");
  assert(missing.parentInRepeatedChildDirectoryStructure === false && missing.inFolderChain === false, "N: no invented P1-J flags");
  assert(missingBank.occurrences.filter((item) => item.joinFound).length === 2, "N: real occurrences still join");

  const blob = JSON.stringify(years.groups).toLocaleLowerCase();
  assert(!blob.includes("duplikat") && !blob.includes("redundant"), "R: no duplicate rating");
  assert(!blob.includes("zusammenführen") && !blob.includes("zusammenfuehren"), "R: no merge rating");
  assert(!blob.includes("löschen") && !blob.includes("loeschen") && !blob.includes("unnötig"), "R: no action rating");

  assert(banks.analysis.repeatedFolderNames.some((item) => item.name === "Bank"), "P1-H repeatedFolderNames still present");
}
