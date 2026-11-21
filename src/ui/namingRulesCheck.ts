import {
  addNamingRule,
  applySuggestedFileName,
  createNamingRule,
  deleteNamingRule,
  emptyNamingRuleStore,
  extractLabeledValue,
  firstMatchingRule,
  hydrateNamingRuleStore,
  loadNamingRuleStore,
  moveNamingRule,
  NAMING_RULES_KEY,
  namingRuleSchemaError,
  persistNamingRuleStore,
  planNameSuggestion,
  preserveOriginalFileExtension,
  renderRuleFileName,
  ruleMatches,
  sanitizeNamingRuleStore,
  saveNamingRuleStore,
  setNamingRuleEnabled,
  updateNamingRule,
  type NamingRule,
  type NamingRuleStore,
} from "./namingRules";
import { canDragWorkbenchFile } from "./treeWorkbenchMove";
import { isWorkbenchRenameShortcut } from "./treeWorkbenchRename";
import {
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

function invoiceRule(patch: Partial<NamingRule> = {}): NamingRule {
  return {
    id: "rule-invoice",
    name: "Rechnungen",
    enabled: true,
    formats: ["pdf"],
    keywords: ["Rechnung"],
    documentType: "Rechnung",
    schema: "{datum}_{dokumenttyp}_{name}",
    ...patch,
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

export async function runNamingRulesCheck(): Promise<void> {
  const root = dir("C:/Dotty-Test/Probeordner", "Probeordner", [
    file("C:/Dotty-Test/Probeordner/Rechnung_Mueller.pdf", "Rechnung_Mueller.pdf"),
  ]);
  const source = root.children[0];
  assert(!isDirectory(source), "fixture file");

  const empty = emptyNamingRuleStore();
  assert(empty.rules.length === 0, "empty store has no rules");
  const created = addNamingRule(empty);
  assert(created.rules.length === 1 && created.rules[0]?.name === "Neue Regel", "create adds a named rule");
  assert(created.rules[0]?.enabled === true, "new rules start enabled");
  assert(created.rules[0]?.schema === "{datum}_{name}", "new rules use the default schema");

  const renamed = updateNamingRule(created, created.rules[0]!.id, { name: "  Rechnungen  " });
  assert(renamed.rules[0]?.name === "Rechnungen", "edit trims the rule name");
  const disabled = setNamingRuleEnabled(renamed, renamed.rules[0]!.id, false);
  assert(disabled.rules[0]?.enabled === false, "rule can be deactivated");
  const removed = deleteNamingRule(disabled, disabled.rules[0]!.id);
  assert(removed.rules.length === 0, "rule can be deleted");

  const first = createNamingRule([], "Erste");
  const second = createNamingRule([first], "Zweite");
  const ordered: NamingRuleStore = { version: 1, rules: [first, second] };
  const down = moveNamingRule(ordered, first.id, 1);
  assert(down.rules[0]?.id === second.id && down.rules[1]?.id === first.id, "priority moves down");
  const up = moveNamingRule(down, first.id, -1);
  assert(up.rules[0]?.id === first.id, "priority moves up");
  assert(moveNamingRule(ordered, first.id, -1) === ordered, "moving the first rule up is a no-op");

  const invoiceView = view({
    name: "scan.pdf",
    format: "pdf",
    status: "searchable",
    text: "Firma Beispiel GmbH\nRechnungsdatum: 28.10.2026\nAbsender: Mueller GmbH\nBetreff: Wartung Oktober",
  });
  const jpegView = view({
    name: "bild.jpg",
    format: "jpeg",
    status: "searchable",
    text: "PNG- oder JPG-Datei mit sichtbarem Text 28 .10.2026",
    source: "ocr",
    ocrAttempted: true,
  });
  const emptyText = view({
    name: "leer.pdf",
    format: "pdf",
    status: "noExtractableText",
    text: null,
    source: "ocr",
    ocrAttempted: true,
  });
  const matching = invoiceRule();
  assert(ruleMatches(matching, invoiceView), "keyword and PDF format match");
  assert(!ruleMatches({ ...matching, enabled: false }, invoiceView), "inactive rules do not match");
  assert(!ruleMatches(matching, jpegView), "JPEG does not match a PDF-only rule");
  assert(!ruleMatches(matching, emptyText), "missing document text does not satisfy keywords");
  assert(firstMatchingRule([{ ...matching, enabled: false }, matching], invoiceView)?.id === "rule-invoice", "first enabled match wins");

  const catchAll: NamingRule = invoiceRule({
    id: "rule-all",
    name: "Auffangregel",
    formats: [],
    keywords: [],
    schema: "{datum}_{name}",
  });
  assert(firstMatchingRule([matching, catchAll], jpegView)?.id === "rule-all", "later catch-all is used only when earlier rules miss");
  assert(firstMatchingRule([matching, catchAll], invoiceView)?.id === "rule-invoice", "higher priority matching rule wins");

  const planned = planNameSuggestion("Rechnung_Mueller.pdf", invoiceView, [matching]);
  assert(planned.source === "rule" && planned.rule?.name === "Rechnungen", "matching rule is applied");
  assert(planned.suggestedName === "2026-10-28_Rechnung_Rechnung_Mueller.pdf", "schema uses available date, type and name");
  assert(planned.missing.length === 0, "complete rule values do not ask");
  assert(planned.values.absender === "Mueller GmbH", "labeled sender is used");
  assert(planned.values.betreff === "Wartung Oktober", "labeled subject is used");

  const missingType = planNameSuggestion("Rechnung_Mueller.pdf", invoiceView, [
    invoiceRule({ documentType: "", schema: "{datum}_{dokumenttyp}_{name}" }),
  ]);
  assert(missingType.source === "rule" && missingType.suggestedName === null, "missing document type is not invented");
  assert(missingType.missing.includes("dokumenttyp"), "user is asked for the document type");

  const missingSender = planNameSuggestion("Notiz.pdf", invoiceView, [
    invoiceRule({ schema: "{datum}_{absender}_{name}", documentType: "" }),
  ]);
  assert(missingSender.values.absender === "Mueller GmbH", "present sender label is kept");
  const noSender = planNameSuggestion(
    "Notiz.pdf",
    view({
      name: "Notiz.pdf",
      format: "pdf",
      status: "searchable",
      text: "Rechnungsdatum: 28.10.2026\nNur Fliesstext ohne Absenderzeile.",
    }),
    [invoiceRule({ schema: "{datum}_{absender}_{name}" })],
  );
  assert(noSender.missing.includes("absender") && noSender.suggestedName === null, "missing sender is not invented");

  const filled = planNameSuggestion(
    "Notiz.pdf",
    view({
      name: "Notiz.pdf",
      format: "pdf",
      status: "searchable",
      text: "Rechnungsdatum: 28.10.2026",
    }),
    [invoiceRule({ schema: "{datum}_{absender}_{name}" })],
    { absender: "Ort" },
  );
  assert(filled.suggestedName === "2026-10-28_Ort_Notiz.pdf", "user-supplied placeholder completes the rule");

  const noRule = planNameSuggestion("Rechnung_Mueller.pdf", invoiceView, []);
  assert(noRule.source === "default", "without a matching rule the existing suggestion is used");
  assert(noRule.suggestedName === "2026-10-28_Rechnung_Mueller.pdf", "default remains YYYY-MM-DD_Name.ext");

  const inactiveOnly = planNameSuggestion("Rechnung_Mueller.pdf", invoiceView, [
    invoiceRule({ enabled: false }),
  ]);
  assert(inactiveOnly.source === "default", "inactive rules fall back to the existing suggestion");

  const ocrInvoice = planNameSuggestion(
    "scan.jpg",
    view({
      name: "scan.jpg",
      format: "jpeg",
      status: "searchable",
      text: "Rechnungsdatum: 28.10.2026",
      source: "ocr",
      ocrAttempted: true,
    }),
    [invoiceRule({ id: "rule-ocr", formats: ["jpeg"], keywords: ["Rechnung"], schema: "{datum}_{name}" })],
  );
  assert(ocrInvoice.source === "rule" && ocrInvoice.missing.includes("datum"), "OCR dates stay unconfirmed in rules");

  const ocrUnlabeled = planNameSuggestion("bild.jpg", jpegView, [
    invoiceRule({ id: "rule-jpeg", formats: ["jpeg"], keywords: ["sichtbarem"], schema: "{datum}_{name}" }),
  ]);
  assert(ocrUnlabeled.source === "rule", "JPEG keyword rule matches OCR text");
  assert(ocrUnlabeled.missing.includes("datum"), "unlabeled OCR date is not auto-filled");
  assert(ocrUnlabeled.suggestedName === null, "rule waits for the date instead of inventing one");
  const ocrWithDate = planNameSuggestion("bild.jpg", jpegView, [
    invoiceRule({ id: "rule-jpeg", formats: ["jpeg"], keywords: ["sichtbarem"], schema: "{datum}_{name}" }),
  ], { datum: "2026-10-28" });
  assert(ocrWithDate.suggestedName === "2026-10-28_bild.jpg", "user date completes the OCR rule");
  const ocrWithGermanDate = planNameSuggestion("bild.jpg", jpegView, [
    invoiceRule({ id: "rule-jpeg", formats: ["jpeg"], keywords: ["sichtbarem"], schema: "{datum}_{name}" }),
  ], { datum: "01.01.2026" });
  assert(ocrWithGermanDate.suggestedName === "2026-01-01_bild.jpg", "typed German date is stored as ISO in the rule name");

  assert(extractLabeledValue("Absender: Mueller GmbH", ["absender"]) === "Mueller GmbH", "sender label is read");
  assert(extractLabeledValue("Davon: keine Angabe", ["von"]) === null, "partial words are not treated as labels");
  assert(namingRuleSchemaError("{datum}_{name}") === null, "known placeholders are accepted");
  assert(namingRuleSchemaError("{datum}_{ki}")?.includes("{ki}") === true, "unknown placeholders are rejected");
  assert(namingRuleSchemaError("nurtext") !== null, "schema without placeholders is rejected");
  assert(renderRuleFileName("a.pdf", "{datum}_{name}", { datum: "2026-10-28", name: "a" }) === "2026-10-28_a.pdf", "extension is preserved");
  assert(renderRuleFileName("a.pdf", "{datum}_{name}.pdf", { datum: "2026-10-28", name: "a" }) === "2026-10-28_a.pdf", "schema extension is not doubled");

  const storage = new MemoryStorage();
  const persisted: NamingRuleStore = { version: 1, rules: [matching] };
  assert(saveNamingRuleStore(persisted, storage), "rules save to storage");
  const loaded = loadNamingRuleStore(storage);
  assert(loaded.rules[0]?.name === "Rechnungen" && loaded.rules[0]?.keywords[0] === "Rechnung", "rules load from storage");
  assert(storage.getItem(NAMING_RULES_KEY)?.includes("Rechnungen") === true, "browser fallback key is written");
  const broken = new MemoryStorage();
  broken.setItem(NAMING_RULES_KEY, "{not json");
  assert(loadNamingRuleStore(broken).rules.length === 0, "broken JSON falls back to an empty store");
  const sanitized = sanitizeNamingRuleStore({
    rules: [{ id: "x", name: "", enabled: "yes", formats: ["pdf", "exe", "pdf"], keywords: ["  Rechnung  ", ""], schema: "" }],
  });
  assert(sanitized.rules[0]?.name === "Unbenannte Regel", "empty names are replaced");
  assert(sanitized.rules[0]?.formats.join(",") === "pdf", "unknown formats are dropped");
  assert(sanitized.rules[0]?.schema === "{datum}_{name}", "empty schema falls back");

  const memoryJson = {
    raw: null as string | null,
    async load() {
      return this.raw;
    },
    async save(json: string) {
      this.raw = json;
    },
  };
  const hydratedEmpty = await hydrateNamingRuleStore(memoryJson, new MemoryStorage());
  assert(hydratedEmpty.rules.length === 0, "missing JSON file starts empty");
  await persistNamingRuleStore(persisted, memoryJson, new MemoryStorage());
  assert(memoryJson.raw?.includes("Rechnungen") === true, "Tauri JSON store receives the rules");
  const reloaded = await hydrateNamingRuleStore(memoryJson, new MemoryStorage());
  assert(reloaded.rules[0]?.id === "rule-invoice", "JSON store roundtrip keeps the rule");

  const meterView = view({
    name: "Zaehler.pdf",
    format: "pdf",
    status: "searchable",
    text: "Zählerablesungsmeldung\nZählerstand 14.11.2026\nAblesewert 1234.",
  });
  assert(!ruleMatches(matching, meterView), "meter reading without the invoice keyword does not match");
  assert(
    ruleMatches(invoiceRule({ keywords: [] }), meterView),
    "a PDF-only rule without keywords matches every PDF, including meter readings",
  );

  const incompletePlan = planNameSuggestion("scan.pdf", invoiceView, [
    invoiceRule({ documentType: "", schema: "{datum}_{dokumenttyp}_{name}" }),
  ]);
  assert(incompletePlan.missing.includes("dokumenttyp"), "rule suggestion can still be incomplete");
  const manualActive = applySuggestedFileName("scan.pdf", "2026-11-14_Zählerablesungsmeldung.pdf");
  assert(manualActive.ok && manualActive.fileName === "2026-11-14_Zählerablesungsmeldung.pdf", "manual name is accepted with an active rule");
  const manualInactive = applySuggestedFileName("scan.pdf", "2026-11-14_Zählerablesungsmeldung.pdf");
  assert(manualInactive.ok, "manual name is accepted with an inactive rule");
  const manualNoRule = applySuggestedFileName("Rechnung_Mueller.pdf", "2026-11-14_Zählerablesungsmeldung.pdf");
  assert(manualNoRule.ok, "manual name is accepted without a matching rule");
  const namePartOnly = applySuggestedFileName("2026-11-14_Rechnung.pdf", "2026-11-14_Zählerablesungsmeldung.pdf");
  assert(namePartOnly.ok && namePartOnly.fileName === "2026-11-14_Zählerablesungsmeldung.pdf", "only the name part may change");
  assert(
    preserveOriginalFileExtension("scan.pdf", "2026-11-14_Zählerablesungsmeldung") === "2026-11-14_Zählerablesungsmeldung.pdf",
    "missing extension is restored",
  );
  const invalidName = applySuggestedFileName("scan.pdf", "Rechnung:.pdf");
  assert(!invalidName.ok && invalidName.unchanged === false && invalidName.reason.includes("unzulässig"), "invalid Windows names are rejected with a message");
  const unchangedName = applySuggestedFileName("Rechnung_Mueller.pdf", "Rechnung_Mueller.pdf");
  assert(!unchangedName.ok && unchangedName.unchanged, "unchanged names do not rename");
  const collisionRequest = workbenchNameSuggestRequest(root.path, source, "keep-other.pdf");
  assert(collisionRequest.ok && collisionRequest.request.targetPath.endsWith("keep-other.pdf"), "apply still builds a rename request; overwrite is decided by the existing engine");

  const prepared = workbenchNameSuggestRequest(root.path, source, "2026-11-14_Zählerablesungsmeldung.pdf");
  assert(prepared.ok && prepared.request.newName === "2026-11-14_Zählerablesungsmeldung.pdf", "manual apply reuses the existing rename request");
  const cancel = workbenchNameSuggestRequest(root.path, source, "Rechnung_Mueller.pdf");
  assert(!cancel.ok && cancel.unchanged, "leaving the original name does not rename");
  assert(canDragWorkbenchFile(source, true), "naming rules do not disable drag-and-drop");
  assert(
    isWorkbenchRenameShortcut({ key: "u", ctrlKey: true, shiftKey: true }),
    "Ctrl+Shift+U remains the inline rename shortcut",
  );
}
