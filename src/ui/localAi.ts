/** P2-L.10b: optional local Ollama filename fallback. No cloud, no invented facts. */
import { stemFromFilename } from "./inventoryFileNameSyntax";
import {
  extractLabeledValue,
  firstMatchingRule,
  preserveOriginalFileExtension,
  type NameSuggestOutcome,
  type NamingPlaceholder,
  type NamingRule,
} from "./namingRules";
import {
  buildDatedFileName,
  foldDocumentLabel,
  parseUserDocumentDate,
  preferredAskIso,
  resolveDocumentDateFromView,
  sanitizeSuggestedFileNamePart,
  stripLeadingDatePrefix,
  type DocumentTextView,
} from "./treeWorkbenchNameSuggest";
import { browserStorage, type WorkbenchStorage } from "./workbenchPrefs";

export const LOCAL_AI_PREFS_KEY = "dottyfm.local-ai.v1";
export const LOCAL_AI_PREFS_VERSION = 1;
export const LOCAL_AI_HOST = "127.0.0.1";
export const LOCAL_AI_PORT = 11434;
export const LOCAL_AI_PROMPT_HEAD_CHARS = 1800;
export const LOCAL_AI_PROMPT_TAIL_CHARS = 400;
const LOCAL_AI_RESULT_CACHE_LIMIT = 24;

export interface LocalAiPrefs {
  version: number;
  enabled: boolean;
  model: string;
}

export interface LocalAiProbe {
  reachable: boolean;
  message: string;
  models: string[];
}

export interface LocalAiNameFields {
  dokumenttyp: string | null;
  absender: string | null;
  betreff: string | null;
  thema: string | null;
}

export interface LocalAiJsonStore {
  load(): Promise<string | null>;
  save(json: string): Promise<void>;
}

export interface LocalAiGenerateTimings {
  totalMs: number;
  loadMs: number;
  promptEvalMs: number;
  evalMs: number;
}

export interface LocalAiGenerateResult {
  ok: boolean;
  response?: string | null;
  message: string;
  timings?: LocalAiGenerateTimings | null;
  doneReason?: string | null;
  evalCount?: number | null;
}

export interface LocalAiClient {
  probe(): Promise<LocalAiProbe>;
  generate(model: string, prompt: string): Promise<LocalAiGenerateResult>;
}

export interface LocalAiTimings {
  inspectMs: number | null;
  dateMs: number;
  rulesMs: number;
  prefsMs: number;
  promptMs: number;
  ollamaMs: number | null;
  ollamaLoadMs: number | null;
  ollamaPromptEvalMs: number | null;
  ollamaEvalMs: number | null;
  composeMs: number;
  cacheHit: boolean;
  used: boolean;
  textSource: string | null;
  textChars: number | null;
  ocrAttempted: boolean | null;
  ollamaDoneReason: string | null;
  ollamaEvalCount: number | null;
  totalMs: number;
}

export interface LocalAiRequestResult {
  fields: LocalAiNameFields | null;
  message: string;
  used: boolean;
  cacheHit: boolean;
  timings: LocalAiTimings;
}

const resultCache = new Map<string, LocalAiNameFields>();
const inflight = new Map<
  string,
  Promise<{
    fields: LocalAiNameFields | null;
    message: string;
    ollama: LocalAiGenerateTimings | null;
    doneReason: string | null;
    evalCount: number | null;
  }>
>();

export function defaultLocalAiPrefs(): LocalAiPrefs {
  return { version: LOCAL_AI_PREFS_VERSION, enabled: false, model: "" };
}

export function sanitizeLocalAiPrefs(raw: unknown): LocalAiPrefs {
  const defaults = defaultLocalAiPrefs();
  if (raw === null || typeof raw !== "object") {
    return defaults;
  }
  const value = raw as Record<string, unknown>;
  const model = typeof value.model === "string" ? sanitizeModelName(value.model) : "";
  return {
    version: LOCAL_AI_PREFS_VERSION,
    enabled: value.enabled === true,
    model,
  };
}

export function sanitizeModelName(model: string): string {
  const trimmed = model.trim();
  if (trimmed.length === 0 || trimmed.length > 128 || trimmed.includes("://")) {
    return "";
  }
  return /^[A-Za-z0-9._:/\-]+$/.test(trimmed) ? trimmed : "";
}

export function loadLocalAiPrefs(storage: WorkbenchStorage | null = browserStorage()): LocalAiPrefs {
  if (storage === null) {
    return defaultLocalAiPrefs();
  }
  try {
    const raw = storage.getItem(LOCAL_AI_PREFS_KEY);
    if (raw === null || raw.trim().length === 0) {
      return defaultLocalAiPrefs();
    }
    return sanitizeLocalAiPrefs(JSON.parse(raw) as unknown);
  } catch {
    return defaultLocalAiPrefs();
  }
}

export function saveLocalAiPrefs(prefs: LocalAiPrefs, storage: WorkbenchStorage | null = browserStorage()): boolean {
  if (storage === null) {
    return false;
  }
  try {
    storage.setItem(LOCAL_AI_PREFS_KEY, JSON.stringify(sanitizeLocalAiPrefs(prefs)));
    return true;
  } catch {
    return false;
  }
}

