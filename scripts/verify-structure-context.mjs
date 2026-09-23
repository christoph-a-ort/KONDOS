// Dev-side structure-context check. Mirrors src/ui/inventoryStructureContext.ts.
// Not imported by the app.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return readFileSync(join(rootDir, rel), "utf8");
}

const contextSrc = read("src/ui/inventoryStructureContext.ts");
const checkSrc = read("src/ui/inventoryStructureContextCheck.ts");
const analysisSrc = read("src/ui/inventoryAnalysis.ts");
const overviewSrc = read("src/ui/inventoryOverview.ts");
const overviewUi = read("src/ui/InventoryOverviewPanel.tsx");
const treeViewSrc = read("src/ui/TreeView.tsx");
const appSrc = read("src/App.tsx");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");

assert(contextSrc.includes("export function analyzeStructureContext"), "core: analyzeStructureContext exported");
assert(contextSrc.includes("export interface YearFolderGroup"), "core: YearFolderGroup type");
assert(contextSrc.includes("YEAR_FOLDER_MIN = 1900"), "core: year min 1900");
assert(contextSrc.includes("YEAR_FOLDER_MAX = 2100"), "core: year max 2100");
assert(contextSrc.includes("MIN_YEAR_GROUP_SIZE = 2"), "core: group minimum 2");
assert(contextSrc.includes("/^[0-9]{4}$/"), "core: exact four ASCII digits");
assert(contextSrc.includes("displayInventoryPath"), "core: reuses relative path helper");
assert(contextSrc.includes("missingYears"), "core: missingYears field");
assert(contextSrc.includes("consecutiveRuns"), "core: consecutiveRuns field");
assert(contextSrc.includes("a_data"), "core: companion-structure note present");
assert(contextSrc.includes("repeatedChildDirectoryStructures"), "core: repeated child directory structures");
assert(contextSrc.includes("MIN_CHILD_DIRECTORY_STRUCTURE_SIZE = 2"), "core: min 2 child directories");
assert(contextSrc.includes("MIN_REPEATED_STRUCTURE_PARENTS = 2"), "core: min 2 parents");
assert(contextSrc.includes("MIN_FOLDER_CHAIN_LENGTH = 3"), "core: chain minimum 3");
assert(contextSrc.includes("folderChains"), "core: folderChains field");
assert(contextSrc.includes('listing !== "read"'), "core: only fully read parents");
assert(!overviewUi.includes("repeatedChildDirectoryStructures"), "overview UI not yet showing structure groups");
assert(!overviewSrc.includes("repeatedChildDirectoryStructures"), "overview view not yet mapping structure groups");
assert(!overviewUi.includes("folderChains"), "overview UI not yet showing folder chains");
assert(!overviewSrc.includes("folderChains"), "overview view not yet mapping folder chains");
assert(!contextSrc.toLocaleLowerCase().includes("duplikat"), "core: no Duplikat");
assert(!contextSrc.includes("openai") && !contextSrc.toLocaleLowerCase().includes("soll-struktur"), "core: no KI/SOLL");
assert(treeViewSrc.includes("useMemo(() => analyzeStructureContext(result), [result])"), "TreeView memos structure context");
assert(overviewUi.includes("SECTION_YEAR_STRUCTURES"), "overview UI shows year groups");
assert(overviewSrc.includes("YearFolderGroup") || overviewSrc.includes("yearGroups"), "overview view maps year groups");
assert(!appSrc.includes("inventoryStructureContext"), "App does not own structure context");
assert(analysisSrc.includes("repeatedFolderNames"), "P1-H repeated folders remain");
assert(checkSrc.includes("runInventoryStructureContextCheck"), "ts check exists");
assert(checkSrc.includes("runFolderChainCheck"), "ts chain checks exist");
assert(workbenchSrc.includes("runInventoryStructureContextCheck"), "ts check is wired");
assert(!contextSrc.includes("start_scan"), "no scan IPC");
assert(!contextSrc.includes("ContentCache") && !contextSrc.includes("contentCache"), "no ContentCache");

