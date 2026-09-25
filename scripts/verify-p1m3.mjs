// P1-M slice 3: pattern observations visible in IST overview. Aggregation/UI only.

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

const patternSrc = read("src/ui/inventoryPatternOverview.ts");
const patternCheck = read("src/ui/inventoryPatternOverviewCheck.ts");
const overviewUi = read("src/ui/InventoryOverviewPanel.tsx");
const overviewSrc = read("src/ui/inventoryOverview.ts");
const treeViewSrc = read("src/ui/TreeView.tsx");
const workbenchSrc = read("src/ui/treeWorkbenchCheck.ts");
const exactSrc = read("src/ui/inventoryExactFolderFileStructure.ts");
const syntaxSrc = read("src/ui/inventoryFileNameSyntax.ts");
const fileContextSrc = read("src/ui/inventoryFileStructureContext.ts");
const analysisSrc = read("src/ui/inventoryAnalysis.ts");
const repeatedFolderSrc = read("src/ui/inventoryRepeatedNameContext.ts");
const repeatedFileSrc = read("src/ui/inventoryRepeatedFileNameContext.ts");
const appCss = read("src/App.css");

assert(patternSrc.includes("export function buildInventoryPatternOverviewView"), "core: pattern view builder");
assert(patternSrc.includes('SECTION_PATTERNS = "Muster"'), "core: Muster title");
assert(patternSrc.includes("PATTERN_OBSERVATION_HINT"), "core: observation hint");
assert(
  patternSrc.includes(
    "wiederkehrende Strukturen und Muster erkannt. Die Angaben beschreiben den Bestand und stellen keine Bewertung dar.",
  ),
  "core: polished observation wording",
);
assert(!patternSrc.includes("auffällig"), "core: no auffällig wording");
assert(patternSrc.includes('SECTION_FILE_NAME_FEATURES = "Muster in Dateinamen"'), "core: Muster in Dateinamen");
assert(patternSrc.includes("2025-09-25 (JJJJ-MM-TT)"), "core: dash date display label");
assert(patternSrc.includes("2025_09_25 (JJJJ_MM_TT)"), "core: underscore date display label");
assert(patternSrc.includes("20250925 (JJJJMMTT)"), "core: compact date display label");
assert(patternSrc.includes("DATE_FORM_DISPLAY_LABELS"), "core: display labels separated from recognition");
assert(overviewUi.includes("row.label"), "panel shows date display labels");
assert(overviewUi.includes("DEFAULT_PATTERN_SECTION_OPEN.dateForms"), "date forms default closed wiring");
assert(overviewUi.includes("DEFAULT_PATTERN_SECTION_OPEN.sameStem"), "same stem default closed wiring");
assert(overviewUi.includes("DEFAULT_PATTERN_SECTION_OPEN.exactFileNames"), "exact names default closed wiring");
assert(overviewUi.includes("DEFAULT_PATTERN_SECTION_OPEN.extensionMultisets"), "multisets default closed wiring");
assert(patternSrc.includes("dateForms: false"), "core: date forms closed by default");
assert(patternSrc.includes("sameStem: false"), "core: same stem closed by default");
assert(patternSrc.includes("exactFileNames: false"), "core: exact names closed by default");
assert(patternSrc.includes("extensionMultisets: false"), "core: multisets closed by default");
assert(patternSrc.includes("SIX_DIGIT_HINT"), "core: six-digit hint");
assert(patternSrc.includes("nicht als Datum gewertet"), "core: six-digit not date");
assert(patternSrc.includes("EXTENSION_MULTISET_HINT"), "core: extension content hint");
assert(patternSrc.includes("ohne Endung"), "core: no-extension display");
assert(patternSrc.includes("patterns: false"), "core: Muster closed by default");
assert(!patternSrc.includes("Muster ("), "core: no aggregate Muster count");
assert(!patternSrc.toLocaleLowerCase().includes("duplikat"), "core: no Duplikat");
assert(!patternSrc.toLocaleLowerCase().includes("empfehlung"), "core: no Empfehlung");
assert(!patternSrc.includes("YYMMDD als"), "core: no YYMMDD interpretation");
assert(!patternSrc.toLocaleLowerCase().includes("kurzes datum"), "core: no short-date claim");
assert(!patternSrc.toLocaleLowerCase().includes("versionen"), "core: no Versionen");
assert(!patternSrc.toLocaleLowerCase().includes("konvertierung"), "core: no Konvertierung");
assert(patternSrc.includes("YYYYMMDD"), "core: YYYYMMDD format label allowed");

assert(patternCheck.includes("runInventoryPatternOverviewCheck"), "ts pattern check exists");
assert(workbenchSrc.includes("runInventoryPatternOverviewCheck"), "pattern check wired");

