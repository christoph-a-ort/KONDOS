import { type DirectoryNode, type FileNode, type FsNode, type ScanResult } from "../model";
import { buildDisplayFilterView, emptyDisplayFilterDraft } from "./displayFilter";
import { analyzeInventory } from "./inventoryAnalysis";
import { deriveVisibleRows } from "./treeRows";
import { DEFAULT_TREE_SORT } from "./treeSort";
import {
  MIN_YEAR_GROUP_SIZE,
  YEAR_FOLDER_MAX,
  YEAR_FOLDER_MIN,
  MIN_CHILD_DIRECTORY_STRUCTURE_SIZE,
  MIN_REPEATED_STRUCTURE_PARENTS,
  MIN_FOLDER_CHAIN_LENGTH,
  analyzeStructureContext,
  folderContextByPath,
  isYearFolderName,
  parseYearFolderName,
  type InventoryStructureContext,
} from "./inventoryStructureContext";

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

function serialized(context: InventoryStructureContext): string {
  return JSON.stringify(context);
}

export function runInventoryStructureContextCheck(): void {
  assert(YEAR_FOLDER_MIN === 1900 && YEAR_FOLDER_MAX === 2100, "year range 1900-2100");
  assert(MIN_YEAR_GROUP_SIZE === 2, "year group minimum is 2");

  assert(parseYearFolderName("2020") === 2020, "A: 2020 is a year folder");
  assert(isYearFolderName("2021") && isYearFolderName("2024") && isYearFolderName("2025"), "A: further years");
  const lone = analyzeStructureContext(
    resultOf(dir("C:/bank", "bank", [dir("C:/bank/2020", "2020", [], { depth: 1 })])),
  );
  assert(lone.yearFolders.length === 1 && lone.yearFolders[0]?.year === 2020, "A: lone year folder listed");
  assert(lone.yearGroups.length === 0, "A: single year folder is not a group");

  const consecutive = analyzeStructureContext(
    resultOf(
      dir("C:/pdf", "pdf", [
        dir("C:/pdf/2020", "2020", [], { depth: 1 }),
        dir("C:/pdf/2021", "2021", [], { depth: 1 }),
      ]),
    ),
  );
  assert(consecutive.yearGroups.length === 1, "B: two years form a group");
  const consecutiveGroup = consecutive.yearGroups[0];
  assert(consecutiveGroup?.years.join(",") === "2020,2021", "B: years 2020,2021");
  assert(consecutiveGroup?.minYear === 2020 && consecutiveGroup.maxYear === 2021, "B: min/max");
  assert(consecutiveGroup?.missingYears.length === 0, "B: no missing years");
  assert(
    consecutiveGroup?.consecutiveRuns.length === 1 &&
      consecutiveGroup.consecutiveRuns[0]?.start === 2020 &&
      consecutiveGroup.consecutiveRuns[0]?.end === 2021,
    "B: one consecutive run 2020-2021",
  );

  const gapped = analyzeStructureContext(
    resultOf(
      dir("C:/pdf", "pdf", [
        dir("C:/pdf/2020", "2020", [], { depth: 1 }),
        dir("C:/pdf/2022", "2022", [], { depth: 1 }),
      ]),
    ),
  );
  assert(gapped.yearGroups[0]?.years.join(",") === "2020,2022", "C: years present");
  assert(gapped.yearGroups[0]?.missingYears.join(",") === "2021", "C: missing 2021");
  assert(gapped.yearGroups[0]?.consecutiveRuns.length === 0, "C: not a consecutive pair");

  const twoRuns = analyzeStructureContext(
    resultOf(
      dir("C:/pdf", "pdf", [
        dir("C:/pdf/2020", "2020", [], { depth: 1 }),
        dir("C:/pdf/2021", "2021", [], { depth: 1 }),
        dir("C:/pdf/2023", "2023", [], { depth: 1 }),
        dir("C:/pdf/2024", "2024", [], { depth: 1 }),
      ]),
    ),
  );
  const twoRunGroup = twoRuns.yearGroups[0];
  assert(twoRunGroup?.minYear === 2020 && twoRunGroup.maxYear === 2024, "D: range 2020-2024");
  assert(twoRunGroup?.missingYears.join(",") === "2022", "D: missing 2022");
  assert(twoRunGroup?.consecutiveRuns.length === 2, "D: two consecutive runs");
  assert(
    twoRunGroup?.consecutiveRuns[0]?.start === 2020 && twoRunGroup.consecutiveRuns[0]?.end === 2021,
    "D: first run 2020-2021",
  );
  assert(
    twoRunGroup?.consecutiveRuns[1]?.start === 2023 && twoRunGroup.consecutiveRuns[1]?.end === 2024,
    "D: second run 2023-2024",
  );

  const bounded = analyzeStructureContext(
    resultOf(
      dir("C:/jahre", "jahre", [
        dir("C:/jahre/1899", "1899", [], { depth: 1 }),
        dir("C:/jahre/1900", "1900", [], { depth: 1 }),
        dir("C:/jahre/2100", "2100", [], { depth: 1 }),
        dir("C:/jahre/2101", "2101", [], { depth: 1 }),
      ]),
    ),
  );
  assert(
    bounded.yearFolders.map((item) => item.year).join(",") === "1900,2100",
    "E: only 1900 and 2100 are year folders",
  );
  assert(bounded.yearGroups.length === 1, "E: 1900 and 2100 still form a group by parent");
  assert(bounded.yearGroups[0]?.years.join(",") === "1900,2100", "E: group years");
  assert(!isYearFolderName("1899") && !isYearFolderName("2101"), "E: bounds excluded");

  const notYears = ["2024 Rechnungen", "Rechnungen 2024", "2024-01", "20241", "24", "02024", "2024_alt"];
  for (const name of notYears) {
    assert(!isYearFolderName(name), `F: not a year folder: ${name}`);
  }
  const named = analyzeStructureContext(
    resultOf(
      dir("C:/docs", "docs", [
        dir("C:/docs/2024 Rechnungen", "2024 Rechnungen", [], { depth: 1 }),
        dir("C:/docs/Rechnungen 2024", "Rechnungen 2024", [], { depth: 1 }),
        dir("C:/docs/2024-01", "2024-01", [], { depth: 1 }),
        dir("C:/docs/20241", "20241", [], { depth: 1 }),
      ]),
    ),
  );
  assert(named.yearFolders.length === 0 && named.yearGroups.length === 0, "F: no year folders or groups");

  const splitParents = analyzeStructureContext(
    resultOf(
      dir("C:/bestand", "bestand", [
        dir(
          "C:/bestand/Gas",
          "Gas",
          [
            dir("C:/bestand/Gas/2022", "2022", [], { depth: 2 }),
            dir("C:/bestand/Gas/2023", "2023", [], { depth: 2 }),
            dir("C:/bestand/Gas/2024", "2024", [], { depth: 2 }),
          ],
          { depth: 1 },
        ),
        dir(
          "C:/bestand/Wasser",
          "Wasser",
          [
            dir("C:/bestand/Wasser/2023", "2023", [], { depth: 2 }),
            dir("C:/bestand/Wasser/2024", "2024", [], { depth: 2 }),
            dir("C:/bestand/Wasser/2025", "2025", [], { depth: 2 }),
          ],
          { depth: 1 },
        ),
      ]),
    ),
  );
  assert(splitParents.yearGroups.length === 2, "G: same year names form separate groups");
  assert(splitParents.yearGroups[0]?.parent.path === "C:/bestand/Gas", "G: Gas group first by path");
  assert(splitParents.yearGroups[1]?.parent.path === "C:/bestand/Wasser", "G: Wasser group second");
  assert(splitParents.yearGroups[0]?.years.join(",") === "2022,2023,2024", "G: Gas years");
  assert(splitParents.yearGroups[1]?.years.join(",") === "2023,2024,2025", "G: Wasser years");

  const nestedDepths = analyzeStructureContext(
    resultOf(
      dir("C:/bank", "bank", [
        dir(
          "C:/bank/Kontoauszuege",
          "Kontoauszuege",
          [
            dir(
              "C:/bank/Kontoauszuege/PDF",
              "PDF",
              [
                dir("C:/bank/Kontoauszuege/PDF/2020", "2020", [], { depth: 3 }),
                dir("C:/bank/Kontoauszuege/PDF/2021", "2021", [], { depth: 3 }),
                dir("C:/bank/Kontoauszuege/PDF/2022", "2022", [], { depth: 3 }),
              ],
              { depth: 2 },
            ),
          ],
          { depth: 1 },
        ),
        dir(
          "C:/bank/VersorgerA",
          "VersorgerA",
          [
            dir("C:/bank/VersorgerA/2023", "2023", [], { depth: 2 }),
            dir("C:/bank/VersorgerA/2024", "2024", [], { depth: 2 }),
            dir("C:/bank/VersorgerA/2025", "2025", [], { depth: 2 }),
          ],
          { depth: 1 },
        ),
        dir(
          "C:/bank/VersorgerB",
          "VersorgerB",
          [
            dir("C:/bank/VersorgerB/2023", "2023", [], { depth: 2 }),
            dir("C:/bank/VersorgerB/2025", "2025", [], { depth: 2 }),
          ],
          { depth: 1 },
        ),
      ]),
    ),
  );
  assert(nestedDepths.yearGroups.length === 3, "H: three independent groups at mixed depths");
  const pdfGroup = nestedDepths.yearGroups.find((item) => item.parent.name === "PDF");
  assert(pdfGroup?.years.join(",") === "2020,2021,2022", "H: PDF group 2020-2022");
  assert(pdfGroup?.parentRelativePath === "Kontoauszuege\\PDF", "H: relative parent path");
  assert(
    nestedDepths.yearGroups.find((item) => item.parent.name === "VersorgerB")?.missingYears.join(",") === "2024",
    "H: VersorgerB missing 2024",
  );

  const withFiles = analyzeStructureContext(
    resultOf(
      dir("C:/pdf", "pdf", [
        dir("C:/pdf/2020", "2020", [file("C:/pdf/2020/a.pdf", "a.pdf", { depth: 2, sizeBytes: 1 })], { depth: 1 }),
        dir("C:/pdf/2021", "2021", [file("C:/pdf/2021/b.pdf", "b.pdf", { depth: 2, sizeBytes: 2 })], { depth: 1 }),
      ]),
    ),
  );
  assert(withFiles.yearGroups.length === 1, "I: year folders with files still form a group");
  const year2020 = folderContextByPath(withFiles, "C:/pdf/2020");
  assert(year2020?.childFiles.length === 1 && year2020.childFiles[0]?.name === "a.pdf", "I: files remain in folder context");

  const emptyYear = analyzeStructureContext(
    resultOf(
      dir("C:/pdf", "pdf", [
        dir("C:/pdf/2020", "2020", [], { depth: 1 }),
        dir("C:/pdf/2021", "2021", [], { depth: 1 }),
      ]),
    ),
  );
  assert(emptyYear.yearFolders.every((item) => item.listing === "read"), "J: empty year folders still detected");
  assert(emptyYear.yearGroups.length === 1, "J: empty year folders still form a group");

  const depthLimited = analyzeStructureContext(
    resultOf(
      dir("C:/pdf", "pdf", [
        dir("C:/pdf/2020", "2020", [], { depth: 1, listing: "depthLimited" }),
        dir("C:/pdf/2021", "2021", [], { depth: 1 }),
      ]),
    ),
  );
  const limited = depthLimited.yearFolders.find((item) => item.year === 2020);
  assert(limited?.listing === "depthLimited", "K: depthLimited year folder is still a year folder");
  assert(depthLimited.yearGroups.length === 1, "K: depthLimited year folder may join a group");
  assert(
    folderContextByPath(depthLimited, "C:/pdf/2020")?.childDirectories.length === 0 &&
      folderContextByPath(depthLimited, "C:/pdf/2020")?.childFiles.length === 0,
    "K: no content inferred for depthLimited year folder",
  );

  const unsortedInput = analyzeStructureContext(
    resultOf(
      dir("C:/pdf", "pdf", [
        dir("C:/pdf/2022", "2022", [], { depth: 1 }),
        dir("C:/pdf/2020", "2020", [], { depth: 1 }),
        dir("C:/pdf/2021", "2021", [], { depth: 1 }),
      ]),
    ),
  );
  assert(unsortedInput.yearGroups[0]?.years.join(",") === "2020,2021,2022", "L: years sorted ascending");
  assert(
    unsortedInput.yearGroups[0]?.yearFolders.map((item) => item.folder.name).join(",") === "2020,2021,2022",
    "L: year folder refs sorted",
  );
  const unsortedAgain = analyzeStructureContext(
    resultOf(
      dir("C:/pdf", "pdf", [
        dir("C:/pdf/2022", "2022", [], { depth: 1 }),
        dir("C:/pdf/2020", "2020", [], { depth: 1 }),
        dir("C:/pdf/2021", "2021", [], { depth: 1 }),
      ]),
    ),
  );
  assert(serialized(unsortedInput) === serialized(unsortedAgain), "L: deterministic serialization");

  const repeated = dir("C:/bestand", "bestand", [
    dir("C:/bestand/A", "A", [dir("C:/bestand/A/2024", "2024", [], { depth: 2 })], { depth: 1 }),
    dir("C:/bestand/B", "B", [dir("C:/bestand/B/2024", "2024", [], { depth: 2 })], { depth: 1 }),
  ]);
  const inventory = analyzeInventory(resultOf(repeated));
  const structure = analyzeStructureContext(resultOf(repeated));
  assert(
    inventory.repeatedFolderNames.some((item) => item.name === "2024" && item.count === 2),
    "M: repeatedFolderNames still reports 2024 twice",
  );
  assert(structure.yearFolders.length === 2 && structure.yearGroups.length === 0, "M: two lone year folders, no groups");

  const mixedRoot = dir("C:/pdf", "pdf", [
    dir("C:/pdf/2020", "2020", [file("C:/pdf/2020/a.pdf", "a.pdf", { depth: 2, sizeBytes: 1 })], { depth: 1 }),
    dir("C:/pdf/2021", "2021", [], { depth: 1 }),
    dir("C:/pdf/sonst", "sonst", [file("C:/pdf/sonst/x.txt", "x.txt", { depth: 2, sizeBytes: 1 })], { depth: 1 }),
  ]);
  const mixedResult = resultOf(mixedRoot);
  const full = analyzeStructureContext(mixedResult);
  const filtered = buildDisplayFilterView(mixedRoot, { ...emptyDisplayFilterDraft(), extensions: [".pdf"] }, DEFAULT_TREE_SORT);
  assert(filtered.constrained, "N: display filter is constrained");
  assert(analyzeStructureContext(mixedResult).yearGroups.length === full.yearGroups.length, "N: ignores display filter");
  const collapsed = deriveVisibleRows(mixedRoot, new Set(["C:/pdf"]));
  assert(collapsed.length < 6, "N: collapsed view hides children");
  assert(analyzeStructureContext(mixedResult).yearFolders.length === full.yearFolders.length, "N: ignores expand state");

  const pdfContext = folderContextByPath(full, "C:/pdf");
  assert(pdfContext?.parent === null, "parent: root has no parent");
  assert(pdfContext?.siblingDirectories.length === 0, "siblings: root has none");
  assert(
    pdfContext?.childDirectories.map((item) => item.name).join(",") === "2020,2021,sonst",
    "children: direct directories",
  );
  const yearCtx = folderContextByPath(full, "C:/pdf/2020");
  assert(yearCtx?.parent?.name === "pdf", "parent: year folder parent is pdf");
  assert(yearCtx?.siblingDirectories.map((item) => item.name).join(",") === "2021,sonst", "siblings: other direct dirs");
  assert(yearCtx?.relativePath === "2020", "relative path for year folder");
  assert(pdfContext?.relativePath === "Startordner", "relative path for root");
  assert(yearCtx?.depth === 1, "depth from FsNode");

  const blob = serialized(full).toLocaleLowerCase();
  assert(!blob.includes("unvollstaendig") && !blob.includes("unvollständig"), "no incompleteness rating");
  assert(!blob.includes("chaotisch") && !blob.includes("soll"), "no SOLL or chaos rating");
  assert(!blob.includes("duplikat"), "no duplicate label");

  runRepeatedChildDirectoryStructureCheck();
  runFolderChainCheck();
}

