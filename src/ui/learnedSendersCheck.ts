import { applySuggestedFileName, planNameSuggestion, type NamingRule } from "./namingRules";
import {
  applyLearnedSender,
  canRememberSender,
  deleteLearnedSenderMapping,
  emptyLearnedSenderStore,
  hydrateLearnedSenderStore,
  LEARNED_SENDERS_KEY,
  loadLearnedSenderStore,
  matchLearnedSender,
  persistLearnedSenderStore,
  rememberSenderMapping,
  sanitizeLearnedSenderStore,
  senderLearningCue,
  shouldPersistSenderMapping,
  updateLearnedSenderMapping,
} from "./learnedSenders";
import { parseLocalAiResponse, planAiNameSuggestion } from "./localAi";
import { workbenchNameSuggestRequest, type DocumentTextView } from "./treeWorkbenchNameSuggest";
import { isWorkbenchRenameShortcut } from "./treeWorkbenchRename";
import { canDragWorkbenchFile } from "./treeWorkbenchMove";
import type { DirectoryNode, FileNode, FsNode } from "../model";

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(label);
  }
}

function file(id: string, name: string, extras: Partial<FileNode> = {}): FileNode {
  return { id, name, path: id, depth: 1, kind: "file", sizeBytes: 4, modifiedAtMs: 100, ...extras };
}

