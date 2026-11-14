/** P2-L.10a: user-defined file naming rules. No invented values, no AI. */
import { isAllowedWindowsComponent } from "./windowsPathRules";
import { isUnchangedWorkbenchRename } from "./treeWorkbenchRename";
import { stemFromFilename } from "./inventoryFileNameSyntax";
import {
  buildDatedFileName,
  foldDocumentLabel,
  preferredAskIso,
  resolveDocumentDateFromView,
  sanitizeSuggestedFileNamePart,
  stripLeadingDatePrefix,
  type DocumentDateResolution,
  type DocumentTextView,
} from "./treeWorkbenchNameSuggest";
import { browserStorage, type WorkbenchStorage } from "./workbenchPrefs";

export const NAMING_RULES_KEY = "dottyfm.naming-rules.v1";
export const NAMING_RULES_VERSION = 1;

export const NAMING_PLACEHOLDERS = ["datum", "dokumenttyp", "absender", "betreff", "name"] as const;
export type NamingPlaceholder = (typeof NAMING_PLACEHOLDERS)[number];

export const NAMING_PLACEHOLDER_LABELS: Record<NamingPlaceholder, string> = {
  datum: "Dokumentdatum",
  dokumenttyp: "Dokumentart",
  absender: "Absender",
  betreff: "Betreff",
  name: "Bisheriger Dateiname",
};

export const NAMING_FORMATS = ["pdf", "docx", "xlsx", "png", "jpeg"] as const;
export type NamingRuleFormat = (typeof NAMING_FORMATS)[number];

export const NAMING_FORMAT_LABELS: Record<NamingRuleFormat, string> = {
  pdf: "PDF",
  docx: "Word (DOCX)",
  xlsx: "Excel (XLSX)",
  png: "PNG",
  jpeg: "JPEG",
};

export interface NamingRule {
  id: string;
  name: string;
  enabled: boolean;
  formats: NamingRuleFormat[];
  keywords: string[];
  documentType: string;
  schema: string;
}

export interface NamingRuleStore {
  version: number;
  rules: NamingRule[];
}

export interface NameSuggestOutcome {
  source: "rule" | "default";
  rule: NamingRule | null;
  resolution: DocumentDateResolution;
  values: Partial<Record<NamingPlaceholder, string>>;
  missing: NamingPlaceholder[];
  unknownPlaceholders: string[];
  suggestedName: string | null;
}

const PLACEHOLDER_PATTERN = /\{([A-Za-z]+)\}/g;
const SENDER_LABELS = ["absender", "von", "from", "sender"];
const SUBJECT_LABELS = ["betreff", "subject"];

export function emptyNamingRuleStore(): NamingRuleStore {
  return { version: NAMING_RULES_VERSION, rules: [] };
}

export function defaultNamingRuleSchema(): string {
  return "{datum}_{name}";
}

export function createNamingRule(existing: readonly NamingRule[], name = "Neue Regel"): NamingRule {
  return {
    id: uniqueRuleId(existing),
    name: sanitizeRuleName(name),
    enabled: true,
    formats: [],
    keywords: [],
    documentType: "",
    schema: defaultNamingRuleSchema(),
  };
}

export function sanitizeNamingRuleStore(raw: unknown): NamingRuleStore {
  if (raw === null || typeof raw !== "object") {
    return emptyNamingRuleStore();
  }
  const value = raw as Record<string, unknown>;
  const rulesRaw = Array.isArray(value.rules) ? value.rules : [];
  const seen = new Set<string>();
  const rules: NamingRule[] = [];
  for (const item of rulesRaw) {
    const rule = sanitizeNamingRule(item, seen);
    if (rule !== null) {
      seen.add(rule.id);
      rules.push(rule);
    }
  }
  return { version: NAMING_RULES_VERSION, rules };
}

export function addNamingRule(store: NamingRuleStore, rule: NamingRule = createNamingRule(store.rules)): NamingRuleStore {
  return { version: NAMING_RULES_VERSION, rules: [...store.rules, sanitizeNamingRule(rule, new Set(store.rules.map((item) => item.id))) ?? createNamingRule(store.rules)] };
}

export function updateNamingRule(store: NamingRuleStore, ruleId: string, patch: Partial<NamingRule>): NamingRuleStore {
  return {
    version: NAMING_RULES_VERSION,
    rules: store.rules.map((rule) => {
      if (rule.id !== ruleId) {
        return rule;
      }
      return sanitizeNamingRule({ ...rule, ...patch, id: rule.id }, new Set()) ?? rule;
    }),
  };
}

export function deleteNamingRule(store: NamingRuleStore, ruleId: string): NamingRuleStore {
  return { version: NAMING_RULES_VERSION, rules: store.rules.filter((rule) => rule.id !== ruleId) };
}

