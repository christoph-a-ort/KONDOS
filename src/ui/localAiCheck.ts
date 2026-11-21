import {
  buildLocalAiPrompt,
  clearLocalAiResultCache,
  clipTextForAi,
  composeAiNameStem,
  defaultLocalAiPrefs,
  documentTextForAi,
  extractCompleteLocalAiJson,
  formatLocalAiTimings,
  groundedAiValue,
  hasLocalAiNameFields,
  hydrateLocalAiPrefs,
  loadLocalAiPrefs,
  localAiCacheKey,
  localAiJsonLooksTruncated,
  LOCAL_AI_PREFS_KEY,
  nameSuggestSourceLabel,
  normalizeCompanyName,
  parseLocalAiResponse,
  persistLocalAiPrefs,
  planAiNameSuggestion,
  requestLocalAiNameFields,
  resolveDocumentType,
  sanitizeLocalAiPrefs,
  saveLocalAiPrefs,
  shouldUseLocalAiFallback,
  type LocalAiClient,
  type LocalAiPrefs,
} from "./localAi";
import { applySuggestedFileName, planNameSuggestion, type NamingRule } from "./namingRules";
import { canDragWorkbenchFile } from "./treeWorkbenchMove";
import { isWorkbenchRenameShortcut } from "./treeWorkbenchRename";
import {
  preferredAskIso,
  resolveDocumentDateFromView,
  workbenchNameSuggestRequest,
  type DocumentTextView,
} from "./treeWorkbenchNameSuggest";
import { isDirectory, type DirectoryNode, type FileNode, type FsNode } from "../model";

function file(id: string, name: string, extras: Partial<FileNode> = {}): FileNode {
  return { id, name, path: id, depth: 1, kind: "file", sizeBytes: 4, modifiedAtMs: 100, ...extras };
}

function dir(id: string, name: string, children: FsNode[] = []): DirectoryNode {
  return { id, name, path: id, depth: 0, kind: "directory", listing: "read", children };
}

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
}

function view(partial: Partial<DocumentTextView> & Pick<DocumentTextView, "name" | "text" | "format" | "status">): DocumentTextView {
  return {
    scanId: 1,
    path: `C:/scan/${partial.name}`,
    source: partial.source ?? "extract",
    ocrAttempted: partial.ocrAttempted ?? false,
    ...partial,
  };
}

const invoiceRule: NamingRule = {
  id: "rule-invoice",
  name: "Rechnungen",
  enabled: true,
  formats: ["pdf"],
  keywords: ["Rechnung"],
  documentType: "Rechnung",
  schema: "{datum}_{dokumenttyp}_{name}",
};

const invoiceView = view({
  name: "scan.pdf",
  format: "pdf",
  status: "searchable",
  text: "Firma Beispiel GmbH\nRechnungsdatum: 28.10.2026\nAbsender: Mueller GmbH\nBetreff: Wartung Oktober",
});

const letterView = view({
  name: "schreiben.pdf",
  format: "pdf",
  status: "searchable",
  text: "Stadtwerke Musterstadt\nBetreff: Zählerablesungsmeldung\nAblesedatum 14.11.2026",
});

class MemoryStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function fakeClient(response: string | null, ok = true): LocalAiClient {
  return {
    async probe() {
      return { reachable: ok, message: ok ? "ok" : "down", models: ok ? ["llama3.2:latest"] : [] };
    },
    async generate() {
      if (!ok) {
        throw new Error("offline");
      }
      return { ok: response !== null, response, message: response ? "ok" : "empty" };
    },
  };
}

