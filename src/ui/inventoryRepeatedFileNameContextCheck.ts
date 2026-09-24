import { type DirectoryNode, type FileNode, type FsNode, type ScanResult } from "../model";
import { analyzeInventory, type InventoryAnalysis } from "./inventoryAnalysis";
import {
  analyzeFileStructureContext,
  type InventoryFileStructureContext,
} from "./inventoryFileStructureContext";
import {
  analyzeRepeatedFileNameContext,
  type RepeatedFileNameContextGroup,
} from "./inventoryRepeatedFileNameContext";
import { analyzeStructureContext } from "./inventoryStructureContext";

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
  files: InventoryFileStructureContext;
  groups: RepeatedFileNameContextGroup[];
} {
  const scan = resultOf(root);
  const analysis = analyzeInventory(scan);
  const structure = analyzeStructureContext(scan);
  const files = analyzeFileStructureContext(scan, structure);
  return {
    analysis,
    files,
    groups: analyzeRepeatedFileNameContext(analysis, files),
  };
}

function groupNamed(
  groups: readonly RepeatedFileNameContextGroup[],
  name: string,
): RepeatedFileNameContextGroup {
  const group = groups.find((item) => item.name === name);
  assert(group !== undefined, `missing repeated file name group ${name}`);
  return group;
}

function occurrenceAt(
  group: RepeatedFileNameContextGroup,
  path: string,
) {
  const item = group.occurrences.find((entry) => entry.path === path);
  assert(item !== undefined, `missing occurrence ${path}`);
  return item;
}