export async function hydrateLocalAiPrefs(
  jsonStore: LocalAiJsonStore | null,
  storage: WorkbenchStorage | null = browserStorage(),
): Promise<LocalAiPrefs> {
  if (jsonStore === null) {
    return loadLocalAiPrefs(storage);
  }
  try {
    const raw = await jsonStore.load();
    if (raw === null) {
      const migrated = loadLocalAiPrefs(storage);
      if (migrated.enabled || migrated.model.length > 0) {
        try {
          await jsonStore.save(JSON.stringify(migrated));
        } catch {
          return migrated;
        }
      }
      return migrated;
    }
    return sanitizeLocalAiPrefs(JSON.parse(raw) as unknown);
  } catch {
    return defaultLocalAiPrefs();
  }
}

export async function persistLocalAiPrefs(
  prefs: LocalAiPrefs,
  jsonStore: LocalAiJsonStore | null,
  storage: WorkbenchStorage | null = browserStorage(),
): Promise<void> {
  const sanitized = sanitizeLocalAiPrefs(prefs);
  if (jsonStore !== null) {
    await jsonStore.save(JSON.stringify(sanitized));
    return;
  }
  if (!saveLocalAiPrefs(sanitized, storage)) {
    throw new Error("Die KI-Einstellungen konnten nicht gespeichert werden.");
  }
}

export function shouldUseLocalAiFallback(
  rules: readonly NamingRule[],
  view: DocumentTextView,
  prefs: LocalAiPrefs,
): boolean {
  if (!prefs.enabled || sanitizeModelName(prefs.model).length === 0) {
    return false;
  }
  if (firstMatchingRule(rules, view) !== null) {
    return false;
  }
  return documentTextForAi(view).length > 0;
}

export function documentTextForAi(view: DocumentTextView): string {
  const text = (view.text ?? "").trim();
  if (!documentTextLooksUsable(text)) {
    return "";
  }
  return text;
}

function documentTextLooksUsable(text: string): boolean {
  const letters = [...text].filter((ch) => /\p{L}/u.test(ch)).length;
  if (letters < 24) {
    return false;
  }
  const words = text.toLowerCase().match(/\p{L}{3,}/gu) ?? [];
  if (words.length < 4) {
    return false;
  }
  return new Set(words).size >= 3;
}

export function buildLocalAiPrompt(fileName: string, text: string): string {
  void fileName;
  return [
    "Du extrahierst strukturierte Angaben. Du bestimmst nicht den Dateinamen.",
    'Nur JSON: {"absender":string|null,"dokumenttyp":string|null,"betreff":string|null,"thema":string|null}',
    "absender=Aussteller/Firma im Briefkopf. Nicht Unterzeichner, Empfänger, Ansprechpartner, Sachbearbeiter oder Formularfeld.",
    "Keine Formularfelder (Unterschrift, Stempel, Datum) als Absender. Kein Dateiname als Beleg.",
    "Nur belegte Angaben. Nichts erfinden. Keine Daten. Unsicher=null. Werte kurz.",
    "dokumenttyp konkret (Stromrechnung, Gasrechnung, Telefonrechnung, Versicherungsschreiben, Zählerstandsmeldung, GEG-Beratungsnachweis) nur wenn belegt, sonst null.",
    "Text:",
    clipTextForAi(text),
  ].join("\n");
}

export function clipTextForAi(text: string): string {
  const trimmed = stripSignatureNoise(text.trim());
  const budget = LOCAL_AI_PROMPT_HEAD_CHARS + LOCAL_AI_PROMPT_TAIL_CHARS;
  if (trimmed.length <= budget) {
    return trimmed;
  }
  return `${trimmed.slice(0, LOCAL_AI_PROMPT_HEAD_CHARS)}\n[...]\n${trimmed.slice(-LOCAL_AI_PROMPT_TAIL_CHARS)}`;
}

export function localAiCacheKey(model: string, fileName: string, text: string): string {
  return `${sanitizeModelName(model)}:${fnv1a(fileName)}:${fnv1a(text)}`;
}

export function clearLocalAiResultCache(): void {
  resultCache.clear();
  inflight.clear();
}

export function hasCachedLocalAiResult(model: string, fileName: string, text: string): boolean {
  return resultCache.has(localAiCacheKey(model, fileName, text));
}

export function emptyLocalAiTimings(): LocalAiTimings {
  return {
    inspectMs: null,
    dateMs: 0,
    rulesMs: 0,
    prefsMs: 0,
    promptMs: 0,
    ollamaMs: null,
    ollamaLoadMs: null,
    ollamaPromptEvalMs: null,
    ollamaEvalMs: null,
    composeMs: 0,
    cacheHit: false,
    used: false,
    textSource: null,
    textChars: null,
    ocrAttempted: null,
    ollamaDoneReason: null,
    ollamaEvalCount: null,
    totalMs: 0,
  };
}

export function formatLocalAiTimings(timings: LocalAiTimings): string {
  const ollama =
    timings.ollamaMs === null
      ? "ollama=-"
      : `ollama=${timings.ollamaMs}ms(load=${timings.ollamaLoadMs ?? 0} prompt_eval=${timings.ollamaPromptEvalMs ?? 0} eval=${timings.ollamaEvalMs ?? 0})`;
  return [
    "[Namensvorschlag]",
    `inspect=${timings.inspectMs ?? "-"}ms`,
    `text=${timings.textSource ?? "-"}`,
    `chars=${timings.textChars ?? "-"}`,
    `ocr=${timings.ocrAttempted === null ? "-" : timings.ocrAttempted ? "yes" : "no"}`,
    `date=${timings.dateMs}ms`,
    `rules=${timings.rulesMs}ms`,
    `prefs=${timings.prefsMs}ms`,
    `prompt=${timings.promptMs}ms`,
    ollama,
    `done=${timings.ollamaDoneReason ?? "-"}`,
    `tokens=${timings.ollamaEvalCount ?? "-"}`,
    `compose=${timings.composeMs}ms`,
    `cache=${timings.cacheHit ? "hit" : "miss"}`,
    `used=${timings.used ? "yes" : "no"}`,
    `total=${timings.totalMs}ms`,
  ].join(" ");
}

