import { isDirectory, isFile, type DirectoryNode, type FileNode, type FsNode } from "../model";
import {
  BATCH_PAGE_RANGE_UNSUPPORTED,
  createDocumentId,
  createLogicalDocument,
  documentSourceIsSupported,
  physicalFileRefFromNode,
} from "./batchDocument";
import {
  analyzePreparedDocument,
  BATCH_CANCEL_LABEL,
  BATCH_CANCELLED_HINT,
  BATCH_NOT_ANALYZED_LABEL,
  BATCH_PROGRESS_TITLE,
  BATCH_STEP_CANCELLING,
  batchAnalysisOverview,
  batchFileOutcomeTotal,
  belongsToRun,
  captureBatchSelection,
  batchProcessedCountLine,
  batchResultHintExtras,
  completeBatchResults,
  markUnprocessedCancelled,
  planDocumentName,
  skippedUnsupportedSource,
  summarizeBatchResults,
  technicalStatusLabel,
  waitingResult,
  type BatchAnalyzeInput,
  type BatchDocumentResult,
} from "./batchAnalysis";
import { runBatchAnalysis } from "./batchAnalysisRun";
import { emptyLearnedSenderStore } from "./learnedSenders";
import { planAiNameSuggestion } from "./localAi";
import { planNameSuggestion, type NamingRule } from "./namingRules";
import { planFolderSuggestions } from "./treeWorkbenchFolderSuggest";
import type { DocumentTextView } from "./treeWorkbenchNameSuggest";

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(label);
  }
}

function file(path: string, name: string, extras: Partial<FileNode> = {}): FileNode {
  return { id: path, name, path, depth: 1, kind: "file", sizeBytes: 8, modifiedAtMs: 100, ...extras };
}

function dir(path: string, name: string, children: FsNode[] = []): DirectoryNode {
  return { id: path, name, path, depth: 0, kind: "directory", listing: "read", children };
}

function view(text: string, name: string, extras: Partial<DocumentTextView> = {}): DocumentTextView {
  return {
    scanId: 1,
    path: `C:/Dotty-Test/Ablage/${name}`,
    name,
    format: "pdf",
    status: "searchable",
    text,
    source: "extract",
    ...extras,
  };
}

function praxisRoot(): DirectoryNode {
  const hamm = "C:/Dotty-Test/Ablage/Strom+Gas/SW Hamm_Strom";
  return dir("C:/Dotty-Test/Ablage", "Ablage", [
    dir("C:/Dotty-Test/Ablage/Inbox", "Inbox", [
      file("C:/Dotty-Test/Ablage/Inbox/scan.pdf", "scan.pdf"),
      file("C:/Dotty-Test/Ablage/Inbox/notiz.txt", "notiz.txt"),
      file("C:/Dotty-Test/Ablage/Inbox/2022-07-14_Verbrauchsabrechnung.pdf", "2022-07-14_Verbrauchsabrechnung.pdf"),
      file("C:/Dotty-Test/Ablage/Inbox/brief.docx", "brief.docx"),
    ]),
    dir("C:/Dotty-Test/Ablage/Energie", "Energie", [
      dir("C:/Dotty-Test/Ablage/Energie/GEG", "GEG", [
        file(
          "C:/Dotty-Test/Ablage/Energie/GEG/2025-12-01_HGZ_GEG-Beratungsnachweis.pdf",
          "2025-12-01_HGZ_GEG-Beratungsnachweis.pdf",
        ),
      ]),
      dir("C:/Dotty-Test/Ablage/Energie/Rechnungen", "Rechnungen"),
    ]),
    dir("C:/Dotty-Test/Ablage/Strom+Gas", "Strom+Gas", [
      dir(hamm, "SW Hamm_Strom", [
        dir(`${hamm}/2020`, "2020", [file(`${hamm}/2020/2020.pdf`, "2020.pdf")]),
        dir(`${hamm}/2021`, "2021", [file(`${hamm}/2021/2021.pdf`, "2021.pdf")]),
        file(`${hamm}/offen.pdf`, "offen.pdf"),
      ]),
    ]),
  ]);
}

function findNode(node: FsNode, path: string): FsNode {
  if (node.path === path) {
    return node;
  }
  if (!isDirectory(node)) {
    throw new Error(`missing ${path}`);
  }
  for (const child of node.children) {
    try {
      return findNode(child, path);
    } catch {
      /* continue */
    }
  }
  throw new Error(`missing ${path}`);
}