function customerShape(parentPath: string, parentName: string, depth: number): DirectoryNode {
  return dir(
    parentPath,
    parentName,
    [
      dir(`${parentPath}/Angebote`, "Angebote", [], { depth: depth + 1 }),
      dir(`${parentPath}/Rechnungen`, "Rechnungen", [], { depth: depth + 1 }),
      dir(`${parentPath}/Schriftverkehr`, "Schriftverkehr", [], { depth: depth + 1 }),
    ],
    { depth },
  );
}

function runRepeatedChildDirectoryStructureCheck(): void {
  assert(MIN_CHILD_DIRECTORY_STRUCTURE_SIZE === 2, "structure minimum is 2 child directories");
  assert(MIN_REPEATED_STRUCTURE_PARENTS === 2, "structure group minimum is 2 parents");
  const identicalThree = analyzeStructureContext(
    resultOf(
      dir("C:/kunden", "kunden", [customerShape("C:/kunden/A", "A", 1), customerShape("C:/kunden/B", "B", 1)]),
    ),
  );
  assert(identicalThree.repeatedChildDirectoryStructures.length === 1, "A: one group for two identical parents");
  const groupA = identicalThree.repeatedChildDirectoryStructures[0];
  assert(groupA?.childDirectoryCount === 3, "A: three child directories");
  assert(groupA?.parentCount === 2, "A: two parents");
  assert(
    groupA?.childDirectoryNames.join(",") === "Angebote,Rechnungen,Schriftverkehr",
    "A: original child names",
  );
  assert(groupA?.parents.map((item) => item.folder.name).join(",") === "A,B", "A: parents A then B");

  const casing = analyzeStructureContext(
    resultOf(
      dir("C:/kunden", "kunden", [
        dir(
          "C:/kunden/A",
          "A",
          [
            dir("C:/kunden/A/Angebote", "Angebote", [], { depth: 2 }),
            dir("C:/kunden/A/Rechnungen", "Rechnungen", [], { depth: 2 }),
            dir("C:/kunden/A/Schriftverkehr", "Schriftverkehr", [], { depth: 2 }),
          ],
          { depth: 1 },
        ),
        dir(
          "C:/kunden/B",
          "B",
          [
            dir("C:/kunden/B/angebote", "angebote", [], { depth: 2 }),
            dir("C:/kunden/B/RECHNUNGEN", "RECHNUNGEN", [], { depth: 2 }),
            dir("C:/kunden/B/schriftverkehr", "schriftverkehr", [], { depth: 2 }),
          ],
          { depth: 1 },
        ),
      ]),
    ),
  );
  assert(casing.repeatedChildDirectoryStructures.length === 1, "B: case-insensitive same group");
  assert(casing.repeatedChildDirectoryStructures[0]?.parentCount === 2, "B: two parents");
  assert(
    casing.repeatedChildDirectoryStructures[0]?.signature ===
      identicalThree.repeatedChildDirectoryStructures[0]?.signature,
    "B: same signature as canonical names",
  );

  const loneParent = analyzeStructureContext(
    resultOf(dir("C:/kunden", "kunden", [customerShape("C:/kunden/A", "A", 1)])),
  );
  assert(loneParent.repeatedChildDirectoryStructures.length === 0, "C: single parent is not a group");

  const singleChild = analyzeStructureContext(
    resultOf(
      dir("C:/docs", "docs", [
        dir("C:/docs/A", "A", [dir("C:/docs/A/PDF", "PDF", [], { depth: 2 })], { depth: 1 }),
        dir("C:/docs/B", "B", [dir("C:/docs/B/PDF", "PDF", [], { depth: 2 })], { depth: 1 }),
      ]),
    ),
  );
  assert(singleChild.repeatedChildDirectoryStructures.length === 0, "D: one direct child is not a structure group");

  const twoVsThree = analyzeStructureContext(
    resultOf(
      dir("C:/kunden", "kunden", [
        customerShape("C:/kunden/A", "A", 1),
        dir(
          "C:/kunden/C",
          "C",
          [
            dir("C:/kunden/C/Angebote", "Angebote", [], { depth: 2 }),
            dir("C:/kunden/C/Rechnungen", "Rechnungen", [], { depth: 2 }),
          ],
          { depth: 1 },
        ),
      ]),
    ),
  );
  assert(twoVsThree.repeatedChildDirectoryStructures.length === 0, "E: 2 vs 3 children is not the same structure");

  const reordered = analyzeStructureContext(
    resultOf(
      dir("C:/kunden", "kunden", [
        dir(
          "C:/kunden/A",
          "A",
          [
            dir("C:/kunden/A/Schriftverkehr", "Schriftverkehr", [], { depth: 2 }),
            dir("C:/kunden/A/Angebote", "Angebote", [], { depth: 2 }),
            dir("C:/kunden/A/Rechnungen", "Rechnungen", [], { depth: 2 }),
          ],
          { depth: 1 },
        ),
        dir(
          "C:/kunden/B",
          "B",
          [
            dir("C:/kunden/B/Rechnungen", "Rechnungen", [], { depth: 2 }),
            dir("C:/kunden/B/Schriftverkehr", "Schriftverkehr", [], { depth: 2 }),
            dir("C:/kunden/B/Angebote", "Angebote", [], { depth: 2 }),
          ],
          { depth: 1 },
        ),
      ]),
    ),
  );
  assert(reordered.repeatedChildDirectoryStructures.length === 1, "F: order of children does not matter");
  assert(
    reordered.repeatedChildDirectoryStructures[0]?.childDirectoryNames.join(",") ===
      "Angebote,Rechnungen,Schriftverkehr",
    "F: display names sorted",
  );

  const independent = analyzeStructureContext(
    resultOf(
      dir("C:/bestand", "bestand", [
        customerShape("C:/bestand/A", "A", 1),
        customerShape("C:/bestand/B", "B", 1),
        dir(
          "C:/bestand/Gas",
          "Gas",
          [
            dir("C:/bestand/Gas/2023", "2023", [], { depth: 2 }),
            dir("C:/bestand/Gas/2024", "2024", [], { depth: 2 }),
            dir("C:/bestand/Gas/2025", "2025", [], { depth: 2 }),
          ],
          { depth: 1 },
        ),
        dir(
          "C:/bestand/Wasser",
          "Wasser",
          [
            dir("C:/bestand/Wasser/2023", "2023", [], { depth: 2 }),
            dir("C:/bestand/Wasser/2024", "2024", [], { depth: 2 }),
            dir("C:/bestand/Wasser/2025", "2025", [], { depth: 2 }),
          ],
          { depth: 1 },
        ),
      ]),
    ),
  );
  assert(independent.repeatedChildDirectoryStructures.length === 2, "G: two independent groups");
  const customerGroup = independent.repeatedChildDirectoryStructures.find((item) =>
    item.childDirectoryNames.includes("Angebote"),
  );
  const yearNameGroup = independent.repeatedChildDirectoryStructures.find((item) =>
    item.childDirectoryNames.includes("2023"),
  );
  assert(customerGroup?.parentCount === 2 && yearNameGroup?.parentCount === 2, "G: each group has two parents");
  assert(customerGroup?.parents.map((item) => item.folder.name).join(",") === "A,B", "G: customer parents A,B");
  assert(
    yearNameGroup?.parents.map((item) => item.folder.name).join(",") === "Gas,Wasser",
    "G: year-name parents Gas,Wasser",
  );

  const depthLimitedParent = analyzeStructureContext(
    resultOf(
      dir("C:/kunden", "kunden", [
        customerShape("C:/kunden/A", "A", 1),
        dir(
          "C:/kunden/B",
          "B",
          [
            dir("C:/kunden/B/Angebote", "Angebote", [], { depth: 2 }),
            dir("C:/kunden/B/Rechnungen", "Rechnungen", [], { depth: 2 }),
            dir("C:/kunden/B/Schriftverkehr", "Schriftverkehr", [], { depth: 2 }),
          ],
          { depth: 1, listing: "depthLimited" },
        ),
      ]),
    ),
  );
  assert(depthLimitedParent.repeatedChildDirectoryStructures.length === 0, "H: depthLimited parent is not grouped");

  const incompleteParent = analyzeStructureContext(
    resultOf(
      dir("C:/kunden", "kunden", [
        customerShape("C:/kunden/A", "A", 1),
        dir(
          "C:/kunden/B",
          "B",
          [
            dir("C:/kunden/B/Angebote", "Angebote", [], { depth: 2 }),
            dir("C:/kunden/B/Rechnungen", "Rechnungen", [], { depth: 2 }),
            dir("C:/kunden/B/Schriftverkehr", "Schriftverkehr", [], { depth: 2 }),
          ],
          { depth: 1, listing: "incomplete" },
        ),
      ]),
    ),
  );
  assert(incompleteParent.repeatedChildDirectoryStructures.length === 0, "I: incomplete parent is not grouped");

  const years = analyzeStructureContext(
    resultOf(
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
    ),
  );
  assert(years.yearGroups.length === 2, "J: year groups remain two parent groups");
  assert(years.yearGroups[0]?.years.join(",") === "2023,2024,2025", "J: Gas years unchanged");
  assert(years.yearGroups[1]?.years.join(",") === "2023,2024,2025", "J: Wasser years unchanged");
  assert(years.repeatedChildDirectoryStructures.length === 1, "J: same years also form a general structure group");
  assert(
    years.repeatedChildDirectoryStructures[0]?.childDirectoryNames.join(",") === "2023,2024,2025",
    "J: general structure names are the years",
  );

  const mixedDepth = analyzeStructureContext(
    resultOf(
      dir("C:/root", "root", [
        customerShape("C:/root/A", "A", 1),
        dir(
          "C:/root/tief",
          "tief",
          [customerShape("C:/root/tief/B", "B", 2)],
          { depth: 1 },
        ),
      ]),
    ),
  );
  assert(mixedDepth.repeatedChildDirectoryStructures.length === 1, "K: same structure at different depths");
  assert(
    mixedDepth.repeatedChildDirectoryStructures[0]?.parents.map((item) => item.depth).join(",") === "1,2",
    "K: depths 1 then 2 by relative path",
  );

  const orderFirst = analyzeStructureContext(
    resultOf(
      dir("C:/bestand", "bestand", [
        customerShape("C:/bestand/B", "B", 1),
        customerShape("C:/bestand/A", "A", 1),
        dir(
          "C:/bestand/X",
          "X",
          [dir("C:/bestand/X/Eins", "Eins", [], { depth: 2 }), dir("C:/bestand/X/Zwei", "Zwei", [], { depth: 2 })],
          { depth: 1 },
        ),
        dir(
          "C:/bestand/Y",
          "Y",
          [dir("C:/bestand/Y/Eins", "Eins", [], { depth: 2 }), dir("C:/bestand/Y/Zwei", "Zwei", [], { depth: 2 })],
          { depth: 1 },
        ),
      ]),
    ),
  );
  const orderSecond = analyzeStructureContext(
    resultOf(
      dir("C:/bestand", "bestand", [
        dir(
          "C:/bestand/Y",
          "Y",
          [dir("C:/bestand/Y/Zwei", "Zwei", [], { depth: 2 }), dir("C:/bestand/Y/Eins", "Eins", [], { depth: 2 })],
          { depth: 1 },
        ),
        customerShape("C:/bestand/A", "A", 1),
        dir(
          "C:/bestand/X",
          "X",
          [dir("C:/bestand/X/Zwei", "Zwei", [], { depth: 2 }), dir("C:/bestand/X/Eins", "Eins", [], { depth: 2 })],
          { depth: 1 },
        ),
        customerShape("C:/bestand/B", "B", 1),
      ]),
    ),
  );
  assert(serialized(orderFirst) === serialized(orderSecond), "L: deterministic regardless of input order");
  assert(
    orderFirst.repeatedChildDirectoryStructures[0]?.childDirectoryCount === 3,
    "L: larger structure first",
  );
  assert(
    orderFirst.repeatedChildDirectoryStructures[0]?.parents.map((item) => item.relativePath).join(",") === "A,B",
    "L: parents sorted by relative path",
  );
  assert(
    orderFirst.repeatedChildDirectoryStructures[1]?.childDirectoryNames.join(",") === "Eins,Zwei",
    "L: smaller structure second",
  );

  const filterRoot = dir("C:/kunden", "kunden", [
    customerShape("C:/kunden/A", "A", 1),
    customerShape("C:/kunden/B", "B", 1),
    dir("C:/kunden/sonst", "sonst", [file("C:/kunden/sonst/x.pdf", "x.pdf", { depth: 2 })], { depth: 1 }),
  ]);
  const filterResult = resultOf(filterRoot);
  const unfiltered = analyzeStructureContext(filterResult);
  const filteredView = buildDisplayFilterView(
    filterRoot,
    { ...emptyDisplayFilterDraft(), extensions: [".pdf"] },
    DEFAULT_TREE_SORT,
  );
  assert(filteredView.constrained, "M: display filter is constrained");
  assert(
    analyzeStructureContext(filterResult).repeatedChildDirectoryStructures.length ===
      unfiltered.repeatedChildDirectoryStructures.length,
    "M: ignores display filter",
  );
  const collapsedRows = deriveVisibleRows(filterRoot, new Set(["C:/kunden"]));
  assert(collapsedRows.length < 10, "M: collapsed view hides children");
  assert(
    analyzeStructureContext(filterResult).repeatedChildDirectoryStructures[0]?.parentCount === 2,
    "M: ignores expand state",
  );

  const structureBlob = serialized(unfiltered).toLocaleLowerCase();
  assert(!structureBlob.includes("redundant"), "no redundancy rating");
  assert(!structureBlob.includes("zusammenführen") && !structureBlob.includes("loeschen"), "no action rating");
}