export function parseLocalAiResponse(raw: string, documentText: string): LocalAiNameFields {
  const empty: LocalAiNameFields = { dokumenttyp: null, absender: null, betreff: null, thema: null };
  const json = extractCompleteLocalAiJson(raw);
  if (json === null) {
    return enrichLocalAiFields(documentText, empty);
  }
  return enrichLocalAiFields(documentText, {
    dokumenttyp: groundedAiValue(documentText, asOptionalString(json.dokumenttyp)),
    absender: groundedAiValue(documentText, asOptionalString(json.absender), { partial: true }),
    betreff: groundedAiValue(documentText, asOptionalString(json.betreff)),
    thema: groundedAiValue(documentText, asOptionalString(json.thema)),
  });
}

export function extractCompleteLocalAiJson(raw: string): Record<string, unknown> | null {
  const json = extractJsonObject(raw);
  if (json === null) {
    return null;
  }
  if (!LOCAL_AI_JSON_KEYS.every((key) => Object.prototype.hasOwnProperty.call(json, key))) {
    return null;
  }
  return json;
}

export function localAiJsonLooksTruncated(raw: string, doneReason?: string | null): boolean {
  if (extractCompleteLocalAiJson(raw) !== null) {
    return false;
  }
  return doneReason === "length" || raw.trim().includes("{");
}

export function groundedAiValue(
  documentText: string,
  candidate: string | null,
  options?: { partial?: boolean },
): string | null {
  if (candidate === null) {
    return null;
  }
  const cleaned = sanitizeSuggestedFileNamePart(candidate.replace(/\s+/g, " "));
  if (cleaned.length < 3 || cleaned.length > 80) {
    return null;
  }
  if (looksLikeDate(cleaned) || looksLikeInventedIso(cleaned) || looksLikeFileNameValue(cleaned)) {
    return null;
  }
  const foldedText = foldDocumentLabel(documentText);
  const words = cleaned.split(/\s+/).filter((word) => word.length > 0);
  const kept: string[] = [];
  for (const word of words) {
    if (wordIsGrounded(foldedText, word)) {
      kept.push(word);
    }
  }
  if (kept.length === words.length) {
    return cleaned;
  }
  if (options?.partial === true && kept.length > 0) {
    const partial = sanitizeSuggestedFileNamePart(kept.join(" "));
    if (partial.length >= 3) {
      return partial;
    }
  }
  return null;
}

export function hasLocalAiNameFields(fields: LocalAiNameFields): boolean {
  return [fields.dokumenttyp, fields.absender, fields.betreff, fields.thema].some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}

export function planAiNameSuggestion(
  fileName: string,
  view: DocumentTextView,
  fields: LocalAiNameFields,
  overrides: Partial<Record<NamingPlaceholder, string>> = {},
): NameSuggestOutcome {
  const resolution = resolveDocumentDateFromView(view);
  const overrideIso = hasValue(overrides.datum) ? parseUserDocumentDate(overrides.datum!) : null;
  const iso =
    overrideIso !== null
      ? overrideIso
      : resolution.status === "confident"
        ? resolution.iso
        : preferredAskIso(resolution);
  const values: Partial<Record<NamingPlaceholder, string>> = {};
  if (iso.length > 0) {
    values.datum = iso;
  }
  const dokumenttyp = firstFilled(overrides.dokumenttyp, fields.dokumenttyp);
  const absender = firstFilled(overrides.absender, fields.absender);
  const betreff = firstFilled(overrides.betreff, fields.betreff ?? fields.thema);
  if (dokumenttyp) {
    values.dokumenttyp = dokumenttyp;
  }
  if (absender) {
    values.absender = absender;
  }
  if (betreff) {
    values.betreff = betreff;
  }
  const fromName = stemFromFilename(fileName);
  const remainder = sanitizeSuggestedFileNamePart(stripLeadingDatePrefix(fromName.stem).remainder);
  if (remainder.length > 0) {
    values.name = remainder;
  }
  const namePart = composeAiNameStem(
    {
      dokumenttyp: dokumenttyp ?? null,
      absender: absender ?? null,
      betreff: betreff ?? null,
      thema: fields.thema,
    },
    remainder,
  );
  const missing: NamingPlaceholder[] = iso.length > 0 ? [] : ["datum"];
  let suggestedName: string | null = null;
  if (iso.length > 0 && namePart.length > 0) {
    suggestedName = preserveOriginalFileExtension(fileName, `${iso}_${namePart}`);
  } else if (iso.length > 0) {
    suggestedName = buildDatedFileName(fileName, iso);
  }
  return {
    source: "ai",
    rule: null,
    resolution,
    values,
    missing,
    unknownPlaceholders: [],
    suggestedName,
  };
}