function analyze(
  extras: Partial<BatchAnalyzeInput> & Pick<BatchAnalyzeInput, "document" | "currentNode" | "view" | "root">,
): ReturnType<typeof analyzePreparedDocument> {
  return analyzePreparedDocument({
    runId: extras.runId ?? 1,
    document: extras.document,
    currentNode: extras.currentNode,
    view: extras.view,
    inspectError: extras.inspectError ?? null,
    scanRoot: extras.scanRoot ?? extras.root.path,
    root: extras.root,
    rules: extras.rules ?? [],
    learned: extras.learned ?? emptyLearnedSenderStore(),
    aiFields: extras.aiFields ?? null,
    usedLocalAi: extras.usedLocalAi ?? false,
  });
}

function wholeFileDoc(runId: number, index: number, node: FsNode) {
  return createLogicalDocument({
    documentId: createDocumentId(runId, index),
    sourceKind: "wholeFile",
    file: physicalFileRefFromNode(node),
  });
}

export function runBatchAnalysisCheck(): void {
  const root = praxisRoot();
  const scan = findNode(root, "C:/Dotty-Test/Ablage/Inbox/scan.pdf");
  const txt = findNode(root, "C:/Dotty-Test/Ablage/Inbox/notiz.txt");
  const inbox = findNode(root, "C:/Dotty-Test/Ablage/Inbox");
  const invoice = findNode(root, "C:/Dotty-Test/Ablage/Inbox/2022-07-14_Verbrauchsabrechnung.pdf");
  const docx = findNode(root, "C:/Dotty-Test/Ablage/Inbox/brief.docx");
  const placed = findNode(root, "C:/Dotty-Test/Ablage/Energie/GEG/2025-12-01_HGZ_GEG-Beratungsnachweis.pdf");
  const loose = findNode(root, "C:/Dotty-Test/Ablage/Strom+Gas/SW Hamm_Strom/offen.pdf");
  assert(isFile(scan) && isFile(txt) && isDirectory(inbox), "fixtures");

  const capture = captureBatchSelection(7, [scan, txt, inbox, scan, docx]);
  assert(capture.documents.length === 2, "A: supported files are captured once");
  assert(capture.documents[0]!.documentId !== capture.documents[0]!.file.path, "document id is not the file path");
  assert(capture.skipped.some((item) => item.reason.includes("nicht unterstützt")), "P: unsupported files are skipped with a reason");
  assert(capture.skipped.some((item) => item.reason.includes("Ordner")), "P: folders are skipped with a reason");
  assert(capture.skipped.some((item) => item.reason.includes("bereits")), "O: duplicate files are processed once");
  assert(capture.documents.map((item) => item.file.name).join(",") === "scan.pdf,brief.docx", "B: pdf and docx stay");

  const gegText = view(
    "Haus- und Gebäudewirtschaftszentrum HGZ\nNachweis über die Erfüllung der Informationspflicht nach § 71 Gebäudeenergiegesetz\nGEG-Beratungsnachweis\nDokumentdatum: 01.12.2025",
    "scan.pdf",
  );
  const named = analyze({
    document: wholeFileDoc(1, 0, scan),
    currentNode: scan,
    view: gegText,
    root,
  });
  const directName = planNameSuggestion(scan.name, gegText, []);
  const directFolder = planFolderSuggestions({ scanRoot: root.path, root, source: scan, view: gegText });
  assert(named.proposedFileName === directName.suggestedName, "C: naming reuses planNameSuggestion");
  assert(directFolder.status === "suggestions", "D: folder planner still ranks GEG");
  assert(named.folderPath === directFolder.suggestions[0]?.path, "D: folder reuse matches the existing planner");
  assert(named.documentDate === "2025-12-01", "F: a unique document date is used");
  assert(named.documentDateStatus === "confident", "F: unique extract date is confident");
  assert(!named.ocrAttempted, "F: extract is not treated as OCR");

  const rule: NamingRule = {
    id: "r1",
    name: "GEG-Regel",
    enabled: true,
    formats: ["pdf"],
    keywords: ["Gebäudeenergiegesetz"],
    documentType: "GEG-Beratungsnachweis",
    schema: "{datum}_{dokumenttyp}",
  };
  const withRule = analyze({
    document: wholeFileDoc(1, 1, scan),
    currentNode: scan,
    view: gegText,
    root,
    rules: [rule],
    aiFields: { dokumenttyp: "Rechnung", absender: "Falsch", betreff: null, thema: null },
    usedLocalAi: true,
  });
  assert(withRule.namingRuleName === "GEG-Regel", "E: naming rules win over KI fields");
  assert(withRule.proposedFileName === "2025-12-01_GEG-Beratungsnachweis.pdf", "E: the rule schema is applied");
  assert(!withRule.usedLocalAi, "E: KI is not treated as the source when a rule matches");
  const aiOnly = planDocumentName(scan.name, gegText, [], {
    dokumenttyp: "Schreiben",
    absender: "HGZ",
    betreff: null,
    thema: null,
  });
  assert(aiOnly.source === "ai", "E: without a matching rule the existing KI planner is used");
  assert(planAiNameSuggestion(scan.name, gegText, { dokumenttyp: "Schreiben", absender: "HGZ", betreff: null, thema: null }).suggestedName === aiOnly.suggestedName, "E: KI path is the existing planner");

  const mixedDates = view("Rechnungsdatum 01.03.2026\nBriefdatum 15.04.2026", "scan.pdf");
  const asked = analyze({
    document: wholeFileDoc(1, 2, scan),
    currentNode: scan,
    view: mixedDates,
    root,
  });
  assert(asked.outcomeKind === "needsDecision", "G: several date candidates stay a decision");
  assert(asked.dateCandidates.length >= 2, "G: candidates are kept");
  assert(asked.decisions.some((item) => item.kind === "chooseDate"), "G: the user must choose a date");
  assert(asked.documentDateStatus === "ask", "G: no invented unique date");

  const ocrView = view("Rechnungsdatum: 14.07.2022\nStadtwerke Hamm\nVerbrauchsabrechnung", invoice.name, {
    source: "ocr",
    ocrAttempted: true,
  });
  const ocr = analyze({
    document: wholeFileDoc(1, 3, invoice),
    currentNode: invoice,
    view: ocrView,
    root,
    scanRoot: root.path,
  });
  assert(ocr.ocrAttempted, "H: OCR is recorded");
  assert(ocr.decisions.some((item) => item.kind === "confirmDate"), "H: OCR dates remain confirmation-required");
  assert(ocr.outcomeKind === "needsDecision", "H: OCR does not auto-approve");

  const similar = view("Haus- und Gebäudewirtschaftszentrum HGZ\nBetreff: Rückfrage zum bestehenden Vertrag", "scan.pdf");
  const manyFolders = analyze({
    document: wholeFileDoc(1, 4, scan),
    currentNode: scan,
    view: similar,
    root,
  });
  const similarPlan = planFolderSuggestions({ scanRoot: root.path, root, source: scan, view: similar });
  if (similarPlan.status === "suggestions" && similarPlan.suggestions.length > 1) {
    assert(manyFolders.decisions.some((item) => item.kind === "chooseFolder"), "I: several folders require an explicit choice");
    assert(manyFolders.folderPath === null, "I: no single folder is applied silently");
  }

  const datedInvoice = view(
    "Stadtwerke Hamm\nRechnungsdatum: 14.07.2022\nStromrechnung\nVerbrauchsabrechnung",
    "offen.pdf",
  );
  const created = analyze({
    document: wholeFileDoc(1, 5, loose),
    currentNode: loose,
    view: datedInvoice,
    root,
    scanRoot: "C:/Dotty-Test/Ablage/Strom+Gas/SW Hamm_Strom",
  });
  assert(created.newFolder, "J: a missing year folder is proposed");
  assert(created.folderName === "2022" || (created.folderPath ?? "").includes("2022"), "J: 2022 is proposed");
  assert(created.proposedFileName !== null, "J: a name is still proposed");

  const placedView = view(
    "Haus- und Gebäudewirtschaftszentrum HGZ\nGEG-Beratungsnachweis\nDokumentdatum: 01.12.2025",
    placed.name,
  );
  const already = analyze({
    document: wholeFileDoc(1, 6, placed),
    currentNode: placed,
    view: placedView,
    root,
  });
  assert(already.alreadyPlaced, "K: already filed is detected");
  assert(already.outcomeKind === "alreadyFitting" || already.alreadyNamed, "K: already fitting or already named");

  const missing = analyze({
    document: wholeFileDoc(1, 7, scan),
    currentNode: null,
    view: null,
    inspectError: "Die Datei ist nicht mehr vorhanden.",
    root,
  });
  const later = analyze({
    document: wholeFileDoc(1, 8, docx),
    currentNode: docx,
    view: view("Kurzer Brief ohne Datum.", "brief.docx"),
    root,
  });
  assert(missing.outcomeKind === "failed", "L: a missing file fails");
  assert(later.technicalStatus === "done", "L: a later file is still analyzed");

  const waiting = [waitingResult(3, wholeFileDoc(3, 0, scan)), waitingResult(3, wholeFileDoc(3, 1, docx))];
  const firstDone = analyze({
    runId: 3,
    document: wholeFileDoc(3, 0, scan),
    currentNode: scan,
    view: gegText,
    root,
  });
  const cancelled = markUnprocessedCancelled(3, [wholeFileDoc(3, 0, scan), wholeFileDoc(3, 1, docx)], [firstDone]);
  assert(cancelled.length === 2, "M: cancel keeps the full original document list");
  assert(cancelled[0]!.technicalStatus === "done", "M: completed results are kept after cancel");
  assert(cancelled.some((item) => item.outcomeKind === "cancelled"), "M: remaining documents are marked cancelled");
  assert(cancelled[1]!.error === BATCH_CANCELLED_HINT, "M: unprocessed files use the abort hint");
  assert(batchResultHintExtras(cancelled[1]!) === "", "hint column does not repeat the abort text");
  assert(
    `${cancelled[1]!.error ?? ""}${batchResultHintExtras(cancelled[1]!)}` === BATCH_CANCELLED_HINT,
    "hint column shows the abort text once",
  );
  assert(waiting.length === 2, "N: progress starts from waiting documents");
  assert(BATCH_PROGRESS_TITLE === "Stapelanalyse läuft", "P2-L.12a UX: running progress title");
  assert(BATCH_CANCEL_LABEL === "Analyse abbrechen", "P2-L.12a UX: cancel button label");
  assert(BATCH_STEP_CANCELLING === "Abbruch angefordert …", "P2-L.12a UX: cancel requested copy");
  assert(
    batchProcessedCountLine({
      runId: 1,
      total: 4,
      processed: 1,
      currentName: "scan.pdf",
      step: "Dokumentinhalt wird gelesen …",
      cancelling: false,
    }) === "1 / 4",
    "P2-L.12a UX: processed / total count",
  );

  const changed = analyze({
    document: wholeFileDoc(1, 9, scan),
    currentNode: { ...scan, sizeBytes: 99, modifiedAtMs: 999 },
    view: gegText,
    root,
  });
  assert(changed.outcomeKind === "failed" && (changed.error ?? "").includes("verändert"), "Q: changed fingerprint is not analyzed from cache");

  const pageRange = createLogicalDocument({
    documentId: createDocumentId(9, 0),
    sourceKind: "pdfPageRange",
    file: physicalFileRefFromNode(scan),
    pageRange: { startPage: 1, endPage: 3 },
  });
  const whole = createLogicalDocument({
    documentId: createDocumentId(9, 1),
    sourceKind: "wholeFile",
    file: physicalFileRefFromNode(scan),
  });
  assert(pageRange.file.path === whole.file.path, "T: two document ids can share one PDF");
  assert(pageRange.documentId !== whole.documentId, "T: document ids stay distinct");
  const rejected = skippedUnsupportedSource(9, pageRange);
  assert(!documentSourceIsSupported("pdfPageRange"), "U: page ranges are not supported");
  assert(rejected.error === BATCH_PAGE_RANGE_UNSUPPORTED, "U: page ranges are not reported as analyzed");
  const rejectedFromView = analyze({
    document: pageRange,
    currentNode: scan,
    view: gegText,
    root,
  });
  assert(rejectedFromView.outcomeKind === "skipped", "U: whole-PDF text is not used as a page-range result");
  assert(rejectedFromView.proposedFileName === null, "U: no name is invented for an unimplemented source");

  assert(belongsToRun(4, 4) && !belongsToRun(4, 5), "S: results from another run are rejected");

  const summary = summarizeBatchResults(
    [wholeFileDoc(1, 0, scan), wholeFileDoc(1, 1, docx)],
    [named, missing, later, rejected],
    capture.skipped,
  );
  assert(summary.failed >= 1 && summary.skipped >= 1, "summary counts failures and skips");
  assert(named.technicalStatus === "done", "R: analysis stores results without file operations");
}