export async function runLocalAiCheck(): Promise<void> {
  clearLocalAiResultCache();
  const root = dir("C:/Dotty-Test/Probeordner", "Probeordner", [
    file("C:/Dotty-Test/Probeordner/schreiben.pdf", "schreiben.pdf"),
  ]);
  const source = root.children[0];
  assert(!isDirectory(source), "fixture file");

  const off = defaultLocalAiPrefs();
  assert(off.enabled === false, "KI is off by default");
  assert(!shouldUseLocalAiFallback([], letterView, off), "disabled KI does not start");
  const on: LocalAiPrefs = { version: 1, enabled: true, model: "llama3.2:latest" };
  assert(shouldUseLocalAiFallback([], letterView, on), "enabled KI starts when no rule matches");
  assert(!shouldUseLocalAiFallback([invoiceRule], invoiceView, on), "matching rule prevents KI fallback");
  assert(shouldUseLocalAiFallback([invoiceRule], letterView, on), "non-matching rule allows KI fallback");
  assert(!shouldUseLocalAiFallback([], view({ name: "leer.pdf", format: "pdf", status: "noExtractableText", text: null }), on), "empty text does not start KI");

  const unavailable = sanitizeLocalAiPrefs({ enabled: true, model: "http://evil" });
  assert(unavailable.model === "", "remote model names are rejected");
  assert(sanitizeLocalAiPrefs({ enabled: "yes", model: "llama3.2:latest" }).enabled === false, "enabled must be boolean true");

  const storage = new MemoryStorage();
  assert(saveLocalAiPrefs(on, storage), "prefs save");
  const loaded = loadLocalAiPrefs(storage);
  assert(loaded.enabled && loaded.model === "llama3.2:latest", "prefs load");
  assert(storage.getItem(LOCAL_AI_PREFS_KEY)?.includes("llama3.2") === true, "prefs key written");
  const memoryJson = {
    raw: null as string | null,
    async load() {
      return this.raw;
    },
    async save(json: string) {
      this.raw = json;
    },
  };
  await persistLocalAiPrefs(on, memoryJson, new MemoryStorage());
  const hydrated = await hydrateLocalAiPrefs(memoryJson, new MemoryStorage());
  assert(hydrated.model === "llama3.2:latest", "json store roundtrip");

  const prompt = buildLocalAiPrompt("schreiben.pdf", letterView.text ?? "");
  assert(prompt.includes("null") && prompt.includes("Zählerablesungsmeldung"), "prompt uses document text");
  assert(prompt.includes("bestimmst nicht den Dateinamen"), "prompt does not let the model compose the filename");
  assert(!prompt.includes("Datei:"), "current filename is not sent as document evidence");
  assert(!prompt.includes("schreiben.pdf"), "prompt does not repeat the current filename");
  assert(!prompt.toLowerCase().includes("openai"), "prompt stays local");
  const longText = `${"Vattenfall Europe Sales GmbH\nJahresrechnung Strom\n".repeat(200)}ENDE`;
  const clipped = clipTextForAi(longText);
  assert(clipped.includes("Vattenfall") && clipped.includes("ENDE") && clipped.includes("[...]"), "long prompts keep head and tail");
  assert(clipped.length < longText.length, "long document text is clipped for the model");
  assert(buildLocalAiPrompt("a.pdf", longText).length < 3200, "KI prompt stays compact");

  const grounded = parseLocalAiResponse(
    '{"dokumenttyp":"Zählerablesungsmeldung","absender":"Stadtwerke Musterstadt","betreff":"Zählerablesungsmeldung","thema":null}',
    letterView.text ?? "",
  );
  assert(grounded.absender === "Stadtwerke Musterstadt", "grounded sender is kept");
  assert(hasLocalAiNameFields(grounded), "grounded fields exist");
  const invented = parseLocalAiResponse(
    '{"dokumenttyp":"Rechnung","absender":"Fantasie AG","betreff":"Geheimvertrag","thema":"2026-11-14"}',
    letterView.text ?? "",
  );
  assert(invented.absender === "Stadtwerke Musterstadt", "letterhead organisation wins over an invented sender");
  assert(invented.betreff === null && invented.thema === null, "invented subject is dropped");
  assert(groundedAiValue("Nur Fliesstext", "Mueller GmbH") === null, "missing evidence is not used");
  assert(documentTextForAi(letterView).includes("Zählerablesungsmeldung"), "existing extract is reused");

  const aiPlan = planAiNameSuggestion("schreiben.pdf", letterView, grounded, { datum: "2026-11-14" });
  assert(aiPlan.source === "ai", "AI plan is marked as local KI");
  assert(
    aiPlan.suggestedName === "2026-11-14_Stadtwerke Musterstadt_Zählerstandsmeldung.pdf",
    "AI name uses sender and unified document type",
  );
  assert(nameSuggestSourceLabel(aiPlan) === "Lokale KI", "dialog can label KI source");
  assertUniformElectricityInvoices();
  assertSenderNotSignatory();
  assertScannedGegCertificate();
  assertScannedGegFormFromDiagnose();
  assert(normalizeCompanyName("Vattenfall Europe Sales GmbH") === "Vattenfall", "legal form and generic suffixes are stripped");
  assert(normalizeCompanyName("Stadtwerke Musterstadt") === "Stadtwerke Musterstadt", "multi-word distinctive names stay");
  assert(normalizeCompanyName("Deutsche Telekom AG") === "Deutsche Telekom", "legal form only is stripped from multi-word names");
  assert(resolveDocumentType("Jahresrechnung Strom der Stadtwerke", "Rechnung") === "Stromrechnung", "document evidence unifies electricity invoices");
  assert(resolveDocumentType("Rechnung über Wartung", "Stromrechnung") === "Rechnung", "unevidenced specialization is not used");
  assert(resolveDocumentType("Mahnung wegen Zahlungsverzug", "Mahnung") === "Mahnung", "unknown evidenced types are kept");
  const missingSender = parseLocalAiResponse('{"dokumenttyp":"Mahnung","absender":null,"betreff":null,"thema":null}', "Mahnung wegen Zahlungsverzug vom 02.03.2026");
  assert(missingSender.absender === null && missingSender.dokumenttyp === "Mahnung", "missing sender is not invented");
  const missingSenderPlan = planAiNameSuggestion(
    "mahnung.pdf",
    view({ name: "mahnung.pdf", format: "pdf", status: "searchable", text: "Mahnung wegen Zahlungsverzug vom 02.03.2026" }),
    missingSender,
    { datum: "2026-03-02" },
  );
  assert(missingSenderPlan.suggestedName === "2026-03-02_Mahnung.pdf", "fallback without sender uses the evidenced type");
  assert(
    composeAiNameStem({ dokumenttyp: "Rechnung", absender: null, betreff: "rechnung", thema: null }, "scan") === "Rechnung",
    "betreff is not preferred over document type",
  );
  const typed = applySuggestedFileName("schreiben.pdf", "2026-11-14_Notiz.pdf");
  assert(typed.ok && typed.fileName === "2026-11-14_Notiz.pdf", "manual names remain applicable");
  const rulePlan = planNameSuggestion("scan.pdf", invoiceView, [invoiceRule]);
  assert(rulePlan.source === "rule", "rules still win before KI");
  assert(nameSuggestSourceLabel(rulePlan).includes("Rechnungen"), "rule source label remains");

  const fromKi = await requestLocalAiNameFields(
    fakeClient('{"betreff":"Zählerablesungsmeldung","absender":"Stadtwerke Musterstadt","dokumenttyp":null,"thema":null}'),
    on,
    "schreiben.pdf",
    letterView,
    [],
  );
  assert(fromKi.used && fromKi.fields?.betreff === "Zählerablesungsmeldung", "KI fallback runs without a matching rule");
  assert(typeof fromKi.timings.totalMs === "number", "timings are recorded in milliseconds");
  assert(formatLocalAiTimings(fromKi.timings).includes("ms") && !formatLocalAiTimings(fromKi.timings).includes("Zähler"), "timing log has no document text");
  assert(formatLocalAiTimings(fromKi.timings).includes("total="), "wall-clock total is part of the timing line");

  const skipped = await requestLocalAiNameFields(fakeClient("ignored"), on, "scan.pdf", invoiceView, [invoiceRule]);
  assert(!skipped.used && skipped.fields === null, "rule match does not call KI");
  assert(skipped.timings.used === false && skipped.timings.ollamaMs === null, "rule match skips Ollama timing");

  clearLocalAiResultCache();
  const failed = await requestLocalAiNameFields(fakeClient(null, false), on, "offline.pdf", letterView, []);
  assert(failed.used && failed.fields === null, "KI errors fall back to the default suggestion");

  const disabled = await requestLocalAiNameFields(fakeClient("x"), off, "schreiben.pdf", letterView, []);
  assert(!disabled.used, "disabled KI does not call Ollama");

  await assertLocalAiCache(on);

  const prepared = workbenchNameSuggestRequest(root.path, source, "2026-11-14_Zählerablesungsmeldung.pdf");
  assert(prepared.ok, "AI suggestion still applies through the existing rename request");
  const manual = workbenchNameSuggestRequest(root.path, source, "2026-11-14_Notiz.pdf");
  assert(manual.ok, "manual rename remains possible");
  assert(canDragWorkbenchFile(source, true), "drag-and-drop remains");
  assert(
    isWorkbenchRenameShortcut({ key: "u", ctrlKey: true, shiftKey: true }),
    "Ctrl+Shift+U remains",
  );
}