export function nameSuggestSourceLabel(plan: NameSuggestOutcome): string {
  if (plan.source === "rule" && plan.rule !== null) {
    return `Benennungsregel: ${plan.rule.name}`;
  }
  if (plan.source === "ai") {
    return "Lokale KI";
  }
  return "Standardvorschlag";
}

async function generateWithClient(
  client: LocalAiClient,
  model: string,
  prompt: string,
  text: string,
): Promise<{
  fields: LocalAiNameFields | null;
  message: string;
  ollama: LocalAiGenerateTimings | null;
  doneReason: string | null;
  evalCount: number | null;
}> {
  const result = await client.generate(model, prompt);
  const ollama = result.timings ?? null;
  const doneReason = result.doneReason ?? null;
  const evalCount = result.evalCount ?? null;
  if (!result.ok || result.response == null || result.response.trim().length === 0) {
    return {
      fields: null,
      message: result.message || "Die lokale KI hat keinen Vorschlag geliefert.",
      ollama,
      doneReason,
      evalCount,
    };
  }
  const raw = localAiJsonLooksTruncated(result.response, doneReason) ? "" : result.response;
  const fields = parseLocalAiResponse(raw, text);
  if (!hasLocalAiNameFields(fields)) {
    return {
      fields: null,
      message: "Die lokale KI hat keine belegbaren Namensangaben geliefert.",
      ollama,
      doneReason,
      evalCount,
    };
  }
  return { fields, message: result.message, ollama, doneReason, evalCount };
}

export async function requestLocalAiNameFields(
  client: LocalAiClient,
  prefs: LocalAiPrefs,
  fileName: string,
  view: DocumentTextView,
  rules: readonly NamingRule[],
): Promise<LocalAiRequestResult> {
  const started = nowMs();
  const dateStarted = nowMs();
  resolveDocumentDateFromView(view);
  const dateMs = elapsedMs(dateStarted);
  const rulesStarted = nowMs();
  const allowed = shouldUseLocalAiFallback(rules, view, prefs);
  const rulesMs = elapsedMs(rulesStarted);
  if (!allowed) {
    return {
      fields: null,
      message: "",
      used: false,
      cacheHit: false,
      timings: {
        ...emptyLocalAiTimings(),
        dateMs,
        rulesMs,
        totalMs: elapsedMs(started),
      },
    };
  }
  const text = documentTextForAi(view);
  const promptStarted = nowMs();
  const prompt = buildLocalAiPrompt(fileName, text);
  const promptMs = elapsedMs(promptStarted);
  const key = localAiCacheKey(prefs.model, fileName, text);
  const cached = takeCachedFields(key);
  if (cached !== null) {
    const composeStarted = nowMs();
    const composeMs = elapsedMs(composeStarted);
    return {
      fields: cached,
      message: "Gespeicherter KI-Vorschlag wird verwendet.",
      used: true,
      cacheHit: true,
      timings: {
        ...emptyLocalAiTimings(),
        dateMs,
        rulesMs,
        promptMs,
        ollamaMs: 0,
        composeMs,
        cacheHit: true,
        used: true,
        totalMs: elapsedMs(started),
      },
    };
  }
  try {
    const pending = inflight.get(key) ?? generateWithClient(client, prefs.model, prompt, text);
    inflight.set(key, pending);
    const ollamaStarted = nowMs();
    const generated = await pending;
    const ollamaMs = elapsedMs(ollamaStarted);
    inflight.delete(key);
    const composeStarted = nowMs();
    if (generated.fields !== null) {
      storeCachedFields(key, generated.fields);
    }
    const composeMs = elapsedMs(composeStarted);
    return {
      fields: generated.fields,
      message: generated.message,
      used: true,
      cacheHit: false,
      timings: {
        ...emptyLocalAiTimings(),
        dateMs,
        rulesMs,
        promptMs,
        ollamaMs,
        ollamaLoadMs: generated.ollama?.loadMs ?? null,
        ollamaPromptEvalMs: generated.ollama?.promptEvalMs ?? null,
        ollamaEvalMs: generated.ollama?.evalMs ?? null,
        ollamaDoneReason: generated.doneReason,
        ollamaEvalCount: generated.evalCount,
        composeMs,
        cacheHit: false,
        used: true,
        totalMs: elapsedMs(started),
      },
    };
  } catch {
    inflight.delete(key);
    return {
      fields: null,
      message: "Die lokale KI ist fehlgeschlagen. Es wird der Standardvorschlag verwendet.",
      used: true,
      cacheHit: false,
      timings: {
        ...emptyLocalAiTimings(),
        dateMs,
        rulesMs,
        promptMs,
        used: true,
        totalMs: elapsedMs(started),
      },
    };
  }
}

export function composeAiNameStem(fields: LocalAiNameFields, fallback: string): string {
  const preferred = joinNameParts([fields.absender, fields.dokumenttyp]);
  if (preferred.length > 0) {
    return preferred;
  }
  const topic = joinNameParts([fields.betreff ?? fields.thema]);
  if (topic.length > 0) {
    return topic;
  }
  return fallback;
}

export function normalizeCompanyName(name: string): string {
  const cleaned = sanitizeSuggestedFileNamePart(name.replace(/\s+/g, " "));
  const words = cleaned.split(/\s+/).filter((word) => word.length > 0);
  const distinctive = words.filter((word) => isDistinctiveCompanyToken(word));
  if (distinctive.length === 0) {
    return cleaned;
  }
  return sanitizeSuggestedFileNamePart(distinctive.join(" "));
}