export async function runBatchAnalysisRunCheck(): Promise<void> {
  const root = praxisRoot();
  const scan = findNode(root, "C:/Dotty-Test/Ablage/Inbox/scan.pdf");
  const invoice = findNode(root, "C:/Dotty-Test/Ablage/Inbox/2022-07-14_Verbrauchsabrechnung.pdf");
  let inspects = 0;
  let stop = false;
  const results = await runBatchAnalysis({
    runId: 12,
    documents: [wholeFileDoc(12, 0, scan), wholeFileDoc(12, 1, invoice)],
    skipped: [],
    scanRoot: root.path,
    root,
    deps: {
      inspect: async () => {
        inspects += 1;
        if (inspects >= 1) {
          stop = true;
        }
        return view(
          "Haus- und Gebäudewirtschaftszentrum HGZ\nGEG-Beratungsnachweis\nDokumentdatum: 01.12.2025",
          "scan.pdf",
        );
      },
      findNode: (nodeId) => findNode(root, nodeId),
      rules: [],
      learned: emptyLearnedSenderStore(),
      aiPrefs: null,
      aiClient: null,
    },
    shouldStop: () => stop,
    isCurrentRun: (id) => id === 12,
    onProgress: () => undefined,
  });
  assert(inspects === 1, "M: cancel stops before the next inspect");
  assert(results.length === 2, "M: both documents remain after cancel");
  assert(results.some((item) => item.technicalStatus === "done"), "M: the finished document is kept");
  assert(results.some((item) => item.outcomeKind === "cancelled"), "M: later documents are cancelled");
  await runBatchCancelSevenCheck();
  const stale = await runBatchAnalysis({
    runId: 8,
    documents: [wholeFileDoc(8, 0, scan)],
    skipped: [],
    scanRoot: root.path,
    root,
    deps: {
      inspect: async () => view("Dokumentdatum: 01.12.2025\nGEG-Beratungsnachweis", "scan.pdf"),
      findNode: (nodeId) => findNode(root, nodeId),
      rules: [],
      learned: emptyLearnedSenderStore(),
      aiPrefs: null,
      aiClient: null,
    },
    shouldStop: () => false,
    isCurrentRun: () => false,
    onProgress: () => undefined,
  });
  assert(stale.length === 0, "S: a superseded run does not keep results");
}

