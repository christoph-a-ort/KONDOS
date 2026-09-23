// P1-K slice 1: repeated folder names joined with structure context. Not imported by the app.

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

const contextSrc = read("src/ui/inventoryRepeatedNameContext.ts");
const checkSrc = read("src/ui/inventoryRepeatedNameContextCheck.ts");
const analysisSrc = read("src/ui/inventoryAnalysis.ts");
const overviewSrc = read("src/ui/inventoryOverview.ts");
const overviewUi = read("src/ui/InventoryOverviewPanel.tsx");
const treeViewSrc = read("src/ui/TreeView.tsx");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const appCss = read("src/App.css");

assert(contextSrc.includes("export function analyzeRepeatedFolderNameContext"), "core: analyze exported");
assert(contextSrc.includes("folderContextByPath"), "core: joins via folderContextByPath");
assert(contextSrc.includes("joinFound"), "core: missing join is explicit");
assert(contextSrc.includes("parentInRepeatedChildDirectoryStructure"), "core: parent P1-J flag");
assert(contextSrc.includes("inFolderChain"), "core: chain membership flag");
assert(contextSrc.includes("isYearFolderName"), "core: year name flag");
assert(contextSrc.includes("yearGroup"), "core: optional year group context");
assert(checkSrc.includes("runInventoryRepeatedNameContextCheck"), "ts checks exist");
assert(workbenchSrc.includes("runInventoryRepeatedNameContextCheck"), "wired via workbench checks");
assert(!overviewUi.includes("analyzeRepeatedFolderNameContext"), "no overview UI yet");
assert(!overviewSrc.includes("analyzeRepeatedFolderNameContext"), "no overview mapping yet");
assert(!treeViewSrc.includes("analyzeRepeatedFolderNameContext"), "no TreeView wiring yet");
assert(!treeViewSrc.includes("[P1-J TEMP]") && !treeViewSrc.includes("[P1-K TEMP]"), "no temp console");
assert(!appCss.includes("repeated-name-context"), "no CSS for P1-K UI");
assert(analysisSrc.includes("repeatedFolderNames"), "P1-H field remains");
assert(!analysisSrc.includes("analyzeRepeatedFolderNameContext"), "P1-H not owning P1-K");
assert(!contextSrc.includes("start_scan"), "no scan IPC");
assert(!contextSrc.includes("ContentCache"), "no ContentCache");
assert(!contextSrc.toLocaleLowerCase().includes("duplikat"), "no Duplikat");
assert(!contextSrc.toLocaleLowerCase().includes("redundant"), "no redundant");
assert(!contextSrc.includes("unnötig") && !contextSrc.includes("zusammenführen"), "no action rating");
assert(checkSrc.includes('"A: two Bank occurrences"'), "test A: normal name");
assert(checkSrc.includes('"C: both 2023s belong to a yearGroup"'), "test C: year group");
assert(checkSrc.includes('"D: not a yearGroup member"'), "test D: year name without group");
assert(checkSrc.includes('"G: A>B>C member is in a folder chain"'), "test G: chain");
assert(checkSrc.includes('"N: missing join is marked"'), "test N: missing join");

console.log("p1-k checks passed");
