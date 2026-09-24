import { type DirectoryNode, type FileNode, type FsNode, type ScanResult } from "../model";
import { NO_EXTENSION_KEY } from "./displayFilter";
import {
  analyzeFileStructureContext,
  fileContextByPath,
  type InventoryFileStructureContext,
} from "./inventoryFileStructureContext";
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
  structure: InventoryStructureContext;
  files: InventoryFileStructureContext;
} {
  const scan = resultOf(root);
  const structure = analyzeStructureContext(scan);
  return {
    structure,
    files: analyzeFileStructureContext(scan, structure),
  };
}

function countFiles(root: DirectoryNode): number {
  let count = 0;
  function visit(node: FsNode): void {
    if (node.kind === "file") {
      count += 1;
      return;
    }
    for (const child of node.children) {
      visit(child);
    }
  }
  visit(root);
  return count;
}

export function runInventoryFileStructureContextCheck(): void {
  const bankRoot = dir("C:/docs", "docs", [
    dir(
      "C:/docs/Bank",
      "Bank",
      [
        file("C:/docs/Bank/Vertrag.pdf", "Vertrag.pdf", { depth: 2, sizeBytes: 100 }),
        file("C:/docs/Bank/Info.docx", "Info.docx", { depth: 2, sizeBytes: 40 }),
      ],
      { depth: 1 },
    ),
  ]);
  const bank = derived(bankRoot);
  assert(bank.files.files.length === countFiles(bankRoot), "count: one entry per ScanResult file");
  const vertrag = fileContextByPath(bank.files, "C:/docs/Bank/Vertrag.pdf");
  assert(vertrag?.joinFound === true, "A: join found");
  assert(vertrag.parent?.name === "Bank", "A: parent Bank");
  assert(vertrag.parentRelativePath === "Bank", "A: parent relative path");
  assert(vertrag.relativePath === "Bank\\Vertrag.pdf", "A: relative file path");
  assert(vertrag.parentIsYearFolderName === false && vertrag.yearGroup === null, "A: no year context");
  assert(vertrag.siblingFileCount === 1 && vertrag.siblingFileNames.join(",") === "Info.docx", "A/K: sibling Info.docx");
  assert(vertrag.extensionKey === ".pdf" && vertrag.hasExtension === true, "A: extension .pdf");
  assert(vertrag.sizeBytes === 100, "G: sizeBytes present");
  assert(vertrag.parentListing === "read", "N: parent listing read");

  const festnetz = derived(
    dir("C:/v", "v", [
      dir(
        "C:/v/Festnetz",
        "Festnetz",
        [
          dir("C:/v/Festnetz/2022", "2022", [file("C:/v/Festnetz/2022/A.pdf", "A.pdf", { depth: 3 })], { depth: 2 }),
          dir("C:/v/Festnetz/2023", "2023", [file("C:/v/Festnetz/2023/B.pdf", "B.pdf", { depth: 3 })], { depth: 2 }),
          dir("C:/v/Festnetz/2024", "2024", [file("C:/v/Festnetz/2024/C.pdf", "C.pdf", { depth: 3 })], { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  const bPdf = fileContextByPath(festnetz.files, "C:/v/Festnetz/2023/B.pdf");
  assert(bPdf?.parent?.name === "2023", "B: parent 2023");
  assert(bPdf.parentIsYearFolderName === true, "B: parent is year folder name");
  assert(bPdf.yearGroup !== null, "B: yearGroup present");
  assert(bPdf.yearGroup?.parent.name === "Festnetz", "B: yearGroup parent Festnetz");
  assert(bPdf.yearGroup?.years.join(",") === "2022,2023,2024", "B: years");
  assert(bPdf.yearGroup?.minYear === 2022 && bPdf.yearGroup?.maxYear === 2024, "B: span");
  assert(festnetz.structure.yearGroups.length === 1, "W: yearGroups unchanged count");

  const loneYear = derived(
    dir("C:/docs", "docs", [
      dir("C:/docs/A", "A", [dir("C:/docs/A/2023", "2023", [file("C:/docs/A/2023/x.pdf", "x.pdf", { depth: 3 })], { depth: 2 })], {
        depth: 1,
      }),
      dir("C:/docs/B", "B", [dir("C:/docs/B/2023", "2023", [], { depth: 2 })], { depth: 1 }),
    ]),
  );
  const loneFile = fileContextByPath(loneYear.files, "C:/docs/A/2023/x.pdf");
  assert(loneFile?.parentIsYearFolderName === true, "C: name is year folder");
  assert(loneFile.yearGroup === null, "C: not a yearGroup member");
  assert(loneYear.structure.yearGroups.length === 0, "C: no year groups");

  const noExt = derived(
    dir("C:/docs", "docs", [dir("C:/docs/P", "P", [file("C:/docs/P/README", "README", { depth: 2 })], { depth: 1 })]),
  );
  const readme = fileContextByPath(noExt.files, "C:/docs/P/README");
  assert(readme?.hasExtension === false && readme.extensionKey === NO_EXTENSION_KEY, "D: no extension");

  const cased = derived(
    dir("C:/docs", "docs", [dir("C:/docs/P", "P", [file("C:/docs/P/Doc.PDF", "Doc.PDF", { depth: 2 })], { depth: 1 })]),
  );
  assert(fileContextByPath(cased.files, "C:/docs/P/Doc.PDF")?.extensionKey === ".pdf", "E: case-insensitive .pdf");

  const tarball = derived(
    dir("C:/docs", "docs", [
      dir("C:/docs/P", "P", [file("C:/docs/P/archive.tar.gz", "archive.tar.gz", { depth: 2 })], { depth: 1 }),
    ]),
  );
  assert(fileContextByPath(tarball.files, "C:/docs/P/archive.tar.gz")?.extensionKey === ".gz", "F: .tar.gz → .gz");

  const unknownSize = derived(
    dir("C:/docs", "docs", [dir("C:/docs/P", "P", [file("C:/docs/P/a.bin", "a.bin", { depth: 2 })], { depth: 1 })]),
  );
  assert(fileContextByPath(unknownSize.files, "C:/docs/P/a.bin")?.sizeBytes === null, "H: size unknown");

  const stamped = derived(
    dir("C:/docs", "docs", [
      dir(
        "C:/docs/P",
        "P",
        [file("C:/docs/P/a.txt", "a.txt", { depth: 2, createdAtMs: 10, modifiedAtMs: 20 })],
        { depth: 1 },
      ),
    ]),
  );
  const stampedFile = fileContextByPath(stamped.files, "C:/docs/P/a.txt");
  assert(stampedFile?.createdAtMs === 10 && stampedFile.modifiedAtMs === 20, "I: timestamps present");

  const noStamp = derived(
    dir("C:/docs", "docs", [dir("C:/docs/P", "P", [file("C:/docs/P/a.txt", "a.txt", { depth: 2 })], { depth: 1 })]),
  );
  const noStampFile = fileContextByPath(noStamp.files, "C:/docs/P/a.txt");
  assert(noStampFile?.createdAtMs === null && noStampFile.modifiedAtMs === null, "J: timestamps unknown");

  const manySiblings = derived(
    dir("C:/docs", "docs", [
      dir(
        "C:/docs/P",
        "P",
        [
          file("C:/docs/P/c.txt", "c.txt", { depth: 2 }),
          file("C:/docs/P/a.txt", "a.txt", { depth: 2 }),
          file("C:/docs/P/b.txt", "b.txt", { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  const aTxt = fileContextByPath(manySiblings.files, "C:/docs/P/a.txt");
  assert(aTxt?.siblingFileCount === 2, "K: two siblings");
  assert(aTxt.siblingFileNames.join(",") === "b.txt,c.txt", "K: sibling names sorted, self excluded");

  const single = derived(
    dir("C:/docs", "docs", [
      dir("C:/docs/einzeln", "einzeln", [file("C:/docs/einzeln/allein.txt", "allein.txt", { depth: 2 })], { depth: 1 }),
    ]),
  );
  const alone = fileContextByPath(single.files, "C:/docs/einzeln/allein.txt");
  assert(alone?.siblingFileCount === 0 && alone.siblingFileNames.length === 0, "L: single-file folder has no siblings");

  const withDirs = derived(
    dir("C:/docs", "docs", [
      dir(
        "C:/docs/P",
        "P",
        [
          file("C:/docs/P/x.txt", "x.txt", { depth: 2 }),
          dir("C:/docs/P/Fotos", "Fotos", [], { depth: 2 }),
          dir("C:/docs/P/Bank", "Bank", [], { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  const withDirFile = fileContextByPath(withDirs.files, "C:/docs/P/x.txt");
  assert(withDirFile?.childDirectoryCount === 2, "M: two child directories");
  assert(withDirFile.childDirectoryNames.join(",") === "Bank,Fotos", "M: directory names sorted");

  const depthLimited = derived(
    dir("C:/docs", "docs", [
      dir(
        "C:/docs/P",
        "P",
        [file("C:/docs/P/x.txt", "x.txt", { depth: 2 })],
        { depth: 1, listing: "depthLimited" },
      ),
    ]),
  );
  assert(fileContextByPath(depthLimited.files, "C:/docs/P/x.txt")?.parentListing === "depthLimited", "O: depthLimited");

  const incomplete = derived(
    dir("C:/docs", "docs", [
      dir(
        "C:/docs/P",
        "P",
        [file("C:/docs/P/x.txt", "x.txt", { depth: 2 })],
        { depth: 1, listing: "incomplete" },
      ),
    ]),
  );
  assert(fileContextByPath(incomplete.files, "C:/docs/P/x.txt")?.parentListing === "incomplete", "P: incomplete");

  const structureParents = derived(
    dir("C:/v", "v", [
      dir(
        "C:/v/Gas",
        "Gas",
        [
          dir("C:/v/Gas/2023", "2023", [file("C:/v/Gas/2023/g.pdf", "g.pdf", { depth: 3 })], { depth: 2 }),
          dir("C:/v/Gas/2024", "2024", [], { depth: 2 }),
          dir("C:/v/Gas/2025", "2025", [], { depth: 2 }),
        ],
        { depth: 1 },
      ),
      dir(
        "C:/v/Wasser",
        "Wasser",
        [
          dir("C:/v/Wasser/2023", "2023", [], { depth: 2 }),
          dir("C:/v/Wasser/2024", "2024", [], { depth: 2 }),
          dir("C:/v/Wasser/2025", "2025", [], { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  const gasFile = fileContextByPath(structureParents.files, "C:/v/Gas/2023/g.pdf");
  assert(gasFile?.parentInRepeatedChildDirectoryStructure === false, "R prep: parent year folder is not structure parent");
  assert(gasFile.grandparentInRepeatedChildDirectoryStructure === true, "R: grandparent Gas in P1-J structure");
  assert(
    gasFile.grandparentRepeatedChildDirectoryStructureSignature !== null,
    "R: grandparent signature present",
  );
  assert(structureParents.structure.repeatedChildDirectoryStructures.length === 1, "X: P1-J structures unchanged");

  const parentIsStructure = derived(
    dir("C:/kunden", "kunden", [
      dir(
        "C:/kunden/A",
        "A",
        [
          dir("C:/kunden/A/Angebote", "Angebote", [file("C:/kunden/A/Angebote/a.pdf", "a.pdf", { depth: 3 })], {
            depth: 2,
          }),
          dir("C:/kunden/A/Rechnungen", "Rechnungen", [], { depth: 2 }),
          dir("C:/kunden/A/Schriftverkehr", "Schriftverkehr", [], { depth: 2 }),
        ],
        { depth: 1 },
      ),
      dir(
        "C:/kunden/B",
        "B",
        [
          dir("C:/kunden/B/Angebote", "Angebote", [], { depth: 2 }),
          dir("C:/kunden/B/Rechnungen", "Rechnungen", [], { depth: 2 }),
          dir("C:/kunden/B/Schriftverkehr", "Schriftverkehr", [], { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  // File under Angebote: parent=Angebote is NOT structure parent; grandparent=A IS.
  // Need file directly under structure parent A:
  const parentDirect = derived(
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
          dir("C:/kunden/B/Angebote", "Angebote", [], { depth: 2 }),
          dir("C:/kunden/B/Rechnungen", "Rechnungen", [], { depth: 2 }),
          dir("C:/kunden/B/Schriftverkehr", "Schriftverkehr", [], { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  const note = fileContextByPath(parentDirect.files, "C:/kunden/A/notiz.txt");
  assert(note?.parentInRepeatedChildDirectoryStructure === true, "Q: parent A is P1-J structure parent");
  assert(note.parentRepeatedChildDirectoryStructureSignature !== null, "Q: parent signature");
  assert(
    fileContextByPath(parentIsStructure.files, "C:/kunden/A/Angebote/a.pdf")?.grandparentInRepeatedChildDirectoryStructure ===
      true,
    "R: file under child of structure parent",
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
            [dir("C:/root/A/B/C", "C", [file("C:/root/A/B/C/end.pdf", "end.pdf", { depth: 4 })], { depth: 3 })],
            { depth: 2 },
          ),
        ],
        { depth: 1 },
      ),
      dir("C:/root/sonst", "sonst", [file("C:/root/sonst/x.pdf", "x.pdf", { depth: 2 })], { depth: 1 }),
    ]),
  );
  const endPdf = fileContextByPath(chain.files, "C:/root/A/B/C/end.pdf");
  assert(endPdf?.parentInFolderChain === true, "S: parent C in folder chain");
  assert(endPdf.parentIsFolderChainEnd === true, "T: parent is chain end");
  const other = fileContextByPath(chain.files, "C:/root/sonst/x.pdf");
  assert(other?.parentInFolderChain === false && other.parentIsFolderChainEnd === false, "S/T: unrelated parent");
  assert(chain.structure.folderChains.length === 1, "X: folderChains unchanged");

  const orphanScan = resultOf(
    dir("C:/docs", "docs", [
      dir("C:/docs/P", "P", [file("C:/docs/P/a.txt", "a.txt", { depth: 2 })], { depth: 1 }),
      file("C:/orphan.txt", "orphan.txt", { depth: 1 }),
    ]),
  );
  const orphanStructure = analyzeStructureContext(resultOf(dir("C:/docs", "docs", [])));
  const orphanFiles = analyzeFileStructureContext(orphanScan, orphanStructure);
  const orphan = fileContextByPath(orphanFiles, "C:/orphan.txt");
  assert(orphan?.joinFound === false, "U: missing parent join marked");
  assert(orphan.parent === null && orphan.yearGroup === null, "U: no invented parent/year");
  assert(orphan.parentInFolderChain === false && orphan.parentIsFolderChainEnd === false, "U: no invented chain");

  const ordered = derived(
    dir("C:/docs", "docs", [
      dir("C:/docs/Zed", "Zed", [file("C:/docs/Zed/b.txt", "b.txt", { depth: 2 })], { depth: 1 }),
      dir("C:/docs/Abel", "Abel", [file("C:/docs/Abel/a.txt", "a.txt", { depth: 2 })], { depth: 1 }),
    ]),
  );
  assert(
    ordered.files.files.map((item) => item.relativePath).join(",") === "Abel\\a.txt,Zed\\b.txt",
    "V: sorted by relative path",
  );
  const orderedAgain = derived(
    dir("C:/docs", "docs", [
      dir("C:/docs/Abel", "Abel", [file("C:/docs/Abel/a.txt", "a.txt", { depth: 2 })], { depth: 1 }),
      dir("C:/docs/Zed", "Zed", [file("C:/docs/Zed/b.txt", "b.txt", { depth: 2 })], { depth: 1 }),
    ]),
  );
  assert(JSON.stringify(ordered.files) === JSON.stringify(orderedAgain.files), "V: deterministic serialization");

  const structureBefore = JSON.stringify({
    yearGroups: festnetz.structure.yearGroups,
    repeatedChildDirectoryStructures: festnetz.structure.repeatedChildDirectoryStructures,
    folderChains: festnetz.structure.folderChains,
  });
  analyzeFileStructureContext(resultOf(festnetzRoot()), festnetz.structure);
  const structureAfter = JSON.stringify({
    yearGroups: festnetz.structure.yearGroups,
    repeatedChildDirectoryStructures: festnetz.structure.repeatedChildDirectoryStructures,
    folderChains: festnetz.structure.folderChains,
  });
  assert(structureBefore === structureAfter, "W/X: join does not mutate structure");

  const blob = JSON.stringify(bank.files).toLocaleLowerCase();
  assert(!blob.includes("duplikat") && !blob.includes("redundant"), "Y: no duplicate rating");
  assert(!blob.includes("unnötig") && !blob.includes("überflüssig") && !blob.includes("ueberfluessig"), "Y: no surplus rating");
  assert(!blob.includes("verschieben") && !blob.includes("löschen") && !blob.includes("loeschen"), "Y: no action rating");
}

function festnetzRoot(): DirectoryNode {
  return dir("C:/v", "v", [
    dir(
      "C:/v/Festnetz",
      "Festnetz",
      [
        dir("C:/v/Festnetz/2022", "2022", [file("C:/v/Festnetz/2022/A.pdf", "A.pdf", { depth: 3 })], { depth: 2 }),
        dir("C:/v/Festnetz/2023", "2023", [file("C:/v/Festnetz/2023/B.pdf", "B.pdf", { depth: 3 })], { depth: 2 }),
        dir("C:/v/Festnetz/2024", "2024", [file("C:/v/Festnetz/2024/C.pdf", "C.pdf", { depth: 3 })], { depth: 2 }),
      ],
      { depth: 1 },
    ),
  ]);
}