function sevenInbox(): { root: DirectoryNode; files: FileNode[] } {
  const files = [0, 1, 2, 3, 4, 5, 6].map((index) =>
    file(`C:/Dotty-Test/Ablage/Inbox/d${index}.pdf`, `d${index}.pdf`),
  );
  return {
    root: dir("C:/Dotty-Test/Ablage", "Ablage", [
      dir("C:/Dotty-Test/Ablage/Inbox", "Inbox", files),
    ]),
    files,
  };
}

async function runSevenCancel(options: {
  runId: number;
  stopAtInspect: number | null;
}): Promise<{ results: BatchDocumentResult[]; inspects: number; documents: ReturnType<typeof wholeFileDoc>[] }> {
  const { root, files } = sevenInbox();
  const documents = files.map((node, index) => wholeFileDoc(options.runId, index, node));
  let inspects = 0;
  let stop = false;
  const results = await runBatchAnalysis({
    runId: options.runId,
    documents,
    skipped: [],
    scanRoot: root.path,
    root,
    deps: {
      inspect: async () => {
        inspects += 1;
        if (options.stopAtInspect !== null && inspects === options.stopAtInspect) {
          stop = true;
        }
        if (options.stopAtInspect !== null && inspects > options.stopAtInspect) {
          throw new Error("J: no further analysis after cancel");
        }
        return view(
          "Haus- und Gebäudewirtschaftszentrum HGZ\nGEG-Beratungsnachweis\nDokumentdatum: 01.12.2025",
          "d.pdf",
        );
      },
      findNode: (nodeId) => findNode(root, nodeId),
      rules: [],
      learned: emptyLearnedSenderStore(),
      aiPrefs: null,
      aiClient: null,
    },
    shouldStop: () => stop,
    isCurrentRun: (id) => id === options.runId,
    onProgress: () => undefined,
  });
  return { results, inspects, documents };
}

