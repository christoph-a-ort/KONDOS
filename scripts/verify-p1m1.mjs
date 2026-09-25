// P1-M slice 1: exact folder direct-file structures. Wired into IST overview via H3.

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

const contextSrc = read("src/ui/inventoryExactFolderFileStructure.ts");
const checkSrc = read("src/ui/inventoryExactFolderFileStructureCheck.ts");
const structureSrc = read("src/ui/inventoryStructureContext.ts");
const analysisSrc = read("src/ui/inventoryAnalysis.ts");
const fileContextSrc = read("src/ui/inventoryFileStructureContext.ts");
const repeatedFileSrc = read("src/ui/inventoryRepeatedFileNameContext.ts");
const repeatedFolderSrc = read("src/ui/inventoryRepeatedNameContext.ts");
const overviewSrc = read("src/ui/inventoryOverview.ts");
const overviewUi = read("src/ui/InventoryOverviewPanel.tsx");
const treeViewSrc = read("src/ui/TreeView.tsx");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const appCss = read("src/App.css");

assert(contextSrc.includes("export function analyzeExactFolderFileStructures"), "core: analyze exported");
assert(contextSrc.includes("exactDirectFileNameStructures"), "core: name structures");
assert(contextSrc.includes("exactExtensionMultisets"), "core: extension multisets");
assert(contextSrc.includes("fileExtensionKey"), "core: reuses fileExtensionKey");
assert(contextSrc.includes("NO_EXTENSION_KEY"), "core: NO_EXTENSION_KEY");
assert(contextSrc.includes('listing === "read"'), "core: only listing=read");
assert(contextSrc.includes("childFiles.length >= 1"), "core: requires at least one direct file");
assert(contextSrc.includes("toLocaleLowerCase"), "core: name normalization");
assert(!contextSrc.includes("jaccard") && !contextSrc.includes("levenshtein"), "no similarity");
assert(!contextSrc.includes("Hash") && !contextSrc.includes("hash"), "no hashing");
assert(checkSrc.includes("runInventoryExactFolderFileStructureCheck"), "ts checks exist");
assert(workbenchSrc.includes("runInventoryExactFolderFileStructureCheck"), "wired via workbench");
assert(treeViewSrc.includes("analyzeExactFolderFileStructures"), "TreeView wires H1");
assert(treeViewSrc.includes("analyzeExactFolderFileStructures(structureContext)"), "TreeView memos H1 on structure");
assert(overviewUi.includes("exactFolderStructures"), "overview panel accepts H1 context");
assert(overviewUi.includes("exactNameTitle"), "overview shows exact name patterns");
assert(!structureSrc.includes("analyzeExactFolderFileStructures"), "P1-I/J not owning P1-M");
assert(!analysisSrc.includes("analyzeExactFolderFileStructures"), "P1-H not owning P1-M");
assert(!fileContextSrc.includes("analyzeExactFolderFileStructures"), "P1-L H1 not owning P1-M");
assert(!repeatedFileSrc.includes("analyzeExactFolderFileStructures"), "P1-L H2 not owning P1-M");
assert(!repeatedFolderSrc.includes("analyzeExactFolderFileStructures"), "P1-K not owning P1-M");
assert(!contextSrc.includes("start_scan"), "no scan IPC");
assert(!contextSrc.includes("ContentCache"), "no ContentCache");
assert(!contextSrc.toLocaleLowerCase().includes("duplikat"), "no Duplikat");
assert(!contextSrc.toLocaleLowerCase().includes("redundant"), "no redundant");
assert(!contextSrc.includes("unnötig") && !contextSrc.includes("aufräumen"), "no action rating");
assert(checkSrc.includes('"A1: one name-structure group"'), "test A1");
assert(checkSrc.includes('"A3: case-insensitive name set"'), "test A3");
assert(checkSrc.includes('"A8: empty folders form no name group"'), "test A8");
assert(checkSrc.includes('"A10: incomplete/depthLimited excluded'), "test A10");
assert(checkSrc.includes('"B1: one extension multiset group"'), "test B1");
assert(checkSrc.includes('"B5/B6: NO_EXTENSION_KEY multiset"'), "test B5");
assert(checkSrc.includes('"B8: .tar.gz → .gz multiset"') || checkSrc.includes('"B8: .tar.gz'), "test B8");
assert(checkSrc.includes('"C-A: different names → no name group"'), "test C-A");
assert(checkSrc.includes('"C-B: equal names ⇒ equal extension multiset'), "test C-B");

console.log("p1-m1 checks passed");
