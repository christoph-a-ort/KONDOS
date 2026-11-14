/** P2-L.8: document-date file name suggestions. Dates come from extracted text or the user. */
import { isFile, type FsNode } from "../model";
import { isValidCalendarDate, stemFromFilename } from "./inventoryFileNameSyntax";
import { isAllowedWindowsComponent } from "./windowsPathRules";
import { canRenameWorkbenchFile, workbenchRenameRequest, type WorkbenchRenameRequest } from "./treeWorkbenchRename";

export type DocumentTextStatus =
  | "searchable"
  | "noExtractableText"
  | "unsupported"
  | "protected"
  | "parseError"
  | "missing"
  | "accessDenied"
  | "ioError"
  | "tooLarge";

export interface DocumentTextView {
  scanId: number;
  path: string;
  name: string;
  format: "pdf" | "docx" | "xlsx" | "png" | "jpeg" | null;
  status: DocumentTextStatus | string;
  text: string | null;
  source: "cache" | "extract" | "ocr" | "none" | string;
  ocrAttempted?: boolean;
  message?: string | null;
}

export type DocumentDateKind = "document" | "other" | "unlabeled";

export interface DocumentDateHit {
  iso: string;
  raw: string;
  kind: DocumentDateKind;
  snippet: string;
  startIndex: number;
}

export type DocumentDateResolution =
  | { status: "confident"; iso: string; evidence: DocumentDateHit; hits: DocumentDateHit[] }
  | { status: "ask"; reason: string; hits: DocumentDateHit[] };

const DOCUMENT_LABELS = [
  "rechnungsdatum",
  "briefdatum",
  "dokumentdatum",
  "ausstellungsdatum",
  "belegdatum",
  "invoice date",
  "letter date",
  "document date",
  "date of invoice",
  "datum der rechnung",
  "datum des schreibens",
];

const REJECT_LABELS = [
  "zahlungsziel",
  "zahlungsfrist",
  "faelligkeitsdatum",
  "faelligkeitsdatum",
  "faellig am",
  "faellig",
  "lieferdatum",
  "liefertermin",
  "versanddatum",
  "leistungszeitraum",
  "geburtsdatum",
  "gueltig bis",
  "gueltigkeitsdatum",
  "referenzdatum",
  "bestelldatum",
  "buchungsdatum",
  "due date",
  "delivery date",
  "payment due",
  "date of birth",
  "valid until",
  "bis zum",
  "zahlbar bis",
];

const MONTHS: Record<string, number> = {
  januar: 1,
  jan: 1,
  februar: 2,
  feb: 2,
  maerz: 3,
  mrz: 3,
  marz: 3,
  april: 4,
  apr: 4,
  mai: 5,
  juni: 6,
  jun: 6,
  juli: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  oktober: 10,
  okt: 10,
  november: 11,
  nov: 11,
  dezember: 12,
  dez: 12,
};

const DATE_DMY = /(?<!\d)(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})(?!\d)/g;
const DATE_DMY2 = /(?<!\d)(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{2})(?!\d)/g;
const DATE_ISO = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
const DATE_YMD_SLASH = /(?<!\d)(\d{4})\/(\d{2})\/(\d{2})(?!\d)/g;
const DATE_DMY_SLASH = /(?<!\d)(\d{1,2})\/(\d{1,2})\/(\d{4})(?!\d)/g;
const DATE_NAMED =
  /(?<!\d)(\d{1,2})\.\s*(januar|jan|februar|feb|maerz|märz|mrz|marz|april|apr|mai|juni|jun|juli|jul|august|aug|september|sept|sep|oktober|okt|november|nov|dezember|dez)\.?\s+(\d{4})/gi;
const LEADING_DATE_PREFIX =
  /^(?:(\d{4})[-_.](\d{2})[-_.](\d{2})|(\d{8})|(\d{1,2})[.](\d{1,2})[.](\d{4}))(?:[_ \-.]+)?/;

export function canSuggestWorkbenchFileName(node: FsNode, occupancyIdle: boolean): boolean {
  return canRenameWorkbenchFile(node, occupancyIdle);
}

