// P1-L slice 1: general file structure context. Not imported by the app.

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

const contextSrc = read("src/ui/inventoryFileStructureContext.ts");
const checkSrc = read("src/ui/inventoryFileStructureContextCheck.ts");
const overviewSrc = read("src/ui/inventoryOverview.ts");
const overviewUi = read("src/ui/InventoryOverviewPanel.tsx");
const treeViewSrc = read("src/ui/TreeView.tsx");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const appCss = read("src/App.css");
const analysisSrc = read("src/ui/inventoryAnalysis.ts");
const structureSrc = read("src/ui/inventoryStructureContext.ts");
const repeatedSrc = read("src/ui/inventoryRepeatedNameContext.ts");

assert(contextSrc.includes("export function analyzeFileStructureContext"), "core: analyze exported");
assert(contextSrc.includes("export interface FileStructureContext"), "core: FileStructureContext type");
assert(contextSrc.includes("joinFound"), "core: missing join is explicit");
assert(contextSrc.includes("fileExtensionKey"), "core: reuses extension helper");
assert(contextSrc.includes("displayInventoryPath"), "core: reuses relative path helper");
assert(contextSrc.includes("parentIsYearFolderName"), "core: year parent flag");
assert(contextSrc.includes("yearGroup"), "core: optional year group");
assert(contextSrc.includes("parentInRepeatedChildDirectoryStructure"), "core: parent P1-J");
assert(contextSrc.includes("grandparentInRepeatedChildDirectoryStructure"), "core: grandparent P1-J");
assert(contextSrc.includes("parentInFolderChain"), "core: chain membership");
assert(contextSrc.includes("parentIsFolderChainEnd"), "core: chain end");
assert(contextSrc.includes("siblingFileCount"), "core: sibling files");
assert(checkSrc.includes("runInventoryFileStructureContextCheck"), "ts checks exist");
assert(workbenchSrc.includes("runInventoryFileStructureContextCheck"), "wired via workbench");
assert(!overviewUi.includes("analyzeFileStructureContext"), "no overview UI yet");
assert(!overviewSrc.includes("analyzeFileStructureContext"), "no overview mapping yet");
assert(!treeViewSrc.includes("analyzeFileStructureContext"), "no TreeView wiring yet");
assert(!treeViewSrc.includes("[P1-L TEMP]"), "no temp console");
assert(!appCss.includes("file-structure-context"), "no CSS for P1-L UI");
assert(!analysisSrc.includes("analyzeFileStructureContext"), "P1-H not owning P1-L");
assert(!structureSrc.includes("analyzeFileStructureContext"), "P1-I/J not owning P1-L");
assert(!repeatedSrc.includes("analyzeFileStructureContext"), "P1-K not owning P1-L");
assert(!contextSrc.includes("start_scan"), "no scan IPC");
assert(!contextSrc.includes("ContentCache"), "no ContentCache");
assert(!contextSrc.toLocaleLowerCase().includes("duplikat"), "no Duplikat");
assert(!contextSrc.toLocaleLowerCase().includes("redundant"), "no redundant");
assert(!contextSrc.includes("unnötig") && !contextSrc.includes("verschieben"), "no action rating");
assert(checkSrc.includes('"A: join found"'), "test A");
assert(checkSrc.includes('"B: yearGroup present"'), "test B");
assert(checkSrc.includes('"C: not a yearGroup member"'), "test C");
assert(checkSrc.includes('"F: .tar.gz → .gz"') || checkSrc.includes('"F: .tar.gz'), "test F");
assert(checkSrc.includes('"L: single-file folder has no siblings"'), "test L");
assert(checkSrc.includes('"Q: parent A is P1-J structure parent"'), "test Q");
assert(checkSrc.includes('"R: grandparent Gas in P1-J structure"'), "test R");
assert(checkSrc.includes('"U: missing parent join marked"'), "test U");

console.log("p1-l checks passed");