export function setNamingRuleEnabled(store: NamingRuleStore, ruleId: string, enabled: boolean): NamingRuleStore {
  return updateNamingRule(store, ruleId, { enabled });
}

export function moveNamingRule(store: NamingRuleStore, ruleId: string, direction: -1 | 1): NamingRuleStore {
  const index = store.rules.findIndex((rule) => rule.id === ruleId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= store.rules.length) {
    return store;
  }
  const rules = [...store.rules];
  const [moved] = rules.splice(index, 1);
  rules.splice(nextIndex, 0, moved!);
  return { version: NAMING_RULES_VERSION, rules };
}

export function schemaPlaceholders(schema: string): { known: NamingPlaceholder[]; unknown: string[] } {
  const known: NamingPlaceholder[] = [];
  const unknown: string[] = [];
  const seenKnown = new Set<NamingPlaceholder>();
  const seenUnknown = new Set<string>();
  PLACEHOLDER_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_PATTERN.exec(schema)) !== null) {
    const token = match[1]!.toLowerCase();
    if (isNamingPlaceholder(token)) {
      if (!seenKnown.has(token)) {
        seenKnown.add(token);
        known.push(token);
      }
    } else if (!seenUnknown.has(token)) {
      seenUnknown.add(token);
      unknown.push(token);
    }
  }
  return { known, unknown };
}

export function namingRuleSchemaError(schema: string): string | null {
  const trimmed = schema.trim();
  if (trimmed.length === 0) {
    return "Bitte ein Dateinamensschema eingeben.";
  }
  const { known, unknown } = schemaPlaceholders(trimmed);
  if (unknown.length > 0) {
    return `Unbekannte Platzhalter: ${unknown.map((item) => `{${item}}`).join(", ")}.`;
  }
  if (known.length === 0) {
    return "Das Schema braucht mindestens einen bekannten Platzhalter.";
  }
  return null;
}

export function ruleMatches(rule: NamingRule, view: DocumentTextView): boolean {
  if (!rule.enabled) {
    return false;
  }
  if (rule.formats.length > 0) {
    if (view.format == null || !rule.formats.includes(view.format)) {
      return false;
    }
  }
  const required = rule.keywords.map((keyword) => foldDocumentLabel(keyword.trim())).filter((keyword) => keyword.length > 0);
  if (required.length > 0) {
    const text = foldDocumentLabel(view.text ?? "");
    if (text.trim().length === 0) {
      return false;
    }
    if (required.some((keyword) => !text.includes(keyword))) {
      return false;
    }
  }
  return true;
}

export function firstMatchingRule(rules: readonly NamingRule[], view: DocumentTextView): NamingRule | null {
  return rules.find((rule) => ruleMatches(rule, view)) ?? null;
}

export function planNameSuggestion(
  fileName: string,
  view: DocumentTextView,
  rules: readonly NamingRule[],
  overrides: Partial<Record<NamingPlaceholder, string>> = {},
): NameSuggestOutcome {
  const resolution = resolveDocumentDateFromView(view);
  const rule = firstMatchingRule(rules, view);
  if (rule === null) {
    return planDefaultSuggestion(fileName, resolution, overrides);
  }
  const values = applyOverrides(extractRuleValues(fileName, view, rule, resolution), overrides);
  const parsed = schemaPlaceholders(rule.schema);
  const missing = parsed.known.filter((placeholder) => !hasValue(values[placeholder]));
  return {
    source: "rule",
    rule,
    resolution,
    values,
    missing,
    unknownPlaceholders: parsed.unknown,
    suggestedName:
      parsed.unknown.length === 0 && missing.length === 0
        ? renderRuleFileName(fileName, rule.schema, values)
        : null,
  };
}

export function renderRuleFileName(
  fileName: string,
  schema: string,
  values: Partial<Record<NamingPlaceholder, string>>,
): string | null {
  const schemaError = namingRuleSchemaError(schema);
  if (schemaError !== null) {
    return null;
  }
  const { known } = schemaPlaceholders(schema);
  if (known.some((placeholder) => !hasValue(values[placeholder]))) {
    return null;
  }
  const withoutExt = stripMatchingExtension(schema.trim(), fileName);
  const stem = withoutExt.replace(PLACEHOLDER_PATTERN, (_all, token: string) => {
    const key = token.toLowerCase();
    return isNamingPlaceholder(key) ? (values[key] ?? "") : "";
  });
  const cleaned = sanitizeSuggestedFileNamePart(stem.replace(/\s+/g, " "));
  if (cleaned.length === 0 || !isAllowedWindowsComponent(`${cleaned}${fileExtension(fileName)}`)) {
    return null;
  }
  return `${cleaned}${fileExtension(fileName)}`;
}

