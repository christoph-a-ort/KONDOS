/** P2-L.10b.5: on-demand text diagnosis. Does not change OCR, naming, or the KI prompt. */
import {
  buildLocalAiPrompt,
  clipTextForAi,
  documentTextForAi,
  hasLocalAiNameFields,
  parseLocalAiResponse,
  type LocalAiClient,
  type LocalAiNameFields,
  type LocalAiPrefs,
} from "./localAi";
import type { DocumentTextView } from "./treeWorkbenchNameSuggest";

export const DIAGNOSE_SECTION_RAW = "OCR-Rohtext";
export const DIAGNOSE_SECTION_LINES = "Erkannte Textzeilen";
export const DIAGNOSE_SECTION_OLLAMA = "An Ollama übergebener Text";
export const DIAGNOSE_SECTION_KI_RAW = "KI-Antwort vor der Plausibilitätsprüfung";
export const DIAGNOSE_SECTION_PARSED = "Ergebnis nach der Plausibilitätsprüfung";

export interface NameSuggestDiagnoseSnapshot {
  fileName: string;
  source: string;
  ocrAttempted: boolean;
  rawText: string;
  lines: string[];
  ollamaDocumentText: string;
  ollamaPrompt: string;
  usableForAi: boolean;
  kiRan: boolean;
  kiMessage: string | null;
  rawKiResponse: string | null;
  parsed: LocalAiNameFields | null;
  parsedUsable: boolean;
  copyText: string;
}

export function splitOcrLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  return text.split(/\r?\n/);
}

export function formatDiagnoseFields(fields: LocalAiNameFields | null, usable: boolean): string {
  if (fields === null) {
    return ["dokumenttyp: (keine Antwort)", "absender: (keine Antwort)", "betreff: (keine Antwort)", "thema: (keine Antwort)", `brauchbar: ${usable ? "ja" : "nein"}`].join("\n");
  }
  return [
    `dokumenttyp: ${fields.dokumenttyp ?? "(leer)"}`,
    `absender: ${fields.absender ?? "(leer)"}`,
    `betreff: ${fields.betreff ?? "(leer)"}`,
    `thema: ${fields.thema ?? "(leer)"}`,
    `brauchbar: ${usable ? "ja" : "nein"}`,
  ].join("\n");
}

export function buildNameSuggestDiagnoseSnapshot(input: {
  fileName: string;
  view: DocumentTextView;
  kiRan: boolean;
  kiMessage: string | null;
  rawKiResponse: string | null;
}): NameSuggestDiagnoseSnapshot {
  const rawText = input.view.text ?? "";
  const lines = splitOcrLines(rawText);
  const usableText = documentTextForAi(input.view);
  const usableForAi = usableText.length > 0;
  const ollamaDocumentText = usableForAi ? clipTextForAi(usableText) : "";
  const ollamaPrompt = usableForAi ? buildLocalAiPrompt(input.fileName, usableText) : "";
  const parsed =
    input.rawKiResponse !== null && input.rawKiResponse.trim().length > 0
      ? parseLocalAiResponse(input.rawKiResponse, usableText)
      : null;
  const parsedUsable = parsed !== null && hasLocalAiNameFields(parsed);
  const snapshot: NameSuggestDiagnoseSnapshot = {
    fileName: input.fileName,
    source: input.view.source,
    ocrAttempted: input.view.ocrAttempted === true,
    rawText,
    lines,
    ollamaDocumentText,
    ollamaPrompt,
    usableForAi,
    kiRan: input.kiRan,
    kiMessage: input.kiMessage,
    rawKiResponse: input.rawKiResponse,
    parsed,
    parsedUsable,
    copyText: "",
  };
  snapshot.copyText = formatNameSuggestDiagnoseCopy(snapshot);
  return snapshot;
}

export function formatNameSuggestDiagnoseCopy(snapshot: NameSuggestDiagnoseSnapshot): string {
  const numbered =
    snapshot.lines.length === 0
      ? "(keine Zeilen)"
      : snapshot.lines.map((line, index) => `${String(index + 1).padStart(3, "0")}\t${line}`).join("\n");
  const ollamaBlock = snapshot.usableForAi
    ? snapshot.ollamaPrompt
    : "(nicht übergeben: der Inspect-Text gilt als nicht nutzbar für die KI)";
  const kiRawBlock = !snapshot.kiRan
    ? snapshot.kiMessage ?? "(lokale KI wurde für diese Prüfung nicht aufgerufen)"
    : snapshot.rawKiResponse !== null && snapshot.rawKiResponse.trim().length > 0
      ? snapshot.rawKiResponse
      : snapshot.kiMessage ?? "(leere KI-Antwort)";
  return [
    `Datei: ${snapshot.fileName}`,
    `Quelle: ${snapshot.source}`,
    `OCR ausgeführt: ${snapshot.ocrAttempted ? "ja" : "nein"}`,
    `Zeichen OCR-Rohtext: ${snapshot.rawText.length}`,
    `Zeilen: ${snapshot.lines.length}`,
    "",
    `=== ${DIAGNOSE_SECTION_RAW} ===`,
    snapshot.rawText.length > 0 ? snapshot.rawText : "(leer)",
    "",
    `=== ${DIAGNOSE_SECTION_LINES} ===`,
    "Reihenfolge wie in Windows.Media.Ocr OcrResult.Text gespeichert (Zeilenumbrüche, keine zweite OCR).",
    numbered,
    "",
    `=== ${DIAGNOSE_SECTION_OLLAMA} ===`,
    ollamaBlock,
    "",
    `=== ${DIAGNOSE_SECTION_KI_RAW} ===`,
    kiRawBlock,
    "",
    `=== ${DIAGNOSE_SECTION_PARSED} ===`,
    formatDiagnoseFields(snapshot.parsed, snapshot.parsedUsable),
    "",
  ].join("\n");
}

export async function runNameSuggestDiagnose(options: {
  fileName: string;
  view: DocumentTextView;
  prefs: LocalAiPrefs;
  client: LocalAiClient | null;
}): Promise<NameSuggestDiagnoseSnapshot> {
  const usableText = documentTextForAi(options.view);
  const canCallKi =
    options.client !== null &&
    options.prefs.enabled &&
    options.prefs.model.trim().length > 0 &&
    usableText.length > 0;
  if (!canCallKi) {
    const reason =
      options.client === null || !options.prefs.enabled || options.prefs.model.trim().length === 0
        ? "Lokale KI ist ausgeschaltet oder nicht erreichbar. OCR-Text wird trotzdem angezeigt."
        : "Inspect-Text gilt als nicht nutzbar für die KI. Es wurde kein Prompt gesendet.";
    return buildNameSuggestDiagnoseSnapshot({
      fileName: options.fileName,
      view: options.view,
      kiRan: false,
      kiMessage: reason,
      rawKiResponse: null,
    });
  }
  try {
    const prompt = buildLocalAiPrompt(options.fileName, usableText);
    const result = await options.client!.generate(options.prefs.model, prompt);
    return buildNameSuggestDiagnoseSnapshot({
      fileName: options.fileName,
      view: options.view,
      kiRan: true,
      kiMessage: result.message,
      rawKiResponse: result.ok ? (result.response ?? "") : null,
    });
  } catch (cause) {
    return buildNameSuggestDiagnoseSnapshot({
      fileName: options.fileName,
      view: options.view,
      kiRan: true,
      kiMessage: cause instanceof Error ? cause.message : "Die lokale KI ist fehlgeschlagen.",
      rawKiResponse: null,
    });
  }
}