export function formatIsoDate(year: number, month: number, day: number): string | null {
  if (!isValidCalendarDate(year, month, day) || year < 1900 || year > 2100) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseUserDocumentDate(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) {
    return formatIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  const dmy = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(trimmed);
  if (dmy) {
    return formatIsoDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  }
  return null;
}

export function foldDocumentLabel(text: string): string {
  return text
    .toLocaleLowerCase("de-DE")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

function expandTwoDigitYear(year: number): number {
  return year >= 80 ? 1900 + year : 2000 + year;
}

function snippetAround(text: string, start: number, length: number): string {
  const from = Math.max(0, start - 32);
  const to = Math.min(text.length, start + length + 24);
  return text.slice(from, to).replace(/\s+/g, " ").trim();
}

function classifyContext(text: string, start: number, length: number): DocumentDateKind {
  const before = foldDocumentLabel(text.slice(Math.max(0, start - 96), start));
  if (REJECT_LABELS.some((label) => before.includes(label))) {
    return "other";
  }
  if (DOCUMENT_LABELS.some((label) => before.includes(label))) {
    return "document";
  }
  if (/\bdatum\s*[:.]?\s*$/.test(before) || /,\s*den\s+$/.test(before)) {
    return "document";
  }
  const after = foldDocumentLabel(text.slice(start + length, Math.min(text.length, start + length + 16)));
  if (/^\s*(faellig|due)\b/.test(after)) {
    return "other";
  }
  return "unlabeled";
}

function pushHit(
  hits: DocumentDateHit[],
  text: string,
  raw: string,
  start: number,
  year: number,
  month: number,
  day: number,
): void {
  const iso = formatIsoDate(year, month, day);
  if (iso === null) {
    return;
  }
  const overlaps = hits.some(
    (hit) => start < hit.startIndex + hit.raw.length && start + raw.length > hit.startIndex,
  );
  if (overlaps) {
    return;
  }
  hits.push({
    iso,
    raw,
    kind: classifyContext(text, start, raw.length),
    snippet: snippetAround(text, start, raw.length),
    startIndex: start,
  });
}

export function collectDocumentDateHits(text: string): DocumentDateHit[] {
  const hits: DocumentDateHit[] = [];
  const addAll = (pattern: RegExp, read: (match: RegExpExecArray) => { raw: string; year: number; month: number; day: number } | null) => {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const parsed = read(match);
      if (parsed === null) {
        continue;
      }
      pushHit(hits, text, parsed.raw, match.index, parsed.year, parsed.month, parsed.day);
    }
  };

  addAll(DATE_DMY, (match) => ({
    raw: match[0],
    year: Number(match[3]),
    month: Number(match[2]),
    day: Number(match[1]),
  }));
  addAll(DATE_ISO, (match) => ({
    raw: match[0],
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }));
  addAll(DATE_YMD_SLASH, (match) => ({
    raw: match[0],
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }));
  addAll(DATE_DMY_SLASH, (match) => {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = Number(match[3]);
    if (first > 12 && second <= 12) {
      return { raw: match[0], year, month: second, day: first };
    }
    if (second > 12 && first <= 12) {
      return { raw: match[0], year, month: first, day: second };
    }
    return { raw: match[0], year, month: second, day: first };
  });
  addAll(DATE_DMY2, (match) => ({
    raw: match[0],
    year: expandTwoDigitYear(Number(match[3])),
    month: Number(match[2]),
    day: Number(match[1]),
  }));
  addAll(DATE_NAMED, (match) => {
    const month = MONTHS[foldDocumentLabel(match[2] ?? "")];
    if (month === undefined) {
      return null;
    }
    return {
      raw: match[0],
      year: Number(match[3]),
      month,
      day: Number(match[1]),
    };
  });

  hits.sort((left, right) => left.startIndex - right.startIndex || left.iso.localeCompare(right.iso));
  return hits;
}

export function resolveDocumentDate(text: string | null | undefined): DocumentDateResolution {
  if (text == null || text.trim().length === 0) {
    return {
      status: "ask",
      reason: "Im Dokumentinhalt wurde kein Datum gefunden.",
      hits: [],
    };
  }
  const hits = collectDocumentDateHits(text);
  const documentHits = hits.filter((hit) => hit.kind === "document");
  const uniqueDocument = uniqueIsos(documentHits);
  if (uniqueDocument.length === 1) {
    const evidence = documentHits.find((hit) => hit.iso === uniqueDocument[0]);
    if (evidence !== undefined) {
      return { status: "confident", iso: uniqueDocument[0], evidence, hits };
    }
  }
  if (uniqueDocument.length > 1) {
    return {
      status: "ask",
      reason: "Es gibt mehrere unterschiedliche Dokumentdaten. Bitte das Datum wählen.",
      hits,
    };
  }
  if (hits.length === 0) {
    return {
      status: "ask",
      reason: "Im Dokumentinhalt wurde kein Datum gefunden.",
      hits,
    };
  }
  return {
    status: "ask",
    reason: "Es wurde kein eindeutiges Dokumentdatum erkannt. Bitte das Datum wählen.",
    hits,
  };
}

export function isOcrTextSource(view: DocumentTextView): boolean {
  return view.source === "ocr" || view.ocrAttempted === true;
}

export function resolveDocumentDateFromView(view: DocumentTextView): DocumentDateResolution {
  if (view.status !== "searchable" || view.text == null || view.text.trim().length === 0) {
    return {
      status: "ask",
      reason: view.message ?? documentTextAskReason(view),
      hits: [],
    };
  }
  const resolved = resolveDocumentDate(view.text);
  if (resolved.status === "confident" && isOcrTextSource(view)) {
    return {
      status: "ask",
      reason: "Die Texterkennung ist unsicher. Bitte das erkannte Dokumentdatum prüfen.",
      hits: resolved.hits,
    };
  }
  return resolved;
}

export function documentTextAskReason(view: DocumentTextView): string {
  if (view.message != null && view.message.length > 0) {
    return view.message;
  }
  switch (view.status) {
    case "unsupported":
      return "Dieser Dateityp kann aktuell nicht zuverlässig ausgelesen werden. Bitte das Datum eingeben.";
    case "noExtractableText":
      return "Der Dokumentinhalt enthält keinen auslesbaren Text. Bitte das Datum eingeben.";
    case "protected":
      return "Das Dokument ist geschützt und wurde nicht ausgelesen. Bitte das Datum eingeben.";
    case "ocrUnavailable":
      return "Texterkennung ist auf diesem Gerät nicht verfügbar. Bitte das Datum eingeben.";
    case "ocrFailed":
      return "Die Texterkennung ist fehlgeschlagen. Bitte das Datum eingeben.";
    case "parseError":
    case "ioError":
    case "missing":
    case "accessDenied":
    case "tooLarge":
      return "Der Dokumentinhalt konnte nicht gelesen werden. Bitte das Datum eingeben.";
    default:
      return "Es wurde kein eindeutiges Dokumentdatum erkannt. Bitte das Datum eingeben.";
  }
}

function uniqueIsos(hits: DocumentDateHit[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const hit of hits) {
    if (!seen.has(hit.iso)) {
      seen.add(hit.iso);
      out.push(hit.iso);
    }
  }
  return out;
}

export function preferredAskIso(resolution: DocumentDateResolution): string {
  if (resolution.status === "confident") {
    return resolution.iso;
  }
  const documents = uniqueDocumentDateChoices(resolution.hits).filter((hit) => hit.kind === "document");
  return documents.length === 1 ? documents[0]!.iso : "";
}

export function uniqueDocumentDateChoices(hits: DocumentDateHit[]): DocumentDateHit[] {
  const seen = new Set<string>();
  const out: DocumentDateHit[] = [];
  for (const hit of hits) {
    if (seen.has(hit.iso)) {
      continue;
    }
    seen.add(hit.iso);
    out.push(hit);
  }
  return out;
}

export function stripLeadingDatePrefix(stem: string): { remainder: string; hadPrefix: boolean } {
  const match = LEADING_DATE_PREFIX.exec(stem);
  if (match === null) {
    return { remainder: stem, hadPrefix: false };
  }
  let year: number;
  let month: number;
  let day: number;
  if (match[1] !== undefined) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else if (match[4] !== undefined) {
    year = Number(match[4].slice(0, 4));
    month = Number(match[4].slice(4, 6));
    day = Number(match[4].slice(6, 8));
  } else {
    year = Number(match[7]);
    month = Number(match[6]);
    day = Number(match[5]);
  }
  if (formatIsoDate(year, month, day) === null) {
    return { remainder: stem, hadPrefix: false };
  }
  return { remainder: stem.slice(match[0].length), hadPrefix: true };
}

export function sanitizeSuggestedFileNamePart(value: string): string {
  let cleaned = value.trim();
  cleaned = [...cleaned].map((character) => {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || '<>:"/\\|?*'.includes(character)) {
      return "_";
    }
    return character;
  }).join("");
  cleaned = cleaned.replace(/_+/g, "_").replace(/^[_ .]+|[_ .]+$/g, "");
  return cleaned;
}

export function buildDatedFileName(fileName: string, isoDate: string): string {
  const fromName = stemFromFilename(fileName);
  const stripped = stripLeadingDatePrefix(fromName.stem);
  const remainder = sanitizeSuggestedFileNamePart(stripped.remainder);
  const extension = fromName.hasExtension ? fileName.slice(fileName.lastIndexOf(".")) : "";
  const built = remainder.length > 0 ? `${isoDate}_${remainder}${extension}` : `${isoDate}${extension}`;
  return built;
}

export function nameSuggestNeedsUserDate(resolution: DocumentDateResolution): boolean {
  return resolution.status === "ask";
}

export function workbenchNameSuggestRequest(
  scanRoot: string,
  source: FsNode,
  typedName: string,
): { ok: true; request: WorkbenchRenameRequest } | { ok: false; reason: string; unchanged: boolean } {
  if (!isFile(source)) {
    return { ok: false, reason: "Nur einzelne Dateien können umbenannt werden.", unchanged: false };
  }
  if (!isAllowedWindowsComponent(typedName.trim())) {
    return { ok: false, reason: "Der Dateiname ist unzulässig.", unchanged: false };
  }
  return workbenchRenameRequest(scanRoot, source, typedName);
}
