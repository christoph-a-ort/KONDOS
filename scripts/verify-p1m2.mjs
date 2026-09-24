// P1-M slice 2: syntactic file-name features. Not imported by the app.

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

const contextSrc = read("src/ui/inventoryFileNameSyntax.ts");
const checkSrc = read("src/ui/inventoryFileNameSyntaxCheck.ts");
const fileContextSrc = read("src/ui/inventoryFileStructureContext.ts");
const exactSrc = read("src/ui/inventoryExactFolderFileStructure.ts");
const overviewSrc = read("src/ui/inventoryOverview.ts");
const overviewUi = read("src/ui/InventoryOverviewPanel.tsx");
const treeViewSrc = read("src/ui/TreeView.tsx");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const appCss = read("src/App.css");

assert(contextSrc.includes("export function analyzeFileNameSyntax"), "core: analyze exported");
assert(contextSrc.includes("InventoryFileNameSyntaxContext"), "core: context type");
assert(contextSrc.includes("sameStemDifferentExtensions"), "core: same stem groups");
assert(contextSrc.includes("fileExtensionKey"), "core: reuses fileExtensionKey");
assert(contextSrc.includes("sixDigitBlocks"), "core: sixDigitBlocks");
assert(contextSrc.includes("datePatterns"), "core: datePatterns");
assert(contextSrc.includes("isValidCalendarDate"), "core: calendar validation");
assert(contextSrc.includes("InventoryFileStructureContext"), "core: uses P1-L H1");
assert(!contextSrc.includes("jaccard") && !contextSrc.includes("levenshtein"), "no similarity");
assert(!contextSrc.toLocaleLowerCase().includes("scandatum"), "no scan-date claim");
assert(!contextSrc.toLocaleLowerCase().includes("rechnungdatum"), "no invoice-date claim");
assert(checkSrc.includes("runInventoryFileNameSyntaxCheck"), "ts checks exist");
assert(workbenchSrc.includes("runInventoryFileNameSyntaxCheck"), "wired via workbench");
assert(!overviewUi.includes("analyzeFileNameSyntax"), "no overview UI yet");
assert(!overviewSrc.includes("analyzeFileNameSyntax"), "no overview mapping yet");
assert(!treeViewSrc.includes("analyzeFileNameSyntax"), "no TreeView wiring yet");
assert(!appCss.includes("file-name-syntax"), "no CSS for P1-M H2 UI");
assert(!fileContextSrc.includes("analyzeFileNameSyntax"), "P1-L H1 not owning P1-M H2");
assert(!exactSrc.includes("analyzeFileNameSyntax"), "P1-M H1 not owning P1-M H2");
assert(!contextSrc.includes("start_scan"), "no scan IPC");
assert(!contextSrc.includes("ContentCache"), "no ContentCache");
assert(!contextSrc.toLocaleLowerCase().includes("duplikat"), "no Duplikat");
assert(checkSrc.includes('"A1: test.pdf"'), "test A1");
assert(checkSrc.includes('"A2: archiv.tar.gz"'), "test A2");
assert(checkSrc.includes('"C9: no partial YYYYMMDD from longer digits"'), "test C9");
assert(checkSrc.includes('"D3: seven digits is not sixDigitBlock"') || checkSrc.includes('"B4/D3:'), "test D3");
assert(checkSrc.includes('"G1: Bericht.pdf + Bericht.docx"'), "test G1");
assert(checkSrc.includes('"G3: same extension after case fold'), "test G3");
assert(checkSrc.includes('"H1: stem/ext"'), "test H1");

console.log("p1-m2 checks passed");