function assertSevenOverview(
  label: string,
  runId: number,
  documents: ReturnType<typeof wholeFileDoc>[],
  results: BatchDocumentResult[],
  expectDone: number,
  expectCancelled: number,
): void {
  const overview = batchAnalysisOverview(runId, documents, results, []);
  const rows = completeBatchResults(runId, documents, results);
  const fromPartial = batchAnalysisOverview(runId, documents, results.slice(0, Math.max(1, expectDone)), []);
  assert(results.length === 7, `${label} D: runner keeps seven documents`);
  assert(rows.length === 7, `${label} D: completeBatchResults keeps seven documents`);
  assert(overview.rows.length === 7, `${label} H: overview shows seven rows`);
  assert(fromPartial.rows.length === 7, `${label} H: overview fills missing rows`);
  assert(
    documents.every((document) => rows.some((item) => item.document.documentId === document.documentId)),
    `${label} D: every original document id is present`,
  );
  const done = rows.filter((item) => item.technicalStatus === "done");
  const cancelled = rows.filter((item) => item.outcomeKind === "cancelled");
  assert(done.length === expectDone, `${label} E: completed analyses are kept`);
  assert(cancelled.length === expectCancelled, `${label} F: unprocessed documents are marked`);
  assert(
    cancelled.every((item) => item.error === BATCH_CANCELLED_HINT),
    `${label} F: abort hint is set`,
  );
  assert(
    cancelled.every((item) => technicalStatusLabel(item.technicalStatus) === BATCH_NOT_ANALYZED_LABEL),
    `${label} F: status is not analyzed`,
  );
  if (expectDone > 0) {
    const lastProcessed = rows[expectDone - 1]!;
    assert(lastProcessed.technicalStatus === "done", `${label} G: last processed document keeps its result`);
    assert(lastProcessed.document.documentId === documents[expectDone - 1]!.documentId, `${label} G: last processed id`);
  }
  assert(overview.summary.selected === 7, `${label} I: selected count is 7`);
  assert(overview.summary.cancelled === expectCancelled, `${label} I: cancelled count`);
  assert(batchFileOutcomeTotal(overview.summary) === 7, `${label} I: outcome totals match selected files`);
}

