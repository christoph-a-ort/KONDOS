import { type DirectoryNode, type FileNode, type FsNode, type ScanResult, type ScanWarning } from "../model";
import { formatByteSize } from "./treeFormat";
import { buildDisplayFilterView, emptyDisplayFilterDraft } from "./displayFilter";
import { deriveVisibleRows } from "./treeRows";
import { DEFAULT_TREE_SORT } from "./treeSort";
import { analyzeInventory } from "./inventoryAnalysis";
import { analyzeStructureContext } from "./inventoryStructureContext";
import {
  DEFAULT_SECTION_OPEN,
  DIRECT_FILE_RANK_LIMIT,
  EMPTY_EMPTY_FOLDERS,
  EMPTY_REPEATED_FILES,
  EMPTY_REPEATED_FOLDERS,
  EMPTY_SINGLE_FILE_FOLDERS,
  EMPTY_YEAR_STRUCTURES,
  FILE_TYPE_TOTAL_LABEL,
  IST_OVERVIEW_NO_SCAN,
  IST_OVERVIEW_TITLE,
  REPEATED_FILES_HINT,
  SECTION_BUSY_FOLDERS,
  SECTION_YEAR_STRUCTURES,
  START_FOLDER_LABEL,
  UNCONFIRMED_EMPTY_HINT,
  UNCONFIRMED_EMPTY_TITLE,
  YEAR_MISSING_LABEL,
  buildInventoryOverviewView,
  depthLimitedNote,
  displayInventoryPath,
  inventoryAnalysisFromScan,
  sectionSummary,
  subdirectoryCount,
} from "./inventoryOverview";

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

function resultOf(root: DirectoryNode, warnings: ScanWarning[] = []): ScanResult {
  return {
    root,
    warnings,
    stats: { directoryCount: 0, fileCount: 0, skippedCount: 0, durationMs: 0 },
  };
}

function assert(condition: boolean, label: string): asserts condition {
  if (!condition) {
    throw new Error(label);
  }
}

function bannedWords(text: string): boolean {
  const lower = text.toLocaleLowerCase();
  return [
    "schlecht",
    "chaotisch",
    "kritisch",
    "problematisch",
    "optimal",
    "ineffizient",
    "zu tief",
    "zu viele",
    "aufräumen",
    "duplikat",
    "duplicate",
    "ki-analyse",
    "inventoryanalysis",
    "fehlende jahre",
    "fehlen 20",
    "empfehlung",
    "soll-struktur",
  ].some((word) => lower.includes(word));
}