export function resolveDocumentType(documentText: string, kiType: string | null): string | null {
  const fromDocument = catalogDocumentType(documentText);
  if (fromDocument !== null) {
    return fromDocument;
  }
  if (kiType !== null && kiType.trim().length > 0) {
    const cleaned = sanitizeSuggestedFileNamePart(kiType);
    return cleaned.length > 0 ? cleaned : null;
  }
  return null;
}

export function enrichLocalAiFields(documentText: string, fields: LocalAiNameFields): LocalAiNameFields {
  const recovered = resolvePlausibleAbsender(documentText, fields);
  const absender = recovered !== null ? sanitizeAbsenderValue(recovered) : null;
  return {
    ...fields,
    absender: absender !== null && absender.length >= 3 ? absender : null,
    dokumenttyp: resolveDocumentType(documentText, fields.dokumenttyp),
  };
}

export function resolvePlausibleAbsender(documentText: string, fields: LocalAiNameFields): string | null {
  const org = documentIssuerOrganisation(documentText);
  const kiRaw = fields.absender !== null && fields.absender.trim().length > 0 ? fields.absender.trim() : null;
  const ki = kiRaw !== null && !isFormCaptionName(kiRaw) ? kiRaw : null;
  if (org !== null) {
    if (ki !== null && !looksLikePersonName(ki) && issuerMatches(ki, org)) {
      return preferIssuerLabel(ki, org);
    }
    if (ki !== null && looksLikePersonName(ki)) {
      return org;
    }
    return org;
  }
  const labeled = extractLabeledValue(documentText, ["absender", "von", "from", "sender"]);
  const candidates = [ki, labeled, senderHintFromFields(documentText, fields)].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  for (const candidate of candidates) {
    if (isFormCaptionName(candidate) || companyAppearsOnlyNearFormLabels(candidate, documentText)) {
      continue;
    }
    if (isRejectedPersonIssuer(candidate, documentText)) {
      continue;
    }
    if (looksLikePersonName(candidate) && !appearsInLetterhead(candidate, documentText)) {
      continue;
    }
    if (!looksLikePersonName(candidate) && !looksLikeOrganisationName(candidate)) {
      continue;
    }
    return candidate;
  }
  return null;
}

function looksLikeOrganisationName(name: string): boolean {
  const words = name.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) {
    return false;
  }
  if (looksLikePersonName(name)) {
    return false;
  }
  return words.some((word) => isLegalFormToken(word) || isOrgHintToken(word));
}

export function looksLikePersonName(name: string): boolean {
  const words = name
    .replace(/,/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
  if (words.length < 2 || words.length > 4) {
    return false;
  }
  if (words.some((word) => isLegalFormToken(word) || isOrgHintToken(word) || isRoleTitleToken(word))) {
    return false;
  }
  return words.every((word) => isPersonNameToken(word));
}

export function rejectedStampOrganisations(text: string): string[] {
  return uniqueFolded(
    extractLegalFormCompanies(text)
      .map((name) => normalizeCompanyName(name))
      .filter((name) => name.length >= 3 && companyAppearsOnlyNearFormLabels(name, text)),
  );
}

function documentIssuerOrganisation(text: string): string | null {
  const letterhead = extractLegalFormCompaniesInRange(text, 0, letterheadLimit(text))
    .map((name) => normalizeCompanyName(name))
    .filter((name) => isPlausibleIssuerOrganisation(name, text));
  const uniqueLetterhead = uniqueFolded(letterhead);
  if (uniqueLetterhead.length === 1) {
    return uniqueLetterhead[0]!;
  }
  const heading = extractLetterheadOrganisation(text);
  if (heading !== null) {
    return heading;
  }
  if (uniqueLetterhead.length > 1) {
    return null;
  }
  const uniqueAll = uniqueFolded(
    extractLegalFormCompanies(text)
      .map((name) => normalizeCompanyName(name))
      .filter((name) => isPlausibleIssuerOrganisation(name, text)),
  );
  return uniqueAll.length === 1 ? uniqueAll[0]! : null;
}

function isPlausibleIssuerOrganisation(name: string, text: string): boolean {
  if (name.length < 3 || isFormCaptionName(name) || companyAppearsOnlyNearFormLabels(name, text)) {
    return false;
  }
  return true;
}

function extractLetterheadOrganisation(text: string): string | null {
  const heading = text.slice(0, letterheadLimit(text));
  for (const line of heading.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (
      trimmed.length < 3 ||
      trimmed.length > 120 ||
      isGreetingLine(trimmed) ||
      isRoleTitleLine(trimmed) ||
      isFormCaptionName(trimmed) ||
      looksLikePersonName(trimmed)
    ) {
      continue;
    }
    const words = trimmed.split(/\s+/);
    if (words.some((word) => isLegalFormToken(word) || isOrgHintToken(word))) {
      const cleaned = normalizeCompanyName(trimmed);
      if (isPlausibleIssuerOrganisation(cleaned, text)) {
        return cleaned;
      }
    }
  }
  return null;
}

function extractLegalFormCompaniesInRange(text: string, start: number, end: number): string[] {
  return extractLegalFormCompanies(text).filter((name) => {
    const index = text.toLocaleLowerCase("de-DE").indexOf(name.toLocaleLowerCase("de-DE"));
    return index >= start && index < end;
  });
}

function letterheadLimit(text: string): number {
  return Math.min(1200, Math.max(240, Math.floor(text.length * 0.35)));
}

function issuerMatches(candidate: string, organisation: string): boolean {
  const left = distinctiveIssuerTokens(candidate);
  const right = distinctiveIssuerTokens(organisation);
  if (left.length === 0 || right.length === 0) {
    return false;
  }
  return left.every((token) => right.includes(token)) || right.every((token) => left.includes(token));
}

function preferIssuerLabel(candidate: string, organisation: string): string {
  const normalizedCandidate = sanitizeAbsenderValue(candidate);
  if (looksLikePersonName(normalizedCandidate)) {
    return organisation;
  }
  return organisation.length >= normalizedCandidate.length ? organisation : normalizedCandidate;
}

function sanitizeAbsenderValue(value: string): string {
  if (looksLikePersonName(value)) {
    return sanitizeSuggestedFileNamePart(value.replace(/\s+/g, " "));
  }
  return normalizeCompanyName(value);
}

function isRejectedPersonIssuer(name: string, text: string): boolean {
  if (!looksLikePersonName(name)) {
    return false;
  }
  if (hasNearbyRoleTitle(name, text)) {
    return true;
  }
  return appearsOnlyInSignatureZone(name, text);
}

function appearsInLetterhead(name: string, text: string): boolean {
  return nameOffsets(name, text).some((offset) => offset < letterheadLimit(text));
}

function appearsOnlyInSignatureZone(name: string, text: string): boolean {
  const offsets = nameOffsets(name, text);
  if (offsets.length === 0) {
    return false;
  }
  const zone = Math.floor(text.length * 0.65);
  return offsets.every((offset) => offset >= zone);
}

function hasNearbyRoleTitle(name: string, text: string): boolean {
  const foldedName = foldDocumentLabel(name);
  const foldedText = foldDocumentLabel(text);
  let from = 0;
  while (from < foldedText.length) {
    const index = foldedText.indexOf(foldedName, from);
    if (index < 0) {
      return false;
    }
    const window = foldedText.slice(index, index + foldedName.length + 120);
    if (ROLE_PHRASES.some((phrase) => window.includes(phrase)) || [...ROLE_TITLE_TOKENS].some((token) => window.includes(token))) {
      return true;
    }
    from = index + foldedName.length;
  }
  return false;
}

function nameOffsets(name: string, text: string): number[] {
  const needle = name.trim().toLocaleLowerCase("de-DE");
  if (needle.length < 3) {
    return [];
  }
  const haystack = text.toLocaleLowerCase("de-DE");
  const offsets: number[] = [];
  let from = 0;
  while (from < haystack.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) {
      break;
    }
    offsets.push(index);
    from = index + needle.length;
  }
  return offsets;
}