async function assertLocalAiCache(on: LocalAiPrefs): Promise<void> {
  clearLocalAiResultCache();
  let calls = 0;
  const counted: LocalAiClient = {
    async probe() {
      return { reachable: true, message: "ok", models: ["llama3.2:latest"] };
    },
    async generate() {
      calls += 1;
      return {
        ok: true,
        response: '{"absender":"Stadtwerke Musterstadt","dokumenttyp":"Zählerablesungsmeldung","betreff":null,"thema":null}',
        message: "ok",
        timings: { totalMs: 12, loadMs: 1, promptEvalMs: 4, evalMs: 7 },
      };
    },
  };
  const first = await requestLocalAiNameFields(counted, on, "cache.pdf", letterView, []);
  const second = await requestLocalAiNameFields(counted, on, "cache.pdf", letterView, []);
  assert(first.used && !first.cacheHit && calls === 1, "first KI call is a cache miss");
  assert(second.cacheHit && calls === 1, "repeated file reuses the KI result");
  assert(second.timings.cacheHit && second.timings.ollamaMs === 0, "cache hit does not call Ollama");
  assert(localAiCacheKey(on.model, "cache.pdf", letterView.text ?? "") === localAiCacheKey("llama3.2:latest", "cache.pdf", letterView.text ?? ""), "cache key is stable");
  const otherText = view({
    name: "cache.pdf",
    format: "pdf",
    status: "searchable",
    text: `${letterView.text ?? ""}\nZusatzzeile fuer Cache-Fehlschlag`,
  });
  const missedText = await requestLocalAiNameFields(counted, on, "cache.pdf", otherText, []);
  assert(!missedText.cacheHit && calls === 2, "changed document text is a cache miss");
  const otherModel = await requestLocalAiNameFields(
    counted,
    { ...on, model: "qwen2.5:7b" },
    "cache.pdf",
    letterView,
    [],
  );
  assert(!otherModel.cacheHit && calls === 3, "model change is a cache miss");
  const beforeRules = calls;
  const ruled = await requestLocalAiNameFields(counted, on, "scan.pdf", invoiceView, [invoiceRule]);
  assert(!ruled.used && calls === beforeRules, "matching rule still avoids a KI call");
}

