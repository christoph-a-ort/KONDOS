// P1-J slice 1: exact repeated direct child-directory structures. Not imported by the app.

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
const overviewSrc = read("src/ui/inventoryOverview.ts");
const overviewUi = read("src/ui/InventoryOverviewPanel.tsx");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");

assert(contextSrc.includes("repeatedChildDirectoryStructures"), "core: field on InventoryStructureContext");
assert(contextSrc.includes("MIN_CHILD_DIRECTORY_STRUCTURE_SIZE = 2"), "core: min 2 child directories");
assert(contextSrc.includes("MIN_REPEATED_STRUCTURE_PARENTS = 2"), "core: min 2 parents");
assert(contextSrc.includes("MIN_FOLDER_CHAIN_LENGTH = 3"), "core: chain min 3");
assert(contextSrc.includes("folderChains"), "core: folderChains field");
assert(contextSrc.includes('listing !== "read"'), "core: only listing read");
assert(contextSrc.includes("toLocaleLowerCase()"), "core: case-insensitive keys");
assert(!overviewUi.includes("repeatedChildDirectoryStructures"), "no UI yet");
assert(!overviewSrc.includes("repeatedChildDirectoryStructures"), "no overview mapping yet");
assert(!overviewUi.includes("folderChains"), "no chain UI yet");
assert(!overviewSrc.includes("folderChains"), "no chain overview mapping yet");
assert(checkSrc.includes("runRepeatedChildDirectoryStructureCheck"), "ts checks exist");
assert(checkSrc.includes("runFolderChainCheck"), "ts chain checks exist");
assert(workbenchSrc.includes("runInventoryStructureContextCheck"), "wired via structure-context check");
assert(!contextSrc.includes("start_scan"), "no scan IPC");
assert(!contextSrc.includes("ContentCache"), "no ContentCache");
assert(!contextSrc.toLocaleLowerCase().includes("duplikat"), "no Duplikat");
assert(!contextSrc.toLocaleLowerCase().includes("redundant"), "no redundant");
assert(!contextSrc.includes("unnötig") && !contextSrc.includes("zusammenlegen"), "no chain rating");

console.log("p1-j checks passed");
