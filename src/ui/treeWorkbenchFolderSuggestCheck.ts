import { isDirectory, isFile, type DirectoryNode, type FileNode, type FsNode } from "../model";
import { rememberSenderMapping } from "./learnedSenders";
import {
  canSuggestWorkbenchFolder,
  collectFolderCandidates,
  FOLDER_SUGGEST_ALREADY_HERE,
  FOLDER_SUGGEST_MAX,
  FOLDER_SUGGEST_UNCLEAR,
  folderIsInsideScanRoot,
  folderSuggestCues,
  planFolderSuggestions,
} from "./treeWorkbenchFolderSuggest";
import type { DocumentTextView } from "./treeWorkbenchNameSuggest";

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(label);
  }
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

function isYearLeaf(path: string): boolean {
  return /\/(19|20)\d{2}$/.test(path.replace(/\\/g, "/"));
}