function assertScannedGegCertificate(): void {
  const ocrText = [
    "HGZ Solutions GmbH",
    "GEG-Beratungsnachweis",
    "Einbau einer Gasheizung",
    "01.01.2026",
  ].join("\n");
  const ocrView = view({
    name: "scan.pdf",
    format: "pdf",
    status: "searchable",
    source: "ocr",
    ocrAttempted: true,
    text: ocrText,
  });
  const emptyKi = parseLocalAiResponse("kein json", ocrText);
  assert(emptyKi.absender === "HGZ", "OCR letterhead company is used even if the model returns no JSON");
  assert(emptyKi.dokumenttyp === "GEG-Beratungsnachweis", "GEG certificate type is taken from evidenced OCR text");
  assert(documentTextForAi(ocrView).includes("HGZ Solutions GmbH"), "usable OCR text is passed to the KI");
  assert(clipTextForAi(ocrText).includes("GEG-Beratungsnachweis"), "short scan OCR is not clipped away");
  assert(documentTextForAi(view({ name: "cid.pdf", format: "pdf", status: "searchable", source: "cache", text: "cid cid cid cid cid cid cid cid cid cid" })) === "", "cid cache is not treated as KI text");
  const invented = parseLocalAiResponse(
    '{"absender":"Fantasie AG","dokumenttyp":"Rechnung","betreff":null,"thema":null}',
    ocrText,
  );
  assert(invented.absender === "HGZ", "invented sender does not replace the OCR company");
  const asked = planAiNameSuggestion("scan.pdf", ocrView, emptyKi);
  const dateAsk = resolveDocumentDateFromView(ocrView);
  assert(dateAsk.status === "ask", "handwritten unlabeled OCR date stays confirmable");
  assert(preferredAskIso(dateAsk) === "", "unlabeled OCR date is not auto-filled");
  assert(asked.missing.includes("datum"), "handwritten date is offered for confirmation");
  const plan = planAiNameSuggestion("scan.pdf", ocrView, emptyKi, { datum: "2026-01-01" });
  assert(plan.suggestedName === "2026-01-01_HGZ_GEG-Beratungsnachweis.pdf", "confirmed date plus OCR fields build the GEG name");
  assert(!plan.suggestedName?.includes("Fantasie"), "invented names stay out of the filename");
}