function dir(id: string, name: string, children: FsNode[] = []): DirectoryNode {
  return { id, name, path: id, depth: 0, kind: "directory", listing: "read", children };
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

class MemoryStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

export async function runLearnedSendersCheck(): Promise<void> {
  const stampText =
    "Nachweis Erfüllung Informationspflicht nach S 71 Absatz 11 Gebäudeenergiegesetz Unterschrift fachkundige Person Stempel SHGZ KGZ GmbH Berlin";
  const stampView = view({
    name: "scan.pdf",
    format: "pdf",
    status: "searchable",
    source: "ocr",
    text: stampText,
  });
  const cue = senderLearningCue(null, stampText);
  assert(cue === "SHGZ KGZ", "rejected stamp fragment is the learning cue when absender is empty");
  assert(canRememberSender(cue, "HGZ"), "SHGZ KGZ may be remembered as HGZ");
  assert(!canRememberSender("SHGZ KGZ", "SHGZ KGZ"), "unchanged absender is not a learning event");
  assert(!canRememberSender("", "HGZ"), "empty source is not remembered without a cue");

  const remembered = rememberSenderMapping(emptyLearnedSenderStore(), "SHGZ KGZ", "HGZ");
  assert(remembered.ok, "confirmed correction can be stored");
  const store = remembered.ok ? remembered.store : emptyLearnedSenderStore();
  assert(store.mappings.length === 1 && store.mappings[0]?.to === "HGZ", "mapping stores confirmed sender");
  assert(!JSON.stringify(store).includes("Berlin"), "address fragments are not stored");
  assert(!JSON.stringify(store).includes(stampText), "document text is not stored");

  assert(
    !shouldPersistSenderMapping({ remember: false, renameOk: true, from: "SHGZ KGZ", to: "HGZ" }),
    "learning stays off by default",
  );
  assert(
    !shouldPersistSenderMapping({ remember: true, renameOk: true, cancelled: true, from: "SHGZ KGZ", to: "HGZ" }),
    "cancel does not store a mapping",
  );
  const failedName = applySuggestedFileName("scan.pdf", ":::");
  assert(
    !shouldPersistSenderMapping({
      remember: true,
      renameOk: failedName.ok,
      from: "SHGZ KGZ",
      to: "HGZ",
    }),
    "failed rename does not store a mapping",
  );
  assert(
    !shouldPersistSenderMapping({ remember: true, renameOk: true, from: "SHGZ KGZ", to: "SHGZ KGZ" }),
    "filename-only confirm without absender change does not store",
  );
  assert(
    shouldPersistSenderMapping({ remember: true, renameOk: true, from: "SHGZ KGZ", to: "HGZ" }),
    "explicit remember after successful rename stores the mapping",
  );

  const unique = matchLearnedSender(store, "SHGZ KGZ", stampText);
  assert(unique.status === "unique" && unique.mapping?.to === "HGZ", "exact recognized sender is a unique hit");
  const fromEmpty = matchLearnedSender(store, null, stampText);
  assert(fromEmpty.status === "unique" && fromEmpty.mapping?.to === "HGZ", "token sequence SHGZ KGZ in OCR is a unique hit");
  const similar = matchLearnedSender(store, "SHGZ Solutions GmbH", "SHGZ Solutions GmbH\nRechnung");
  assert(similar.status === "none", "a similar company name is not replaced");
  const otherFirm = matchLearnedSender(store, "eprimo", "eprimo GmbH\nStromrechnung");
  assert(otherFirm.status === "none", "a different recognized sender stays unchanged");

  const second = rememberSenderMapping(store, "SHGZ KGZ Berlin", "Anderer");
  assert(second.ok, "a more specific mapping can exist");
  const ambiguousText = "Stempel SHGZ KGZ Berlin GmbH";
  const ambiguous = matchLearnedSender(second.ok ? second.store : store, null, ambiguousText);
  assert(ambiguous.status === "ambiguous", "two matching mappings are not applied silently");
  const appliedAmbiguous = applyLearnedSender(null, ambiguousText, second.ok ? second.store : store);
  assert(appliedAmbiguous.absender === null && appliedAmbiguous.learned === false, "ambiguous matches leave the sender untouched");

  const applied = applyLearnedSender("SHGZ KGZ", stampText, store);
  assert(applied.learned && applied.absender === "HGZ", "unique mapping is applied as a suggestion");
  const manual = applyLearnedSender("SHGZ KGZ", stampText, store, "Manuell");
  assert(manual.absender === "Manuell" && manual.learned === false, "manual sender always wins");

  const edited = updateLearnedSenderMapping(store, store.mappings[0]!.id, { to: "HGZ Solutions" });
  assert(edited.mappings[0]?.to === "HGZ Solutions", "mapping can be edited");
  const deleted = deleteLearnedSenderMapping(edited, edited.mappings[0]!.id);
  assert(deleted.mappings.length === 0, "mapping can be deleted");
  assert(matchLearnedSender(deleted, "SHGZ KGZ", stampText).status === "none", "deleted mapping is not applied");

  const memory = new MemoryStorage();
  const persisted = { json: "" };
  const jsonStore = {
    async load() {
      return persisted.json.length > 0 ? persisted.json : null;
    },
    async save(json: string) {
      persisted.json = json;
    },
  };
  await persistLearnedSenderStore(store, jsonStore, memory);
  const reloaded = await hydrateLearnedSenderStore(jsonStore, new MemoryStorage());
  assert(reloaded.mappings[0]?.to === "HGZ", "mappings survive a reload from app data JSON");
  assert(persisted.json.includes("SHGZ") && !persisted.json.includes("Berlin"), "app-data JSON has the mapping, not the address");
  await persistLearnedSenderStore(store, null, memory);
  assert(memory.getItem(LEARNED_SENDERS_KEY) !== null, "browser key is written in tests");
  const afterRestart = loadLearnedSenderStore(memory);
  assert(afterRestart.mappings[0]?.fromKey.includes("shgz"), "browser storage roundtrip keeps the folded key");
  assert(sanitizeLearnedSenderStore({ mappings: [{ from: "SHGZ KGZ", to: "HGZ" }] }).mappings.length === 1, "id is filled on sanitize");

  const ki = parseLocalAiResponse("kein json", stampText);
  const learnedFields = { ...ki, absender: applied.absender };
  const named = planAiNameSuggestion("scan.pdf", stampView, learnedFields, { datum: "2026-01-01" });
  assert(named.suggestedName === "2026-01-01_HGZ_GEG-Beratungsnachweis.pdf", "learned sender is used in the filename");

  const invoiceRule: NamingRule = {
    id: "rule-invoice",
    name: "Rechnungen",
    enabled: true,
    formats: ["pdf"],
    keywords: ["rechnung"],
    documentType: "Rechnung",
    schema: "{datum}_{absender}_{dokumenttyp}.pdf",
  };
  const invoiceView = view({
    name: "rechnung.pdf",
    format: "pdf",
    status: "searchable",
    source: "extract",
    text: "Rechnung Mueller GmbH\nRechnungsdatum 28.10.2026",
  });
  const rulePlan = planNameSuggestion("rechnung.pdf", invoiceView, [invoiceRule]);
  assert(rulePlan.source === "rule", "naming rules still win before learned senders");
  const ruleLearned = matchLearnedSender(store, "Mueller", invoiceView.text ?? "");
  assert(ruleLearned.status === "none", "SHGZ mapping does not hit an invoice sender");

  const root = dir("C:/Dotty-Test/Probeordner", "Probeordner", [file("C:/Dotty-Test/Probeordner/scan.pdf", "scan.pdf")]);
  const source = root.children[0] as FileNode;
  const prepared = workbenchNameSuggestRequest(root.path, source, "2026-01-01_HGZ_GEG-Beratungsnachweis.pdf");
  assert(prepared.ok, "learned filename still uses the existing rename request");
  assert(canDragWorkbenchFile(source, true), "drag-and-drop remains");
  assert(isWorkbenchRenameShortcut({ key: "u", ctrlKey: true, shiftKey: true }), "Ctrl+Shift+U remains");
}