function distinctiveIssuerTokens(value: string): string[] {
  return value
    .split(/\s+/)
    .map((word) => foldedToken(word))
    .filter((token) => token.length >= 3 && !LEGAL_FORM_TOKENS.has(token) && !GENERIC_CORPORATE_TOKENS.has(token));
}

function uniqueFolded(names: string[]): string[] {
  const unique: string[] = [];
  for (const name of names) {
    const folded = foldDocumentLabel(name);
    if (!unique.some((existing) => foldDocumentLabel(existing) === folded)) {
      unique.push(name);
    }
  }
  return unique;
}

function stripSignatureNoise(text: string): string {
  const cutoff = Math.floor(text.length * 0.65);
  const lines = text.split(/\r?\n/);
  let cursor = 0;
  const kept: string[] = [];
  for (const line of lines) {
    const start = cursor;
    cursor += line.length + 1;
    const trimmed = line.trim();
    if (
      isGreetingLine(trimmed) ||
      isRoleTitleLine(trimmed) ||
      (looksLikePersonName(trimmed) && start >= cutoff) ||
      (looksLikePersonName(trimmed) && hasNearbyRoleTitle(trimmed, text))
    ) {
      continue;
    }
    kept.push(line);
  }
  const next = kept.join("\n").trim();
  return next.length > 0 ? next : text;
}

function isGreetingLine(line: string): boolean {
  const folded = foldDocumentLabel(line);
  return GREETING_PREFIXES.some((prefix) => folded.startsWith(prefix));
}

function isRoleTitleLine(line: string): boolean {
  const folded = foldDocumentLabel(line);
  if (ROLE_PHRASES.some((phrase) => folded.includes(phrase))) {
    return true;
  }
  const tokens = line.split(/\s+/).map((word) => foldedToken(word)).filter((token) => token.length > 0);
  return tokens.length > 0 && tokens.some((token) => ROLE_TITLE_TOKENS.has(token));
}