function assertScannedGegFormFromDiagnose(): void {
  const ocrText =
    "Nachweis Erfüllung Informationspflicht nach S 71 Absatz 11 Gebäudeenergiegesetz Unterschrift fachkundige Person Stempel SHGZ KGZ GmbH Berlin";
  const ocrView = view({
    name: "alter-scan.pdf",
    format: "pdf",
    status: "searchable",
    source: "ocr",
    ocrAttempted: true,
    text: ocrText,
  });
  assert(
    resolveDocumentType(ocrText, "Zählerstandsmeldung") === "GEG-Beratungsnachweis",
    "Informationspflicht after §71 GEG is a GEG certificate, not a meter reading",
  );
  assert(
    resolveDocumentType("Nachweis Erfüllung Informationspflicht nach 5 71 Absatz 11 Gebäudeenergiegesetz", null) ===
      "GEG-Beratungsnachweis",
    "OCR may read § as 5",
  );
  assert(
    resolveDocumentType("Nachweis Erfüllung Informationspflicht nach § 71 Absatz 11 Gebäudeenergiegesetz", null) ===
      "GEG-Beratungsnachweis",
    "literal § remains readable",
  );
  const truncated =
    '{"absender":"Unterschrift fachkundige Person Stempel SHGZ KGZ","dokumenttyp":"Zählerstandsmeldung","betreff":"alter-scan.pdf","thema":';
  assert(extractCompleteLocalAiJson(truncated) === null, "truncated JSON is not parsed");
  assert(localAiJsonLooksTruncated(truncated, "length"), "done_reason=length marks incomplete JSON");
  const fromTruncated = parseLocalAiResponse(truncated, ocrText);
  assert(fromTruncated.absender === null, "stamp fragments are not invented as a company");
  assert(fromTruncated.dokumenttyp === "GEG-Beratungsnachweis", "document type is taken from OCR evidence");
  assert(fromTruncated.betreff === null, "truncated JSON does not become a subject");
  const completeBad = parseLocalAiResponse(
    '{"absender":"Unterschrift fachkundige Person Stempel SHGZ KGZ","dokumenttyp":"Zählerstandsmeldung","betreff":"alter-scan.pdf","thema":null}',
    ocrText,
  );
  assert(completeBad.absender === null, "form captions are not used as sender");
  assert(completeBad.dokumenttyp === "GEG-Beratungsnachweis", "unevidenced meter-reading type is discarded");
  assert(completeBad.betreff === null, "current filename is not used as subject");
  assert(!buildLocalAiPrompt("alter-scan.pdf", ocrText).includes("alter-scan.pdf"), "prompt does not contain the current filename");
  const asked = planAiNameSuggestion("alter-scan.pdf", ocrView, fromTruncated);
  assert(asked.missing.includes("datum"), "missing handwritten date stays confirmable");
  assert(preferredAskIso(resolveDocumentDateFromView(ocrView)) === "", "filename date is not invented");
  const named = planAiNameSuggestion("alter-scan.pdf", ocrView, fromTruncated, { datum: "2026-01-01" });
  assert(named.suggestedName === "2026-01-01_GEG-Beratungsnachweis.pdf", "missing sender still yields a typed filename");
  const typed = applySuggestedFileName("alter-scan.pdf", "2026-01-01_Notiz.pdf");
  assert(typed.ok && typed.fileName === "2026-01-01_Notiz.pdf", "manual filename remains possible");
}