assert(overviewUi.includes("SECTION_YEAR_STRUCTURES"), "panel keeps year section");
assert(overviewUi.includes("patterns.title"), "panel renders Muster");
assert(overviewUi.includes("DEFAULT_PATTERN_SECTION_OPEN.patterns"), "panel uses closed default");
assert(overviewUi.includes("SECTION_FILE_NAME_FEATURES"), "panel has file-name features");
assert(overviewUi.includes("SECTION_DATE_FORMS") || overviewUi.includes("dateForms"), "panel has date forms");
assert(overviewUi.includes("sameStemTitle"), "panel has same-stem");
assert(overviewUi.includes("exactNameTitle"), "panel has exact names");
assert(overviewUi.includes("extensionMultisetTitle"), "panel has extension multisets");
assert(overviewUi.includes("observationHint"), "panel has observation hint");
assert(!overviewUi.includes("setSelectedId"), "no click-to-tree in overview panel");
assert(!overviewUi.includes("pendingReveal"), "no reveal navigation in overview panel");

const yearIndex = overviewUi.indexOf("SECTION_YEAR_STRUCTURES");
const patternIndex = overviewUi.indexOf("patterns.title");
assert(yearIndex >= 0 && patternIndex > yearIndex, "Muster comes after Jahresstrukturen");

assert(overviewSrc.includes("Jahresstrukturen"), "P1-I title unchanged");
assert(overviewSrc.includes("Dateitypen"), "P1-H file types unchanged");
assert(overviewSrc.includes("Wiederkehrende Ordnernamen"), "P1-H repeated folders unchanged");

assert(treeViewSrc.includes("analyzeFileStructureContext"), "TreeView uses P1-L H1");
assert(treeViewSrc.includes("analyzeExactFolderFileStructures"), "TreeView uses P1-M H1");
assert(treeViewSrc.includes("analyzeFileNameSyntax"), "TreeView uses P1-M H2");
assert(treeViewSrc.includes("exactFolderStructures={exactFolderStructures}"), "TreeView passes H1");
assert(treeViewSrc.includes("fileNameSyntax={fileNameSyntax}"), "TreeView passes H2");
assert(treeViewSrc.includes("exactFolderStructures={null}"), "no-scan clears H1");
assert(treeViewSrc.includes("fileNameSyntax={null}"), "no-scan clears H2");
assert(!treeViewSrc.includes("analyzeRepeatedFolderNameContext"), "no P1-K in TreeView");
assert(!treeViewSrc.includes("analyzeRepeatedFileNameContext"), "no P1-L H2 in TreeView");
assert(!treeViewSrc.includes("start_scan"), "TreeView pattern wiring has no scan IPC here");

assert(!exactSrc.includes("buildInventoryPatternOverviewView"), "H1 kernel not owning UI view");
assert(!syntaxSrc.includes("buildInventoryPatternOverviewView"), "H2 kernel not owning UI view");
assert(!fileContextSrc.includes("buildInventoryPatternOverviewView"), "L1 not owning UI view");
assert(!analysisSrc.includes("buildInventoryPatternOverviewView"), "P1-H not owning pattern view");
assert(!repeatedFolderSrc.includes("buildInventoryPatternOverviewView"), "P1-K not in H3");
assert(!repeatedFileSrc.includes("buildInventoryPatternOverviewView"), "P1-L2 not in H3");

assert(appCss.includes("inventory-overview-patterns"), "minimal pattern CSS");
assert(!appCss.includes("warning-pattern"), "no warning pattern class");
assert(!appCss.includes("pattern-ampel"), "no ampel class");

assert(patternCheck.includes('"A: analyzed file count"') || patternCheck.includes("A: analyzed"), "check A");
assert(patternCheck.includes("B: digit block file count"), "check B");
assert(patternCheck.includes("C: leading digit files"), "check C");
assert(patternCheck.includes("D: date pattern files"), "check D");
assert(patternCheck.includes("E: date form histogram"), "check E");
assert(patternCheck.includes("F: six-digit files"), "check F");
assert(patternCheck.includes("G: same-stem count"), "check G");
assert(patternCheck.includes("H: exact name structure group") || patternCheck.includes("H: exact name"), "check H");
assert(patternCheck.includes("I: one extension multiset group"), "check I");
assert(patternCheck.includes("J: two folder occurrences"), "check J");
assert(patternCheck.includes("K: same-stem sorted"), "check K");
assert(patternCheck.includes("L:"), "check L relative paths");
assert(patternCheck.includes("M: no-ext label") || patternCheck.includes("M: helper"), "check M");
assert(patternCheck.includes("N: empty date forms"), "check N");
assert(patternCheck.includes("neutrality: no banned H3 meanings"), "neutrality check");

console.log("p1-m3 checks passed");