function isPersonNameToken(word: string): boolean {
  const folded = foldedToken(word);
  if (folded.length < 2 || folded.length > 24 || PERSON_STOP_WORDS.has(folded)) {
    return false;
  }
  return /^[\p{L}][\p{L}'-]{1,23}$/u.test(word);
}

function isOrgHintToken(word: string): boolean {
  return ORG_HINT_TOKENS.has(foldedToken(word));
}

function isRoleTitleToken(word: string): boolean {
  return ROLE_TITLE_TOKENS.has(foldedToken(word));
}

function senderHintFromFields(documentText: string, fields: LocalAiNameFields): string | null {
  const blob = [fields.betreff, fields.thema].filter((value): value is string => value !== null).join(" ");
  if (blob.length === 0) {
    return null;
  }
  const foldedText = foldDocumentLabel(documentText);
  const hints = blob.split(/\s+/).filter((word) => {
    const folded = foldedToken(word);
    return (
      folded.length >= 4 &&
      !isDocumentTypeToken(folded) &&
      !isLegalFormToken(word) &&
      !isGenericCorporateToken(word) &&
      foldedText.includes(folded)
    );
  });
  return hints.length === 1 ? hints[0]! : null;
}

function extractLegalFormCompanies(text: string): string[] {
  const tokens = text.match(/[\p{L}0-9&.-]+/gu) ?? [];
  const found: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (!isLegalFormToken(tokens[index]!)) {
      continue;
    }
    let start = index;
    while (start > 0 && index - (start - 1) <= 6) {
      const previous = tokens[start - 1]!;
      const folded = foldedToken(previous);
      if (previous.includes("&") && folded.length === 0) {
        start -= 1;
        continue;
      }
      if (folded.length === 0 || COMPANY_STOP_WORDS.has(folded)) {
        break;
      }
      start -= 1;
    }
    if (start < index) {
      found.push(tokens.slice(start, index + 1).join(" "));
    }
  }
  return found;
}

function catalogDocumentType(documentText: string): string | null {
  const folded = catalogHaystack(documentText);
  for (const entry of DOCUMENT_TYPE_CATALOG) {
    if (entry.evidence.some((required) => required.every((token) => folded.includes(token)))) {
      return entry.label;
    }
  }
  return null;
}

function catalogHaystack(text: string): string {
  return foldDocumentLabel(text)
    .replace(/§/g, "s")
    .replace(/\s+/g, " ");
}

function isFormCaptionName(name: string): boolean {
  const folded = foldDocumentLabel(name);
  if (FORM_CAPTION_PHRASES.some((phrase) => folded.includes(phrase))) {
    return true;
  }
  const tokens = name
    .split(/\s+/)
    .map((word) => foldedToken(word))
    .filter((token) => token.length > 0);
  return tokens.some((token) => FORM_CAPTION_TOKENS.has(token));
}

function companyAppearsOnlyNearFormLabels(name: string, text: string): boolean {
  const offsets = nameOffsets(name, text);
  if (offsets.length === 0) {
    return false;
  }
  return offsets.every((offset) => {
    const from = Math.max(0, offset - 48);
    const to = Math.min(text.length, offset + name.length + 48);
    const window = foldDocumentLabel(text.slice(from, to));
    return (
      FORM_CAPTION_PHRASES.some((phrase) => window.includes(phrase)) ||
      [...FORM_CAPTION_TOKENS].some((token) => window.includes(token))
    );
  });
}

function joinNameParts(parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .map((part) => sanitizeSuggestedFileNamePart(part))
    .filter((part) => part.length > 0)
    .join("_");
}

function wordIsGrounded(foldedText: string, word: string): boolean {
  const tokens = foldDocumentLabel(word)
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3);
  if (tokens.length > 0) {
    return tokens.every((token) => foldedText.includes(token));
  }
  const folded = foldedToken(word);
  return folded.length >= 2 && foldedText.includes(folded);
}

function foldedToken(word: string): string {
  return foldDocumentLabel(word).replace(/[^a-z0-9]/g, "");
}

function isLegalFormToken(word: string): boolean {
  return LEGAL_FORM_TOKENS.has(foldedToken(word));
}

function isGenericCorporateToken(word: string): boolean {
  return GENERIC_CORPORATE_TOKENS.has(foldedToken(word));
}

function isDistinctiveCompanyToken(word: string): boolean {
  const folded = foldedToken(word);
  if (folded.length < 2) {
    return false;
  }
  return !LEGAL_FORM_TOKENS.has(folded) && !GENERIC_CORPORATE_TOKENS.has(folded) && !COMPANY_STOP_WORDS.has(folded);
}

function isDocumentTypeToken(folded: string): boolean {
  return DOCUMENT_TYPE_TOKENS.has(folded);
}

const ROLE_TITLE_TOKENS = new Set([
  "leiter",
  "leiterin",
  "sachbearbeiter",
  "sachbearbeiterin",
  "ansprechpartner",
  "ansprechpartnerin",
  "kundenbetreuer",
  "kundenbetreuerin",
  "kundenberater",
  "kundenberaterin",
  "mitarbeiter",
  "mitarbeiterin",
  "geschaeftsfuehrer",
  "geschaeftsfuehrerin",
  "prokurist",
  "prokuristin",
  "bearbeiter",
  "bearbeiterin",
]);

const ROLE_PHRASES = ["mit freundlichen gruesen", "im auftrag", "in vertretung"];

const GREETING_PREFIXES = ["sehr geehrte", "sehr geehrter", "liebe ", "lieber ", "hallo "];

const PERSON_STOP_WORDS = new Set(["herr", "herrn", "frau", "sehr", "geehrte", "geehrter", "kundin", "kunde"]);

const ORG_HINT_TOKENS = new Set([
  "amt",
  "stadt",
  "stadtwerke",
  "gemeinde",
  "landkreis",
  "ministerium",
  "kasse",
  "sparkasse",
  "bank",
  "versicherung",
  "werke",
  "werk",
  "genossenschaft",
  "universitaet",
  "kammer",
  "finanzamt",
  "rathaus",
  "gericht",
]);