function assertSenderNotSignatory(): void {
  const eprimoText = [
    "eprimo GmbH",
    "Flughafenstraße 20",
    "65760 Eschborn",
    "Jahresabrechnung",
    "Rechnungsdatum: 22.12.2019",
    "Verbrauch Strom in kWh: 2100",
    "Rechnung über Ihre Stromlieferung",
    "Sehr geehrte Kundin, sehr geehrter Kunde,",
    "anbei Ihre Jahresabrechnung.",
    "Mit freundlichen Grüßen",
    "Jürgen Emich",
    "Leiter Energiewirtschaftliche Prozesse",
  ].join("\n");
  const eprimoView = view({
    name: "jahresabrechnung.pdf",
    format: "pdf",
    status: "searchable",
    text: eprimoText,
  });
  const eprimo = parseLocalAiResponse(
    '{"absender":"Jürgen Emich","dokumenttyp":"Stromrechnung","betreff":"Jahresabrechnung","thema":null}',
    eprimoText,
  );
  assert(eprimo.absender === "eprimo", "letterhead company wins over the signatory");
  assert(eprimo.dokumenttyp === "Stromrechnung", "eprimo document type stays Stromrechnung");
  assert(eprimo.betreff === "Jahresabrechnung", "eprimo subject stays Jahresabrechnung");
  const eprimoPlan = planAiNameSuggestion("jahresabrechnung.pdf", eprimoView, eprimo);
  assert(eprimoPlan.suggestedName === "2019-12-22_eprimo_Stromrechnung.pdf", "eprimo filename uses the company");
  assert(!eprimoPlan.suggestedName?.includes("Emich"), "signatory is not part of the filename");
  assert(!buildLocalAiPrompt("jahresabrechnung.pdf", eprimoText).includes("Emich"), "prompt drops the signature block");

  const letter = parseLocalAiResponse(
    '{"absender":"Petra Wolf","dokumenttyp":null,"betreff":"Vertragsangebot","thema":null}',
    "Alpha GmbH\nVertragsangebot\nMit freundlichen Grüßen\nPetra Wolf\nGeschäftsführerin",
  );
  assert(letter.absender === "Alpha", "business letter uses the company, not the signatory");

  const contact = parseLocalAiResponse(
    '{"absender":"Lisa Jung","dokumenttyp":"Rechnung","betreff":null,"thema":null}',
    "Beta AG\nRechnung vom 03.04.2024\nAnsprechpartner: Lisa Jung\nBitte überweisen.",
  );
  assert(contact.absender === "Beta", "invoice contact is not the sender");

  const agency = parseLocalAiResponse(
    '{"absender":"Tim Abel","dokumenttyp":null,"betreff":"Steuerbescheid","thema":null}',
    "Finanzamt Musterstadt\nSteuerbescheid\nSachbearbeiter: Tim Abel\nIhre Steuerangelegenheit",
  );
  assert(agency.absender === "Finanzamt Musterstadt", "authority clerk is not the sender");

  const privateLetter = parseLocalAiResponse(
    '{"absender":"Anna Schmidt","dokumenttyp":null,"betreff":"Einladung","thema":null}',
    "Anna Schmidt\nWaldweg 4\n12345 Ort\nLiebe Frau Meier,\nvielen Dank.\nMit freundlichen Grüßen\nAnna Schmidt",
  );
  assert(privateLetter.absender === "Anna Schmidt", "private letters may keep a personal sender");

  const recipient = parseLocalAiResponse(
    '{"absender":"Max Kunde","dokumenttyp":"Rechnung","betreff":null,"thema":null}',
    "eprimo GmbH\nHerrn Max Kunde\nKundenweg 1\nRechnung Strom\nMit freundlichen Grüßen\nJürgen Emich",
  );
  assert(recipient.absender === "eprimo", "recipient is not used as sender");
  assert(!`${recipient.absender ?? ""}`.includes("Kunde"), "customer name is not the sender");

  const many = parseLocalAiResponse(
    '{"absender":"Commerzbank AG","dokumenttyp":"Rechnung","betreff":null,"thema":null}',
    "Gamma GmbH\nRechnung Strom\nBitte zahlen an Commerzbank AG\nIBAN DE00",
  );
  assert(many.absender === "Gamma", "letterhead company wins over a later bank name");

  const unclear = parseLocalAiResponse(
    '{"absender":"Jürgen Emich","dokumenttyp":null,"betreff":"Hinweis","thema":null}',
    "Hinweis zum Zähler\nMit freundlichen Grüßen\nJürgen Emich\nLeiter Energiewirtschaftliche Prozesse",
  );
  assert(unclear.absender === null, "signature-only person is not used without an organisation");
}

