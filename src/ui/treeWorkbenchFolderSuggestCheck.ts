import { isDirectory, isFile, type DirectoryNode, type FileNode, type FsNode } from "../model";
import { rememberSenderMapping } from "./learnedSenders";
import {
  canSuggestWorkbenchFolder,
  collectFolderCandidates,
  FOLDER_SUGGEST_ALREADY_HERE,
  FOLDER_SUGGEST_MAX,
  FOLDER_SUGGEST_NEW,
  FOLDER_SUGGEST_NEW_UNCLEAR,
  FOLDER_SUGGEST_UNCLEAR,
  FOLDER_SUGGEST_YEAR_UNKNOWN,
  folderIsInsideScanRoot,
  folderSuggestCues,
  folderSuggestShowsDateField,
  isAcceptableNewFolderName,
  planFolderSuggestions,
  stripFolderStatusSuffix,
  type FolderSuggestOutcome,
} from "./treeWorkbenchFolderSuggest";
import { preferredAskIso, type DocumentTextView } from "./treeWorkbenchNameSuggest";
import { runTreeWorkbenchFolderSuggestApplyCheck } from "./treeWorkbenchFolderSuggestApplyCheck";

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(label);
  }
}

function asNewFolder(outcome: FolderSuggestOutcome, label: string): Extract<FolderSuggestOutcome, { status: "newFolder" }> {
  assert(outcome.status === "newFolder", label);
  if (outcome.status !== "newFolder") {
    throw new Error(label);
  }
  return outcome;
}

function file(path: string, name: string): FileNode {
  return { id: path, name, path, depth: 1, kind: "file", sizeBytes: 8, modifiedAtMs: 100 };
}

function dir(path: string, name: string, children: FsNode[] = []): DirectoryNode {
  return { id: path, name, path, depth: 0, kind: "directory", listing: "read", children };
}

function view(text: string, name = "scan.pdf"): DocumentTextView {
  return {
    scanId: 1,
    path: `C:/Dotty-Test/Ablage/${name}`,
    name,
    format: "pdf",
    status: "searchable",
    text,
    source: "cache",
  };
}

function tree(): DirectoryNode {
  return dir("C:/Dotty-Test/Ablage", "Ablage", [
    dir("C:/Dotty-Test/Ablage/Inbox", "Inbox", [
      file("C:/Dotty-Test/Ablage/Inbox/scan.pdf", "scan.pdf"),
      file("C:/Dotty-Test/Ablage/Inbox/foto.jpg", "foto.jpg"),
      file("C:/Dotty-Test/Ablage/Inbox/notiz.txt", "notiz.txt"),
    ]),
    dir("C:/Dotty-Test/Ablage/Energie", "Energie", [
      dir("C:/Dotty-Test/Ablage/Energie/GEG", "GEG", [
        file(
          "C:/Dotty-Test/Ablage/Energie/GEG/2025-12-01_HGZ_GEG-Beratungsnachweis.pdf",
          "2025-12-01_HGZ_GEG-Beratungsnachweis.pdf",
        ),
      ]),
      dir("C:/Dotty-Test/Ablage/Energie/Rechnungen", "Rechnungen", [
        file("C:/Dotty-Test/Ablage/Energie/Rechnungen/2026-02-01_Stadtwerke_Stromrechnung.pdf", "2026-02-01_Stadtwerke_Stromrechnung.pdf"),
      ]),
    ]),
    dir("C:/Dotty-Test/Ablage/Versicherungen", "Versicherungen", [
      file("C:/Dotty-Test/Ablage/Versicherungen/2026-03-01_Allianz_Versicherungsschreiben.pdf", "2026-03-01_Allianz_Versicherungsschreiben.pdf"),
    ]),
    dir("C:/Dotty-Test/Ablage/Absender", "Absender", [
      dir("C:/Dotty-Test/Ablage/Absender/HGZ", "HGZ", [
        file("C:/Dotty-Test/Ablage/Absender/HGZ/2024-01-01_HGZ_Schreiben.pdf", "2024-01-01_HGZ_Schreiben.pdf"),
      ]),
      dir("C:/Dotty-Test/Ablage/Absender/Stadtwerke", "Stadtwerke", [
        file("C:/Dotty-Test/Ablage/Absender/Stadtwerke/2024-06-01_Stadtwerke_Gasrechnung.pdf", "2024-06-01_Stadtwerke_Gasrechnung.pdf"),
      ]),
      dir("C:/Dotty-Test/Ablage/Absender/Allianz", "Allianz"),
    ]),
    dir("C:/Dotty-Test/Ablage/Vertraege", "Vertraege", [
      dir("C:/Dotty-Test/Ablage/Vertraege/HGZ", "HGZ"),
    ]),
    dir("C:/Dotty-Test/Ablage/Archiv", "Archiv", [
      dir("C:/Dotty-Test/Ablage/Archiv/HGZ", "HGZ"),
    ]),
    dir("C:/Dotty-Test/Ablage/Fotos", "Fotos", [file("C:/Dotty-Test/Ablage/Fotos/urlaub.jpg", "urlaub.jpg")]),
    dir("C:/Dotty-Test/Ablage/Musik", "Musik"),
    dir("C:/Dotty-Test/Ablage/Downloads", "Downloads"),
  ]);
}

function source(root: DirectoryNode, path: string): FileNode {
  const found = findFile(root, path);
  assert(found !== null && isFile(found), `missing fixture ${path}`);
  return found!;
}

