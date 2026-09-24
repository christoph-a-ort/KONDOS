import { type DirectoryNode, type FileNode, type FsNode, type ScanResult } from "../model";
import { NO_EXTENSION_KEY } from "./displayFilter";
import {
  analyzeExactFolderFileStructures,
  type InventoryExactFolderFileStructureContext,
} from "./inventoryExactFolderFileStructure";
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
  exact: InventoryExactFolderFileStructureContext;
} {
  const structure = analyzeStructureContext(resultOf(root));
  return {
    structure,
    exact: analyzeExactFolderFileStructures(structure),
  };
}

function nameGroupFolders(
  exact: InventoryExactFolderFileStructureContext,
  signaturePart: string,
): string[] {
  const group = exact.exactDirectFileNameStructures.find((item) =>
    item.signature.includes(signaturePart),
  );
  return group?.folders.map((item) => item.folder.name) ?? [];
}

export function runInventoryExactFolderFileStructureCheck(): void {
  // --- A: direct file-name structures ---
  const sameNames = derived(
    dir("C:/docs", "docs", [
      dir(
        "C:/docs/A",
        "A",
        [
          file("C:/docs/A/Januar.pdf", "Januar.pdf", { depth: 2 }),
          file("C:/docs/A/Februar.pdf", "Februar.pdf", { depth: 2 }),
          file("C:/docs/A/März.xlsx", "März.xlsx", { depth: 2 }),
        ],
        { depth: 1 },
      ),
      dir(
        "C:/docs/B",
        "B",
        [
          file("C:/docs/B/März.xlsx", "März.xlsx", { depth: 2 }),
          file("C:/docs/B/Januar.pdf", "Januar.pdf", { depth: 2 }),
          file("C:/docs/B/Februar.pdf", "Februar.pdf", { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  assert(sameNames.exact.exactDirectFileNameStructures.length === 1, "A1: one name-structure group");
  assert(sameNames.exact.exactDirectFileNameStructures[0]?.folderCount === 2, "A1: two folders");
  assert(
    sameNames.exact.exactDirectFileNameStructures[0]?.directFileCount === 3,
    "A1: three direct file names",
  );

  const reordered = derived(
    dir("C:/docs", "docs", [
      dir(
        "C:/docs/A",
        "A",
        [
          file("C:/docs/A/c.txt", "c.txt", { depth: 2 }),
          file("C:/docs/A/a.txt", "a.txt", { depth: 2 }),
          file("C:/docs/A/b.txt", "b.txt", { depth: 2 }),
        ],
        { depth: 1 },
      ),
      dir(
        "C:/docs/B",
        "B",
        [
          file("C:/docs/B/a.txt", "a.txt", { depth: 2 }),
          file("C:/docs/B/b.txt", "b.txt", { depth: 2 }),
          file("C:/docs/B/c.txt", "c.txt", { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  assert(reordered.exact.exactDirectFileNameStructures.length === 1, "A2: order-independent signature");
  assert(
    reordered.exact.exactDirectFileNameStructures[0]?.signature === "a.txt\nb.txt\nc.txt",
    "A2: sorted lowercased signature",
  );

  const cased = derived(
    dir("C:/docs", "docs", [
      dir(
        "C:/docs/A",
        "A",
        [
          file("C:/docs/A/Januar.pdf", "Januar.pdf", { depth: 2 }),
          file("C:/docs/A/Februar.pdf", "Februar.pdf", { depth: 2 }),
        ],
        { depth: 1 },
      ),
      dir(
        "C:/docs/B",
        "B",
        [
          file("C:/docs/B/januar.PDF", "januar.PDF", { depth: 2 }),
          file("C:/docs/B/februar.pdf", "februar.pdf", { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  assert(cased.exact.exactDirectFileNameStructures.length === 1, "A3: case-insensitive name set");

  const oneDifferent = derived(
    dir("C:/docs", "docs", [
      dir(
        "C:/docs/A",
        "A",
        [
          file("C:/docs/A/a.pdf", "a.pdf", { depth: 2 }),
          file("C:/docs/A/b.pdf", "b.pdf", { depth: 2 }),
        ],
        { depth: 1 },
      ),
      dir(
        "C:/docs/B",
        "B",
        [
          file("C:/docs/B/a.pdf", "a.pdf", { depth: 2 }),
          file("C:/docs/B/c.pdf", "c.pdf", { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  assert(oneDifferent.exact.exactDirectFileNameStructures.length === 0, "A4: one different name → no group");

  const sameCountDifferentNames = derived(
    dir("C:/docs", "docs", [
      dir(
        "C:/docs/A",
        "A",
        [
          file("C:/docs/A/x.pdf", "x.pdf", { depth: 2 }),
          file("C:/docs/A/y.pdf", "y.pdf", { depth: 2 }),
        ],
        { depth: 1 },
      ),
      dir(
        "C:/docs/B",
        "B",
        [
          file("C:/docs/B/p.pdf", "p.pdf", { depth: 2 }),
          file("C:/docs/B/q.pdf", "q.pdf", { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  assert(
    sameCountDifferentNames.exact.exactDirectFileNameStructures.length === 0,
    "A5: same count different names → no name group",
  );

  const three = derived(
    dir("C:/docs", "docs", [
      dir("C:/docs/A", "A", [file("C:/docs/A/n.txt", "n.txt", { depth: 2 })], { depth: 1 }),
      dir("C:/docs/B", "B", [file("C:/docs/B/n.txt", "n.txt", { depth: 2 })], { depth: 1 }),
      dir("C:/docs/C", "C", [file("C:/docs/C/n.txt", "n.txt", { depth: 2 })], { depth: 1 }),
    ]),
  );
  assert(three.exact.exactDirectFileNameStructures.length === 1, "A6: one group");
  assert(three.exact.exactDirectFileNameStructures[0]?.folderCount === 3, "A6: three folders");

  const unique = derived(
    dir("C:/docs", "docs", [
      dir("C:/docs/A", "A", [file("C:/docs/A/only.txt", "only.txt", { depth: 2 })], { depth: 1 }),
      dir("C:/docs/B", "B", [file("C:/docs/B/other.txt", "other.txt", { depth: 2 })], { depth: 1 }),
    ]),
  );
  assert(unique.exact.exactDirectFileNameStructures.length === 0, "A7: unique folders → no group");

  const empty = derived(
    dir("C:/docs", "docs", [
      dir("C:/docs/A", "A", [], { depth: 1 }),
      dir("C:/docs/B", "B", [], { depth: 1 }),
      dir("C:/docs/C", "C", [file("C:/docs/C/x.txt", "x.txt", { depth: 2 })], { depth: 1 }),
    ]),
  );
  assert(empty.exact.exactDirectFileNameStructures.length === 0, "A8: empty folders form no name group");
  assert(empty.exact.exactExtensionMultisets.length === 0, "B9: empty folders form no extension group");

  const nested = derived(
    dir("C:/docs", "docs", [
      dir(
        "C:/docs/A",
        "A",
        [
          file("C:/docs/A/a.pdf", "a.pdf", { depth: 2 }),
          dir(
            "C:/docs/A/Unter",
            "Unter",
            [file("C:/docs/A/Unter/b.pdf", "b.pdf", { depth: 3 })],
            { depth: 2 },
          ),
        ],
        { depth: 1 },
      ),
      dir(
        "C:/docs/B",
        "B",
        [file("C:/docs/B/a.pdf", "a.pdf", { depth: 2 })],
        { depth: 1 },
      ),
    ]),
  );
  assert(nested.exact.exactDirectFileNameStructures.length === 1, "A9: nested file ignored for parent");
  assert(
    nested.exact.exactDirectFileNameStructures[0]?.directFileNames.join(",") === "a.pdf",
    "A9: only direct a.pdf",
  );

  const incomplete = derived(
    dir("C:/docs", "docs", [
      dir(
        "C:/docs/A",
        "A",
        [file("C:/docs/A/a.pdf", "a.pdf", { depth: 2 })],
        { depth: 1, listing: "incomplete" },
      ),
      dir(
        "C:/docs/B",
        "B",
        [file("C:/docs/B/a.pdf", "a.pdf", { depth: 2 })],
        { depth: 1 },
      ),
      dir(
        "C:/docs/C",
        "C",
        [file("C:/docs/C/a.pdf", "a.pdf", { depth: 2 })],
        { depth: 1, listing: "depthLimited" },
      ),
    ]),
  );
  assert(
    incomplete.exact.exactDirectFileNameStructures.length === 0,
    "A10: incomplete/depthLimited excluded; only one read folder left",
  );
  assert(
    incomplete.exact.exactExtensionMultisets.length === 0,
    "B11: unreliable listings excluded from extension groups",
  );

  const ordered = derived(
    dir("C:/docs", "docs", [
      dir("C:/docs/Zed", "Zed", [file("C:/docs/Zed/n.txt", "n.txt", { depth: 2 })], { depth: 1 }),
      dir("C:/docs/Abel", "Abel", [file("C:/docs/Abel/n.txt", "n.txt", { depth: 2 })], { depth: 1 }),
    ]),
  );
  assert(
    ordered.exact.exactDirectFileNameStructures[0]?.folders.map((item) => item.relativePath).join(",") ===
      "Abel,Zed",
    "A11: folders sorted by relativePath",
  );
  const orderedAgain = derived(
    dir("C:/docs", "docs", [
      dir("C:/docs/Abel", "Abel", [file("C:/docs/Abel/n.txt", "n.txt", { depth: 2 })], { depth: 1 }),
      dir("C:/docs/Zed", "Zed", [file("C:/docs/Zed/n.txt", "n.txt", { depth: 2 })], { depth: 1 }),
    ]),
  );
  assert(
    JSON.stringify(ordered.exact) === JSON.stringify(orderedAgain.exact),
    "A11: deterministic serialization",
  );

  // --- B: extension multisets ---
  const sameExt = derived(
    dir("C:/docs", "docs", [
      dir(
        "C:/docs/A",
        "A",
        [
          file("C:/docs/A/1.pdf", "1.pdf", { depth: 2 }),
          file("C:/docs/A/2.pdf", "2.pdf", { depth: 2 }),
          file("C:/docs/A/3.pdf", "3.pdf", { depth: 2 }),
          file("C:/docs/A/a.jpg", "a.jpg", { depth: 2 }),
          file("C:/docs/A/b.jpg", "b.jpg", { depth: 2 }),
          file("C:/docs/A/sheet.xlsx", "sheet.xlsx", { depth: 2 }),
        ],
        { depth: 1 },
      ),
      dir(
        "C:/docs/B",
        "B",
        [
          file("C:/docs/B/x.pdf", "x.pdf", { depth: 2 }),
          file("C:/docs/B/y.pdf", "y.pdf", { depth: 2 }),
          file("C:/docs/B/z.pdf", "z.pdf", { depth: 2 }),
          file("C:/docs/B/p.jpg", "p.jpg", { depth: 2 }),
          file("C:/docs/B/q.jpg", "q.jpg", { depth: 2 }),
          file("C:/docs/B/t.xlsx", "t.xlsx", { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  assert(sameExt.exact.exactExtensionMultisets.length === 1, "B1: one extension multiset group");
  assert(sameExt.exact.exactDirectFileNameStructures.length === 0, "B2: different names → no name group");
  assert(sameExt.exact.exactExtensionMultisets[0]?.folderCount === 2, "B1: two folders");

  const extReordered = derived(
    dir("C:/docs", "docs", [
      dir(
        "C:/docs/A",
        "A",
        [
          file("C:/docs/A/a.jpg", "a.jpg", { depth: 2 }),
          file("C:/docs/A/b.pdf", "b.pdf", { depth: 2 }),
        ],
        { depth: 1 },
      ),
      dir(
        "C:/docs/B",
        "B",
        [
          file("C:/docs/B/c.pdf", "c.pdf", { depth: 2 }),
          file("C:/docs/B/d.jpg", "d.jpg", { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  assert(extReordered.exact.exactExtensionMultisets.length === 1, "B3: extension order independent");

  const differentCounts = derived(
    dir("C:/docs", "docs", [
      dir(
        "C:/docs/A",
        "A",
        [
          file("C:/docs/A/1.pdf", "1.pdf", { depth: 2 }),
          file("C:/docs/A/2.pdf", "2.pdf", { depth: 2 }),
          file("C:/docs/A/3.pdf", "3.pdf", { depth: 2 }),
        ],
        { depth: 1 },
      ),
      dir(
        "C:/docs/B",
        "B",
        [
          file("C:/docs/B/1.pdf", "1.pdf", { depth: 2 }),
          file("C:/docs/B/2.pdf", "2.pdf", { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  assert(
    differentCounts.exact.exactExtensionMultisets.length === 0,
    "B4: different counts of same extension → no group",
  );

  const noExt = derived(
    dir("C:/docs", "docs", [
      dir(
        "C:/docs/A",
        "A",
        [
          file("C:/docs/A/README", "README", { depth: 2 }),
          file("C:/docs/A/LICENSE", "LICENSE", { depth: 2 }),
          file("C:/docs/A/a.pdf", "a.pdf", { depth: 2 }),
        ],
        { depth: 1 },
      ),
      dir(
        "C:/docs/B",
        "B",
        [
          file("C:/docs/B/NOTES", "NOTES", { depth: 2 }),
          file("C:/docs/B/TODO", "TODO", { depth: 2 }),
          file("C:/docs/B/b.pdf", "b.pdf", { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  assert(noExt.exact.exactExtensionMultisets.length === 1, "B5/B6: NO_EXTENSION_KEY multiset");
  const noExtGroup = noExt.exact.exactExtensionMultisets[0];
  assert(
    noExtGroup?.extensionCounts.some((item) => item.extensionKey === NO_EXTENSION_KEY && item.count === 2),
    "B5: two no-extension files",
  );
  assert(
    noExtGroup?.extensionCounts.some((item) => item.extensionKey === ".pdf" && item.count === 1),
    "B6: one pdf",
  );

  const noExtDifferent = derived(
    dir("C:/docs", "docs", [
      dir(
        "C:/docs/A",
        "A",
        [
          file("C:/docs/A/README", "README", { depth: 2 }),
          file("C:/docs/A/a.pdf", "a.pdf", { depth: 2 }),
          file("C:/docs/A/b.pdf", "b.pdf", { depth: 2 }),
        ],
        { depth: 1 },
      ),
      dir(
        "C:/docs/B",
        "B",
        [
          file("C:/docs/B/NOTES", "NOTES", { depth: 2 }),
          file("C:/docs/B/TODO", "TODO", { depth: 2 }),
          file("C:/docs/B/c.pdf", "c.pdf", { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  assert(
    noExtDifferent.exact.exactExtensionMultisets.length === 0,
    "B5b: 1 none+2 pdf ≠ 2 none+1 pdf",
  );

  const extCase = derived(
    dir("C:/docs", "docs", [
      dir("C:/docs/A", "A", [file("C:/docs/A/Doc.PDF", "Doc.PDF", { depth: 2 })], { depth: 1 }),
      dir("C:/docs/B", "B", [file("C:/docs/B/Other.pdf", "Other.pdf", { depth: 2 })], { depth: 1 }),
    ]),
  );
  assert(extCase.exact.exactExtensionMultisets.length === 1, "B7: extension case via fileExtensionKey");

  const tarball = derived(
    dir("C:/docs", "docs", [
      dir(
        "C:/docs/A",
        "A",
        [file("C:/docs/A/archive.tar.gz", "archive.tar.gz", { depth: 2 })],
        { depth: 1 },
      ),
      dir(
        "C:/docs/B",
        "B",
        [file("C:/docs/B/other.tar.gz", "other.tar.gz", { depth: 2 })],
        { depth: 1 },
      ),
    ]),
  );
  assert(tarball.exact.exactExtensionMultisets.length === 1, "B8: .tar.gz → .gz multiset");
  assert(
    tarball.exact.exactExtensionMultisets[0]?.extensionCounts[0]?.extensionKey === ".gz",
    "B8: extensionKey .gz",
  );

  const nestedExt = derived(
    dir("C:/docs", "docs", [
      dir(
        "C:/docs/A",
        "A",
        [
          file("C:/docs/A/a.pdf", "a.pdf", { depth: 2 }),
          dir(
            "C:/docs/A/Unter",
            "Unter",
            [file("C:/docs/A/Unter/b.jpg", "b.jpg", { depth: 3 })],
            { depth: 2 },
          ),
        ],
        { depth: 1 },
      ),
      dir("C:/docs/B", "B", [file("C:/docs/B/c.pdf", "c.pdf", { depth: 2 })], { depth: 1 }),
    ]),
  );
  assert(nestedExt.exact.exactExtensionMultisets.length === 1, "B10: nested not counted on parent");
  assert(nestedExt.exact.exactExtensionMultisets[0]?.directFileCount === 1, "B10: one direct file");

  // --- C: combination ---
  const combo = derived(
    dir("C:/docs", "docs", [
      dir(
        "C:/docs/A",
        "A",
        [
          file("C:/docs/A/januar.pdf", "januar.pdf", { depth: 2 }),
          file("C:/docs/A/februar.pdf", "februar.pdf", { depth: 2 }),
        ],
        { depth: 1 },
      ),
      dir(
        "C:/docs/B",
        "B",
        [
          file("C:/docs/B/rechnung.pdf", "rechnung.pdf", { depth: 2 }),
          file("C:/docs/B/vertrag.pdf", "vertrag.pdf", { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  assert(combo.exact.exactDirectFileNameStructures.length === 0, "C-A: different names → no name group");
  assert(combo.exact.exactExtensionMultisets.length === 1, "C-A: same 2×.pdf → extension group");

  const sameNamesImpliesExt = derived(
    dir("C:/docs", "docs", [
      dir(
        "C:/docs/A",
        "A",
        [
          file("C:/docs/A/Info.pdf", "Info.pdf", { depth: 2 }),
          file("C:/docs/A/Notes.txt", "Notes.txt", { depth: 2 }),
        ],
        { depth: 1 },
      ),
      dir(
        "C:/docs/B",
        "B",
        [
          file("C:/docs/B/Info.pdf", "Info.pdf", { depth: 2 }),
          file("C:/docs/B/Notes.txt", "Notes.txt", { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  assert(sameNamesImpliesExt.exact.exactDirectFileNameStructures.length === 1, "C-B: name group present");
  assert(
    sameNamesImpliesExt.exact.exactExtensionMultisets.length === 1,
    "C-B: equal names ⇒ equal extension multiset under fileExtensionKey",
  );

  const independent = derived(
    dir("C:/docs", "docs", [
      dir("C:/docs/A1", "A1", [file("C:/docs/A1/alpha.txt", "alpha.txt", { depth: 2 })], { depth: 1 }),
      dir("C:/docs/A2", "A2", [file("C:/docs/A2/alpha.txt", "alpha.txt", { depth: 2 })], { depth: 1 }),
      dir(
        "C:/docs/B1",
        "B1",
        [
          file("C:/docs/B1/1.pdf", "1.pdf", { depth: 2 }),
          file("C:/docs/B1/2.jpg", "2.jpg", { depth: 2 }),
        ],
        { depth: 1 },
      ),
      dir(
        "C:/docs/B2",
        "B2",
        [
          file("C:/docs/B2/x.pdf", "x.pdf", { depth: 2 }),
          file("C:/docs/B2/y.jpg", "y.jpg", { depth: 2 }),
        ],
        { depth: 1 },
      ),
    ]),
  );
  assert(independent.exact.exactDirectFileNameStructures.length === 1, "C-C: one name group (alpha)");
  assert(
    nameGroupFolders(independent.exact, "alpha.txt").sort().join(",") === "A1,A2",
    "C-C: name group only A1/A2",
  );
  assert(independent.exact.exactExtensionMultisets.length === 2, "C-C: two independent extension groups");

  const blob = JSON.stringify(sameNames.exact).toLocaleLowerCase();
  assert(!blob.includes("duplikat") && !blob.includes("redundant"), "Y: no duplicate rating");
  assert(!blob.includes("ähnlich") && !blob.includes("aehnlich"), "Y: no similarity rating");
  assert(
    !blob.includes("löschen") &&
      !blob.includes("loeschen") &&
      !blob.includes("aufräum") &&
      !blob.includes("aufraeum"),
    "Y: no cleanup rating",
  );

  assert(
    sameNames.structure.repeatedChildDirectoryStructures !== undefined,
    "W: P1-J structure context still produced alongside",
  );
}
