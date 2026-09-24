// P1-L slice 2: repeated file names joined with file structure context. Not imported by the app.

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

const contextSrc = read("src/ui/inventoryRepeatedFileNameContext.ts");
const checkSrc = read("src/ui/inventoryRepeatedFileNameContextCheck.ts");
const fileContextSrc = read("src/ui/inventoryFileStructureContext.ts");
const analysisSrc = read("src/ui/inventoryAnalysis.ts");
const structureSrc = read("src/ui/inventoryStructureContext.ts");
const repeatedFolderSrc = read("src/ui/inventoryRepeatedNameContext.ts");
const overviewSrc = read("src/ui/inventoryOverview.ts");
const overviewUi = read("src/ui/InventoryOverviewPanel.tsx");
const treeViewSrc = read("src/ui/TreeView.tsx");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const appCss = read("src/App.css");

assert(contextSrc.includes("export function analyzeRepeatedFileNameContext"), "core: analyze exported");
assert(contextSrc.includes("fileContext"), "core: references FileStructureContext");
assert(contextSrc.includes("joinFound"), "core: missing join is explicit");
assert(contextSrc.includes("analysis.repeatedFileNames"), "core: uses P1-H repeatedFileNames");
assert(contextSrc.includes("InventoryFileStructureContext"), "core: uses P1-L H1");
assert(!contextSrc.includes("analyzeInventory("), "S: no own inventory scan/walk");
assert(!contextSrc.includes("visit("), "S: no ScanResult walk");
assert(checkSrc.includes("runInventoryRepeatedFileNameContextCheck"), "ts checks exist");
assert(workbenchSrc.includes("runInventoryRepeatedFileNameContextCheck"), "wired via workbench");
assert(!overviewUi.includes("analyzeRepeatedFileNameContext"), "no overview UI yet");
assert(!overviewSrc.includes("analyzeRepeatedFileNameContext"), "no overview mapping yet");
assert(!treeViewSrc.includes("analyzeRepeatedFileNameContext"), "no TreeView wiring yet");
assert(!treeViewSrc.includes("[P1-L TEMP]") && !treeViewSrc.includes("P1-L REAL TEST"), "no temp console");
assert(!appCss.includes("repeated-file-name-context"), "no CSS for P1-L2 UI");
assert(analysisSrc.includes("repeatedFileNames"), "P1-H field remains");
assert(!analysisSrc.includes("analyzeRepeatedFileNameContext"), "P1-H not owning P1-L2");
assert(!fileContextSrc.includes("analyzeRepeatedFileNameContext"), "W: P1-L H1 not owning P1-L2");
assert(!structureSrc.includes("analyzeRepeatedFileNameContext"), "P1-I/J not owning P1-L2");
assert(!repeatedFolderSrc.includes("analyzeRepeatedFileNameContext"), "X: P1-K not owning P1-L2");
assert(!contextSrc.includes("start_scan"), "no scan IPC");
assert(!contextSrc.includes("ContentCache"), "no ContentCache");
assert(!contextSrc.toLocaleLowerCase().includes("duplikat"), "no Duplikat");
assert(!contextSrc.toLocaleLowerCase().includes("redundant"), "no redundant");
assert(!contextSrc.includes("sameContent") && !contextSrc.includes("identicalContent"), "no content identity");
assert(!contextSrc.includes("unnötig") && !contextSrc.includes("verschieben"), "no action rating");
assert(checkSrc.includes('"A: normal repeated file name"'), "test A");
assert(checkSrc.includes('"B: Bank parent"'), "test B");
assert(checkSrc.includes('"C: repeated name in two year folders"'), "test C");
assert(checkSrc.includes('"D: yearGroup context for both occurrences"'), "test D");
assert(checkSrc.includes('"E: one P1-H group"'), "test E");
assert(checkSrc.includes('"O: missing join is marked"'), "test O");
assert(checkSrc.includes('"P: missing join stays as occurrence"'), "test P");
assert(checkSrc.includes('"T: occurrences sorted by relative path"'), "test T");
assert(checkSrc.includes('"U: no duplicate rating"'), "test U");

console.log("p1-l2 checks passed");
