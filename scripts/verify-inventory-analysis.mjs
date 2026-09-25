// Dev-side inventory analysis check. Mirrors src/ui/inventoryAnalysis.ts.
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

const analysisSrc = read("src/ui/inventoryAnalysis.ts");
const checkSrc = read("src/ui/inventoryAnalysisCheck.ts");
const overviewSrc = read("src/ui/inventoryOverview.ts");
const overviewUi = read("src/ui/InventoryOverviewPanel.tsx");
const overviewCheck = read("src/ui/inventoryOverviewCheck.ts");
const appSrc = read("src/App.tsx");
const treeViewSrc = read("src/ui/TreeView.tsx");

assert(analysisSrc.includes("export function analyzeInventory"), "core: analyzeInventory exported");
assert(analysisSrc.includes("export interface InventoryAnalysis"), "core: InventoryAnalysis type");
assert(!analysisSrc.toLowerCase().includes("duplicate"), "core: no duplicate label");
assert(!analysisSrc.toLocaleLowerCase().includes("duplikat"), "core: no Duplikat label");
assert(analysisSrc.includes("fileExtensionKey"), "core: reuses fileExtensionKey");
assert(analysisSrc.includes("unconfirmedEmptyLookingFolders"), "core: conservative empty-looking folders");
assert(!appSrc.includes("inventoryAnalysis"), "App does not own inventory analysis");
assert(treeViewSrc.includes("useMemo(() => analyzeInventory(result), [result])"), "TreeView memos analysis on ScanResult");
assert(!treeViewSrc.includes("analyzeInventory(viewRoot)"), "analysis ignores display tree");
assert(treeViewSrc.includes("useMemo(() => analyzeStructureContext(result), [result])"), "TreeView memos structure context on ScanResult");
assert(treeViewSrc.includes("analyzeFileStructureContext(result, structureContext)"), "TreeView memos file structure context");
assert(treeViewSrc.includes("analyzeExactFolderFileStructures(structureContext)"), "TreeView memos exact folder structures");
assert(treeViewSrc.includes("analyzeFileNameSyntax(fileStructureContext)"), "TreeView memos file-name syntax");
assert(!treeViewSrc.includes("analyzeStructureContext(viewRoot)"), "structure context ignores display tree");
assert(treeViewSrc.includes("structure={structureContext}"), "overview receives structure context");
assert(treeViewSrc.includes("exactFolderStructures={exactFolderStructures}"), "overview receives exact structures");
assert(treeViewSrc.includes("fileNameSyntax={fileNameSyntax}"), "overview receives file-name syntax");
assert(treeViewSrc.includes("structure={null}"), "no-scan overview has no leftover structure");
assert(treeViewSrc.includes("InventoryOverviewPanel"), "IST overview panel is wired");
assert(treeViewSrc.includes("analysis={null}"), "no-scan overview is empty");
assert(overviewSrc.includes("IST-Überblick"), "user-facing title");
assert(overviewSrc.includes("Zuerst einen Ordner einlesen."), "no-scan copy");
assert(overviewSrc.includes("DIRECT_FILE_RANK_LIMIT = 10"), "top-10 limit");
assert(overviewSrc.includes("formatByteSize"), "shared size formatter");
assert(overviewSrc.includes("Gleiche Dateinamen bedeuten nicht automatisch identische"), "no-content-identity hint");
assert(!overviewSrc.toLocaleLowerCase().includes("duplikat"), "overview copy has no Duplikate");
assert(overviewSrc.includes("Ordner nach Anzahl direkt enthaltener Dateien"), "neutral ranking title");
assert(!overviewSrc.includes("Ordner mit vielen direkt enthaltenen Dateien"), "old ranking title removed");
assert(overviewSrc.includes("Startordner"), "root display label");
assert(overviewSrc.includes("fileTypes: true") && overviewSrc.includes("busyFolders: true"), "default open sections");
assert(overviewSrc.includes("yearStructures: false"), "year structures closed by default");
assert(overviewSrc.includes("Jahresstrukturen"), "year section title");
assert(overviewSrc.includes("Keine wiederkehrende Jahresstruktur erkannt."), "year empty copy");
assert(overviewSrc.includes("Nicht vorhandene Jahresordner innerhalb der Spanne"), "neutral missing-year wording");
assert(!overviewSrc.toLocaleLowerCase().includes("fehlende jahre"), "overview copy has no fehlende Jahre");
assert(overviewUi.includes("SECTION_YEAR_STRUCTURES"), "panel renders year structures");
assert(overviewUi.includes("patterns.title"), "panel renders Muster after years");
assert(overviewUi.includes("DEFAULT_PATTERN_SECTION_OPEN"), "panel uses pattern defaults");
assert(overviewUi.includes("davon Unterordner"), "subdirectory row");
assert(overviewUi.includes("FILE_TYPE_TOTAL_LABEL"), "file type totals");
assert(treeViewSrc.includes("rootPath={result.root.path}"), "overview uses scan root for display paths");
assert(overviewUi.includes("IST-Überblick") || overviewUi.includes("view.title"), "panel uses overview title");
assert(checkSrc.includes("runInventoryAnalysisCheck"), "ts analysis check exists");
assert(overviewCheck.includes("runInventoryOverviewCheck"), "ts overview check exists");
assert(read("src/ui/treeWorkbenchCheck.ts").includes("runInventoryAnalysisCheck"), "analysis check is wired");
assert(read("src/ui/treeWorkbenchCheck.ts").includes("runInventoryOverviewCheck"), "overview check is wired");
assert(read("src/ui/treeWorkbenchCheck.ts").includes("runInventoryPatternOverviewCheck"), "pattern check is wired");
assert(read("src/ui/inventoryPatternOverview.ts").includes('SECTION_PATTERNS = "Muster"'), "pattern section title");
assert(read("src/ui/inventoryPatternOverview.ts").includes("patterns: false"), "Muster closed by default");