export function runInventoryOverviewCheck(): void {
  const idle = buildInventoryOverviewView(null);
  assert(idle.available === false, "ui: no scan is unavailable");
  assert(idle.title === IST_OVERVIEW_TITLE, "ui: title");
  assert(idle.noScanMessage === IST_OVERVIEW_NO_SCAN, "ui: no-scan message");
  assert(inventoryAnalysisFromScan(null) === null, "ui: no scan yields no analysis");

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
    dir("C:/bestand/denied", "denied", [], { depth: 1, listing: "incomplete" }),
    dir(
      "C:/bestand/einzeln",
      "einzeln",
      [file("C:/bestand/einzeln/allein.txt", "allein.txt", { depth: 2, sizeBytes: 3 })],
      { depth: 1 },
    ),
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
    dir(
      "C:/bestand/vertraege",
      "vertraege",
      [file("C:/bestand/vertraege/Notiz.txt", "Notiz.txt", { depth: 2, sizeBytes: 2 })],
      { depth: 1 },
    ),
    dir("C:/bestand/loop", "loop", [], { depth: 1 }),
  ]);
  const mixedResult = resultOf(mixed, [
    { path: "C:/bestand/loop", code: "skipped", message: "Dateisystemverweis wird nicht gefolgt." },
  ]);
  const analysis = analyzeInventory(mixedResult);
  const mixedStructure = analyzeStructureContext(mixedResult);
  const view = buildInventoryOverviewView(analysis, mixed.path, mixedStructure);

  assert(view.available, "ui: scan makes overview available");
  assert(view.directoryCount === 10, "ui: directoryCount includes root");
  assert(view.subdirectoryCount === 9, "ui: subfolders are directoryCount - 1");
  assert(subdirectoryCount(view.directoryCount) === 9, "ui: subdirectory helper");
  assert(view.directoryCountLabel === "10", "ui: folder count");
  assert(view.subdirectoryCountLabel === "9", "ui: subdirectory count");
  assert(view.fileCountLabel === "11", "ui: file count");
  assert(view.knownSizeLabel === formatByteSize(183), "ui: known size uses shared formatter");
  assert(view.filesWithoutKnownSizeLabel === "1", "ui: files without size");
  assert(view.maxObservedDepthLabel === "2", "ui: observed depth");
  assert(view.depthLimitedNote === "Bei 1 Ordner wurde die eingestellte Einlesetiefe erreicht.", "ui: depthLimited note");
  assert(depthLimitedNote(0) === null, "ui: zero depthLimited has no note");
  assert(depthLimitedNote(4) === "Bei 4 Ordnern wurde die eingestellte Einlesetiefe erreicht.", "ui: plural depthLimited");

  const pdf = view.fileTypes.find((item) => item.label === ".pdf");
  assert(pdf !== undefined && pdf.fileCountLabel === "2", "ui: pdf type visible");
  assert(view.fileTypes.some((item) => item.label === "Ohne Dateiendung"), "ui: no-extension type visible");
  const typedFiles = analysis.fileTypes.reduce((sum, item) => sum + item.fileCount, 0);
  assert(typedFiles === analysis.fileCount, "ui: type counts sum to fileCount");
  assert(view.fileTypeTotalCountLabel === view.fileCountLabel, "ui: type total files match");
  assert(view.fileTypeTotalSizeLabel === view.knownSizeLabel, "ui: type total size matches known size");
  assert(FILE_TYPE_TOTAL_LABEL === "Gesamt", "ui: type total label");
  assert(SECTION_BUSY_FOLDERS === "Ordner nach Anzahl direkt enthaltener Dateien", "ui: ranking title is neutral");
  assert(!SECTION_BUSY_FOLDERS.includes("vielen"), "ui: ranking title has no viele");
  assert(view.busyFolders[0]?.pathLabel === "Vertraege", "ui: relative busy path");
  assert(view.emptyFolders.find((item) => item.path === "C:/bestand/leer")?.pathLabel === "leer", "ui: relative empty path");
  assert(
    displayInventoryPath(
      "C:\\Users\\COrt\\OneDrive\\Privates\\Harald",
      "C:\\Users\\COrt\\OneDrive\\Privates\\Harald\\Erbschaft\\Unterlagen Steuer Horst 2024",
    ) === "Erbschaft\\Unterlagen Steuer Horst 2024",
    "ui: windows relative path display",
  );
  assert(displayInventoryPath("C:/bestand", "C:/bestand") === START_FOLDER_LABEL, "ui: root display");
  assert(DEFAULT_SECTION_OPEN.fileTypes && DEFAULT_SECTION_OPEN.busyFolders, "ui: types and rank open by default");
  assert(
    !DEFAULT_SECTION_OPEN.emptyFolders &&
      !DEFAULT_SECTION_OPEN.singleFile &&
      !DEFAULT_SECTION_OPEN.repeatedFolders &&
      !DEFAULT_SECTION_OPEN.repeatedFiles &&
      !DEFAULT_SECTION_OPEN.unconfirmed &&
      !DEFAULT_SECTION_OPEN.yearStructures,
    "ui: remaining sections closed by default",
  );
  assert(SECTION_YEAR_STRUCTURES === "Jahresstrukturen", "ui: year section title");
  assert(sectionSummary(SECTION_YEAR_STRUCTURES, 4) === "Jahresstrukturen (4)", "ui: year section count");
  assert(view.yearGroupCount === 0 && view.yearGroupsEmpty === EMPTY_YEAR_STRUCTURES, "ui: mixed fixture has no year groups");
  assert(YEAR_MISSING_LABEL === "Nicht vorhandene Jahresordner innerhalb der Spanne", "ui: missing years wording is neutral");
  assert(!YEAR_MISSING_LABEL.toLocaleLowerCase().includes("fehlende jahre"), "ui: no fehlende Jahre");
  assert(sectionSummary("Leere Ordner", 0) === "Leere Ordner (0)", "ui: zero count in summary");
  assert(sectionSummary("Wiederkehrende Dateinamen", 1) === "Wiederkehrende Dateinamen (1)", "ui: nonzero count in summary");
  assert(view.busyFolders.length <= DIRECT_FILE_RANK_LIMIT, "ui: busy folder rank limited");
  assert(view.busyFolders[0]?.name === "Vertraege" && view.busyFolders[0].countLabel === "4", "ui: busiest folder first");
  assert(view.emptyFolders.some((item) => item.path === "C:/bestand/leer"), "ui: empty folder listed");
  assert(!view.emptyFolders.some((item) => item.path === "C:/bestand/grenze"), "ui: depthLimited not empty");
  assert(!view.emptyFolders.some((item) => item.path === "C:/bestand/denied"), "ui: incomplete not empty");
  assert(!view.emptyFolders.some((item) => item.path === "C:/bestand/loop"), "ui: unconfirmed not empty");
  assert(view.unconfirmedFolders.some((item) => item.path === "C:/bestand/loop"), "ui: unconfirmed separate");
  assert(view.unconfirmedTitle === UNCONFIRMED_EMPTY_TITLE, "ui: unconfirmed title");
  assert(view.unconfirmedHint === UNCONFIRMED_EMPTY_HINT, "ui: unconfirmed hint");
  assert(view.singleFileCount === 2, "ui: single-file folder count");
  assert(view.repeatedFolders.some((item) => item.summary.toLocaleLowerCase().includes("vertraege") && item.countLabel === "2"), "ui: repeated folders");
  assert(view.repeatedFiles.some((item) => item.name.toLocaleLowerCase() === "bild.jpg"), "ui: repeated files");
  assert(view.repeatedFilesHint === REPEATED_FILES_HINT, "ui: no-content-identity hint");
  assert(!bannedWords(JSON.stringify(view)), "ui: no rating or duplicate wording");

  const barren = buildInventoryOverviewView(analyzeInventory(resultOf(dir("C:/n", "n", []))), "C:/n", analyzeStructureContext(resultOf(dir("C:/n", "n", []))));
  assert(barren.fileTypesEmpty !== null, "ui: empty types");
  assert(barren.busyFoldersEmpty !== null, "ui: empty busy folders");
  assert(barren.emptyFoldersEmpty === null && barren.emptyFolders.length === 1, "ui: empty root listed");
  assert(barren.emptyFolders[0]?.pathLabel === START_FOLDER_LABEL, "ui: empty root labeled Startordner");
  assert(barren.singleFileEmpty === EMPTY_SINGLE_FILE_FOLDERS, "ui: empty single-file");
  assert(barren.repeatedFoldersEmpty === EMPTY_REPEATED_FOLDERS, "ui: empty repeated folders");
  assert(barren.repeatedFilesEmpty === EMPTY_REPEATED_FILES, "ui: empty repeated files");
  assert(barren.yearGroupCount === 0 && barren.yearGroupsEmpty === EMPTY_YEAR_STRUCTURES, "ui: empty year structures");
  assert(barren.unconfirmedFolders.length === 0, "ui: hide unconfirmed when none");
  assert(barren.depthLimitedNote === null, "ui: no depthLimited note on empty");

  const noEmpty = buildInventoryOverviewView(
    analyzeInventory(resultOf(dir("C:/x", "x", [file("C:/x/a.txt", "a.txt", { sizeBytes: 1 })]))),
    "C:/x",
  );
  assert(noEmpty.emptyFoldersEmpty === EMPTY_EMPTY_FOLDERS, "ui: no empty folders message");

  const rankedChildren: FsNode[] = [];
  for (let index = 1; index <= 12; index += 1) {
    const files: FsNode[] = [];
    for (let fileIndex = 0; fileIndex < index; fileIndex += 1) {
      files.push(file(`C:/r/d${index}/f${fileIndex}.txt`, `f${fileIndex}.txt`, { depth: 2, sizeBytes: 1 }));
    }
    rankedChildren.push(dir(`C:/r/d${index}`, `d${index}`, files, { depth: 1 }));
  }
  const ranked = buildInventoryOverviewView(analyzeInventory(resultOf(dir("C:/r", "r", rankedChildren))), "C:/r");
  assert(ranked.busyFolders.length === DIRECT_FILE_RANK_LIMIT, "ui: rank capped at 10");
  assert(ranked.busyFolders[0]?.name === "d12", "ui: rank starts at most files");
  assert(ranked.busyFolders[9]?.name === "d3", "ui: tenth entry is d3");
  assert(!ranked.busyFolders.some((item) => item.name === "d2"), "ui: eleventh not shown");

  const firstScan = resultOf(dir("C:/a", "a", [file("C:/a/one.txt", "one.txt", { sizeBytes: 8 })]));
  const secondScan = resultOf(dir("C:/b", "b", [file("C:/b/two.pdf", "two.pdf", { sizeBytes: 4 }), file("C:/b/three.pdf", "three.pdf", { sizeBytes: 4 })]));
  const firstView = buildInventoryOverviewView(inventoryAnalysisFromScan(firstScan), "C:/a", analyzeStructureContext(firstScan));
  const secondView = buildInventoryOverviewView(inventoryAnalysisFromScan(secondScan), "C:/b", analyzeStructureContext(secondScan));
  assert(firstView.fileCountLabel === "1" && secondView.fileCountLabel === "2", "ui: new scan replaces analysis");
  assert(secondView.fileTypes[0]?.label === ".pdf", "ui: second scan types");
  assert(inventoryAnalysisFromScan(firstScan) !== inventoryAnalysisFromScan(secondScan), "ui: analyses are distinct objects");
  assert(firstView.yearGroupCount === 0 && secondView.yearGroupCount === 0, "ui: scans without year groups stay empty");

  const yearRoot = dir("C:/bank", "bank", [
    dir(
      "C:/bank/Kontoauszuege",
      "Kontoauszuege",
      [
        dir(
          "C:/bank/Kontoauszuege/PDF",
          "PDF",
          [
            dir("C:/bank/Kontoauszuege/PDF/2020", "2020", [], { depth: 3 }),
            dir("C:/bank/Kontoauszuege/PDF/2021", "2021", [], { depth: 3 }),
            dir("C:/bank/Kontoauszuege/PDF/2022", "2022", [], { depth: 3 }),
          ],
          { depth: 2 },
        ),
      ],
      { depth: 1 },
    ),
    dir(
      "C:/bank/VersorgerA",
      "VersorgerA",
      [
        dir("C:/bank/VersorgerA/2023", "2023", [], { depth: 2 }),
        dir("C:/bank/VersorgerA/2024", "2024", [], { depth: 2 }),
        dir("C:/bank/VersorgerA/2025", "2025", [], { depth: 2 }),
      ],
      { depth: 1 },
    ),
    dir(
      "C:/bank/VersorgerB",
      "VersorgerB",
      [
        dir("C:/bank/VersorgerB/2023", "2023", [], { depth: 2 }),
        dir("C:/bank/VersorgerB/2025", "2025", [], { depth: 2 }),
      ],
      { depth: 1 },
    ),
    dir(
      "C:/bank/Luecken",
      "Luecken",
      [
        dir("C:/bank/Luecken/2020", "2020", [], { depth: 2 }),
        dir("C:/bank/Luecken/2021", "2021", [], { depth: 2 }),
        dir("C:/bank/Luecken/2023", "2023", [], { depth: 2 }),
        dir("C:/bank/Luecken/2024", "2024", [], { depth: 2 }),
      ],
      { depth: 1 },
    ),
  ]);
  const yearResult = resultOf(yearRoot);
  const yearAnalysis = analyzeInventory(yearResult);
  const yearStructure = analyzeStructureContext(yearResult);
  const yearView = buildInventoryOverviewView(yearAnalysis, yearRoot.path, yearStructure);
  assert(yearView.yearGroupCount === 4, "ui: four year groups");
  assert(yearView.yearGroupsEmpty === null, "ui: year groups not empty");
  assert(yearView.yearGroups[0]?.parentName === "Kontoauszuege" || yearView.yearGroups.some((item) => item.parentName === "PDF"), "ui: parent name visible");
  const pdfGroup = yearView.yearGroups.find((item) => item.parentName === "PDF");
  assert(pdfGroup?.parentPathLabel === "Kontoauszuege\\PDF", "ui: relative parent path");
  assert(pdfGroup?.yearsLabel === "2020 · 2021 · 2022", "ui: present years");
  assert(pdfGroup?.spanLabel === "2020–2022", "ui: observed span");
  assert(pdfGroup?.missingYearsLabel === null, "ui: no missing-year row when span is complete");
  assert(pdfGroup?.consecutiveRunsLabel === null, "ui: no redundant consecutive row");
  assert(!pdfGroup?.parentPathLabel.includes("C:"), "ui: year parent path is relative");
  const luecken = yearView.yearGroups.find((item) => item.parentName === "Luecken");
  assert(luecken?.missingYearsLabel === "2022", "ui: missing years listed neutrally");
  assert(luecken?.consecutiveRunsLabel === "2020–2021 · 2023–2024", "ui: consecutive runs only when gaps exist");
  const wasser = yearView.yearGroups.find((item) => item.parentName === "VersorgerB");
  assert(wasser?.yearsLabel === "2023 · 2025" && wasser.spanLabel === "2023–2025", "ui: gapped group span");
  assert(wasser?.missingYearsLabel === "2024" && wasser.consecutiveRunsLabel === null, "ui: gap without extra consecutive runs");
  assert(yearView.yearGroups[0]?.parentPath === "C:/bank/Kontoauszuege/PDF", "ui: groups keep context order");
  assert(yearView.yearGroups.map((item) => item.parentName).join(",") === "PDF,Luecken,VersorgerA,VersorgerB", "ui: deterministic year group order");
  assert(!bannedWords(JSON.stringify(yearView)), "ui: year view has no rating wording");
  assert(!JSON.stringify(yearView).toLocaleLowerCase().includes("fehlende jahre"), "ui: year view has no fehlende Jahre");

  const filteredYear = buildDisplayFilterView(yearRoot, { ...emptyDisplayFilterDraft(), extensions: [".pdf"] }, DEFAULT_TREE_SORT);
  assert(filteredYear.constrained, "ui: year filter is constrained");
  const yearViewAgain = buildInventoryOverviewView(analyzeInventory(yearResult), yearRoot.path, analyzeStructureContext(yearResult));
  assert(JSON.stringify(yearView.yearGroups) === JSON.stringify(yearViewAgain.yearGroups), "ui: filter does not change year groups");
  const collapsedYear = deriveVisibleRows(yearRoot, new Set(["C:/bank"]));
  assert(collapsedYear.length < yearAnalysis.directoryCount, "ui: expand hides children");
  assert(yearView.yearGroupCount === analyzeStructureContext(yearResult).yearGroups.length, "ui: expand does not change year groups");

  const laterScan = resultOf(dir("C:/neu", "neu", [dir("C:/neu/2024", "2024", [], { depth: 1 })]));
  const laterView = buildInventoryOverviewView(analyzeInventory(laterScan), "C:/neu", analyzeStructureContext(laterScan));
  assert(laterView.yearGroupCount === 0, "ui: new scan replaces previous year groups");
  const idleAfter = buildInventoryOverviewView(null);
  assert(idleAfter.yearGroupCount === 0 && idleAfter.available === false, "ui: no leftover year context without scan");

  const sameResult = mixedResult;
  const once = analyzeInventory(sameResult);
  const twice = analyzeInventory(sameResult);
  const viewOnce = buildInventoryOverviewView(once, mixed.path);
  const viewTwice = buildInventoryOverviewView(twice, mixed.path);
  assert(JSON.stringify(viewOnce) === JSON.stringify(viewTwice), "ui: same scan yields same overview");
  assert(!viewOnce.busyFolders[0]?.pathLabel.includes("C:"), "ui: displayed paths are not absolute");
}