const YEAR_FOLDER_MIN = 1900;
const YEAR_FOLDER_MAX = 2100;
const MIN_YEAR_GROUP_SIZE = 2;
const MIN_CHILD_DIRECTORY_STRUCTURE_SIZE = 2;
const MIN_REPEATED_STRUCTURE_PARENTS = 2;
const MIN_FOLDER_CHAIN_LENGTH = 3;
const YEAR_FOLDER_NAME = /^[0-9]{4}$/;
const START_FOLDER_LABEL = "Startordner";

function isDirectory(node) {
  return node.kind === "directory";
}

function isFile(node) {
  return node.kind === "file";
}

function parseYearFolderName(name) {
  if (!YEAR_FOLDER_NAME.test(name)) return null;
  const year = Number(name);
  if (year < YEAR_FOLDER_MIN || year > YEAR_FOLDER_MAX) return null;
  return year;
}

function compareText(left, right) {
  const order = left.localeCompare(right, undefined, { sensitivity: "base" });
  if (order !== 0) return order;
  return left < right ? -1 : left > right ? 1 : 0;
}

function displayInventoryPath(rootAbs, abs) {
  const root = String(rootAbs).replace(/\\/g, "/").replace(/\/+$/, "");
  const path = String(abs).replace(/\\/g, "/").replace(/\/+$/, "");
  if (path.toLocaleLowerCase() === root.toLocaleLowerCase()) return START_FOLDER_LABEL;
  if (path.length > root.length && path.slice(0, root.length).toLocaleLowerCase() === root.toLocaleLowerCase()) {
    const tail = path.slice(root.length);
    if (tail.startsWith("/")) return tail.slice(1).replace(/\//g, "\\");
  }
  return path.split("/").filter(Boolean).pop() ?? START_FOLDER_LABEL;
}

function nodeRef(node) {
  return { id: node.id, name: node.name, path: node.path, depth: node.depth };
}

function yearRef(year, node) {
  return { year, folder: nodeRef(node), listing: node.listing };
}

function uniqueYears(yearFolders) {
  const years = [];
  for (const item of yearFolders) {
    if (years[years.length - 1] !== item.year) years.push(item.year);
  }
  return years;
}

function missingYearsBetween(minYear, maxYear, present) {
  const presentSet = new Set(present);
  const missing = [];
  for (let year = minYear; year <= maxYear; year += 1) {
    if (!presentSet.has(year)) missing.push(year);
  }
  return missing;
}

function consecutiveRunsOf(years) {
  const runs = [];
  if (years.length === 0) return runs;
  let start = years[0];
  let end = start;
  for (let index = 1; index < years.length; index += 1) {
    const year = years[index];
    if (year === end + 1) {
      end = year;
      continue;
    }
    if (end > start) runs.push({ start, end });
    start = year;
    end = year;
  }
  if (end > start) runs.push({ start, end });
  return runs;
}

function uniqueChildDirectoryEntries(children) {
  const byKey = new Map();
  const sorted = children.slice().sort((a, b) => compareText(a.name, b.name));
  for (const child of sorted) {
    const key = child.name.toLocaleLowerCase();
    if (!byKey.has(key)) byKey.set(key, child.name);
  }
  return [...byKey.entries()]
    .map(([key, original]) => ({ key, original }))
    .sort((a, b) => compareText(a.key, b.key) || compareText(a.original, b.original));
}

function buildRepeatedChildDirectoryStructures(folders) {
  const buckets = new Map();
  for (const folder of folders) {
    if (folder.listing !== "read") continue;
    const entries = uniqueChildDirectoryEntries(folder.childDirectories);
    if (entries.length < MIN_CHILD_DIRECTORY_STRUCTURE_SIZE) continue;
    const signature = entries.map((item) => item.key).join("\n");
    const existing = buckets.get(signature);
    if (existing === undefined) buckets.set(signature, [folder]);
    else existing.push(folder);
  }
  const groups = [];
  for (const [signature, members] of buckets) {
    if (members.length < MIN_REPEATED_STRUCTURE_PARENTS) continue;
    const parents = members
      .map((item) => ({ folder: item.folder, relativePath: item.relativePath, depth: item.depth }))
      .sort((a, b) => compareText(a.relativePath, b.relativePath));
    const first = parents[0];
    const firstFolder = members.find((item) => item.folder.path === first.folder.path) ?? members[0];
    const childDirectoryNames = uniqueChildDirectoryEntries(firstFolder.childDirectories).map((item) => item.original);
    groups.push({
      signature,
      childDirectoryNames,
      childDirectoryCount: childDirectoryNames.length,
      parents,
      parentCount: parents.length,
    });
  }
  groups.sort((left, right) => {
    if (left.childDirectoryCount !== right.childDirectoryCount) return right.childDirectoryCount - left.childDirectoryCount;
    if (left.parentCount !== right.parentCount) return right.parentCount - left.parentCount;
    return compareText(left.signature, right.signature);
  });
  return groups;
}

function canContinueFolderChain(folder) {
  return folder.listing === "read" && folder.childFiles.length === 0 && folder.childDirectories.length === 1;
}

function parentContinuesIntoFolder(folder, byPath) {
  if (folder.parent === null) return false;
  const parent = byPath.get(folder.parent.path);
  if (parent === undefined || !canContinueFolderChain(parent)) return false;
  return parent.childDirectories[0]?.path === folder.folder.path;
}

function buildFolderChains(folders) {
  const byPath = new Map(folders.map((item) => [item.folder.path, item]));
  const chains = [];
  for (const folder of folders) {
    if (parentContinuesIntoFolder(folder, byPath) || !canContinueFolderChain(folder)) continue;
    const walk = [folder];
    const seen = new Set([folder.folder.path]);
    let current = folder;
    while (canContinueFolderChain(current)) {
      const nextPath = current.childDirectories[0]?.path;
      if (nextPath === undefined || seen.has(nextPath)) break;
      const next = byPath.get(nextPath);
      if (next === undefined) break;
      seen.add(nextPath);
      walk.push(next);
      current = next;
    }
    if (walk.length < MIN_FOLDER_CHAIN_LENGTH) continue;
    const start = walk[0];
    const end = walk[walk.length - 1];
    chains.push({
      folderCount: walk.length,
      folders: walk.map((item) => item.folder),
      start: start.folder,
      end: end.folder,
      startRelativePath: start.relativePath,
      endRelativePath: end.relativePath,
      startDepth: start.depth,
      endDepth: end.depth,
      endDirectFileCount: end.childFiles.length,
      endDirectDirectoryCount: end.childDirectories.length,
      endListing: end.listing,
    });
  }
  chains.sort((left, right) => {
    if (left.folderCount !== right.folderCount) return right.folderCount - left.folderCount;
    return compareText(left.startRelativePath, right.startRelativePath) || compareText(left.start.path, right.start.path);
  });
  return chains;
}

function analyzeStructureContext(result) {
  const rootPath = result.root.path;
  const folders = [];
  const yearFolders = [];
  const yearGroups = [];

  function visit(node, parent, siblingDirectories) {
    const childDirectories = node.children.filter(isDirectory);
    const childFiles = node.children.filter(isFile);
    const year = parseYearFolderName(node.name);
    if (year !== null) yearFolders.push(yearRef(year, node));
    folders.push({
      folder: nodeRef(node),
      parent: parent === null ? null : nodeRef(parent),
      childDirectories: childDirectories.map(nodeRef).sort((a, b) => compareText(a.path, b.path)),
      childFiles: childFiles.map(nodeRef).sort((a, b) => compareText(a.path, b.path)),
      siblingDirectories: siblingDirectories
        .filter((sibling) => sibling.id !== node.id)
        .map(nodeRef)
        .sort((a, b) => compareText(a.path, b.path)),
      depth: node.depth,
      relativePath: displayInventoryPath(rootPath, node.path),
      listing: node.listing,
    });
    const childYearFolders = childDirectories
      .map((child) => {
        const childYear = parseYearFolderName(child.name);
        return childYear === null ? null : yearRef(childYear, child);
      })
      .filter((item) => item !== null)
      .sort((left, right) => left.year - right.year || compareText(left.folder.path, right.folder.path));
    if (childYearFolders.length >= MIN_YEAR_GROUP_SIZE) {
      const years = uniqueYears(childYearFolders);
      yearGroups.push({
        parent: nodeRef(node),
        parentRelativePath: displayInventoryPath(rootPath, node.path),
        years,
        yearFolders: childYearFolders,
        minYear: years[0],
        maxYear: years[years.length - 1],
        missingYears: missingYearsBetween(years[0], years[years.length - 1], years),
        consecutiveRuns: consecutiveRunsOf(years),
      });
    }
    for (const child of childDirectories) visit(child, node, childDirectories);
  }

  visit(result.root, null, []);
  folders.sort((left, right) => compareText(left.folder.path, right.folder.path));
  yearFolders.sort((left, right) => left.year - right.year || compareText(left.folder.path, right.folder.path));
  yearGroups.sort((left, right) => compareText(left.parent.path, right.parent.path));
  return {
    folders,
    yearFolders,
    yearGroups,
    repeatedChildDirectoryStructures: buildRepeatedChildDirectoryStructures(folders),
    folderChains: buildFolderChains(folders),
  };
}

function file(id, name, extras = {}) {
  return { id, name, path: id, depth: 1, kind: "file", ...extras };
}

function dir(id, name, children, extras = {}) {
  return { id, name, path: id, depth: 0, kind: "directory", listing: "read", children, ...extras };
}

function resultOf(root) {
  return { root, warnings: [], stats: { directoryCount: 0, fileCount: 0, skippedCount: 0, durationMs: 0 } };
}

assert(parseYearFolderName("2020") === 2020, "A: 2020");
assert(analyzeStructureContext(resultOf(dir("C:/bank", "bank", [dir("C:/bank/2020", "2020", [], { depth: 1 })]))).yearGroups.length === 0, "A: no lone group");

const consecutive = analyzeStructureContext(
  resultOf(dir("C:/pdf", "pdf", [dir("C:/pdf/2020", "2020", [], { depth: 1 }), dir("C:/pdf/2021", "2021", [], { depth: 1 })])),
);
assert(consecutive.yearGroups[0]?.consecutiveRuns[0]?.start === 2020 && consecutive.yearGroups[0]?.consecutiveRuns[0]?.end === 2021, "B: 2020-2021");

const gapped = analyzeStructureContext(
  resultOf(dir("C:/pdf", "pdf", [dir("C:/pdf/2020", "2020", [], { depth: 1 }), dir("C:/pdf/2022", "2022", [], { depth: 1 })])),
);
assert(gapped.yearGroups[0]?.missingYears.join(",") === "2021", "C: missing 2021");

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
assert(twoRuns.yearGroups[0]?.consecutiveRuns.length === 2, "D: two runs");
assert(twoRuns.yearGroups[0]?.missingYears.join(",") === "2022", "D: missing 2022");

assert(parseYearFolderName("1899") === null && parseYearFolderName("1900") === 1900, "E: 1899/1900");
assert(parseYearFolderName("2100") === 2100 && parseYearFolderName("2101") === null, "E: 2100/2101");

for (const name of ["2024 Rechnungen", "Rechnungen 2024", "2024-01", "20241", "24", "02024", "2024_alt"]) {
  assert(parseYearFolderName(name) === null, `F: ${name}`);
}

const split = analyzeStructureContext(
  resultOf(
    dir("C:/bestand", "bestand", [
      dir("C:/bestand/Gas", "Gas", [dir("C:/bestand/Gas/2022", "2022", [], { depth: 2 }), dir("C:/bestand/Gas/2023", "2023", [], { depth: 2 })], { depth: 1 }),
      dir("C:/bestand/Wasser", "Wasser", [dir("C:/bestand/Wasser/2023", "2023", [], { depth: 2 }), dir("C:/bestand/Wasser/2024", "2024", [], { depth: 2 })], { depth: 1 }),
    ]),
  ),
);
assert(split.yearGroups.length === 2, "G: separate parent groups");
assert(split.yearGroups[0]?.parent.name === "Gas" && split.yearGroups[1]?.parent.name === "Wasser", "G: path order");

const nested = analyzeStructureContext(
  resultOf(
    dir("C:/bank", "bank", [
      dir(
        "C:/bank/Kontoauszuege",
        "Kontoauszuege",
        [
          dir(
            "C:/bank/Kontoauszuege/PDF",
            "PDF",
            [dir("C:/bank/Kontoauszuege/PDF/2020", "2020", [], { depth: 3 }), dir("C:/bank/Kontoauszuege/PDF/2021", "2021", [], { depth: 3 })],
            { depth: 2 },
          ),
        ],
        { depth: 1 },
      ),
      dir("C:/bank/VersorgerA", "VersorgerA", [dir("C:/bank/VersorgerA/2023", "2023", [], { depth: 2 }), dir("C:/bank/VersorgerA/2024", "2024", [], { depth: 2 })], { depth: 1 }),
    ]),
  ),
);
assert(nested.yearGroups.length === 2, "H: mixed depths");
assert(nested.yearGroups.find((item) => item.parent.name === "PDF")?.parentRelativePath === "Kontoauszuege\\PDF", "H: relative parent");

const withFiles = analyzeStructureContext(
  resultOf(
    dir("C:/pdf", "pdf", [
      dir("C:/pdf/2020", "2020", [file("C:/pdf/2020/a.pdf", "a.pdf", { depth: 2 })], { depth: 1 }),
      dir("C:/pdf/2021", "2021", [], { depth: 1 }),
    ]),
  ),
);
assert(withFiles.yearGroups.length === 1, "I: files do not block recognition");
assert(withFiles.yearFolders.length === 2, "J: empty year folder still counted");

const limited = analyzeStructureContext(
  resultOf(
    dir("C:/pdf", "pdf", [
      dir("C:/pdf/2020", "2020", [], { depth: 1, listing: "depthLimited" }),
      dir("C:/pdf/2021", "2021", [], { depth: 1 }),
    ]),
  ),
);
assert(limited.yearFolders.find((item) => item.year === 2020)?.listing === "depthLimited", "K: depthLimited year folder kept");
assert(limited.yearGroups.length === 1, "K: still in group");

const unsorted = resultOf(
  dir("C:/pdf", "pdf", [dir("C:/pdf/2022", "2022", [], { depth: 1 }), dir("C:/pdf/2020", "2020", [], { depth: 1 }), dir("C:/pdf/2021", "2021", [], { depth: 1 })]),
);
assert(JSON.stringify(analyzeStructureContext(unsorted)) === JSON.stringify(analyzeStructureContext(unsorted)), "L: deterministic");
assert(analyzeStructureContext(unsorted).yearGroups[0]?.years.join(",") === "2020,2021,2022", "L: sorted years");

assert(analysisSrc.includes("repeatedFolderNames: toRepeatedGroups(folderNames)"), "M: P1-H repeated names unchanged");

const pdf = analyzeStructureContext(
  resultOf(
    dir("C:/pdf", "pdf", [
      dir("C:/pdf/2020", "2020", [], { depth: 1 }),
      dir("C:/pdf/2021", "2021", [], { depth: 1 }),
    ]),
  ),
);
const yearCtx = pdf.folders.find((item) => item.folder.path === "C:/pdf/2020");
assert(yearCtx?.parent?.name === "pdf", "parent context");
assert(yearCtx?.siblingDirectories.map((item) => item.name).join(",") === "2021", "sibling context");
assert(yearCtx?.relativePath === "2020", "relative path");
assert(pdf.folders.find((item) => item.folder.path === "C:/pdf")?.relativePath === START_FOLDER_LABEL, "root relative path");

function customer(parentPath, parentName) {
  return dir(parentPath, parentName, [
    dir(`${parentPath}/Angebote`, "Angebote", [], { depth: 2 }),
    dir(`${parentPath}/Rechnungen`, "Rechnungen", [], { depth: 2 }),
    dir(`${parentPath}/Schriftverkehr`, "Schriftverkehr", [], { depth: 2 }),
  ], { depth: 1 });
}

const sameShape = analyzeStructureContext(
  resultOf(dir("C:/kunden", "kunden", [customer("C:/kunden/A", "A"), customer("C:/kunden/B", "B")])),
);
assert(sameShape.repeatedChildDirectoryStructures.length === 1, "P1-J A: one group");
assert(sameShape.repeatedChildDirectoryStructures[0]?.childDirectoryNames.join(",") === "Angebote,Rechnungen,Schriftverkehr", "P1-J A: names");
assert(sameShape.repeatedChildDirectoryStructures[0]?.parentCount === 2, "P1-J A: two parents");

const limitedParent = analyzeStructureContext(
  resultOf(
    dir("C:/kunden", "kunden", [
      customer("C:/kunden/A", "A"),
      dir("C:/kunden/B", "B", [
        dir("C:/kunden/B/Angebote", "Angebote", [], { depth: 2 }),
        dir("C:/kunden/B/Rechnungen", "Rechnungen", [], { depth: 2 }),
        dir("C:/kunden/B/Schriftverkehr", "Schriftverkehr", [], { depth: 2 }),
      ], { depth: 1, listing: "depthLimited" }),
    ]),
  ),
);
assert(limitedParent.repeatedChildDirectoryStructures.length === 0, "P1-J H: depthLimited excluded");

const yearShape = analyzeStructureContext(
  resultOf(
    dir("C:/v", "v", [
      dir("C:/v/Gas", "Gas", [dir("C:/v/Gas/2023", "2023", [], { depth: 2 }), dir("C:/v/Gas/2024", "2024", [], { depth: 2 })], { depth: 1 }),
      dir("C:/v/Wasser", "Wasser", [dir("C:/v/Wasser/2023", "2023", [], { depth: 2 }), dir("C:/v/Wasser/2024", "2024", [], { depth: 2 })], { depth: 1 }),
    ]),
  ),
);
assert(yearShape.yearGroups.length === 2, "P1-J J: year groups unchanged");
assert(yearShape.repeatedChildDirectoryStructures.length === 1, "P1-J J: years also form a general group");

function linear(parts, base, depth) {
  const head = parts[0];
  const path = `${base}/${head.name}`;
  const rest = parts.slice(1);
  const children = [...(head.extraChildren ?? [])];
  if (rest.length > 0) children.unshift(linear(rest, path, depth + 1));
  return dir(path, head.name, children, { depth, ...head.extras });
}

const chainThree = analyzeStructureContext(
  resultOf(
    dir("C:/bestand", "bestand", [
      linear([{ name: "A" }, { name: "B" }, { name: "C" }], "C:/bestand", 1),
      dir("C:/bestand/sonst", "sonst", [], { depth: 1 }),
    ]),
  ),
);
assert(chainThree.folderChains.length === 1, "P1-J chain A: one chain");
assert(chainThree.folderChains[0]?.folderCount === 3, "P1-J chain A: length 3");
assert(chainThree.folderChains[0]?.folders.map((item) => item.name).join(">") === "A>B>C", "P1-J chain A: names");

const chainTwo = analyzeStructureContext(
  resultOf(
    dir("C:/bestand", "bestand", [
      linear([{ name: "A" }, { name: "B" }], "C:/bestand", 1),
      dir("C:/bestand/sonst", "sonst", [], { depth: 1 }),
    ]),
  ),
);
assert(chainTwo.folderChains.length === 0, "P1-J chain B: two folders are not a chain");

const chainFour = analyzeStructureContext(
  resultOf(
    dir("C:/bestand", "bestand", [
      linear([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }], "C:/bestand", 1),
      dir("C:/bestand/sonst", "sonst", [], { depth: 1 }),
    ]),
  ),
);
assert(chainFour.folderChains.length === 1, "P1-J chain C: one maximal chain");
assert(chainFour.folderChains[0]?.folderCount === 4, "P1-J chain C: length 4");

const chainLimited = analyzeStructureContext(
  resultOf(
    dir("C:/bestand", "bestand", [
      linear(
        [{ name: "W" }, { name: "A" }, { name: "B", extras: { listing: "depthLimited" } }, { name: "C" }],
        "C:/bestand",
        1,
      ),
      dir("C:/bestand/sonst", "sonst", [], { depth: 1 }),
    ]),
  ),
);
assert(chainLimited.folderChains[0]?.folders.map((item) => item.name).join(">") === "W>A>B", "P1-J chain F: stops at depthLimited");
assert(chainLimited.folderChains[0]?.endListing === "depthLimited", "P1-J chain F: listing kept");

const chainRoot = analyzeStructureContext(
  resultOf(dir("C:/root", "root", [linear([{ name: "A" }, { name: "B" }], "C:/root", 1)])),
);
assert(chainRoot.folderChains[0]?.startRelativePath === START_FOLDER_LABEL, "P1-J chain I: root is Startordner");
assert(sameShape.folderChains.length === 0, "P1-J chain N: customer structure is not a chain");
assert(yearShape.folderChains.length === 0, "P1-J chain M: year siblings are not a chain");

console.log("structure context checks passed");
