/** P2-L.10b.7a: manual date and field edits in the name-suggestion dialog. */
import { formatIsoDate, parseUserDocumentDate, type DocumentDateResolution } from "./treeWorkbenchNameSuggest";
import type { NamingPlaceholder } from "./namingRules";

export const NAME_SUGGEST_DATE_ERROR =
  "Das Datum ist ungültig. Bitte TT.MM.JJJJ oder JJJJ-MM-TT verwenden.";

export type NameSuggestDateStatus = "empty" | "partial" | "valid" | "invalid";

export type NameSuggestDateParse = {
  status: NameSuggestDateStatus;
  iso: string | null;
  error: string | null;
};

export type NameSuggestDateCommit = {
  action: "set" | "clear" | "keep";
  iso: string | null;
  draft: string;
  error: string | null;
};

export type CalendarPickerState = {
  viewYear: number;
  viewMonth: number;
  selectedIso: string | null;
};

const PARTIAL_DATE =
  /^(?:\d{1,4}|\d{1,2}\.|\d{1,2}\.\d{1,2}\.?|\d{1,2}\.\d{1,2}\.\d{0,3}|\d{4}-|\d{4}-\d{1,2}|\d{4}-\d{2}-|\d{4}-\d{2}-\d{0,1})$/;
const COMPLETE_DATE_SHAPE = /^(?:\d{1,2}\.\d{1,2}\.\d{4}|\d{4}-\d{2}-\d{2})$/;

export function formatGermanDocumentDate(iso: string): string {
  const parsed = parseUserDocumentDate(iso);
  if (parsed === null) {
    return "";
  }
  const [year, month, day] = parsed.split("-");
  return `${day}.${month}.${year}`;
}

export function parseNameSuggestDateInput(raw: string): NameSuggestDateParse {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { status: "empty", iso: null, error: null };
  }
  const iso = parseUserDocumentDate(trimmed);
  if (iso !== null) {
    return { status: "valid", iso, error: null };
  }
  if (!COMPLETE_DATE_SHAPE.test(trimmed) && PARTIAL_DATE.test(trimmed)) {
    return { status: "partial", iso: null, error: null };
  }
  return { status: "invalid", iso: null, error: NAME_SUGGEST_DATE_ERROR };
}

export function commitNameSuggestDateInput(previousIso: string | null, raw: string): NameSuggestDateCommit {
  const parsed = parseNameSuggestDateInput(raw);
  if (parsed.status === "valid" && parsed.iso !== null) {
    return { action: "set", iso: parsed.iso, draft: raw, error: null };
  }
  if (parsed.status === "empty") {
    return { action: "clear", iso: null, draft: raw, error: null };
  }
  return {
    action: "keep",
    iso: previousIso,
    draft: raw,
    error: parsed.error,
  };
}

export function commitCalendarDateInput(previousIso: string | null, raw: string): NameSuggestDateCommit {
  const parsed = parseNameSuggestDateInput(raw);
  if (parsed.status === "valid" && parsed.iso !== null) {
    return {
      action: "set",
      iso: parsed.iso,
      draft: formatGermanDocumentDate(parsed.iso),
      error: null,
    };
  }
  if (parsed.status === "empty") {
    return { action: "clear", iso: null, draft: "", error: null };
  }
  return {
    action: "keep",
    iso: previousIso,
    draft: previousIso !== null ? formatGermanDocumentDate(previousIso) : "",
    error: parsed.error ?? NAME_SUGGEST_DATE_ERROR,
  };
}

export function calendarInputValue(iso: string | null | undefined): string {
  if (typeof iso !== "string" || iso.length === 0) {
    return "";
  }
  return parseUserDocumentDate(iso) ?? "";
}

export function documentDateFieldIso(args: {
  override: string | undefined;
  resolution: DocumentDateResolution | null;
  fileName: string;
}): string | null {
  void args.fileName;
  if (typeof args.override === "string" && args.override.trim().length > 0) {
    return parseUserDocumentDate(args.override);
  }
  if (args.resolution !== null && args.resolution.status === "confident") {
    return args.resolution.iso;
  }
  return null;
}

export function shiftCalendarMonth(state: CalendarPickerState, delta: number): CalendarPickerState {
  const absolute = state.viewYear * 12 + (state.viewMonth - 1) + delta;
  const year = Math.floor(absolute / 12);
  const month = ((absolute % 12) + 12) % 12 + 1;
  return { ...state, viewYear: year, viewMonth: month };
}

export function shiftCalendarYear(state: CalendarPickerState, delta: number): CalendarPickerState {
  return { ...state, viewYear: state.viewYear + delta };
}

export function selectCalendarDay(
  state: CalendarPickerState,
  day: number,
): { state: CalendarPickerState; iso: string | null; error: string | null } {
  const iso = formatIsoDate(state.viewYear, state.viewMonth, day);
  if (iso === null) {
    return { state, iso: null, error: NAME_SUGGEST_DATE_ERROR };
  }
  return {
    state: { ...state, selectedIso: iso },
    iso,
    error: null,
  };
}

export function nextAutoSuggestedFileName(args: {
  nameTouched: boolean;
  suggestedName: string | null;
  currentName: string;
}): string {
  if (args.nameTouched) {
    return args.currentName;
  }
  if (args.suggestedName !== null) {
    return args.suggestedName;
  }
  return args.currentName;
}

export function keepManualOverrides<T extends Partial<Record<NamingPlaceholder, string>>>(
  overrides: T,
  _incomingAiFields: unknown,
): T {
  void _incomingAiFields;
  return overrides;
}

export function nameSuggestFieldValue(override: string | undefined, planned: string | undefined): string {
  return override ?? planned ?? "";
}