export function preserveOriginalFileExtension(originalName: string, typedName: string): string {
  const trimmed = typedName.trim();
  const originalExt = fileExtension(originalName);
  if (originalExt.length === 0 || trimmed.length === 0) {
    return trimmed;
  }
  const typedExt = fileExtension(trimmed);
  if (typedExt.toLocaleLowerCase("de-DE") === originalExt.toLocaleLowerCase("de-DE")) {
    return trimmed;
  }
  return `${stemFromFilename(trimmed).stem}${originalExt}`;
}

export function applySuggestedFileName(
  originalName: string,
  typedName: string,
): { ok: true; fileName: string } | { ok: false; reason: string; unchanged: boolean } {
  const fileName = preserveOriginalFileExtension(originalName, typedName);
  if (fileName.length === 0) {
    return { ok: false, reason: "Bitte einen Dateinamen eingeben.", unchanged: false };
  }
  if (isUnchangedWorkbenchRename(originalName, fileName)) {
    return { ok: false, reason: "Der Dateiname ist unverändert.", unchanged: true };
  }
  if (!isAllowedWindowsComponent(fileName)) {
    return { ok: false, reason: "Der Dateiname ist unzulässig.", unchanged: false };
  }
  return { ok: true, fileName };
}

export function extractLabeledValue(text: string, labels: readonly string[]): string | null {
  const foldedLabels = new Set(labels.map((label) => foldDocumentLabel(label)));
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const match = /^(.{1,40}?)\s*:\s*(.+)$/.exec(trimmed);
    if (match === null) {
      continue;
    }
    const folded = foldDocumentLabel(match[1] ?? "");
    if (!foldedLabels.has(folded)) {
      continue;
    }
    const value = sanitizeSuggestedFileNamePart(match[2] ?? "");
    if (value.length > 0) {
      return value;
    }
  }
  return null;
}

export type NamingRulesJsonStore = {
  load(): Promise<string | null>;
  save(json: string): Promise<void>;
};

export function loadNamingRuleStore(storage: WorkbenchStorage | null = browserStorage()): NamingRuleStore {
  if (storage === null) {
    return emptyNamingRuleStore();
  }
  try {
    const raw = storage.getItem(NAMING_RULES_KEY);
    if (raw === null || raw.trim().length === 0) {
      return emptyNamingRuleStore();
    }
    return sanitizeNamingRuleStore(JSON.parse(raw) as unknown);
  } catch {
    return emptyNamingRuleStore();
  }
}

export function saveNamingRuleStore(
  store: NamingRuleStore,
  storage: WorkbenchStorage | null = browserStorage(),
): boolean {
  if (storage === null) {
    return false;
  }
  try {
    storage.setItem(NAMING_RULES_KEY, JSON.stringify(sanitizeNamingRuleStore(store)));
    return true;
  } catch {
    return false;
  }
}

export async function hydrateNamingRuleStore(
  jsonStore: NamingRulesJsonStore | null,
  storage: WorkbenchStorage | null = browserStorage(),
): Promise<NamingRuleStore> {
  if (jsonStore === null) {
    return loadNamingRuleStore(storage);
  }
  try {
    const raw = await jsonStore.load();
    if (raw === null) {
      const migrated = loadNamingRuleStore(storage);
      if (migrated.rules.length > 0) {
        try {
          await jsonStore.save(JSON.stringify(migrated));
        } catch {
          return migrated;
        }
      }
      return migrated;
    }
    return sanitizeNamingRuleStore(JSON.parse(raw) as unknown);
  } catch {
    return emptyNamingRuleStore();
  }
}

export async function persistNamingRuleStore(
  store: NamingRuleStore,
  jsonStore: NamingRulesJsonStore | null,
  storage: WorkbenchStorage | null = browserStorage(),
): Promise<void> {
  const sanitized = sanitizeNamingRuleStore(store);
  const json = JSON.stringify(sanitized);
  if (jsonStore !== null) {
    await jsonStore.save(json);
    return;
  }
  if (!saveNamingRuleStore(sanitized, storage)) {
    throw new Error("Die Benennungsregeln konnten nicht gespeichert werden.");
  }
}

