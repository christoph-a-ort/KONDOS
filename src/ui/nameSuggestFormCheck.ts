import { applySuggestedFileName, planNameSuggestion } from "./namingRules";
import {
  calendarInputValue,
  commitCalendarDateInput,
  commitNameSuggestDateInput,
  documentDateFieldIso,
  formatGermanDocumentDate,
  keepManualOverrides,
  NAME_SUGGEST_DATE_ERROR,
  nameSuggestFieldValue,
  nextAutoSuggestedFileName,
  parseNameSuggestDateInput,
  selectCalendarDay,
  shiftCalendarMonth,
  shiftCalendarYear,
  type CalendarPickerState,
} from "./nameSuggestForm";
import { planAiNameSuggestion } from "./localAi";
import {
  emptyLearnedSenderStore,
  rememberSenderMapping,
  shouldPersistSenderMapping,
} from "./learnedSenders";
import { resolveDocumentDateFromView, type DocumentTextView } from "./treeWorkbenchNameSuggest";

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

export function runNameSuggestFormCheck(): void {
  assert(parseNameSuggestDateInput("01.01.2026").iso === "2026-01-01", "keyboard German date is accepted");
  assert(parseNameSuggestDateInput("2026-01-01").iso === "2026-01-01", "keyboard ISO date is accepted");
  assert(parseNameSuggestDateInput("1.1.2026").iso === "2026-01-01", "unpadded German keyboard date is accepted");
  assert(parseNameSuggestDateInput("01.01.").status === "partial", "incomplete typed date is not committed");
  assert(parseNameSuggestDateInput("2026-01-").status === "partial", "incomplete ISO typing is not committed");
  assert(parseNameSuggestDateInput("").status === "empty", "cleared date is empty");
  assert(
    parseNameSuggestDateInput("31.02.2026").status === "invalid" &&
      parseNameSuggestDateInput("31.02.2026").error === NAME_SUGGEST_DATE_ERROR,
    "impossible typed date is reported",
  );
  assert(parseNameSuggestDateInput("2026-02-31").status === "invalid", "impossible ISO calendar date is reported");
  assert(parseNameSuggestDateInput("heute").status === "invalid", "today is not invented from free text");
  assert(formatGermanDocumentDate("2026-01-01") === "01.01.2026", "ISO is shown as German date");
  assert(calendarInputValue("01.01.2026") === "2026-01-01", "calendar value is ISO");
  assert(calendarInputValue("") === "", "empty calendar stays empty");

  const whileTyping = commitNameSuggestDateInput("2026-10-21", "01.01.");
  assert(whileTyping.action === "keep" && whileTyping.iso === "2026-10-21", "partial typing does not reset a confirmed date");
  const typedValid = commitNameSuggestDateInput("2026-10-21", "01.01.2026");
  assert(typedValid.action === "set" && typedValid.iso === "2026-01-01", "completed German date replaces the previous value");
  const cleared = commitNameSuggestDateInput("2026-01-01", "");
  assert(cleared.action === "clear" && cleared.iso === null, "clearing the field removes the date");

  const calendarPick = commitCalendarDateInput(null, "2026-01-01");
  assert(calendarPick.action === "set" && calendarPick.iso === "2026-01-01", "calendar day selection commits ISO");
  assert(calendarPick.draft === "01.01.2026", "calendar selection is shown as German date");
  const calendarInvalid = commitCalendarDateInput(null, "2026-02-31");
  assert(calendarInvalid.action === "keep" && calendarInvalid.error === NAME_SUGGEST_DATE_ERROR, "invalid calendar date is reported");

  let picker: CalendarPickerState = { viewYear: 2026, viewMonth: 9, selectedIso: null };
  picker = shiftCalendarMonth(picker, 1);
  assert(picker.viewYear === 2026 && picker.viewMonth === 10 && picker.selectedIso === null, "next month does not invent a day");
  picker = shiftCalendarMonth(picker, 1);
  assert(picker.viewMonth === 11 && picker.selectedIso === null, "another month step still keeps no selected day");
  picker = shiftCalendarYear(picker, 1);
  assert(picker.viewYear === 2027 && picker.selectedIso === null, "year change does not invent a day");
  picker = shiftCalendarYear(picker, -1);
  picker = { ...picker, viewYear: 2026, viewMonth: 1 };
  const selected = selectCalendarDay(picker, 1);
  assert(selected.iso === "2026-01-01" && selected.error === null, "selecting 1 January commits that day");
  const badDay = selectCalendarDay({ viewYear: 2026, viewMonth: 2, selectedIso: "2026-01-01" }, 31);
  assert(badDay.iso === null && badDay.state.selectedIso === "2026-01-01", "invalid day keeps the previous selection");

  const unlabeled = view({
    name: "2024-01-15_scan.pdf",
    format: "pdf",
    status: "searchable",
    text: "Formular ohne erkennbares Dokumentdatum.",
  });
  const unlabeledResolution = resolveDocumentDateFromView(unlabeled);
  assert(
    documentDateFieldIso({ override: undefined, resolution: unlabeledResolution, fileName: unlabeled.name }) === null,
    "a date in the filename is not taken as the document date",
  );
  assert(
    documentDateFieldIso({ override: "01.01.2026", resolution: unlabeledResolution, fileName: unlabeled.name }) ===
      "2026-01-01",
    "typed German date is used without inventing from the filename",
  );

  const gegView = view({
    name: "scan.pdf",
    format: "pdf",
    status: "searchable",
    text: "Nachweis Erfüllung Informationspflicht nach S 71 Absatz 11 Gebäudeenergiegesetz Unterschrift Stempel SHGZ KGZ GmbH",
  });
  const kiFields = {
    absender: "SHGZ KGZ",
    dokumenttyp: "GEG-Beratungsnachweis",
    betreff: null,
    thema: null,
  };
  const beforeDate = planAiNameSuggestion("scan.pdf", gegView, kiFields, { absender: "HGZ" });
  assert(beforeDate.values.absender === "HGZ", "manual sender override is kept before a date exists");
  const afterSender = planAiNameSuggestion("scan.pdf", gegView, kiFields, {
    absender: "HGZ",
    datum: parseNameSuggestDateInput("01.01.2026").iso ?? "",
  });
  assert(
    afterSender.suggestedName === "2026-01-01_HGZ_GEG-Beratungsnachweis.pdf",
    "sender correction updates the suggested filename",
  );
  const germanOverride = planAiNameSuggestion("scan.pdf", gegView, kiFields, {
    absender: "HGZ",
    datum: "01.01.2026",
  });
  assert(
    germanOverride.suggestedName === "2026-01-01_HGZ_GEG-Beratungsnachweis.pdf",
    "German date overrides are stored as ISO in the filename",
  );
  const afterType = planAiNameSuggestion("scan.pdf", gegView, { ...kiFields, dokumenttyp: "Rechnung" }, {
    absender: "HGZ",
    dokumenttyp: "GEG-Beratungsnachweis",
    datum: "2026-01-01",
  });
  assert(
    afterType.suggestedName === "2026-01-01_HGZ_GEG-Beratungsnachweis.pdf",
    "document-type correction updates the suggested filename",
  );
  assert(
    nameSuggestFieldValue("HGZ", "SHGZ KGZ") === "HGZ",
    "the absender field stays on the manual value",
  );

  const manualName = nextAutoSuggestedFileName({
    nameTouched: true,
    suggestedName: "2026-01-01_HGZ_GEG-Beratungsnachweis.pdf",
    currentName: "mein-name.pdf",
  });
  assert(manualName === "mein-name.pdf", "a manually edited filename is not overwritten");
  const autoName = nextAutoSuggestedFileName({
    nameTouched: false,
    suggestedName: "2026-01-01_HGZ_GEG-Beratungsnachweis.pdf",
    currentName: "scan.pdf",
  });
  assert(autoName === "2026-01-01_HGZ_GEG-Beratungsnachweis.pdf", "untouched filename follows field edits");

  const afterCache = keepManualOverrides({ absender: "HGZ", datum: "2026-01-01" }, kiFields);
  assert(afterCache.absender === "HGZ" && afterCache.datum === "2026-01-01", "KI or cache results do not reset manual overrides");

  const defaultManual = planNameSuggestion("scan.pdf", gegView, [], {
    absender: "HGZ",
    dokumenttyp: "GEG-Beratungsnachweis",
    datum: "01.01.2026",
  });
  assert(
    defaultManual.suggestedName === "2026-01-01_HGZ_GEG-Beratungsnachweis.pdf",
    "manual fields update the default suggestion when no KI plan exists",
  );

  const prepared = applySuggestedFileName("scan.pdf", autoName);
  assert(prepared.ok && prepared.fileName === "2026-01-01_HGZ_GEG-Beratungsnachweis.pdf", "expected praxis name remains a valid rename");

  assert(
    !shouldPersistSenderMapping({ remember: false, renameOk: true, from: "SHGZ KGZ", to: "HGZ" }),
    "learning stays off by default",
  );
  assert(
    !shouldPersistSenderMapping({ remember: true, renameOk: true, cancelled: true, from: "SHGZ KGZ", to: "HGZ" }),
    "cancel does not store a mapping",
  );
  assert(
    shouldPersistSenderMapping({ remember: true, renameOk: true, from: "SHGZ KGZ", to: "HGZ" }),
    "successful rename with consent stores the mapping",
  );
  const remembered = rememberSenderMapping(emptyLearnedSenderStore(), "SHGZ KGZ", "HGZ");
  assert(remembered.ok && remembered.store.mappings[0]?.to === "HGZ", "confirmed SHGZ KGZ to HGZ can be stored");
}
