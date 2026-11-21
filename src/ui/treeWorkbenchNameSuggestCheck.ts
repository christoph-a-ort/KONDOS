import { isDirectory, type DirectoryNode, type FileNode, type FsNode } from "../model";
import { canDragWorkbenchFile } from "./treeWorkbenchMove";
import { isWorkbenchRenameShortcut } from "./treeWorkbenchRename";
import {
  buildDatedFileName,
  canSuggestWorkbenchFileName,
  collectDocumentDateHits,
  formatIsoDate,
  parseUserDocumentDate,
  isOcrTextSource,
  preferredAskIso,
  resolveDocumentDate,
  resolveDocumentDateFromView,
  stripLeadingDatePrefix,
  workbenchNameSuggestRequest,
  type DocumentTextView,
} from "./treeWorkbenchNameSuggest";

function file(id: string, name: string, extras: Partial<FileNode> = {}): FileNode {
  return { id, name, path: id, depth: 1, kind: "file", sizeBytes: 4, modifiedAtMs: 100, ...extras };
}

function dir(id: string, name: string, children: FsNode[] = []): DirectoryNode {
  return { id, name, path: id, depth: 0, kind: "directory", listing: "read", children };
}

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
}

export function runTreeWorkbenchNameSuggestCheck(): void {
  const root = dir("C:/Dotty-Test/Probeordner", "Probeordner", [
    file("C:/Dotty-Test/Probeordner/Rechnung_Mueller.pdf", "Rechnung_Mueller.pdf"),
    file("C:/Dotty-Test/Probeordner/2024-01-15_Rechnung_Mueller.pdf", "2024-01-15_Rechnung_Mueller.pdf"),
    dir("C:/Dotty-Test/Probeordner/ziel", "ziel"),
  ]);
  const source = root.children[0];
  const prefixed = root.children[1];
  const folder = root.children[2];
  assert(!isDirectory(source), "fixture file");
  assert(isDirectory(folder), "fixture folder");

  const invoice = resolveDocumentDate(
    "Firma Beispiel GmbH\nRechnungsdatum: 28.10.2026\nZahlungsziel: 11.11.2026\nLieferdatum: 20.10.2026",
  );
  assert(invoice.status === "confident" && invoice.iso === "2026-10-28", "unique invoice date is preferred");
  if (invoice.status === "confident") {
    assert(invoice.evidence.snippet.includes("28.10.2026"), "confident date has a document snippet");
    assert(invoice.evidence.kind === "document", "invoice date is classified as document date");
  }

  const mixed = resolveDocumentDate(
    "Rechnungsdatum 01.03.2026\nBriefdatum 15.04.2026",
  );
  assert(mixed.status === "ask", "different document dates ask the user");
  assert(collectDocumentDateHits("Rechnungsdatum 01.03.2026\nBriefdatum 15.04.2026").length >= 2, "both dates stay visible");

  const empty = resolveDocumentDate("Rechnung ohne erkennbares Kalenderdatum.");
  assert(empty.status === "ask" && empty.hits.length === 0, "no invented date when none is present");

  const unlabeled = resolveDocumentDate("Besprechung am 12.05.2026 im Büro.");
  assert(unlabeled.status === "ask", "unlabeled dates are not auto-used");

  const paymentOnly = resolveDocumentDate("Zahlungsziel: 11.11.2026");
  assert(paymentOnly.status === "ask", "payment due is not used as document date");

  const named = resolveDocumentDate("Berlin, den 28. Oktober 2026");
  assert(named.status === "confident" && named.iso === "2026-10-28", "letter date with month name is a document date");

  assert(parseUserDocumentDate("2026-10-28") === "2026-10-28", "user ISO date is accepted");
  assert(parseUserDocumentDate("28.10.2026") === "2026-10-28", "user German date is accepted");
  assert(parseUserDocumentDate("01.01.2026") === "2026-01-01", "user German New Year date is accepted");
  assert(parseUserDocumentDate("1.1.2026") === "2026-01-01", "unpadded German date is accepted");
  assert(parseUserDocumentDate("31.02.2026") === null, "impossible calendar date is rejected");
  assert(parseUserDocumentDate("") === null, "empty user date is not filled");
  assert(parseUserDocumentDate("heute") === null, "today is not invented from text");
  assert(formatIsoDate(2026, 2, 29) === null, "invalid calendar date is rejected");

  const noPrefix = buildDatedFileName("Rechnung_Mueller.pdf", "2026-10-28");
  assert(noPrefix === "2026-10-28_Rechnung_Mueller.pdf", "name without date prefix keeps the existing name");
  const withPrefix = buildDatedFileName("2024-01-15_Rechnung_Mueller.pdf", "2026-10-28");
  assert(withPrefix === "2026-10-28_Rechnung_Mueller.pdf", "existing date prefix is replaced, not doubled");
  const dotted = buildDatedFileName("28.10.2024_Rechnung.pdf", "2026-10-28");
  assert(dotted === "2026-10-28_Rechnung.pdf", "German date prefix is normalized");
  const compact = buildDatedFileName("20240115_Notiz.txt", "2026-10-28");
  assert(compact === "2026-10-28_Notiz.txt", "compact date prefix is normalized");
  assert(stripLeadingDatePrefix("Rechnung").hadPrefix === false, "plain names keep their stem");

  const unsupported: DocumentTextView = {
    scanId: 1,
    path: "C:/a.txt",
    name: "a.txt",
    format: null,
    status: "unsupported",
    text: null,
    source: "none",
  };
  const asked = resolveDocumentDateFromView(unsupported);
  assert(asked.status === "ask", "unsupported types ask for a date instead of faking analysis");

  const ocrInvoice: DocumentTextView = {
    scanId: 1,
    path: "C:/scan.pdf",
    name: "scan.pdf",
    format: "pdf",
    status: "searchable",
    text: "Rechnungsdatum: 28.10.2026\nZahlungsziel: 11.11.2026",
    source: "ocr",
    ocrAttempted: true,
  };
  const ocrResolved = resolveDocumentDateFromView(ocrInvoice);
  assert(ocrResolved.status === "ask", "OCR dates are never treated as certain");
  assert(preferredAskIso(ocrResolved) === "2026-10-28", "unique OCR invoice date is offered for confirmation");
  assert(isOcrTextSource(ocrInvoice), "OCR source is marked");

  const ocrEmpty: DocumentTextView = {
    scanId: 1,
    path: "C:/leer.png",
    name: "leer.png",
    format: "png",
    status: "noExtractableText",
    text: null,
    source: "ocr",
    ocrAttempted: true,
    message: "Die Texterkennung hat keinen Text gefunden.",
  };
  const ocrEmptyResolved = resolveDocumentDateFromView(ocrEmpty);
  assert(ocrEmptyResolved.status === "ask" && ocrEmptyResolved.hits.length === 0, "image without text asks for a date");

  const ocrFailed: DocumentTextView = {
    scanId: 1,
    path: "C:/kaputt.jpg",
    name: "kaputt.jpg",
    format: "jpeg",
    status: "ocrFailed",
    text: null,
    source: "ocr",
    ocrAttempted: true,
  };
  assert(resolveDocumentDateFromView(ocrFailed).status === "ask", "unreadable OCR still asks instead of inventing a date");

  const extractPdf: DocumentTextView = {
    scanId: 1,
    path: "C:/Rechnung_Mueller.pdf",
    name: "Rechnung_Mueller.pdf",
    format: "pdf",
    status: "searchable",
    text: "Rechnungsdatum: 28.10.2026",
    source: "extract",
  };
  const extractResolved = resolveDocumentDateFromView(extractPdf);
  assert(extractResolved.status === "confident", "PDF text layer can still be certain");

  const prepared = workbenchNameSuggestRequest(root.path, source, noPrefix);
  assert(prepared.ok, "apply reuses the existing rename request");
  if (prepared.ok) {
    assert(prepared.request.targetPath.endsWith("2026-10-28_Rechnung_Mueller.pdf"), "apply stays in the same folder");
    assert(prepared.request.sourcePath === source.path, "apply keeps the selected file");
  }

  const cancelDoesNotBuild = workbenchNameSuggestRequest(root.path, source, "Rechnung_Mueller.pdf");
  assert(!cancelDoesNotBuild.ok && cancelDoesNotBuild.unchanged, "leaving the original name does not rename");

  const folderAttempt = workbenchNameSuggestRequest(root.path, folder, "2026-10-28_ziel");
  assert(!folderAttempt.ok, "folders are not renamed by suggestion");

  assert(canSuggestWorkbenchFileName(source, true), "idle files can request a suggestion");
  assert(!canSuggestWorkbenchFileName(source, false), "busy occupancy blocks suggestions");
  assert(!canSuggestWorkbenchFileName(folder, true), "folders have no name suggestion");
  assert(canDragWorkbenchFile(source, true), "name suggestion does not disable drag-and-drop");
  assert(canDragWorkbenchFile(prefixed, true), "prefixed files remain draggable");
  assert(
    isWorkbenchRenameShortcut({ key: "u", ctrlKey: true, shiftKey: true }),
    "Ctrl+Shift+U remains the inline rename shortcut",
  );
  assert(!isWorkbenchRenameShortcut({ key: "F2" }), "F2 stays unused for rename");

  const originalOcrRaw = "PNG— oder JPG—Datei mit sichtbarem Text 28 .10.2026";
  const originalHits = collectDocumentDateHits(originalOcrRaw);
  assert(originalHits.length === 1, "OCR spaced German date is collected");
  assert(originalHits[0]?.iso === "2026-10-28", "OCR spaced date maps to 2026-10-28");
  assert(originalHits[0]?.kind === "unlabeled", "fixture has no document-date label");
  const originalResolved = resolveDocumentDate(originalOcrRaw);
  assert(originalResolved.status === "ask", "unlabeled OCR date is not treated as certain");
  assert(originalResolved.hits.length === 1 && originalResolved.hits[0]?.iso === "2026-10-28", "ask still keeps the OCR date hit");
  const originalView: DocumentTextView = {
    scanId: 9,
    path: "C:/DottyTest/original-word-jpg-771x320.jpg",
    name: "original-word-jpg-771x320.jpg",
    format: "jpeg",
    status: "searchable",
    text: originalOcrRaw,
    source: "ocr",
    ocrAttempted: true,
  };
  const originalFromView = resolveDocumentDateFromView(originalView);
  assert(originalFromView.status === "ask", "OCR source stays uncertain even with a date hit");
  assert(originalFromView.hits[0]?.iso === "2026-10-28", "OCR date remains available as a choice");
  assert(preferredAskIso(originalFromView) === "", "unlabeled OCR date is not auto-filled");
}