function assertUniformElectricityInvoices(): void {
  const dates = [
    { iso: "2025-01-15", printed: "15.01.2025", file: "strom-a.pdf" },
    { iso: "2024-01-15", printed: "15.01.2024", file: "strom-b.pdf" },
    { iso: "2023-01-12", printed: "12.01.2023", file: "strom-c.pdf" },
    { iso: "2022-01-10", printed: "10.01.2022", file: "strom-d.pdf" },
  ];
  const outputs = [
    '{"absender":"Vattenfall","dokumenttyp":"Stromrechnung","betreff":"vattenfall stromrechnung","thema":null}',
    '{"absender":"Vattenfall Europe Sales GmbH","dokumenttyp":"Rechnung","betreff":"vattenfall rechnung","thema":null}',
    '{"absender":"Vattenfall Europe Sales GmbH","dokumenttyp":"Stromrechnung","betreff":"Vattenfall Europe Sales GmbH - Stromrechnung","thema":null}',
    '{"absender":null,"dokumenttyp":"Rechnung","betreff":"rechnung","thema":null}',
  ];
  dates.forEach((entry, index) => {
    const current = view({
      name: entry.file,
      format: "pdf",
      status: "searchable",
      text: [
        "Vattenfall Europe Sales GmbH",
        "Jahresrechnung Strom",
        `Rechnungsdatum: ${entry.printed}`,
        "Verbrauch Strom in kWh",
      ].join("\n"),
    });
    const fields = parseLocalAiResponse(outputs[index]!, current.text ?? "");
    assert(fields.absender === "Vattenfall", `electricity sender is unified (${index})`);
    assert(fields.dokumenttyp === "Stromrechnung", `electricity type is unified (${index})`);
    const plan = planAiNameSuggestion(entry.file, current, fields);
    assert(
      plan.suggestedName === `${entry.iso}_Vattenfall_Stromrechnung.pdf`,
      `electricity filename is unified (${index})`,
    );
    assert(plan.resolution.status === "confident" || plan.values.datum === entry.iso || plan.suggestedName?.startsWith(entry.iso) === true, `document date stays per file (${index})`);
  });
}
