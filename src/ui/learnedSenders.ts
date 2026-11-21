/** P2-L.10b.7: confirmed local sender mappings. No cloud, no extra KI, no bulk rename. */
import { rejectedStampOrganisations, normalizeCompanyName } from "./localAi";
import { foldDocumentLabel, sanitizeSuggestedFileNamePart } from "./treeWorkbenchNameSuggest";
import { browserStorage, type WorkbenchStorage } from "./workbenchPrefs";

export const LEARNED_SENDERS_KEY = "dottyfm.learned-senders.v1";
export const LEARNED_SENDERS_VERSION = 1;

export interface LearnedSenderMapping {
  id: string;
  from: string;
  to: string;
  fromKey: string;
  tokens: string[];
}

export interface LearnedSenderStore {
  version: number;
  mappings: LearnedSenderMapping[];
}

export interface LearnedSenderMatch {
  status: "none" | "unique" | "ambiguous";
  mapping: LearnedSenderMapping | null;
}

export type LearnedSendersJsonStore = {
  load(): Promise<string | null>;
  save(json: string): Promise<void>;
};

export function emptyLearnedSenderStore(): LearnedSenderStore {
  return { version: LEARNED_SENDERS_VERSION, mappings: [] };
}

export function senderKey(value: string): string {
  return foldDocumentLabel(sanitizeSuggestedFileNamePart(value.replace(/\s+/g, " ")))
    .replace(/\s+/g, " ")
    .trim();
}

