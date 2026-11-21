import {
  buildLocalAiPrompt,
  clipTextForAi,
  documentTextForAi,
  emptyLocalAiTimings,
  formatLocalAiTimings,
  parseLocalAiResponse,
  type LocalAiClient,
  type LocalAiPrefs,
} from "./localAi";
import {
  buildNameSuggestDiagnoseSnapshot,
  DIAGNOSE_SECTION_KI_RAW,
  DIAGNOSE_SECTION_LINES,
  DIAGNOSE_SECTION_OLLAMA,
  DIAGNOSE_SECTION_PARSED,
  DIAGNOSE_SECTION_RAW,
  formatNameSuggestDiagnoseCopy,
  runNameSuggestDiagnose,
  splitOcrLines,
} from "./localAiDiagnose";
import type { DocumentTextView } from "./treeWorkbenchNameSuggest";

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(label);
  }
}

function view(partial: Partial<DocumentTextView> & Pick<DocumentTextView, "name" | "text" | "format" | "status">): DocumentTextView {
  return {
    scanId: 1,
    path: `C:/scan/${partial.name}`,
    source: partial.source ?? "ocr",
    ocrAttempted: partial.ocrAttempted ?? true,
    ...partial,
  };
}

function fakeClient(response: string | null, ok = true): LocalAiClient {
  return {
    async probe() {
      return { reachable: ok, message: ok ? "ok" : "down", models: ok ? ["llama3.2:latest"] : [] };
    },
    async generate(_model, prompt) {
      assert(prompt.includes("Nur JSON"), "diagnose uses the existing prompt builder");
      return {
        ok,
        response,
        message: ok ? "ok" : "down",
        timings: { totalMs: 3, loadMs: 1, promptEvalMs: 1, evalMs: 1 },
      };
    },
  };
}

export async function runLocalAiDiagnoseCheck(): Promise<void> {
  const ocrText = [
    "HGZ Solutions GmbH",
    "GEG-Informationspflicht / Beratungsnachweis",
    "Einbau einer Gasheizung",
    "Fachkundige Person",
    "01.01.2026",
    "Unterschrift fachkundige Person",
    "Stempel",
  ].join("\n");
  const ocrView = view({
    name: "scan.pdf",
    format: "pdf",
    status: "searchable",
    source: "ocr",
    ocrAttempted: true,
    text: ocrText,
  });
  const lines = splitOcrLines(ocrText);
  assert(lines[0] === "HGZ Solutions GmbH", "first OCR line stays first");
  assert(lines[1] === "GEG-Informationspflicht / Beratungsnachweis", "second OCR line stays second");
  assert(lines[lines.length - 1] === "Stempel", "last OCR line stays last");
  assert(documentTextForAi(ocrView) === ocrText, "usable OCR text is the inspect text");

  const rawKi = '{"absender":"Unterschrift fachkundige Person Stempel SHGZ KGZ","dokumenttyp":null,"betreff":null,"thema":null}';
  const snapshot = buildNameSuggestDiagnoseSnapshot({
    fileName: "scan.pdf",
    view: ocrView,
    kiRan: true,
    kiMessage: "ok",
    rawKiResponse: rawKi,
  });
  assert(snapshot.rawText === ocrText, "raw OCR text is complete");
  assert(snapshot.lines.join("\n") === ocrText, "line order matches stored OCR text");
  assert(snapshot.ollamaDocumentText === clipTextForAi(ocrText), "Ollama document text uses clipTextForAi");
  assert(snapshot.ollamaPrompt === buildLocalAiPrompt("scan.pdf", ocrText), "Ollama prompt is the existing builder output");
  assert(snapshot.rawKiResponse === rawKi, "raw KI response is kept before grounding");
  const parsed = parseLocalAiResponse(rawKi, ocrText);
  assert(snapshot.parsed?.absender === parsed.absender, "parsed fields reuse parseLocalAiResponse");
  assert(snapshot.copyText.includes(DIAGNOSE_SECTION_RAW), "copy text has OCR section");
  assert(snapshot.copyText.includes(DIAGNOSE_SECTION_LINES), "copy text has line section");
  assert(snapshot.copyText.includes(DIAGNOSE_SECTION_OLLAMA), "copy text has Ollama section");
  assert(snapshot.copyText.includes(DIAGNOSE_SECTION_KI_RAW), "copy text has raw KI section");
  assert(snapshot.copyText.includes(DIAGNOSE_SECTION_PARSED), "copy text has parsed section");
  assert(snapshot.copyText.includes("001\tHGZ Solutions GmbH"), "copy text numbers line order");
  assert(snapshot.copyText.includes(rawKi), "copy text includes the ungrounded KI response");
  assert(formatNameSuggestDiagnoseCopy(snapshot) === snapshot.copyText, "copy formatter is stable");

  const cidView = view({
    name: "cid.pdf",
    format: "pdf",
    status: "searchable",
    source: "cache",
    ocrAttempted: false,
    text: "cid cid cid cid cid cid cid cid cid cid",
  });
  const cidSnap = buildNameSuggestDiagnoseSnapshot({
    fileName: "cid.pdf",
    view: cidView,
    kiRan: false,
    kiMessage: "Inspect-Text gilt als nicht nutzbar für die KI. Es wurde kein Prompt gesendet.",
    rawKiResponse: null,
  });
  assert(cidSnap.rawText.includes("cid"), "unusable cache is still shown as raw text");
  assert(!cidSnap.usableForAi, "unusable cache is not sent to Ollama");
  assert(cidSnap.ollamaPrompt === "", "no prompt is built for unusable text");
  assert(cidSnap.copyText.includes("nicht nutzbar"), "copy text explains why Ollama was skipped");

  const prefs: LocalAiPrefs = { version: 1, enabled: true, model: "llama3.2:latest" };
  const ran = await runNameSuggestDiagnose({
    fileName: "scan.pdf",
    view: ocrView,
    prefs,
    client: fakeClient(rawKi),
  });
  assert(ran.kiRan && ran.rawKiResponse === rawKi, "explicit diagnose may call Ollama once");
  assert(ran.ollamaPrompt.includes(clipTextForAi(ocrText).slice(0, 20)), "diagnose prompt contains clipped OCR text");

  const skipped = await runNameSuggestDiagnose({
    fileName: "scan.pdf",
    view: ocrView,
    prefs: { version: 1, enabled: false, model: "" },
    client: fakeClient("should-not-run"),
  });
  assert(!skipped.kiRan && skipped.rawKiResponse === null, "disabled KI does not run during diagnose");
  assert(skipped.rawText === ocrText, "OCR text is still shown without KI");

  const timing = formatLocalAiTimings({
    ...emptyLocalAiTimings(),
    textSource: "ocr",
    textChars: ocrText.length,
    ocrAttempted: true,
    used: true,
    totalMs: 12,
  });
  assert(!timing.includes("HGZ"), "timing log still contains no document text");
  assert(!timing.includes(ocrText.split("\n")[0]!), "timing log still contains no OCR line");
}