async function runBatchCancelSevenCheck(): Promise<void> {
  const first = await runSevenCancel({ runId: 21, stopAtInspect: 1 });
  assert(first.inspects === 1, "A/J: cancel during the first analysis does not start another file");
  assertSevenOverview("A", 21, first.documents, first.results, 1, 6);

  const third = await runSevenCancel({ runId: 22, stopAtInspect: 3 });
  assert(third.inspects === 3, "B/J: cancel during the third analysis does not start another file");
  assertSevenOverview("B", 22, third.documents, third.results, 3, 4);

  const penultimate = await runSevenCancel({ runId: 23, stopAtInspect: 6 });
  assert(penultimate.inspects === 6, "C/J: cancel during the penultimate analysis does not start another file");
  assertSevenOverview("C", 23, penultimate.documents, penultimate.results, 6, 1);

  const full = await runSevenCancel({ runId: 24, stopAtInspect: null });
  assert(full.inspects === 7, "L: regular completion inspects every document");
  assert(full.results.length === 7, "L: regular completion keeps seven results");
  assert(
    full.results.every((item) => item.outcomeKind !== "cancelled"),
    "L: regular completion does not mark files cancelled",
  );
  const fullOverview = batchAnalysisOverview(24, full.documents, full.results, []);
  assert(fullOverview.rows.length === 7 && fullOverview.summary.selected === 7, "L: overview stays complete");
  assert(fullOverview.summary.cancelled === 0, "L: no abort leftovers");

  const waiting = first.documents.map((document) => waitingResult(21, document));
  const fromWaiting = batchAnalysisOverview(21, first.documents, waiting, []);
  assert(fromWaiting.rows.length === 7, "H: waiting placeholders still yield seven overview rows");
  assert(
    fromWaiting.rows.every((item) => item.error === BATCH_CANCELLED_HINT),
    "H: unprocessed waiting rows become abort rows",
  );

  const again = await runSevenCancel({ runId: 25, stopAtInspect: null });
  assert(again.inspects === 7 && again.results.length === 7, "K: a later batch analysis runs in full");
}