function findFile(node: FsNode, path: string): FileNode | null {
  if (isFile(node) && node.path === path) {
    return node;
  }
  if (node.kind !== "directory") {
    return null;
  }
  for (const child of node.children) {
    const found = findFile(child, path);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

export function runTreeWorkbenchFolderSuggestCheck(): void {
  const root = tree();
  const scanRoot = root.path;
  const inboxScan = source(root, "C:/Dotty-Test/Ablage/Inbox/scan.pdf");

  assert(canSuggestWorkbenchFolder(inboxScan, true), "idle files can request a folder suggestion");
  assert(!canSuggestWorkbenchFolder(inboxScan, false), "busy occupancy blocks the action");
  assert(!canSuggestWorkbenchFolder(root, true), "folders cannot request a folder suggestion");
  assert(folderIsInsideScanRoot(scanRoot, "C:/Dotty-Test/Ablage/Energie/GEG"), "nested folders stay inside the scan root");
  assert(!folderIsInsideScanRoot(scanRoot, "C:/Andere/GEG"), "folders outside the scan root are ignored");
  assert(
    collectFolderCandidates(root, inboxScan.path).every((candidate) => !candidate.fileNames.includes("scan.pdf")),
    "the source file is not treated as a sibling of itself",
  );

  const gegText = view(
    "Haus- und Gebäudewirtschaftszentrum HGZ\nNachweis über die Erfüllung der Informationspflicht nach § 71 Gebäudeenergiegesetz\nGEG-Beratungsnachweis",
  );
  const unique = planFolderSuggestions({ scanRoot, root, source: inboxScan, view: gegText });
  assert(unique.status === "suggestions", "a GEG document finds a matching folder");
  assert(unique.suggestions.length >= 1 && unique.suggestions.length <= FOLDER_SUGGEST_MAX, "at most three folders are returned");
  assert(unique.suggestions[0]?.path === "C:/Dotty-Test/Ablage/Energie/GEG", "the GEG folder ranks first");
  assert(unique.suggestions[0]?.reasons.some((reason) => reason.includes("Dokumentart")), "the type match is explained");
  assert(unique.cues.dokumenttyp === "GEG-Beratungsnachweis", "document type comes from cached text, not a new KI call");
  assert(!unique.suggestions[0]?.alreadyHere, "an inbox file is not already in the GEG folder");

  const similar = planFolderSuggestions({
    scanRoot,
    root,
    source: inboxScan,
    view: view("Haus- und Gebäudewirtschaftszentrum HGZ\nBetreff: Rückfrage zum bestehenden Vertrag"),
  });
  assert(similar.status === "suggestions", "an HGZ sender can match several folders");
  assert(similar.suggestions.length >= 2, "several similar folders stay visible");
  assert(
    similar.suggestions.every((item) => item.path.includes("HGZ") || item.reasons.some((reason) => reason.includes("HGZ"))),
    "similar matches stay tied to the sender evidence",
  );

  const none = planFolderSuggestions({
    scanRoot,
    root,
    source: source(root, "C:/Dotty-Test/Ablage/Inbox/foto.jpg"),
    view: view("Urlaub am Meer mit Sonne, Strand und Sand.", "foto.jpg"),
  });
  assert(none.status === "unclear" && none.reason === FOLDER_SUGGEST_UNCLEAR, "unrelated photos do not invent a folder");
  assert(none.suggestions.length === 0, "unclear placement returns no forced suggestions");

  const invoice = planFolderSuggestions({
    scanRoot,
    root,
    source: inboxScan,
    view: view("Stadtwerke Musterstadt\nStromrechnung\nJahresabrechnung Strom"),
  });
  assert(invoice.status === "suggestions", "a power invoice finds a billing folder");
  assert(
    invoice.suggestions.some((item) => item.path === "C:/Dotty-Test/Ablage/Energie/Rechnungen" || item.path.includes("Stadtwerke")),
    "invoice placement uses document type or sender folders",
  );
  assert(invoice.cues.dokumenttyp === "Stromrechnung", "strom invoices keep their specific type");

  const insurance = planFolderSuggestions({
    scanRoot,
    root,
    source: inboxScan,
    view: view("Allianz Versicherungs-AG\nVersicherungsschreiben\nMitteilung zu Ihrer Police"),
  });
  assert(insurance.status === "suggestions", "an insurance letter finds the insurance folder");
  assert(
    insurance.suggestions.some((item) => item.path.includes("Versicherungen") || item.path.includes("Allianz")),
    "insurance placement uses the insurance or sender folder",
  );

  const nested = planFolderSuggestions({ scanRoot, root, source: inboxScan, view: gegText });
  const gegIndex = nested.suggestions.findIndex((item) => item.path.endsWith("/GEG"));
  const energieIndex = nested.suggestions.findIndex((item) => item.path.endsWith("/Energie") && !item.path.endsWith("/GEG"));
  assert(gegIndex === 0, "the deeper GEG folder outranks the parent Energie folder");
  assert(energieIndex === -1 || gegIndex < energieIndex, "parent folders stay behind a more specific child");

  const already = source(root, "C:/Dotty-Test/Ablage/Energie/GEG/2025-12-01_HGZ_GEG-Beratungsnachweis.pdf");
  const here = planFolderSuggestions({
    scanRoot,
    root,
    source: already,
    view: view("GEG-Beratungsnachweis HGZ", already.name),
  });
  assert(here.status === "alreadyHere" || here.suggestions[0]?.alreadyHere === true, "a file already in the best folder is recognized");
  assert(here.suggestions[0]?.path === "C:/Dotty-Test/Ablage/Energie/GEG", "the current GEG folder remains first");
  assert(
    (here.reason ?? here.suggestions[0]?.summary ?? "").includes("bereits im passenden Ordner")
      || here.suggestions[0]?.reasons.some((reason) => reason.includes("bereits in diesem Ordner")) === true,
    "the already-here reason is visible",
  );

  const learned = rememberSenderMapping(
    { version: 1, mappings: [] },
    "SHGZ KGZ",
    "HGZ",
  );
  assert(learned.ok, "fixture mapping is stored");
  const mapped = folderSuggestCues(
    "scan.pdf",
    view("SHGZ KGZ\nGEG-Beratungsnachweis"),
    learned.ok ? learned.store : { version: 1, mappings: [] },
  );
  assert(mapped.learnedAbsender || mapped.absender === "HGZ" || mapped.dokumenttyp === "GEG-Beratungsnachweis", "learned senders can feed placement cues without a new KI call");

  const outside = planFolderSuggestions({
    scanRoot,
    root,
    source: file("C:/Andere/scan.pdf", "scan.pdf"),
    view: gegText,
  });
  assert(outside.status === "blocked" && outside.reason.includes("Scanwurzel"), "paths outside the scan root are rejected");

  const snapshot = JSON.stringify(root);
  planFolderSuggestions({ scanRoot, root, source: inboxScan, view: gegText });
  planFolderSuggestions({ scanRoot, root, source: source(root, "C:/Dotty-Test/Ablage/Inbox/notiz.txt"), view: view("kurze notiz") });
  assert(JSON.stringify(root) === snapshot, "folder suggestion does not change the scanned tree");

  runHierarchyFolderSuggestCheck();
  runNewFolderSuggestCheck();
  runYearPatternParentFixCheck();
  runFolderDateConfirmCheck();
  runTreeWorkbenchFolderSuggestApplyCheck();
}

function hammInvoice(withDate: boolean, name = "2022-07-14_Verbrauchsabrechnung.pdf"): DocumentTextView {
  const dateLine = withDate ? "Rechnungsdatum: 14.07.2022\n" : "";
  return view(`Stadtwerke Hamm\n${dateLine}Stromrechnung\nVerbrauchsabrechnung`, name);
}

function hierarchyTree(): DirectoryNode {
  const yearFiles = (folder: string, year: string, vendor: string) => [
    file(`${folder}/${year}_${vendor}_Stromrechnung.pdf`, `${year}_${vendor}_Stromrechnung.pdf`),
  ];
  return dir("C:/Dotty-Test/Ablage", "Ablage", [
    dir("C:/Dotty-Test/Ablage/Inbox", "Inbox", [
      file("C:/Dotty-Test/Ablage/Inbox/2022-07-14_Verbrauchsabrechnung.pdf", "2022-07-14_Verbrauchsabrechnung.pdf"),
      file("C:/Dotty-Test/Ablage/Inbox/foto.jpg", "foto.jpg"),
    ]),
    dir("C:/Dotty-Test/Ablage/Strom+Gas", "Strom+Gas", [
      dir("C:/Dotty-Test/Ablage/Strom+Gas/SW Hamm_Strom", "SW Hamm_Strom", [
        dir(
          "C:/Dotty-Test/Ablage/Strom+Gas/SW Hamm_Strom/2021",
          "2021",
          yearFiles("C:/Dotty-Test/Ablage/Strom+Gas/SW Hamm_Strom/2021", "2021", "SWHamm"),
        ),
        dir("C:/Dotty-Test/Ablage/Strom+Gas/SW Hamm_Strom/2022", "2022", [
          file(
            "C:/Dotty-Test/Ablage/Strom+Gas/SW Hamm_Strom/2022/2022-07-14_Verbrauchsabrechnung.pdf",
            "2022-07-14_Verbrauchsabrechnung.pdf",
          ),
          file("C:/Dotty-Test/Ablage/Strom+Gas/SW Hamm_Strom/2022/urlaub.jpg", "urlaub.jpg"),
        ]),
        dir("C:/Dotty-Test/Ablage/Strom+Gas/SW Hamm_Strom/2023", "2023"),
        file("C:/Dotty-Test/Ablage/Strom+Gas/SW Hamm_Strom/offen.pdf", "offen.pdf"),
      ]),
      dir("C:/Dotty-Test/Ablage/Strom+Gas/Vattenfall_Strom - beendet", "Vattenfall_Strom - beendet", [
        dir(
          "C:/Dotty-Test/Ablage/Strom+Gas/Vattenfall_Strom - beendet/2021",
          "2021",
          yearFiles("C:/Dotty-Test/Ablage/Strom+Gas/Vattenfall_Strom - beendet/2021", "2021", "Vattenfall"),
        ),
        dir(
          "C:/Dotty-Test/Ablage/Strom+Gas/Vattenfall_Strom - beendet/2022",
          "2022",
          yearFiles("C:/Dotty-Test/Ablage/Strom+Gas/Vattenfall_Strom - beendet/2022", "2022", "Vattenfall"),
        ),
      ]),
    ]),
    dir("C:/Dotty-Test/Ablage/Projekte", "Projekte", [
      dir("C:/Dotty-Test/Ablage/Projekte/HausA", "HausA", [
        file("C:/Dotty-Test/Ablage/Projekte/HausA/HausA_Protokoll.pdf", "HausA_Protokoll.pdf"),
      ]),
      dir("C:/Dotty-Test/Ablage/Projekte/HausB", "HausB"),
    ]),
  ]);
}

function runHierarchyFolderSuggestCheck(): void {
  const root = hierarchyTree();
  const scanRoot = root.path;
  const inboxInvoice = source(root, "C:/Dotty-Test/Ablage/Inbox/2022-07-14_Verbrauchsabrechnung.pdf");
  const placedInvoice = source(
    root,
    "C:/Dotty-Test/Ablage/Strom+Gas/SW Hamm_Strom/2022/2022-07-14_Verbrauchsabrechnung.pdf",
  );
  const hamm2022 = "C:/Dotty-Test/Ablage/Strom+Gas/SW Hamm_Strom/2022";
  const dated = hammInvoice(true);

  const already = planFolderSuggestions({ scanRoot, root, source: placedInvoice, view: dated });
  assert(already.status === "alreadyHere", "A: a correctly filed 2022 invoice is already here");
  assert(already.reason === FOLDER_SUGGEST_ALREADY_HERE, "A: the already-here sentence is used");
  assert(already.suggestions[0]?.path === hamm2022, "A: the current year folder remains the match");
  assert(already.suggestions.every((item) => !item.path.includes("Vattenfall") && !item.path.endsWith("/2021")), "A: rival vendor and wrong year stay out");
  assert(already.cues.documentYear === "2022", "A: the document year comes from the document date, not the file name alone");
  assert(
    already.suggestions[0]?.reasons.some((reason) => reason.includes("Themenbereich") || reason.includes("Anbieterordner") || reason.includes("Jahresordner")),
    "A: hierarchy reasons name theme, vendor, or year",
  );

  const moved = planFolderSuggestions({ scanRoot, root, source: inboxInvoice, view: dated });
  assert(moved.status === "suggestions", "B: an inbox invoice still gets a target folder");
  assert(moved.suggestions[0]?.path === hamm2022, "B: Stadtwerke Hamm 2022 is the first target");
  assert(moved.suggestions.every((item) => !item.path.includes("Vattenfall")), "D: Vattenfall is not suggested for Stadtwerke Hamm");
  assert(moved.suggestions.every((item) => !item.path.endsWith("/2021")), "C: the wrong year folder is not suggested");
  assert(!moved.suggestions.some((item) => item.path === "C:/Dotty-Test/Ablage/Strom+Gas/SW Hamm_Strom"), "B: the vendor parent is not preferred over the year leaf");

  const unknownYear = planFolderSuggestions({ scanRoot, root, source: inboxInvoice, view: hammInvoice(false) });
  assert(unknownYear.cues.documentYear === null, "F: a filename date is not treated as a confirmed document year");
  assert(
    unknownYear.suggestions.every((item) => !isYearLeaf(item.path) || item.alreadyHere),
    "F: without a confirmed year, year folders are not forced",
  );
  assert(
    unknownYear.status === "suggestions"
      && unknownYear.suggestions.some((item) => item.path.endsWith("/SW Hamm_Strom") && !isYearLeaf(item.path)),
    "F: the vendor folder remains available when the year is unknown",
  );

  const alreadyUnknownYear = planFolderSuggestions({
    scanRoot,
    root,
    source: placedInvoice,
    view: hammInvoice(false, placedInvoice.name),
  });
  assert(alreadyUnknownYear.status === "alreadyHere", "G: a file already in the vendor year leaf is not reorganized");
  assert(alreadyUnknownYear.suggestions[0]?.path === hamm2022, "G: the current folder stays the match without a confirmed year");

  const project = planFolderSuggestions({
    scanRoot,
    root,
    source: source(root, "C:/Dotty-Test/Ablage/Projekte/HausA/HausA_Protokoll.pdf"),
    view: view("Besprechungsprotokoll zum Bauabschnitt, ohne Jahreszahl.", "HausA_Protokoll.pdf"),
  });
  assert(
    (project.status === "suggestions" || project.status === "alreadyHere")
      && project.suggestions[0]?.path.endsWith("/HausA"),
    "E: a project structure without year folders still matches",
  );
  assert(project.cues.documentYear === null, "E: missing dates do not invent a year pattern");
  assert(
    project.suggestions.every((item) => !isYearLeaf(item.path)),
    "E: a project tree does not receive a year folder",
  );

  const none = planFolderSuggestions({
    scanRoot,
    root,
    source: source(root, "C:/Dotty-Test/Ablage/Inbox/foto.jpg"),
    view: view("Urlaub am Meer mit Sonne, Strand und Sand.", "foto.jpg"),
  });
  assert(none.status === "unclear" && none.reason === FOLDER_SUGGEST_UNCLEAR, "H: unrelated files stay unclear");

  const before = JSON.stringify(root);
  planFolderSuggestions({ scanRoot, root, source: inboxInvoice, view: dated });
  assert(JSON.stringify(root) === before, "hierarchy planning does not change the file system tree");

  runSubtreeFolderSuggestCheck();
}

function findDirectory(node: FsNode, path: string): DirectoryNode | null {
  if (isDirectory(node) && node.path === path) {
    return node;
  }
  if (!isDirectory(node)) {
    return null;
  }
  for (const child of node.children) {
    const found = findDirectory(child, path);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

function runSubtreeFolderSuggestCheck(): void {
  const root = hierarchyTree();
  const stromGas = findDirectory(root, "C:/Dotty-Test/Ablage/Strom+Gas");
  const hamm = findDirectory(root, "C:/Dotty-Test/Ablage/Strom+Gas/SW Hamm_Strom");
  assert(stromGas !== null && hamm !== null, "subtree fixtures exist");
  const placedInvoice = source(
    root,
    "C:/Dotty-Test/Ablage/Strom+Gas/SW Hamm_Strom/2022/2022-07-14_Verbrauchsabrechnung.pdf",
  );
  const hamm2022 = "C:/Dotty-Test/Ablage/Strom+Gas/SW Hamm_Strom/2022";
  const dated = hammInvoice(true);

  const fromTheme = planFolderSuggestions({
    scanRoot: stromGas!.path,
    root: stromGas!,
    source: placedInvoice,
    view: dated,
  });
  assert(fromTheme.status === "alreadyHere", "A: scan root Strom+Gas still recognizes the current year folder");
  assert(fromTheme.suggestions[0]?.path === hamm2022, "A: SW Hamm_Strom\\2022 remains the match");

  const fromVendor = planFolderSuggestions({
    scanRoot: hamm!.path,
    root: hamm!,
    source: placedInvoice,
    view: dated,
  });
  assert(fromVendor.status === "alreadyHere", "B: scan root SW Hamm_Strom recognizes the year subfolder");
  assert(fromVendor.suggestions[0]?.path === hamm2022, "B: 2022 remains the current folder");
  assert(
    fromVendor.suggestions[0]?.reasons.some((reason) => reason.includes("Scanwurzel") && reason.includes("Jahren")),
    "B: the scan-root year pattern is explained",
  );

  const fromVendorUnknownYear = planFolderSuggestions({
    scanRoot: hamm!.path,
    root: hamm!,
    source: placedInvoice,
    view: hammInvoice(false, placedInvoice.name),
  });
  assert(
    fromVendorUnknownYear.status === "alreadyHere",
    "B: already-here still holds when the year is unknown but the vendor root and year pattern match",
  );

  const loose = source(root, "C:/Dotty-Test/Ablage/Strom+Gas/SW Hamm_Strom/offen.pdf");
  const outsideYears = planFolderSuggestions({
    scanRoot: hamm!.path,
    root: hamm!,
    source: loose,
    view: hammInvoice(true, loose.name),
  });
  assert(outsideYears.status === "suggestions", "C: a file beside the year folders still gets a target");
  assert(outsideYears.suggestions[0]?.path === hamm2022, "C: the confirmed document year selects 2022");

  const wrongYearFile = source(
    root,
    "C:/Dotty-Test/Ablage/Strom+Gas/SW Hamm_Strom/2021/2021_SWHamm_Stromrechnung.pdf",
  );
  const wrongYear = planFolderSuggestions({
    scanRoot: hamm!.path,
    root: hamm!,
    source: wrongYearFile,
    view: hammInvoice(true, wrongYearFile.name),
  });
  assert(wrongYear.status !== "alreadyHere", "D: a file in the wrong year folder is not called already here");
  assert(wrongYear.suggestions[0]?.path === hamm2022, "D: 2022 is suggested instead of keeping 2021");

  const photo = source(root, "C:/Dotty-Test/Ablage/Strom+Gas/SW Hamm_Strom/2022/urlaub.jpg");
  const mixed = planFolderSuggestions({
    scanRoot: hamm!.path,
    root: hamm!,
    source: photo,
    view: view("Urlaub am Meer mit Sonne, Strand und Sand.", "urlaub.jpg"),
  });
  assert(mixed.status === "unclear", "E: a photo under the vendor root is not filed by the scan-root name alone");

  const projectRoot = findDirectory(root, "C:/Dotty-Test/Ablage/Projekte");
  assert(projectRoot !== null, "project subtree exists");
  const projectFile = source(root, "C:/Dotty-Test/Ablage/Projekte/HausA/HausA_Protokoll.pdf");
  const project = planFolderSuggestions({
    scanRoot: projectRoot!.path,
    root: projectRoot!,
    source: projectFile,
    view: view("Besprechungsprotokoll zum Bauabschnitt, ohne Jahreszahl.", "HausA_Protokoll.pdf"),
  });
  assert(
    (project.status === "suggestions" || project.status === "alreadyHere")
      && project.suggestions[0]?.path.endsWith("/HausA"),
    "F: a project subtree without year folders still matches",
  );

  const ambiguous = planFolderSuggestions({
    scanRoot: hamm!.path,
    root: hamm!,
    source: photo,
    view: view("Kurze Notiz ohne Absender und ohne Dokumentart.", "urlaub.jpg"),
  });
  assert(ambiguous.status === "unclear", "G: insufficient evidence stays unclear");

  const rival = planFolderSuggestions({
    scanRoot: stromGas!.path,
    root: stromGas!,
    source: placedInvoice,
    view: dated,
  });
  assert(rival.suggestions.every((item) => !item.path.includes("Vattenfall")), "H: Stadtwerke Hamm is not assigned to Vattenfall");
}

function hammInvoiceForYear(year: string, name = "scan.pdf"): DocumentTextView {
  return view(`Stadtwerke Hamm\nRechnungsdatum: 14.07.${year}\nStromrechnung\nVerbrauchsabrechnung`, name);
}

function addYearFolder(parent: DirectoryNode, year: string): void {
  parent.children.push(
    dir(`${parent.path}/${year}`, year, [
      file(`${parent.path}/${year}/${year}_Platzhalter.pdf`, `${year}_Platzhalter.pdf`),
    ]),
  );
}

function typePatternTree(): DirectoryNode {
  return dir("C:/Dotty-Test/Themenablage", "Themenablage", [
    dir("C:/Dotty-Test/Themenablage/Inbox", "Inbox", [
      file("C:/Dotty-Test/Themenablage/Inbox/zaehler.pdf", "zaehler.pdf"),
    ]),
    dir("C:/Dotty-Test/Themenablage/Unterlagen", "Unterlagen", [
      dir("C:/Dotty-Test/Themenablage/Unterlagen/Rechnungen", "Rechnungen", [
        file("C:/Dotty-Test/Themenablage/Unterlagen/Rechnungen/alt.pdf", "alt.pdf"),
      ]),
      dir("C:/Dotty-Test/Themenablage/Unterlagen/Vertrag", "Vertrag", [
        file("C:/Dotty-Test/Themenablage/Unterlagen/Vertrag/vertrag.pdf", "vertrag.pdf"),
      ]),
    ]),
  ]);
}

function ambiguousYearTree(): DirectoryNode {
  const years = (parent: string) => [
    dir(`${parent}/2023`, "2023", [file(`${parent}/2023/2023.pdf`, "2023.pdf")]),
    dir(`${parent}/2024`, "2024", [file(`${parent}/2024/2024.pdf`, "2024.pdf")]),
  ];
  return dir("C:/Dotty-Test/Ambivalent", "Ambivalent", [
    dir("C:/Dotty-Test/Ambivalent/Inbox", "Inbox", [
      file("C:/Dotty-Test/Ambivalent/Inbox/scan.pdf", "scan.pdf"),
    ]),
    dir("C:/Dotty-Test/Ambivalent/Strom+Gas", "Strom+Gas", [
      dir("C:/Dotty-Test/Ambivalent/Strom+Gas/SW Hamm_Strom", "SW Hamm_Strom", years("C:/Dotty-Test/Ambivalent/Strom+Gas/SW Hamm_Strom")),
      dir("C:/Dotty-Test/Ambivalent/Strom+Gas/SW Hamm_Strom-Alt", "SW Hamm_Strom-Alt", years("C:/Dotty-Test/Ambivalent/Strom+Gas/SW Hamm_Strom-Alt")),
    ]),
  ]);
}

function runNewFolderSuggestCheck(): void {
  const root = hierarchyTree();
  const scanRoot = root.path;
  const inboxInvoice = source(root, "C:/Dotty-Test/Ablage/Inbox/2022-07-14_Verbrauchsabrechnung.pdf");
  const placedInvoice = source(
    root,
    "C:/Dotty-Test/Ablage/Strom+Gas/SW Hamm_Strom/2022/2022-07-14_Verbrauchsabrechnung.pdf",
  );
  const hammPath = "C:/Dotty-Test/Ablage/Strom+Gas/SW Hamm_Strom";
  const hamm2026 = `${hammPath}/2026`;
  const year2026 = hammInvoiceForYear("2026");

  const missingYear = asNewFolder(
    planFolderSuggestions({ scanRoot, root, source: inboxInvoice, view: year2026 }),
    "A: a missing year folder is proposed",
  );
  assert(missingYear.cues.documentYear === "2026", "A: the confirmed document year is 2026");
  assert(missingYear.newFolder.folderName === "2026", "A: the proposed name is 2026");
  assert(missingYear.newFolder.parentPath === hammPath, "A: the parent is the existing vendor folder");
  assert(missingYear.newFolder.path === hamm2026, "A: the future path is SW Hamm_Strom\\2026");
  assert(missingYear.newFolder.pattern === "year", "A: the pattern is a year folder");
  assert(
    missingYear.newFolder.reasons.some((reason) => reason.includes("nach Jahren"))
      && missingYear.newFolder.reasons.some((reason) => reason.includes("2026 fehlt")),
    "A: the reason names the missing year folder",
  );
  assert(
    !collectFolderCandidates(root).some((candidate) => candidate.path === hamm2026),
    "A: 2026 does not exist in the scanned tree",
  );

  const with2026 = hierarchyTree();
  const hammDir = findDirectory(with2026, hammPath);
  assert(hammDir !== null, "B: vendor folder exists");
  addYearFolder(hammDir!, "2026");
  const existingYear = planFolderSuggestions({
    scanRoot,
    root: with2026,
    source: source(with2026, inboxInvoice.path),
    view: year2026,
  });
  assert(existingYear.status === "suggestions", "B: an existing 2026 folder is used");
  assert(existingYear.suggestions[0]?.path === hamm2026, "B: the existing year folder ranks first");
  assert(existingYear.status !== "newFolder", "B: no new folder is proposed when 2026 exists");

  const unknownYear = planFolderSuggestions({ scanRoot, root, source: inboxInvoice, view: hammInvoice(false) });
  assert(unknownYear.cues.documentYear === null, "C: a filename date is not a confirmed document year");
  assert(unknownYear.status !== "newFolder", "C: no year folder is invented without a confirmed year");
  assert(
    unknownYear.status === "suggestions"
      && unknownYear.suggestions.every((item) => !item.path.endsWith("/2026")),
    "C: 2026 is not suggested as an existing folder either",
  );

  const eprimoView = view(
    "Eprimo GmbH\nStromrechnung\nRechnungsdatum: 12.03.2024\nVerbrauchsabrechnung",
    "eprimo.pdf",
  );
  const newVendor = asNewFolder(
    planFolderSuggestions({ scanRoot, root, source: inboxInvoice, view: eprimoView }),
    "D: a new vendor folder is proposed inside the existing structure",
  );
  assert(newVendor.newFolder.pattern === "vendor", "D: the pattern is a vendor folder");
  assert(newVendor.newFolder.parentPath === "C:/Dotty-Test/Ablage/Strom+Gas", "D: the parent is the theme folder Strom+Gas");
  assert(newVendor.newFolder.folderName === "Eprimo_Strom", "D: the name follows the sibling _Strom convention");
  assert(!newVendor.newFolder.folderName.toLowerCase().includes("beendet"), "D: status suffixes such as - beendet are not copied");
  assert(
    stripFolderStatusSuffix("Vattenfall_Strom - beendet") === "Vattenfall_Strom",
    "D: existing closed-vendor labels are stripped only for pattern learning",
  );
  assert(newVendor.newFolder.path === "C:/Dotty-Test/Ablage/Strom+Gas/Eprimo_Strom", "D: the future path stays under Strom+Gas");

  const types = typePatternTree();
  const meter = asNewFolder(
    planFolderSuggestions({
      scanRoot: types.path,
      root: types,
      source: source(types, "C:/Dotty-Test/Themenablage/Inbox/zaehler.pdf"),
      view: view("Zählerstandsmeldung\nZählerstand am 14.03.2025", "zaehler.pdf"),
    }),
    "E: a new document-type folder is proposed when the pattern is clear",
  );
  assert(meter.newFolder.pattern === "documentType", "E: the pattern is a document-type folder");
  assert(meter.newFolder.parentPath === "C:/Dotty-Test/Themenablage/Unterlagen", "E: the parent is the existing type-group folder");
  assert(meter.newFolder.folderName === "Zählerstandsmeldung", "E: the name comes from the recognized document type");
  assert(meter.newFolder.path === "C:/Dotty-Test/Themenablage/Unterlagen/Zählerstandsmeldung", "E: one missing folder, not a new tree");

  const ambiguousRoot = ambiguousYearTree();
  const ambiguous = planFolderSuggestions({
    scanRoot: ambiguousRoot.path,
    root: ambiguousRoot,
    source: source(ambiguousRoot, "C:/Dotty-Test/Ambivalent/Inbox/scan.pdf"),
    view: hammInvoiceForYear("2026"),
  });
  assert(ambiguous.status === "unclear", "F: two equally matching year structures stay unclear");
  assert(ambiguous.reason === FOLDER_SUGGEST_NEW_UNCLEAR, "F: no unique new folder is invented");

  const already = planFolderSuggestions({ scanRoot, root, source: placedInvoice, view: hammInvoice(true) });
  assert(already.status === "alreadyHere", "G: a correctly filed file is not a new-folder case");
  assert(already.reason === FOLDER_SUGGEST_ALREADY_HERE, "G: already-here remains the outcome");

  const hamm = findDirectory(root, hammPath);
  assert(hamm !== null, "H: vendor subtree exists");
  const besideYears = source(root, "C:/Dotty-Test/Ablage/Strom+Gas/SW Hamm_Strom/offen.pdf");
  const smallRoot = asNewFolder(
    planFolderSuggestions({
      scanRoot: hamm!.path,
      root: hamm!,
      source: besideYears,
      view: year2026,
    }),
    "H: a small scan root can still propose the missing year",
  );
  assert(smallRoot.newFolder.parentPath === hamm!.path, "H: the parent stays inside the scan root");
  assert(folderIsInsideScanRoot(hamm!.path, smallRoot.newFolder.path), "H: the future path stays inside the scan root");
  assert(!smallRoot.newFolder.parentPath.includes("Ablage/Strom+Gas") || smallRoot.newFolder.parentPath.endsWith("SW Hamm_Strom"), "H: no parent outside the scanned vendor root");

  assert(!isAcceptableNewFolderName("CON"), "I: reserved device name CON is rejected");
  assert(!isAcceptableNewFolderName("NUL"), "I: reserved device name NUL is rejected");
  assert(!isAcceptableNewFolderName("a|b"), "I: forbidden characters are rejected");
  assert(!isAcceptableNewFolderName("ordner."), "I: trailing dots are rejected");
  assert(isAcceptableNewFolderName("2026"), "I: a year name remains allowed");
  assert(isAcceptableNewFolderName("Eprimo_Strom"), "I: a conventional vendor name remains allowed");
  for (const outcome of [missingYear, newVendor, meter, smallRoot]) {
    assert(isAcceptableNewFolderName(outcome.newFolder.folderName), "I: proposed names pass the Windows rules");
  }

  const before = JSON.stringify(root);
  planFolderSuggestions({ scanRoot, root, source: inboxInvoice, view: year2026 });
  planFolderSuggestions({ scanRoot, root, source: inboxInvoice, view: eprimoView });
  assert(JSON.stringify(root) === before, "J: proposing a folder does not change the file system tree");
  assert(FOLDER_SUGGEST_NEW === "Neuen Ordner vorschlagen", "dialog copy for a new folder is stable");
}

function isYearLeaf(path: string): boolean {
  return /\/(19|20)\d{2}$/.test(path.replace(/\\/g, "/"));
}

function praxisMissingYearTree(): DirectoryNode {
  const hamm = "C:/Dotty-Test/Strom+Gas/SW Hamm_Strom";
  const vattenfall = "C:/Dotty-Test/Strom+Gas/Vattenfall_Strom - beendet";
  return dir("C:/Dotty-Test/Strom+Gas", "Strom+Gas", [
    dir(hamm, "SW Hamm_Strom", [
      dir(`${hamm}/2020`, "2020", [file(`${hamm}/2020/2020_SWHamm_Stromrechnung.pdf`, "2020_SWHamm_Stromrechnung.pdf")]),
      dir(`${hamm}/2021`, "2021", [file(`${hamm}/2021/2021_SWHamm_Stromrechnung.pdf`, "2021_SWHamm_Stromrechnung.pdf")]),
      file(`${hamm}/2022-07-14_Verbrauchsabrechnung.pdf`, "2022-07-14_Verbrauchsabrechnung.pdf"),
    ]),
    dir(vattenfall, "Vattenfall_Strom - beendet", [
      dir(`${vattenfall}/2020`, "2020", [file(`${vattenfall}/2020/2020_Vattenfall_Stromrechnung.pdf`, "2020_Vattenfall_Stromrechnung.pdf")]),
      dir(`${vattenfall}/2021`, "2021", [file(`${vattenfall}/2021/2021_Vattenfall_Stromrechnung.pdf`, "2021_Vattenfall_Stromrechnung.pdf")]),
    ]),
  ]);
}

function vendorWithoutYearsTree(): DirectoryNode {
  const hamm = "C:/Dotty-Test/OhneJahre/SW Hamm_Strom";
  return dir("C:/Dotty-Test/OhneJahre", "OhneJahre", [
    dir(hamm, "SW Hamm_Strom", [
      file(`${hamm}/2022-07-14_Verbrauchsabrechnung.pdf`, "2022-07-14_Verbrauchsabrechnung.pdf"),
    ]),
  ]);
}

function runYearPatternParentFixCheck(): void {
  const root = praxisMissingYearTree();
  const hammPath = "C:/Dotty-Test/Strom+Gas/SW Hamm_Strom";
  const hamm = findDirectory(root, hammPath);
  assert(hamm !== null, "praxis vendor folder exists");
  const loose = source(root, `${hammPath}/2022-07-14_Verbrauchsabrechnung.pdf`);
  const year2022 = hammInvoice(true, loose.name);
  const unknownYear = hammInvoice(false, loose.name);
  const hammCandidates = collectFolderCandidates(hamm!);
  const hammRoot = hammCandidates.find((candidate) => candidate.isScanRoot);
  assert(hammRoot !== undefined, "A: the vendor scan root is collected");
  assert(
    hammRoot!.childFolderNames.includes("2020") && hammRoot!.childFolderNames.includes("2021"),
    "A: the year pattern 2020/2021 is visible on the parent",
  );
  assert(!hammRoot!.childFolderNames.includes("2022"), "A: 2022 is not yet a child folder");

  const missing = asNewFolder(
    planFolderSuggestions({
      scanRoot: hamm!.path,
      root: hamm!,
      source: loose,
      view: year2022,
    }),
    "A: a confirmed 2022 date proposes the missing year folder",
  );
  assert(missing.cues.documentYear === "2022", "A: the document year is the confirmed document date");
  assert(missing.cues.documentDateStatus === "confident", "A: the date status is confident, not a filename guess");
  assert(missing.newFolder.folderName === "2022", "A: the proposed name is 2022");
  assert(missing.newFolder.parentPath === hammPath, "A: the parent is SW Hamm_Strom");
  assert(missing.newFolder.path === `${hammPath}/2022`, "A: the future path is SW Hamm_Strom\\2022");

  const fromTheme = asNewFolder(
    planFolderSuggestions({ scanRoot: root.path, root, source: loose, view: year2022 }),
    "A: the same missing year is proposed from the theme scan root",
  );
  assert(fromTheme.newFolder.path === `${hammPath}/2022`, "A: theme scan root still targets SW Hamm_Strom\\2022");

  const unclearYear = planFolderSuggestions({
    scanRoot: hamm!.path,
    root: hamm!,
    source: loose,
    view: unknownYear,
  });
  assert(unclearYear.cues.documentYear === null, "B: a filename date is not a confirmed document year");
  assert(unclearYear.cues.documentDateStatus === "ask", "B: the date remains unconfirmed");
  assert(unclearYear.status === "yearUnknown", "B: the year pattern is reported instead of alreadyHere");
  assert(unclearYear.reason === FOLDER_SUGGEST_YEAR_UNKNOWN, "B: the year-unknown sentence is used");
  assert(unclearYear.status !== "alreadyHere", "B: the vendor parent is not called the correct folder");
  assert(unclearYear.status !== "newFolder", "B: 2022 is not invented without a confirmed year");

  const with2022 = praxisMissingYearTree();
  const hammWith2022 = findDirectory(with2022, hammPath);
  assert(hammWith2022 !== null, "C: vendor folder exists");
  addYearFolder(hammWith2022!, "2022");
  const existing = planFolderSuggestions({
    scanRoot: hammWith2022!.path,
    root: hammWith2022!,
    source: source(with2022, loose.path),
    view: year2022,
  });
  assert(existing.status === "suggestions", "C: an existing 2022 folder is recommended");
  assert(existing.suggestions[0]?.path === `${hammPath}/2022`, "C: the existing year folder ranks first");
  assert(existing.status !== "alreadyHere", "C: a file still sitting in the vendor parent is not already here");
  assert(existing.status !== "newFolder", "C: no new folder is proposed when 2022 exists");

  const placedTree = praxisMissingYearTree();
  const hammPlaced = findDirectory(placedTree, hammPath);
  assert(hammPlaced !== null, "D: vendor folder exists");
  addYearFolder(hammPlaced!, "2022");
  const inYear = source(placedTree, `${hammPath}/2022/2022_Platzhalter.pdf`);
  const already = planFolderSuggestions({
    scanRoot: hammPlaced!.path,
    root: hammPlaced!,
    source: inYear,
    view: hammInvoice(true, inYear.name),
  });
  assert(already.status === "alreadyHere", "D: a file already in 2022 is correctly filed");
  assert(already.suggestions[0]?.path === `${hammPath}/2022`, "D: the current year folder remains the match");

  const noYears = vendorWithoutYearsTree();
  const vendorRoot = findDirectory(noYears, "C:/Dotty-Test/OhneJahre/SW Hamm_Strom");
  assert(vendorRoot !== null, "E: vendor folder without years exists");
  const vendorFile = source(noYears, "C:/Dotty-Test/OhneJahre/SW Hamm_Strom/2022-07-14_Verbrauchsabrechnung.pdf");
  const noYearPattern = planFolderSuggestions({
    scanRoot: vendorRoot!.path,
    root: vendorRoot!,
    source: vendorFile,
    view: year2022,
  });
  assert(noYearPattern.status === "alreadyHere", "E: a vendor folder without year children stays a valid final folder");
  assert(noYearPattern.suggestions[0]?.path === vendorRoot!.path, "E: the current vendor folder remains the match");
  assert(noYearPattern.status !== "newFolder", "E: no year folder is invented without a year pattern");

  const rival = asNewFolder(
    planFolderSuggestions({ scanRoot: root.path, root, source: loose, view: year2022 }),
    "F: Stadtwerke Hamm still gets a Hamm target",
  );
  assert(!rival.newFolder.path.includes("Vattenfall"), "F: the missing year is not created under a rival vendor");
  assert(rival.newFolder.parentPath === hammPath, "F: the parent stays SW Hamm_Strom");
}

function ocrView(text: string, name: string): DocumentTextView {
  return { ...view(text, name), source: "ocr", ocrAttempted: true };
}

function runFolderDateConfirmCheck(): void {
  const root = praxisMissingYearTree();
  const hammPath = "C:/Dotty-Test/Strom+Gas/SW Hamm_Strom";
  const hamm = findDirectory(root, hammPath);
  assert(hamm !== null, "date-confirm vendor folder exists");
  const loose = source(root, `${hammPath}/2022-07-14_Verbrauchsabrechnung.pdf`);
  const extractDated = hammInvoice(true, loose.name);
  const ocrDated = ocrView(
    "Stadtwerke Hamm\nRechnungsdatum: 14.07.2022\nStromrechnung\nVerbrauchsabrechnung",
    loose.name,
  );
  const ocrEmpty = ocrView("Stadtwerke Hamm\nStromrechnung\nVerbrauchsabrechnung", loose.name);

  const secure = asNewFolder(
    planFolderSuggestions({ scanRoot: hamm!.path, root: hamm!, source: loose, view: extractDated }),
    "A: a confident PDF text-layer date proposes 2022",
  );
  assert(secure.cues.documentDateStatus === "confident", "A: extract dates stay confident");
  assert(secure.cues.documentYear === "2022", "A: the year 2022 is used without a confirmation");
  assert(secure.newFolder.path === `${hammPath}/2022`, "A: the missing year folder is proposed");
  assert(!folderSuggestShowsDateField(secure), "A: a confident date does not open the confirmation field");

  const unsure = planFolderSuggestions({
    scanRoot: hamm!.path,
    root: hamm!,
    source: loose,
    view: ocrDated,
  });
  assert(unsure.status === "yearUnknown", "B: an OCR date is not used silently");
  assert(unsure.cues.documentDateStatus === "ask", "B: OCR dates stay unconfirmed");
  assert(unsure.cues.documentYear === null, "B: the folder engine does not take the OCR year on its own");
  assert(unsure.cues.dateResolution !== null && unsure.cues.dateResolution.status === "ask", "B: the ask-resolution is passed to the dialog");
  assert(preferredAskIso(unsure.cues.dateResolution!) === "2022-07-14", "B: the unique OCR invoice date is offered");
  assert(folderSuggestShowsDateField(unsure), "B: the date field is shown for confirmation");
  assert(unsure.cues.dateResolution!.hits.length > 0, "B: date candidates are not dropped");

  const confirmed = asNewFolder(
    planFolderSuggestions({
      scanRoot: hamm!.path,
      root: hamm!,
      source: loose,
      view: ocrDated,
      confirmedIso: "2022-07-14",
    }),
    "C: confirming the OCR date re-runs folder placement",
  );
  assert(confirmed.cues.documentDateStatus === "confirmed", "C: the confirmation is session-only and marked as confirmed");
  assert(confirmed.cues.documentYear === "2022", "C: the confirmed year is 2022");
  assert(confirmed.newFolder.folderName === "2022", "C: SW Hamm_Strom\\2022 is proposed");
  assert(confirmed.newFolder.parentPath === hammPath, "C: the parent remains the vendor folder");
  assert(folderSuggestShowsDateField(confirmed), "C: the date can still be corrected after confirmation");

  const corrected = asNewFolder(
    planFolderSuggestions({
      scanRoot: hamm!.path,
      root: hamm!,
      source: loose,
      view: ocrDated,
      confirmedIso: "15.03.2023",
    }),
    "D: a corrected date is used",
  );
  assert(corrected.cues.documentYear === "2023", "D: the corrected year is 2023");
  assert(corrected.newFolder.folderName === "2023", "D: the new folder name follows the corrected year");

  const manual = asNewFolder(
    planFolderSuggestions({
      scanRoot: hamm!.path,
      root: hamm!,
      source: loose,
      view: ocrEmpty,
      confirmedIso: "14.07.2022",
    }),
    "E: a typed date can supply a missing document year",
  );
  assert(manual.cues.dateResolution !== null && manual.cues.dateResolution.hits.length === 0, "E: no invented candidate is shown");
  assert(manual.cues.documentYear === "2022", "E: the typed date becomes the year");
  assert(manual.newFolder.path === `${hammPath}/2022`, "E: the missing 2022 folder is proposed");

  const invalid = planFolderSuggestions({
    scanRoot: hamm!.path,
    root: hamm!,
    source: loose,
    view: ocrEmpty,
    confirmedIso: "nicht-datum",
  });
  assert(invalid.status === "yearUnknown", "F: an invalid date does not assign a year");
  assert(invalid.cues.documentYear === null, "F: the year stays unknown");
  assert(invalid.cues.confirmedIso === null, "F: the invalid value is not stored as a confirmation");

  const with2022 = praxisMissingYearTree();
  const hammWith2022 = findDirectory(with2022, hammPath);
  assert(hammWith2022 !== null, "G: vendor folder exists");
  addYearFolder(hammWith2022!, "2022");
  const existing = planFolderSuggestions({
    scanRoot: hammWith2022!.path,
    root: hammWith2022!,
    source: source(with2022, loose.path),
    view: ocrDated,
    confirmedIso: "2022-07-14",
  });
  assert(existing.status === "suggestions", "G: an existing 2022 folder is recommended after confirmation");
  assert(existing.suggestions[0]?.path === `${hammPath}/2022`, "G: the existing year folder ranks first");
  assert(existing.status !== "newFolder", "G: no new folder is proposed when 2022 exists");

  const placedTree = praxisMissingYearTree();
  const hammPlaced = findDirectory(placedTree, hammPath);
  assert(hammPlaced !== null, "H: vendor folder exists");
  addYearFolder(hammPlaced!, "2022");
  const inYear = source(placedTree, `${hammPath}/2022/2022_Platzhalter.pdf`);
  const already = planFolderSuggestions({
    scanRoot: hammPlaced!.path,
    root: hammPlaced!,
    source: inYear,
    view: extractDated,
  });
  assert(already.status === "alreadyHere", "H: a file already in 2022 is not reorganized");
  assert(already.suggestions[0]?.path === `${hammPath}/2022`, "H: the current year folder remains the match");

  const filenameOnly = planFolderSuggestions({
    scanRoot: hamm!.path,
    root: hamm!,
    source: loose,
    view: hammInvoice(false, loose.name),
  });
  assert(filenameOnly.cues.documentYear === null, "no silent year from the file name 2022-07-14");
  assert(filenameOnly.status === "yearUnknown", "filename dates still require confirmation or a typed date");
}