const LEGAL_FORM_TOKENS = new Set([
  "gmbh",
  "ag",
  "kg",
  "ug",
  "se",
  "ev",
  "gbr",
  "ohg",
  "ltd",
  "inc",
  "corp",
  "plc",
  "llc",
  "mbh",
  "ek",
  "co",
  "kgaa",
]);

const GENERIC_CORPORATE_TOKENS = new Set([
  "europe",
  "europa",
  "sales",
  "holding",
  "holdings",
  "group",
  "gruppe",
  "deutschland",
  "germany",
  "international",
  "intl",
  "services",
  "service",
  "solutions",
  "management",
  "trading",
  "supply",
  "company",
  "unternehmen",
  "gesellschaft",
  "limited",
  "incorporated",
  "partners",
  "partner",
]);

const COMPANY_STOP_WORDS = new Set([
  "der",
  "die",
  "das",
  "den",
  "dem",
  "des",
  "ein",
  "eine",
  "einer",
  "einem",
  "einen",
  "und",
  "oder",
  "the",
  "von",
  "vom",
  "fuer",
  "fur",
  "mit",
  "aus",
  "im",
  "in",
  "am",
  "auf",
  "per",
  "als",
  "bei",
  "nach",
  "zum",
  "zur",
  "absender",
  "betreff",
  "seite",
  "datum",
  "rechnungsdatum",
  "unterschrift",
  "stempel",
  "fachkundige",
  "person",
  "firma",
  "an",
  "ihre",
  "ihr",
  "unsere",
  "unser",
]);

const LOCAL_AI_JSON_KEYS = ["absender", "dokumenttyp", "betreff", "thema"] as const;

const FORM_CAPTION_TOKENS = new Set(["unterschrift", "stempel", "fachkundige", "fachkundiger", "fachkundiges"]);

const FORM_CAPTION_PHRASES = [
  "fachkundige person",
  "datum unterschrift",
  "unterschrift stempel",
  "unterschrift fachkundige",
];

const DOCUMENT_TYPE_CATALOG: Array<{ label: string; evidence: string[][] }> = [
  {
    label: "GEG-Beratungsnachweis",
    evidence: [
      ["gegberatungsnachweis"],
      ["geg", "beratungsnachweis"],
      ["beratungsnachweis"],
      ["informationspflicht", "gebaeudeenergiegesetz"],
      ["informationspflicht", "gebaudeenergiegesetz"],
      ["informationspflicht", "gebaeudeenergie"],
      ["nachweis", "informationspflicht", "71"],
    ],
  },
  { label: "Stromrechnung", evidence: [["stromrechnung"], ["strom", "rechnung"], ["strom", "jahresrechnung"], ["strom", "jahresabrechnung"]] },
  { label: "Gasrechnung", evidence: [["gasrechnung"], ["gas", "rechnung"], ["gas", "jahresrechnung"]] },
  {
    label: "Telefonrechnung",
    evidence: [["telefonrechnung"], ["telefon", "rechnung"], ["mobilfunk", "rechnung"], ["handy", "rechnung"]],
  },
  {
    label: "Versicherungsschreiben",
    evidence: [["versicherungsschreiben"], ["versicherung", "schreiben"], ["versicherung", "mitteilung"]],
  },
  {
    label: "Zählerstandsmeldung",
    evidence: [["zaehlerstandsmeldung"], ["zaehlerablesungsmeldung"], ["zaehlerstand"], ["zaehlerablesung"]],
  },
  { label: "Rechnung", evidence: [["rechnung"], ["jahresrechnung"], ["endabrechnung"]] },
];

const DOCUMENT_TYPE_TOKENS = new Set(
  DOCUMENT_TYPE_CATALOG.flatMap((entry) => [foldDocumentLabel(entry.label), ...entry.evidence.flat()]),
);

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const tryParse = (value: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      if (typeof parsed === "string") {
        return tryParse(parsed);
      }
      return null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(trimmed);
  if (direct !== null) {
    return direct;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return tryParse(trimmed.slice(start, end + 1));
  }
  return null;
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === "null" || trimmed === "-") {
    return null;
  }
  return trimmed;
}

function looksLikeDate(value: string): boolean {
  return /\d{1,4}[.\/-]\d{1,2}[.\/-]\d{1,4}/.test(value) || /^\d{8}$/.test(value);
}

function looksLikeInventedIso(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function looksLikeFileNameValue(value: string): boolean {
  return /\.[a-z][a-z0-9]{1,4}$/i.test(value.trim());
}

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function firstFilled(...values: Array<string | null | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0) ?? undefined;
}

function takeCachedFields(key: string): LocalAiNameFields | null {
  const cached = resultCache.get(key);
  if (cached === undefined) {
    return null;
  }
  resultCache.delete(key);
  resultCache.set(key, cached);
  return cached;
}

function storeCachedFields(key: string, fields: LocalAiNameFields): void {
  if (resultCache.has(key)) {
    resultCache.delete(key);
  }
  resultCache.set(key, fields);
  while (resultCache.size > LOCAL_AI_RESULT_CACHE_LIMIT) {
    const oldest = resultCache.keys().next().value;
    if (typeof oldest !== "string") {
      break;
    }
    resultCache.delete(oldest);
  }
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function elapsedMs(started: number): number {
  return Math.max(0, Math.round(nowMs() - started));
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}