export function senderTokens(value: string): string[] {
  return senderKey(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

export function senderLearningCue(recognized: string | null | undefined, documentText: string): string | null {
  const trimmed = typeof recognized === "string" ? sanitizeSuggestedFileNamePart(recognized) : "";
  if (trimmed.length >= 3) {
    return trimmed;
  }
  const stamps = rejectedStampOrganisations(documentText);
  if (stamps.length !== 1) {
    return null;
  }
  const cue = sanitizeSuggestedFileNamePart(stamps[0]!);
  return cue.length >= 3 ? cue : null;
}

export function shouldPersistSenderMapping(options: {
  remember: boolean;
  renameOk: boolean;
  cancelled?: boolean;
  from: string | null | undefined;
  to: string | null | undefined;
}): boolean {
  if (options.cancelled === true || options.remember !== true || options.renameOk !== true) {
    return false;
  }
  return canRememberSender(options.from, options.to);
}

export function canRememberSender(from: string | null | undefined, to: string | null | undefined): boolean {
  const source = sanitizeSuggestedFileNamePart(from ?? "");
  const confirmed = sanitizeSuggestedFileNamePart(to ?? "");
  if (source.length < 3 || confirmed.length < 2) {
    return false;
  }
  if (senderKey(source) === senderKey(confirmed)) {
    return false;
  }
  if (looksLikeCaption(confirmed) || looksLikeCaption(source)) {
    return false;
  }
  return true;
}

export function rememberSenderMapping(
  store: LearnedSenderStore,
  from: string,
  to: string,
): { ok: true; store: LearnedSenderStore } | { ok: false; store: LearnedSenderStore; reason: string } {
  if (!canRememberSender(from, to)) {
    return { ok: false, store, reason: "Die Absenderkorrektur ist nicht eindeutig genug zum Merken." };
  }
  const mapping = sanitizeLearnedSenderMapping(
    {
      id: "",
      from,
      to,
      fromKey: "",
      tokens: [],
    },
    new Set(store.mappings.map((item) => item.id)),
  );
  if (mapping === null) {
    return { ok: false, store, reason: "Die Absenderkorrektur ist nicht eindeutig genug zum Merken." };
  }
  const existingIndex = store.mappings.findIndex((item) => item.fromKey === mapping.fromKey);
  const mappings = [...store.mappings];
  if (existingIndex >= 0) {
    mappings[existingIndex] = { ...mapping, id: mappings[existingIndex]!.id };
  } else {
    mappings.push(mapping);
  }
  return { ok: true, store: { version: LEARNED_SENDERS_VERSION, mappings } };
}

export function updateLearnedSenderMapping(
  store: LearnedSenderStore,
  mappingId: string,
  patch: Partial<Pick<LearnedSenderMapping, "from" | "to">>,
): LearnedSenderStore {
  return {
    version: LEARNED_SENDERS_VERSION,
    mappings: store.mappings.map((item) => {
      if (item.id !== mappingId) {
        return item;
      }
      return (
        sanitizeLearnedSenderMapping(
          { ...item, ...patch, id: item.id },
          new Set(),
        ) ?? item
      );
    }),
  };
}

export function deleteLearnedSenderMapping(store: LearnedSenderStore, mappingId: string): LearnedSenderStore {
  return {
    version: LEARNED_SENDERS_VERSION,
    mappings: store.mappings.filter((item) => item.id !== mappingId),
  };
}

export function matchLearnedSender(
  store: LearnedSenderStore,
  recognized: string | null | undefined,
  documentText: string,
): LearnedSenderMatch {
  const recognizedKey = senderKey(recognized ?? "");
  const exact = store.mappings.filter((item) => recognizedKey.length >= 3 && item.fromKey === recognizedKey);
  if (exact.length === 1) {
    return { status: "unique", mapping: exact[0]! };
  }
  if (exact.length > 1) {
    return { status: "ambiguous", mapping: null };
  }
  if (recognizedKey.length >= 3) {
    return { status: "none", mapping: null };
  }
  const fromDocument = store.mappings.filter(
    (item) => item.tokens.length >= 2 && documentHasTokenSequence(documentText, item.tokens),
  );
  if (fromDocument.length === 1) {
    return { status: "unique", mapping: fromDocument[0]! };
  }
  if (fromDocument.length > 1) {
    return { status: "ambiguous", mapping: null };
  }
  return { status: "none", mapping: null };
}

export function applyLearnedSender(
  recognized: string | null | undefined,
  documentText: string,
  store: LearnedSenderStore,
  manualAbsender?: string | null,
): { absender: string | null; learned: boolean } {
  const manual = sanitizeSuggestedFileNamePart(manualAbsender ?? "");
  if (manual.length > 0) {
    return { absender: manual, learned: false };
  }
  const match = matchLearnedSender(store, recognized, documentText);
  if (match.status === "unique" && match.mapping !== null) {
    return { absender: match.mapping.to, learned: true };
  }
  const fallback = sanitizeSuggestedFileNamePart(recognized ?? "");
  return { absender: fallback.length > 0 ? fallback : null, learned: false };
}

export function sanitizeLearnedSenderStore(raw: unknown): LearnedSenderStore {
  if (raw === null || typeof raw !== "object") {
    return emptyLearnedSenderStore();
  }
  const value = raw as Record<string, unknown>;
  const rawMappings = Array.isArray(value.mappings) ? value.mappings : [];
  const seen = new Set<string>();
  const mappings: LearnedSenderMapping[] = [];
  for (const item of rawMappings) {
    const mapping = sanitizeLearnedSenderMapping(item, seen);
    if (mapping !== null) {
      seen.add(mapping.id);
      mappings.push(mapping);
    }
  }
  return { version: LEARNED_SENDERS_VERSION, mappings };
}

export function loadLearnedSenderStore(storage: WorkbenchStorage | null = browserStorage()): LearnedSenderStore {
  if (storage === null) {
    return emptyLearnedSenderStore();
  }
  try {
    const raw = storage.getItem(LEARNED_SENDERS_KEY);
    if (raw === null || raw.trim().length === 0) {
      return emptyLearnedSenderStore();
    }
    return sanitizeLearnedSenderStore(JSON.parse(raw) as unknown);
  } catch {
    return emptyLearnedSenderStore();
  }
}

export function saveLearnedSenderStore(
  store: LearnedSenderStore,
  storage: WorkbenchStorage | null = browserStorage(),
): boolean {
  if (storage === null) {
    return false;
  }
  try {
    storage.setItem(LEARNED_SENDERS_KEY, JSON.stringify(sanitizeLearnedSenderStore(store)));
    return true;
  } catch {
    return false;
  }
}

export async function hydrateLearnedSenderStore(
  jsonStore: LearnedSendersJsonStore | null,
  storage: WorkbenchStorage | null = browserStorage(),
): Promise<LearnedSenderStore> {
  if (jsonStore === null) {
    return loadLearnedSenderStore(storage);
  }
  try {
    const raw = await jsonStore.load();
    if (raw === null) {
      const migrated = loadLearnedSenderStore(storage);
      if (migrated.mappings.length > 0) {
        try {
          await jsonStore.save(JSON.stringify(migrated));
        } catch {
          return migrated;
        }
      }
      return migrated;
    }
    return sanitizeLearnedSenderStore(JSON.parse(raw) as unknown);
  } catch {
    return emptyLearnedSenderStore();
  }
}

export async function persistLearnedSenderStore(
  store: LearnedSenderStore,
  jsonStore: LearnedSendersJsonStore | null,
  storage: WorkbenchStorage | null = browserStorage(),
): Promise<void> {
  const sanitized = sanitizeLearnedSenderStore(store);
  const json = JSON.stringify(sanitized);
  if (jsonStore !== null) {
    await jsonStore.save(json);
    return;
  }
  if (!saveLearnedSenderStore(sanitized, storage)) {
    throw new Error("Die Absenderzuordnungen konnten nicht gespeichert werden.");
  }
}

function documentHasTokenSequence(text: string, tokens: string[]): boolean {
  if (tokens.length < 2) {
    return false;
  }
  const haystack = ` ${foldDocumentLabel(text).replace(/[^a-z0-9]+/gi, " ").replace(/\s+/g, " ").trim()} `;
  const needle = ` ${tokens.join(" ")} `;
  return haystack.includes(needle);
}

function looksLikeCaption(value: string): boolean {
  const folded = foldDocumentLabel(value);
  return ["unterschrift", "stempel", "fachkundige person", "datum unterschrift"].some((item) => folded.includes(item));
}

function sanitizeLearnedSenderMapping(raw: unknown, seen: Set<string>): LearnedSenderMapping | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const from = sanitizeSuggestedFileNamePart(typeof value.from === "string" ? value.from : "");
  const to = sanitizeSuggestedFileNamePart(typeof value.to === "string" ? value.to : "");
  if (from.length < 3 || to.length < 2 || senderKey(from) === senderKey(to) || looksLikeCaption(from) || looksLikeCaption(to)) {
    return null;
  }
  const id =
    typeof value.id === "string" && value.id.trim().length > 0 && !seen.has(value.id.trim())
      ? value.id.trim()
      : uniqueMappingId([...seen].map((item) => ({ id: item })));
  const fromKey = senderKey(from);
  const tokens = senderTokens(from);
  if (fromKey.length < 3) {
    return null;
  }
  return {
    id,
    from: normalizeCompanyName(from) || from,
    to,
    fromKey,
    tokens,
  };
}

function uniqueMappingId(existing: readonly { id: string }[]): string {
  const seen = new Set(existing.map((item) => item.id));
  for (let index = 1; index < 10_000; index += 1) {
    const id = `sender-${index}`;
    if (!seen.has(id)) {
      return id;
    }
  }
  return `sender-${seen.size + 1}`;
}