function planDefaultSuggestion(
  fileName: string,
  resolution: DocumentDateResolution,
  overrides: Partial<Record<NamingPlaceholder, string>>,
): NameSuggestOutcome {
  const iso =
    hasValue(overrides.datum)
      ? overrides.datum!
      : resolution.status === "confident"
        ? resolution.iso
        : preferredAskIso(resolution);
  const values: Partial<Record<NamingPlaceholder, string>> = {};
  if (iso.length > 0) {
    values.datum = iso;
  }
  const suggestedName = iso.length > 0 ? buildDatedFileName(fileName, iso) : null;
  const missing: NamingPlaceholder[] = iso.length > 0 ? [] : ["datum"];
  return {
    source: "default",
    rule: null,
    resolution,
    values,
    missing,
    unknownPlaceholders: [],
    suggestedName,
  };
}

function extractRuleValues(
  fileName: string,
  view: DocumentTextView,
  rule: NamingRule,
  resolution: DocumentDateResolution,
): Partial<Record<NamingPlaceholder, string>> {
  const values: Partial<Record<NamingPlaceholder, string>> = {};
  const fromName = stemFromFilename(fileName);
  const stripped = stripLeadingDatePrefix(fromName.stem);
  const namePart = sanitizeSuggestedFileNamePart(stripped.remainder);
  if (namePart.length > 0) {
    values.name = namePart;
  }
  if (resolution.status === "confident") {
    values.datum = resolution.iso;
  }
  const documentType = sanitizeSuggestedFileNamePart(rule.documentType);
  if (documentType.length > 0) {
    values.dokumenttyp = documentType;
  }
  const text = view.text ?? "";
  const sender = extractLabeledValue(text, SENDER_LABELS);
  if (sender !== null) {
    values.absender = sender;
  }
  const subject = extractLabeledValue(text, SUBJECT_LABELS);
  if (subject !== null) {
    values.betreff = subject;
  }
  return values;
}

function applyOverrides(
  values: Partial<Record<NamingPlaceholder, string>>,
  overrides: Partial<Record<NamingPlaceholder, string>>,
): Partial<Record<NamingPlaceholder, string>> {
  const next = { ...values };
  for (const key of NAMING_PLACEHOLDERS) {
    const override = overrides[key];
    if (typeof override === "string") {
      const cleaned = key === "datum" ? override.trim() : sanitizeSuggestedFileNamePart(override);
      if (cleaned.length > 0) {
        next[key] = cleaned;
      }
    }
  }
  return next;
}

function sanitizeNamingRule(raw: unknown, seen: Set<string>): NamingRule | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" && value.id.trim().length > 0 && !seen.has(value.id)
    ? value.id.trim()
    : uniqueRuleId([...seen].map((item) => ({ id: item })));
  const formats = Array.isArray(value.formats)
    ? value.formats.filter((item): item is NamingRuleFormat => typeof item === "string" && isNamingFormat(item))
    : [];
  const keywords = Array.isArray(value.keywords)
    ? value.keywords
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    : [];
  const schema = typeof value.schema === "string" && value.schema.trim().length > 0
    ? value.schema.trim()
    : defaultNamingRuleSchema();
  return {
    id,
    name: sanitizeRuleName(typeof value.name === "string" ? value.name : "Unbenannte Regel"),
    enabled: value.enabled !== false,
    formats: uniqueFormats(formats),
    keywords,
    documentType: typeof value.documentType === "string" ? value.documentType.trim() : "",
    schema,
  };
}

function uniqueRuleId(existing: readonly { id: string }[]): string {
  const seen = new Set(existing.map((item) => item.id));
  for (let index = 1; index < 10_000; index += 1) {
    const id = `rule-${index}`;
    if (!seen.has(id)) {
      return id;
    }
  }
  return `rule-${seen.size + 1}`;
}

function sanitizeRuleName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 80) : "Unbenannte Regel";
}

function uniqueFormats(formats: NamingRuleFormat[]): NamingRuleFormat[] {
  const seen = new Set<NamingRuleFormat>();
  const out: NamingRuleFormat[] = [];
  for (const format of formats) {
    if (!seen.has(format)) {
      seen.add(format);
      out.push(format);
    }
  }
  return out;
}

function isNamingPlaceholder(value: string): value is NamingPlaceholder {
  return (NAMING_PLACEHOLDERS as readonly string[]).includes(value);
}

function isNamingFormat(value: string): value is NamingRuleFormat {
  return (NAMING_FORMATS as readonly string[]).includes(value);
}

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function fileExtension(fileName: string): string {
  const fromName = stemFromFilename(fileName);
  return fromName.hasExtension ? fileName.slice(fileName.lastIndexOf(".")) : "";
}

function stripMatchingExtension(schema: string, fileName: string): string {
  const extension = fileExtension(fileName);
  if (extension.length === 0) {
    return schema;
  }
  if (schema.toLocaleLowerCase("de-DE").endsWith(extension.toLocaleLowerCase("de-DE"))) {
    return schema.slice(0, schema.length - extension.length);
  }
  return schema;
}
