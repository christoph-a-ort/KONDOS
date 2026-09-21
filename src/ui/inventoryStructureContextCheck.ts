import { type DirectoryNode, type FileNode, type FsNode, type ScanResult } from "../model";
import { buildDisplayFilterView, emptyDisplayFilterDraft } from "./displayFilter";
import { analyzeInventory } from "./inventoryAnalysis";
import { deriveVisibleRows } from "./treeRows";
import { DEFAULT_TREE_SORT } from "./treeSort";
import {
  MIN_YEAR_GROUP_SIZE,
  YEAR_FOLDER_MAX,
  YEAR_FOLDER_MIN,
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
}