const NO_EXTENSION_KEY = "";
const NO_EXTENSION_LABEL = "Ohne Dateiendung";

function isDirectory(node) {
  return node.kind === "directory";
}

function isFile(node) {
  return node.kind === "file";
}

function fileExtensionKey(name) {
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === name.length - 1) return null;
  return name.slice(lastDot).toLocaleLowerCase();
}

function normalizeFsPath(path) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function compareText(left, right) {
  const order = left.localeCompare(right, undefined, { sensitivity: "base" });
  if (order !== 0) return order;
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCountThenText(leftCount, rightCount, leftText, rightText) {
  if (leftCount !== rightCount) return rightCount - leftCount;
  return compareText(leftText, rightText);
}

function analyzeInventory(result) {
  const warnedPaths = new Set();
  for (const warning of result.warnings) {
    const normalized = normalizeFsPath(warning.path);
    if (normalized.length > 0) warnedPaths.add(normalized);
  }
  let fileCount = 0;
  let directoryCount = 0;
  let knownSizeBytes = 0;
  let filesWithoutKnownSize = 0;
  let maxObservedDepth = result.root.depth;
  let depthLimitedFolderCount = 0;
  const typeBuckets = new Map();
  const folderNames = new Map();
  const fileNames = new Map();
  const occupancy = [];
  const emptyFolders = [];
  const singleDirectFileFolders = [];
  const unconfirmedEmptyLookingFolders = [];

  function addName(buckets, name, path) {
    const key = name.toLocaleLowerCase();
    const existing = buckets.get(key);
    if (existing === undefined) buckets.set(key, { name, paths: [path] });
    else existing.paths.push(path);
  }

  function nodeRef(node) {
    return { id: node.id, name: node.name, path: node.path, depth: node.depth };
  }

  function visit(node) {
    if (node.depth > maxObservedDepth) maxObservedDepth = node.depth;
    if (isFile(node)) {
      fileCount += 1;
      const hasSize = node.sizeBytes !== undefined;
      if (hasSize) knownSizeBytes += node.sizeBytes;
      else filesWithoutKnownSize += 1;
      const extension = fileExtensionKey(node.name) ?? NO_EXTENSION_KEY;
      const label = extension === NO_EXTENSION_KEY ? NO_EXTENSION_LABEL : extension;
      const bucket = typeBuckets.get(extension);
      if (bucket === undefined) {
        typeBuckets.set(extension, {
          extension,
          label,
          fileCount: 1,
          knownSizeBytes: hasSize ? node.sizeBytes : 0,
        });
      } else {
        bucket.fileCount += 1;
        if (hasSize) bucket.knownSizeBytes += node.sizeBytes;
      }
      addName(fileNames, node.name, node.path);
      return;
    }
    if (!isDirectory(node)) return;
    directoryCount += 1;
    if (node.listing === "depthLimited") depthLimitedFolderCount += 1;
    addName(folderNames, node.name, node.path);
    let directFileCount = 0;
    let directDirectoryCount = 0;
    let directKnownSizeBytes = 0;
    for (const child of node.children) {
      if (isDirectory(child)) directDirectoryCount += 1;
      else {
        directFileCount += 1;
        if (isFile(child) && child.sizeBytes !== undefined) directKnownSizeBytes += child.sizeBytes;
      }
    }
    occupancy.push({
      id: node.id,
      name: node.name,
      path: node.path,
      depth: node.depth,
      listing: node.listing,
      directFileCount,
      directDirectoryCount,
      directKnownSizeBytes,
    });
    if (node.children.length === 0) {
      const looksEmpty = node.listing === "read";
      const hasWarning =
        warnedPaths.has(normalizeFsPath(node.path)) || warnedPaths.has(normalizeFsPath(node.id));
      if (looksEmpty && hasWarning) unconfirmedEmptyLookingFolders.push(nodeRef(node));
      else if (looksEmpty && !hasWarning) emptyFolders.push(nodeRef(node));
    }
    if (directFileCount === 1) singleDirectFileFolders.push(nodeRef(node));
    for (const child of node.children) visit(child);
  }

  visit(result.root);

  const fileTypes = [...typeBuckets.values()].sort((left, right) =>
    compareCountThenText(left.fileCount, right.fileCount, left.extension, right.extension),
  );
  emptyFolders.sort((left, right) => compareText(left.path, right.path));
  singleDirectFileFolders.sort((left, right) => compareText(left.path, right.path));
  unconfirmedEmptyLookingFolders.sort((left, right) => compareText(left.path, right.path));
  const foldersByDirectFileCount = occupancy.slice().sort((left, right) =>
    compareCountThenText(left.directFileCount, right.directFileCount, left.path, right.path),
  );

  function toRepeatedGroups(buckets) {
    const groups = [];
    for (const bucket of buckets.values()) {
      if (bucket.paths.length < 2) continue;
      groups.push({
        name: bucket.name,
        count: bucket.paths.length,
        paths: bucket.paths.slice().sort(compareText),
      });
    }
    groups.sort((left, right) => compareCountThenText(left.count, right.count, left.name, right.name));
    return groups;
  }

  return {
    fileCount,
    directoryCount,
    knownSizeBytes,
    filesWithoutKnownSize,
    maxObservedDepth,
    depthLimitedFolderCount,
    fileTypes,
    folderOccupancy: occupancy,
    emptyFolders,
    singleDirectFileFolders,
    foldersByDirectFileCount,
    repeatedFolderNames: toRepeatedGroups(folderNames),
    repeatedFileNames: toRepeatedGroups(fileNames),
    unconfirmedEmptyLookingFolders,
  };
}

function file(id, name, extras = {}) {
  return { id, name, path: id, depth: 1, kind: "file", ...extras };
}

function dir(id, name, children, extras = {}) {
  return { id, name, path: id, depth: 0, kind: "directory", listing: "read", children, ...extras };
}

function resultOf(root, warnings = []) {
  return { root, warnings, stats: { directoryCount: 0, fileCount: 0, skippedCount: 0, durationMs: 0 } };
}

const empty = analyzeInventory(resultOf(dir("C:/leer", "leer", [])));
assert(empty.fileCount === 0 && empty.directoryCount === 1, "empty: counts");
assert(empty.maxObservedDepth === 0 && empty.emptyFolders[0]?.path === "C:/leer", "empty: root empty");

const mixed = dir("C:/bestand", "bestand", [
  dir(
    "C:/bestand/Vertraege",
    "Vertraege",
    [
      file("C:/bestand/Vertraege/Angebot.PDF", "Angebot.PDF", { depth: 2, sizeBytes: 100 }),
      file("C:/bestand/Vertraege/Protokoll.pdf", "Protokoll.pdf", { depth: 2, sizeBytes: 40 }),
      file("C:/bestand/Vertraege/README", "README", { depth: 2 }),
      file("C:/bestand/Vertraege/Bild.JPG", "Bild.JPG", { depth: 2, sizeBytes: 10 }),
    ],
    { depth: 1 },
  ),
  dir(
    "C:/bestand/Fotos",
    "Fotos",
    [
      file("C:/bestand/Fotos/Bild.jpg", "Bild.jpg", { depth: 2, sizeBytes: 20 }),
      file("C:/bestand/Fotos/Urlaub.png", "Urlaub.png", { depth: 2, sizeBytes: 5 }),
    ],
    { depth: 1 },
  ),
  dir("C:/bestand/leer", "leer", [], { depth: 1 }),
  dir("C:/bestand/grenze", "grenze", [], { depth: 1, listing: "depthLimited" }),
  dir("C:/bestand/einzeln", "einzeln", [file("C:/bestand/einzeln/allein.txt", "allein.txt", { depth: 2, sizeBytes: 3 })], {
    depth: 1,
  }),
  dir(
    "C:/bestand/viele",
    "viele",
    [
      file("C:/bestand/viele/a.txt", "a.txt", { depth: 2, sizeBytes: 1 }),
      file("C:/bestand/viele/b.txt", "b.txt", { depth: 2, sizeBytes: 1 }),
      file("C:/bestand/viele/c.txt", "c.txt", { depth: 2, sizeBytes: 1 }),
    ],
    { depth: 1 },
  ),
  dir("C:/bestand/vertraege", "vertraege", [file("C:/bestand/vertraege/Notiz.txt", "Notiz.txt", { depth: 2, sizeBytes: 2 })], {
    depth: 1,
  }),
]);

const analysis = analyzeInventory(resultOf(mixed));
assert(analysis.fileCount === 11, "mixed: files");
assert(analysis.directoryCount === 8, "mixed: folders including root");
assert(analysis.filesWithoutKnownSize === 1, "mixed: unknown size");
assert(analysis.knownSizeBytes === 183, "mixed: known size sum");
assert(analysis.maxObservedDepth === 2, "mixed: observed depth");
assert(analysis.depthLimitedFolderCount === 1, "mixed: depthLimited count");
const pdf = analysis.fileTypes.find((item) => item.extension === ".pdf");
assert(pdf?.fileCount === 2 && pdf.knownSizeBytes === 140, "types: PDF/pdf merged");
const none = analysis.fileTypes.find((item) => item.extension === NO_EXTENSION_KEY);
assert(none?.label === NO_EXTENSION_LABEL && none.fileCount === 1, "types: ohne Endung");
const typeOrder = analysis.fileTypes.map((item) => item.extension);
assert(typeOrder.indexOf(".jpg") < typeOrder.indexOf(".pdf"), "types: equal count by extension");
assert(!analysis.emptyFolders.some((item) => item.path === "C:/bestand/grenze"), "depthLimited not empty");
assert(analysis.emptyFolders.some((item) => item.path === "C:/bestand/leer"), "true empty folder");
assert(analysis.singleDirectFileFolders.some((item) => item.path === "C:/bestand/einzeln"), "single file folder");
assert(analysis.foldersByDirectFileCount[0]?.path === "C:/bestand/Vertraege", "rank: most files first");
assert(analysis.foldersByDirectFileCount[1]?.path === "C:/bestand/viele", "rank: second");
const rootOcc = analysis.folderOccupancy.find((item) => item.path === "C:/bestand");
assert(rootOcc?.directFileCount === 0 && rootOcc.directKnownSizeBytes === 0, "occupancy: direct only");
assert(
  analysis.repeatedFolderNames.some((item) => item.count === 2 && item.name.toLocaleLowerCase() === "vertraege"),
  "repeated folders",
);
assert(
  analysis.repeatedFileNames.some((item) => item.count === 2 && item.name.toLocaleLowerCase() === "bild.jpg"),
  "repeated files",
);
const blob = JSON.stringify(analysis).toLowerCase();
assert(!blob.includes("duplikat") && !blob.includes("duplicate"), "not labeled as duplicates");

const junction = analyzeInventory(
  resultOf(dir("C:/links", "links", [dir("C:/links/loop", "loop", [], { depth: 1 })]), [
    { path: "C:/links/loop", code: "skipped", message: "Dateisystemverweis wird nicht gefolgt." },
  ]),
);
assert(!junction.emptyFolders.some((item) => item.path === "C:/links/loop"), "warned reparse not empty");
assert(
  junction.unconfirmedEmptyLookingFolders.some((item) => item.path === "C:/links/loop"),
  "warned reparse unconfirmed",
);
const unknownReparse = analyzeInventory(resultOf(dir("C:/x", "x", [dir("C:/x/loop", "loop", [], { depth: 1 })])));
assert(unknownReparse.emptyFolders.some((item) => item.path === "C:/x/loop"), "limitation: no warning looks empty");

const incomplete = analyzeInventory(
  resultOf(dir("C:/inc", "inc", [dir("C:/inc/denied", "denied", [], { depth: 1, listing: "incomplete" })])),
);
assert(!incomplete.emptyFolders.some((item) => item.path === "C:/inc/denied"), "incomplete not empty");

const displaySubset = analysis.fileTypes.find((item) => item.extension === ".pdf")?.fileCount;
assert(analysis.fileCount !== displaySubset, "analysis is not a display-filter subset");
assert(JSON.stringify(analyzeInventory(resultOf(mixed))) === JSON.stringify(analysis), "deterministic");

const tied = analyzeInventory(
  resultOf(
    dir("C:/t", "t", [
      dir("C:/t/B", "B", [file("C:/t/B/1.txt", "1.txt", { depth: 2, sizeBytes: 1 })], { depth: 1 }),
      dir("C:/t/A", "A", [file("C:/t/A/1.txt", "1.txt", { depth: 2, sizeBytes: 1 })], { depth: 1 }),
    ]),
  ),
);
assert(tied.foldersByDirectFileCount[0]?.path === "C:/t/A", "rank tie uses path");

const rankedChildren = [];
for (let index = 1; index <= 12; index += 1) {
  const files = [];
  for (let fileIndex = 0; fileIndex < index; fileIndex += 1) {
    files.push(file(`C:/r/d${index}/f${fileIndex}.txt`, `f${fileIndex}.txt`, { depth: 2, sizeBytes: 1 }));
  }
  rankedChildren.push(dir(`C:/r/d${index}`, `d${index}`, files, { depth: 1 }));
}
const ranked = analyzeInventory(resultOf(dir("C:/r", "r", rankedChildren)));
const topTen = ranked.foldersByDirectFileCount.filter((item) => item.directFileCount > 0).slice(0, 10);
assert(topTen.length === 10, "ui rank cap");
assert(topTen[0].name === "d12" && topTen[9].name === "d3", "ui rank order");

console.log("inventory analysis checks passed");