export function runInventoryRepeatedFileNameContextCheck(): void {
  const normal = derived(
    dir("C:/docs", "docs", [
      dir("C:/docs/Bank", "Bank", [file("C:/docs/Bank/Info.pdf", "Info.pdf", { depth: 2, sizeBytes: 10 })], { depth: 1 }),
      dir(
        "C:/docs/Versicherung",
        "Versicherung",
        [file("C:/docs/Versicherung/Info.pdf", "Info.pdf", { depth: 2, sizeBytes: 20 })],
        { depth: 1 },
      ),
    ]),
  );
  const info = groupNamed(normal.groups, "Info.pdf");
  assert(info.count === 2 && info.occurrences.length === 2, "A: normal repeated file name");
  assert(info.occurrences.every((item) => item.joinFound && item.fileContext !== null), "A: both joined");
  const bankInfo = occurrenceAt(info, "C:/docs/Bank/Info.pdf");
  const versInfo = occurrenceAt(info, "C:/docs/Versicherung/Info.pdf");
  assert(bankInfo.fileContext?.parent?.name === "Bank", "B: Bank parent");
  assert(versInfo.fileContext?.parent?.name === "Versicherung", "B: Versicherung parent");
  assert(bankInfo.fileContext?.relativePath === "Bank\\Info.pdf", "F: relative Bank");
  assert(versInfo.fileContext?.relativePath === "Versicherung\\Info.pdf", "F: relative Versicherung");
  assert(bankInfo.fileContext?.parentRelativePath !== versInfo.fileContext?.parentRelativePath, "G: different parents");
  assert(bankInfo.fileContext?.extensionKey === ".pdf", "H: extension from FileStructureContext");
  assert(bankInfo.fileContext?.sizeBytes === 10 && versInfo.fileContext?.sizeBytes === 20, "I: sizes accessible, not compared");
  assert(normal.analysis.repeatedFileNames.length === normal.groups.length, "R: P1-H group count unchanged");
  assert(
    normal.analysis.repeatedFileNames.every(
      (item) =>
        normal.groups.find((group) => group.name === item.name)?.count === item.count &&
        normal.groups.find((group) => group.name === item.name)?.occurrences.length === item.paths.length,
    ),
    "Q: P1-H count and paths preserved",
  );

  const years = derived(
    dir("C:/v", "v", [
      dir(
        "C:/v/Festnetz",
        "Festnetz",
        [
          dir(
            "C:/v/Festnetz/2023",
            "2023",
            [
              file("C:/v/Festnetz/2023/Info.pdf", "Info.pdf", {
                depth: 3,
                sizeBytes: 5,
                createdAtMs: 100,
                modifiedAtMs: 200,
              }),
            ],
            { depth: 2 },
          ),
          dir(
            "C:/v/Festnetz/2024",
            "2024",
            [
              file("C:/v/Festnetz/2024/Info.pdf", "Info.pdf", {
                depth: 3,
                sizeBytes: 6,
                createdAtMs: 300,
                modifiedAtMs: 400,
              }),
            ],
            { depth: 2 },
          ),
        ],
        { depth: 1 },
      ),
    ]),
  );
  const yearInfo = groupNamed(years.groups, "Info.pdf");
  assert(yearInfo.count === 2 && yearInfo.occurrences.length === 2, "C: repeated name in two year folders");
  assert(
    yearInfo.occurrences.every(
      (item) =>
        item.joinFound &&
        item.fileContext?.parentIsYearFolderName === true &&
        item.fileContext.yearGroup !== null,
    ),
    "D: yearGroup context for both occurrences",
  );
  assert(yearInfo.occurrences[0]?.fileContext?.parent?.name === "2023", "C: first parent 2023");
  assert(yearInfo.occurrences[1]?.fileContext?.parent?.name === "2024", "C: second parent 2024");
  assert(
    yearInfo.occurrences.every((item) => item.fileContext?.yearGroup?.parent.name === "Festnetz"),
    "D: shared yearGroup parent Festnetz",
  );
  assert(
    yearInfo.occurrences.every(
      (item) => item.fileContext?.createdAtMs !== null && item.fileContext?.modifiedAtMs !== null,
    ),
    "J: timestamps accessible via FileStructureContext",
  );

  const mixed = derived(
    dir("C:/docs", "docs", [
      dir("C:/docs/Bank", "Bank", [file("C:/docs/Bank/Info.pdf", "Info.pdf", { depth: 2 })], { depth: 1 }),
      dir(
        "C:/docs/Festnetz",
        "Festnetz",
        [
          dir("C:/docs/Festnetz/2022", "2022", [], { depth: 2 }),
          dir(
            "C:/docs/Festnetz/2023",
            "2023",
            [file("C:/docs/Festnetz/2023/Info.pdf", "Info.pdf", { depth: 3 })],
            { depth: 2 },
          ),
          dir("C:/docs/Festnetz/2024", "2024", [], { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  const mixedInfo = groupNamed(mixed.groups, "Info.pdf");
  assert(mixed.groups.filter((item) => item.name === "Info.pdf").length === 1, "E: one P1-H group");
  assert(mixedInfo.count === 2 && mixedInfo.occurrences.length === 2, "E: two occurrences");
  const mixedBank = occurrenceAt(mixedInfo, "C:/docs/Bank/Info.pdf");
  const mixedYear = occurrenceAt(mixedInfo, "C:/docs/Festnetz/2023/Info.pdf");
  assert(mixedBank.fileContext?.yearGroup === null && mixedBank.fileContext?.parent?.name === "Bank", "E: normal parent");
  assert(
    mixedYear.fileContext?.yearGroup !== null && mixedYear.fileContext?.parent?.name === "2023",
    "E: yearGroup parent",
  );

  const siblings = derived(
    dir("C:/docs", "docs", [
      dir(
        "C:/docs/A",
        "A",
        [
          file("C:/docs/A/Info.pdf", "Info.pdf", { depth: 2 }),
          file("C:/docs/A/Neben.txt", "Neben.txt", { depth: 2 }),
          dir("C:/docs/A/Unter", "Unter", [], { depth: 2 }),
        ],
        { depth: 1 },
      ),
      dir(
        "C:/docs/B",
        "B",
        [file("C:/docs/B/Info.pdf", "Info.pdf", { depth: 2 })],
        { depth: 1 },
      ),
    ]),
  );
  const sibInfo = groupNamed(siblings.groups, "Info.pdf");
  assert(occurrenceAt(sibInfo, "C:/docs/A/Info.pdf").fileContext?.siblingFileCount === 1, "K: siblings in A");
  assert(occurrenceAt(sibInfo, "C:/docs/B/Info.pdf").fileContext?.siblingFileCount === 0, "K: no siblings in B");
  assert(occurrenceAt(sibInfo, "C:/docs/A/Info.pdf").fileContext?.childDirectoryCount === 1, "L: child dirs in A");
  assert(occurrenceAt(sibInfo, "C:/docs/B/Info.pdf").fileContext?.childDirectoryCount === 0, "L: no child dirs in B");

  const structureParents = derived(
    dir("C:/kunden", "kunden", [
      dir(
        "C:/kunden/A",
        "A",
        [
          file("C:/kunden/A/notiz.txt", "notiz.txt", { depth: 2 }),
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
          file("C:/kunden/B/notiz.txt", "notiz.txt", { depth: 2 }),
          dir("C:/kunden/B/Angebote", "Angebote", [], { depth: 2 }),
          dir("C:/kunden/B/Rechnungen", "Rechnungen", [], { depth: 2 }),
          dir("C:/kunden/B/Schriftverkehr", "Schriftverkehr", [], { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  const notes = groupNamed(structureParents.groups, "notiz.txt");
  assert(
    notes.occurrences.every((item) => item.fileContext?.parentInRepeatedChildDirectoryStructure === true),
    "M: parent P1-J structure context",
  );

  const underStructureChild = derived(
    dir("C:/kunden", "kunden", [
      dir(
        "C:/kunden/A",
        "A",
        [
          dir(
            "C:/kunden/A/Angebote",
            "Angebote",
            [file("C:/kunden/A/Angebote/a.pdf", "a.pdf", { depth: 3 })],
            { depth: 2 },
          ),
          dir("C:/kunden/A/Rechnungen", "Rechnungen", [], { depth: 2 }),
          dir("C:/kunden/A/Schriftverkehr", "Schriftverkehr", [], { depth: 2 }),
        ],
        { depth: 1 },
      ),
      dir(
        "C:/kunden/B",
        "B",
        [
          dir(
            "C:/kunden/B/Angebote",
            "Angebote",
            [file("C:/kunden/B/Angebote/a.pdf", "a.pdf", { depth: 3 })],
            { depth: 2 },
          ),
          dir("C:/kunden/B/Rechnungen", "Rechnungen", [], { depth: 2 }),
          dir("C:/kunden/B/Schriftverkehr", "Schriftverkehr", [], { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  const aPdfs = groupNamed(underStructureChild.groups, "a.pdf");
  assert(
    aPdfs.occurrences.every((item) => item.fileContext?.grandparentInRepeatedChildDirectoryStructure === true),
    "M: grandparent P1-J structure context",
  );

  const chain = derived(
    dir("C:/root", "root", [
      dir(
        "C:/root/A",
        "A",
        [
          dir(
            "C:/root/A/B",
            "B",
            [
              dir(
                "C:/root/A/B/C",
                "C",
                [file("C:/root/A/B/C/end.pdf", "end.pdf", { depth: 4 })],
                { depth: 3 },
              ),
            ],
            { depth: 2 },
          ),
        ],
        { depth: 1 },
      ),
      dir(
        "C:/root/X",
        "X",
        [
          dir(
            "C:/root/X/Y",
            "Y",
            [
              dir(
                "C:/root/X/Y/Z",
                "Z",
                [file("C:/root/X/Y/Z/end.pdf", "end.pdf", { depth: 4 })],
                { depth: 3 },
              ),
            ],
            { depth: 2 },
          ),
        ],
        { depth: 1 },
      ),
    ]),
  );
  const ends = groupNamed(chain.groups, "end.pdf");
  assert(
    ends.occurrences.every(
      (item) =>
        item.fileContext?.parentInFolderChain === true && item.fileContext.parentIsFolderChainEnd === true,
    ),
    "N: folderChain context per occurrence",
  );

  const missingBase = derived(
    dir("C:/docs", "docs", [
      dir("C:/docs/Bank", "Bank", [file("C:/docs/Bank/Info.pdf", "Info.pdf", { depth: 2 })], { depth: 1 }),
      dir(
        "C:/docs/Versicherung",
        "Versicherung",
        [file("C:/docs/Versicherung/Info.pdf", "Info.pdf", { depth: 2 })],
        { depth: 1 },
      ),
    ]),
  );
  const patchedAnalysis: InventoryAnalysis = {
    ...missingBase.analysis,
    repeatedFileNames: missingBase.analysis.repeatedFileNames.map((item) =>
      item.name === "Info.pdf"
        ? { ...item, count: 3, paths: [...item.paths, "C:/missing/Info.pdf"] }
        : item,
    ),
  };
  const withMissing = analyzeRepeatedFileNameContext(patchedAnalysis, missingBase.files);
  const missingInfo = groupNamed(withMissing, "Info.pdf");
  const missing = occurrenceAt(missingInfo, "C:/missing/Info.pdf");
  assert(missing.joinFound === false, "O: missing join is marked");
  assert(missing.fileContext === null, "O: no invented fileContext");
  assert(missingInfo.occurrences.length === 3, "P: missing join stays as occurrence");
  assert(missingInfo.count === 3, "Q: P1-H count unchanged after patch");
  assert(missingInfo.occurrences.filter((item) => item.joinFound).length === 2, "P: real joins remain");

  assert(
    missingBase.analysis.repeatedFileNames.length ===
      analyzeRepeatedFileNameContext(missingBase.analysis, missingBase.files).length,
    "R: group count follows P1-H only",
  );

  const ordered = derived(
    dir("C:/docs", "docs", [
      dir("C:/docs/Zed", "Zed", [file("C:/docs/Zed/Info.pdf", "Info.pdf", { depth: 2 })], { depth: 1 }),
      dir("C:/docs/Abel", "Abel", [file("C:/docs/Abel/Info.pdf", "Info.pdf", { depth: 2 })], { depth: 1 }),
    ]),
  );
  const orderedInfo = groupNamed(ordered.groups, "Info.pdf");
  assert(
    orderedInfo.occurrences.map((item) => item.fileContext?.relativePath).join(",") ===
      "Abel\\Info.pdf,Zed\\Info.pdf",
    "T: occurrences sorted by relative path",
  );
  const orderedAgain = derived(
    dir("C:/docs", "docs", [
      dir("C:/docs/Abel", "Abel", [file("C:/docs/Abel/Info.pdf", "Info.pdf", { depth: 2 })], { depth: 1 }),
      dir("C:/docs/Zed", "Zed", [file("C:/docs/Zed/Info.pdf", "Info.pdf", { depth: 2 })], { depth: 1 }),
    ]),
  );
  assert(JSON.stringify(ordered.groups) === JSON.stringify(orderedAgain.groups), "T: deterministic serialization");

  const groupOrderSource = derived(
    dir("C:/docs", "docs", [
      dir(
        "C:/docs/A",
        "A",
        [
          file("C:/docs/A/Alpha.pdf", "Alpha.pdf", { depth: 2 }),
          file("C:/docs/A/Beta.pdf", "Beta.pdf", { depth: 2 }),
        ],
        { depth: 1 },
      ),
      dir(
        "C:/docs/B",
        "B",
        [
          file("C:/docs/B/Alpha.pdf", "Alpha.pdf", { depth: 2 }),
          file("C:/docs/B/Beta.pdf", "Beta.pdf", { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  assert(
    groupOrderSource.groups.map((item) => item.name).join(",") ===
      groupOrderSource.analysis.repeatedFileNames.map((item) => item.name).join(","),
    "S: group order follows P1-H; no parallel repeated-file detection",
  );

  const blob = JSON.stringify(normal.groups).toLocaleLowerCase();
  assert(!blob.includes("duplikat") && !blob.includes("redundant"), "U: no duplicate rating");
  assert(!blob.includes("samecontent") && !blob.includes("identicalcontent"), "U: no content identity claim");
  assert(
    !blob.includes("unnötig") &&
      !blob.includes("ueberfluessig") &&
      !blob.includes("löschen") &&
      !blob.includes("loeschen") &&
      !blob.includes("verschieben"),
    "V: no action rating",
  );

  assert(typeof analyzeFileStructureContext === "function", "W: P1-L Häppchen 1 API still present");
  assert(
    !JSON.stringify(Object.keys(normal.files)).includes("repeatedFileNames"),
    "W: FileStructureContext remains separate from repeated-file groups",
  );
}