function linearNamed(
  parts: readonly { name: string; extras?: Partial<DirectoryNode>; extraChildren?: FsNode[] }[],
  base: string,
  depth: number,
): DirectoryNode {
  const head = parts[0];
  if (head === undefined) {
    throw new Error("linearNamed requires at least one folder");
  }
  const path = `${base}/${head.name}`;
  const rest = parts.slice(1);
  const children: FsNode[] = [...(head.extraChildren ?? [])];
  if (rest.length > 0) {
    children.unshift(linearNamed(rest, path, depth + 1));
  }
  return dir(path, head.name, children, { depth, ...head.extras });
}

function withOtherChild(rootPath: string, rootName: string, primary: DirectoryNode): DirectoryNode {
  return dir(rootPath, rootName, [
    primary,
    dir(`${rootPath}/sonst`, "sonst", [], { depth: 1 }),
  ]);
}

function chainNames(context: InventoryStructureContext, index = 0): string {
  return context.folderChains[index]?.folders.map((item) => item.name).join(">") ?? "";
}

function runFolderChainCheck(): void {
  assert(MIN_FOLDER_CHAIN_LENGTH === 3, "chain minimum is 3 folders");

  const three = analyzeStructureContext(
    resultOf(
      withOtherChild(
        "C:/bestand",
        "bestand",
        linearNamed(
          [
            { name: "A" },
            { name: "B" },
            { name: "C", extraChildren: [file("C:/bestand/A/B/C/x.pdf", "x.pdf", { depth: 3 })] },
          ],
          "C:/bestand",
          1,
        ),
      ),
    ),
  );
  assert(three.folderChains.length === 1, "A: one chain");
  assert(three.folderChains[0]?.folderCount === 3, "A: three folders");
  assert(chainNames(three) === "A>B>C", "A: A>B>C");
  assert(three.folderChains[0]?.start.name === "A" && three.folderChains[0]?.end.name === "C", "A: start A end C");
  assert(three.folderChains[0]?.endDirectFileCount === 1, "A: end has one direct file");
  assert(three.folderChains[0]?.endDirectDirectoryCount === 0, "A: end has no direct directories");
  assert(three.folderChains[0]?.endListing === "read", "A: end listing read");

  const two = analyzeStructureContext(
    resultOf(
      withOtherChild("C:/bestand", "bestand", linearNamed([{ name: "A" }, { name: "B" }], "C:/bestand", 1)),
    ),
  );
  assert(two.folderChains.length === 0, "B: two folders are not a chain");

  const four = analyzeStructureContext(
    resultOf(
      withOtherChild(
        "C:/bestand",
        "bestand",
        linearNamed([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }], "C:/bestand", 1),
      ),
    ),
  );
  assert(four.folderChains.length === 1, "C: exactly one maximal chain");
  assert(four.folderChains[0]?.folderCount === 4, "C: four folders");
  assert(chainNames(four) === "A>B>C>D", "C: A>B>C>D");
  assert(
    four.folderChains.every((item) => item.folders.map((folder) => folder.name).join(">") !== "B>C>D"),
    "C: no subchain",
  );

  const fileStopsShort = analyzeStructureContext(
    resultOf(
      withOtherChild(
        "C:/bestand",
        "bestand",
        linearNamed(
          [
            { name: "A" },
            {
              name: "B",
              extraChildren: [file("C:/bestand/A/B/n.pdf", "n.pdf", { depth: 2 })],
            },
            { name: "C" },
          ],
          "C:/bestand",
          1,
        ),
      ),
    ),
  );
  assert(fileStopsShort.folderChains.length === 0, "D: file in B stops before min length");

  const fileEndsChain = analyzeStructureContext(
    resultOf(
      withOtherChild(
        "C:/bestand",
        "bestand",
        linearNamed(
          [
            { name: "W" },
            { name: "A" },
            { name: "B", extraChildren: [file("C:/bestand/W/A/B/n.pdf", "n.pdf", { depth: 3 })] },
          ],
          "C:/bestand",
          1,
        ),
      ),
    ),
  );
  assert(fileEndsChain.folderChains.length === 1, "D: longer chain still reported");
  assert(chainNames(fileEndsChain) === "W>A>B", "D: ends at B with file");
  assert(fileEndsChain.folderChains[0]?.endDirectFileCount === 1, "D: end file count");

  const twoDirsShort = analyzeStructureContext(
    resultOf(
      withOtherChild(
        "C:/bestand",
        "bestand",
        dir(
          "C:/bestand/A",
          "A",
          [
            dir(
              "C:/bestand/A/B",
              "B",
              [
                dir("C:/bestand/A/B/Eins", "Eins", [], { depth: 3 }),
                dir("C:/bestand/A/B/Zwei", "Zwei", [], { depth: 3 }),
              ],
              { depth: 2 },
            ),
          ],
          { depth: 1 },
        ),
      ),
    ),
  );
  assert(twoDirsShort.folderChains.length === 0, "E: two children stop before min length");

  const twoDirsEnd = analyzeStructureContext(
    resultOf(
      withOtherChild(
        "C:/bestand",
        "bestand",
        dir(
          "C:/bestand/W",
          "W",
          [
            dir(
              "C:/bestand/W/A",
              "A",
              [
                dir(
                  "C:/bestand/W/A/B",
                  "B",
                  [
                    dir("C:/bestand/W/A/B/Eins", "Eins", [], { depth: 4 }),
                    dir("C:/bestand/W/A/B/Zwei", "Zwei", [], { depth: 4 }),
                  ],
                  { depth: 3 },
                ),
              ],
              { depth: 2 },
            ),
          ],
          { depth: 1 },
        ),
      ),
    ),
  );
  assert(twoDirsEnd.folderChains.length === 1, "E: chain ends at folder with two children");
  assert(chainNames(twoDirsEnd) === "W>A>B", "E: W>A>B");
  assert(twoDirsEnd.folderChains[0]?.endDirectDirectoryCount === 2, "E: end directory count");

  const depthLimitedEnd = analyzeStructureContext(
    resultOf(
      withOtherChild(
        "C:/bestand",
        "bestand",
        linearNamed(
          [
            { name: "W" },
            { name: "A" },
            { name: "B", extras: { listing: "depthLimited" } },
            { name: "C" },
          ],
          "C:/bestand",
          1,
        ),
      ),
    ),
  );
  assert(depthLimitedEnd.folderChains.length === 1, "F: depthLimited may be the end");
  assert(chainNames(depthLimitedEnd) === "W>A>B", "F: does not continue past depthLimited");
  assert(depthLimitedEnd.folderChains[0]?.endListing === "depthLimited", "F: end listing preserved");
  assert(depthLimitedEnd.folderChains[0]?.endDirectDirectoryCount === 1, "F: visible child is not a continuation");

  const incompleteEnd = analyzeStructureContext(
    resultOf(
      withOtherChild(
        "C:/bestand",
        "bestand",
        linearNamed(
          [
            { name: "W" },
            { name: "A" },
            { name: "B", extras: { listing: "incomplete" } },
            { name: "C" },
          ],
          "C:/bestand",
          1,
        ),
      ),
    ),
  );
  assert(incompleteEnd.folderChains.length === 1, "G: incomplete may be the end");
  assert(chainNames(incompleteEnd) === "W>A>B", "G: does not continue past incomplete");
  assert(incompleteEnd.folderChains[0]?.endListing === "incomplete", "G: end listing preserved");

  const independent = analyzeStructureContext(
    resultOf(
      dir("C:/bestand", "bestand", [
        linearNamed([{ name: "A" }, { name: "B" }, { name: "C" }], "C:/bestand", 1),
        linearNamed([{ name: "X" }, { name: "Y" }, { name: "Z" }], "C:/bestand", 1),
      ]),
    ),
  );
  assert(independent.folderChains.length === 2, "H: two independent chains");
  assert(chainNames(independent, 0) === "A>B>C", "H: A chain first by path");
  assert(chainNames(independent, 1) === "X>Y>Z", "H: X chain second");

  const fromRoot = analyzeStructureContext(
    resultOf(dir("C:/root", "root", [linearNamed([{ name: "A" }, { name: "B" }], "C:/root", 1)])),
  );
  assert(fromRoot.folderChains.length === 1, "I: chain from root");
  assert(chainNames(fromRoot) === "root>A>B", "I: includes Startordner node");
  assert(fromRoot.folderChains[0]?.startRelativePath === "Startordner", "I: root display path");
  assert(fromRoot.folderChains[0]?.startDepth === 0, "I: root depth 0");

  const mixedDepth = analyzeStructureContext(
    resultOf(
      dir("C:/root", "root", [
        linearNamed([{ name: "A" }, { name: "B" }, { name: "C" }], "C:/root", 1),
        dir(
          "C:/root/tief",
          "tief",
          [
            linearNamed([{ name: "P" }, { name: "Q" }, { name: "R" }], "C:/root/tief", 2),
            dir("C:/root/tief/andere", "andere", [], { depth: 2 }),
          ],
          { depth: 1 },
        ),
      ]),
    ),
  );
  assert(mixedDepth.folderChains.length === 2, "J: chains at mixed depths");
  assert(mixedDepth.folderChains.some((item) => item.startDepth === 1), "J: depth 1 start");
  assert(mixedDepth.folderChains.some((item) => item.startDepth === 2), "J: depth 2 start");

  const ordered = analyzeStructureContext(
    resultOf(
      dir("C:/bestand", "bestand", [
        linearNamed([{ name: "KurzZ" }, { name: "Z2" }, { name: "Z3" }], "C:/bestand", 1),
        linearNamed([{ name: "Lang" }, { name: "L2" }, { name: "L3" }, { name: "L4" }], "C:/bestand", 1),
        linearNamed([{ name: "KurzA" }, { name: "A2" }, { name: "A3" }], "C:/bestand", 1),
      ]),
    ),
  );
  const orderedAgain = analyzeStructureContext(
    resultOf(
      dir("C:/bestand", "bestand", [
        linearNamed([{ name: "Lang" }, { name: "L2" }, { name: "L3" }, { name: "L4" }], "C:/bestand", 1),
        linearNamed([{ name: "KurzA" }, { name: "A2" }, { name: "A3" }], "C:/bestand", 1),
        linearNamed([{ name: "KurzZ" }, { name: "Z2" }, { name: "Z3" }], "C:/bestand", 1),
      ]),
    ),
  );
  assert(ordered.folderChains.map((item) => item.start.name).join(",") === "Lang,KurzA,KurzZ", "K: longer first then path");
  assert(ordered.folderChains[0]?.folderCount === 4, "K: longest first");
  assert(serialized(ordered) === serialized(orderedAgain), "K: deterministic regardless of input order");

  const filterRoot = dir("C:/bestand", "bestand", [
    linearNamed(
      [
        { name: "A" },
        { name: "B" },
        { name: "C", extraChildren: [file("C:/bestand/A/B/C/x.pdf", "x.pdf", { depth: 3 })] },
      ],
      "C:/bestand",
      1,
    ),
    dir("C:/bestand/sonst", "sonst", [file("C:/bestand/sonst/x.pdf", "x.pdf", { depth: 2 })], { depth: 1 }),
  ]);
  const filterResult = resultOf(filterRoot);
  const unfiltered = analyzeStructureContext(filterResult);
  const filteredView = buildDisplayFilterView(
    filterRoot,
    { ...emptyDisplayFilterDraft(), extensions: [".pdf"] },
    DEFAULT_TREE_SORT,
  );
  assert(filteredView.constrained, "L: display filter is constrained");
  assert(
    analyzeStructureContext(filterResult).folderChains.length === unfiltered.folderChains.length,
    "L: ignores display filter",
  );
  const collapsedRows = deriveVisibleRows(filterRoot, new Set(["C:/bestand"]));
  assert(collapsedRows.length < 8, "L: collapsed view hides children");
  assert(analyzeStructureContext(filterResult).folderChains[0]?.folderCount === 3, "L: ignores expand state");

  const years = analyzeStructureContext(
    resultOf(
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
    ),
  );
  assert(years.yearGroups.length === 2, "M: year groups remain two parent groups");
  assert(years.yearGroups[0]?.years.join(",") === "2023,2024,2025", "M: Gas years unchanged");
  assert(years.folderChains.length === 0, "M: year siblings are not a chain");

  const repeated = analyzeStructureContext(
    resultOf(dir("C:/kunden", "kunden", [customerShape("C:/kunden/A", "A", 1), customerShape("C:/kunden/B", "B", 1)])),
  );
  assert(repeated.repeatedChildDirectoryStructures.length === 1, "N: Häppchen 1 group remains");
  assert(repeated.repeatedChildDirectoryStructures[0]?.parentCount === 2, "N: two parents remain");
  assert(repeated.folderChains.length === 0, "N: customer siblings are not a chain");

  const chainBlob = serialized(three).toLocaleLowerCase();
  assert(!chainBlob.includes("unnötig") && !chainBlob.includes("unnoetig"), "O: no depth rating");
  assert(!chainBlob.includes("überflüssig") && !chainBlob.includes("ueberfluessig"), "O: no surplus rating");
  assert(!chainBlob.includes("zusammenlegen") && !chainBlob.includes("vereinfachen"), "O: no merge rating");
  assert(!chainBlob.includes("verschieben") && !chainBlob.includes("löschen") && !chainBlob.includes("loeschen"), "O: no action rating");
}
