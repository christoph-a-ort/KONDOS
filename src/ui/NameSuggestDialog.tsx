import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";

import { isFile, type FsNode } from "../model";
import { subscribeOcrProgress, toUserError } from "../scan";
import { inspectDocumentText } from "./documentTextApi";
import {
  documentTextForAi,
  emptyLocalAiTimings,
  formatLocalAiTimings,
  hasCachedLocalAiResult,
  hasLocalAiNameFields,
  hydrateLocalAiPrefs,
  nameSuggestSourceLabel,
  planAiNameSuggestion,
  requestLocalAiNameFields,
  shouldUseLocalAiFallback,
  type LocalAiNameFields,
  type LocalAiTimings,
} from "./localAi";
import {
  runNameSuggestDiagnose,
  type NameSuggestDiagnoseSnapshot,
} from "./localAiDiagnose";
import { createLocalAiClient, loadLocalAiPrefsJson, logNameSuggestTimings, saveLocalAiPrefsJson } from "./localAiApi";
import {
  applyLearnedSender,
  canRememberSender,
  emptyLearnedSenderStore,
  hydrateLearnedSenderStore,
  persistLearnedSenderStore,
  rememberSenderMapping,
  senderLearningCue,
  shouldPersistSenderMapping,
  type LearnedSenderStore,
} from "./learnedSenders";
import { loadLearnedSendersJson, saveLearnedSendersJson } from "./learnedSendersApi";
import {
  hydrateNamingRuleStore,
  NAMING_PLACEHOLDER_LABELS,
  planNameSuggestion,
  schemaPlaceholders,
  type NamingPlaceholder,
  type NamingRuleStore,
} from "./namingRules";
import { prepareNameSuggestApply } from "./nameSuggestApply";
import { loadNamingRulesJson, saveNamingRulesJson } from "./namingRulesApi";
import {
  calendarInputValue,
  commitCalendarDateInput,
  commitNameSuggestDateInput,
  documentDateFieldIso,
  formatGermanDocumentDate,
  keepManualOverrides,
  nameSuggestFieldValue,
  nextAutoSuggestedFileName,
} from "./nameSuggestForm";
import {
  isOcrTextSource,
  nameSuggestNeedsUserDate,
  uniqueDocumentDateChoices,
  type DocumentDateResolution,
  type DocumentTextView,
} from "./treeWorkbenchNameSuggest";
import type { WorkbenchRenameApplyResult, WorkbenchRenameRequest } from "./treeWorkbenchRename";
import { isTauriRuntime } from "./workbenchPrefsApi";

interface NameSuggestDialogProps {
  open: boolean;
  scanId: number | null;
  scanRoot: string;
  node: FsNode | null;
  onClose: () => void;
  onApply: (request: WorkbenchRenameRequest) => Promise<WorkbenchRenameApplyResult> | WorkbenchRenameApplyResult;
  onIssue?: (message: string) => void;
}

const EXTRA_PLACEHOLDERS: NamingPlaceholder[] = ["dokumenttyp", "absender", "betreff"];

export function NameSuggestDialog({
  open,
  scanId,
  scanRoot,
  node,
  onClose,
  onApply,
  onIssue,
}: NameSuggestDialogProps) {
  const titleId = useId();
  const dateId = useId();
  const nameId = useId();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<DocumentTextView | null>(null);
  const [rules, setRules] = useState<NamingRuleStore>(() => ({ version: 1, rules: [] }));
  const [overrides, setOverrides] = useState<Partial<Record<NamingPlaceholder, string>>>({});
  const [dateDraft, setDateDraft] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const [nameValue, setNameValue] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [applyIssue, setApplyIssue] = useState<string | null>(null);
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const [aiFields, setAiFields] = useState<LocalAiNameFields | null>(null);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [timingLine, setTimingLine] = useState<string | null>(null);
  const [diagnose, setDiagnose] = useState<NameSuggestDiagnoseSnapshot | null>(null);
  const [diagnoseBusy, setDiagnoseBusy] = useState(false);
  const [diagnoseNotice, setDiagnoseNotice] = useState<string | null>(null);
  const [learnedStore, setLearnedStore] = useState<LearnedSenderStore>(emptyLearnedSenderStore);
  const [rememberSender, setRememberSender] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const flowStartedRef = useRef(0);
  const inspectMsRef = useRef<number | null>(null);
  const dateEditedRef = useRef(false);

  function publishNameSuggestTimings(timings: LocalAiTimings) {
    const started = flowStartedRef.current;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const totalMs = started > 0 ? Math.max(0, Math.round(now - started)) : timings.totalMs;
    const line = formatLocalAiTimings({ ...timings, totalMs });
    setTimingLine(line);
    console.info(line);
    if (isTauriRuntime()) {
      void logNameSuggestTimings(line).catch(() => undefined);
    }
  }

  useEffect(() => {
    if (!open || node === null || !isFile(node) || scanId === null) {
      return;
    }
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    setLoading(true);
    setError(null);
    setView(null);
    setOverrides({});
    setDateDraft("");
    setDateError(null);
    dateEditedRef.current = false;
    setOcrStatus(null);
    setApplyIssue(null);
    setAiFields(null);
    setAiStatus(null);
    setAiNotice(null);
    inspectMsRef.current = null;
    setTimingLine(null);
    setDiagnose(null);
    setDiagnoseBusy(false);
    setDiagnoseNotice(null);
    setRememberSender(false);
    setApplyBusy(false);
    flowStartedRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
    setNameTouched(false);
    setNameValue(node.name);
    void subscribeOcrProgress((progress) => {
      if (cancelled || progress.scanId !== scanId) {
        return;
      }
      if (progress.totalPages > 0 && progress.currentPage > 0) {
        setOcrStatus(`Texterkennung läuft (Seite ${progress.currentPage} von ${progress.totalPages})…`);
      } else {
        setOcrStatus("Texterkennung läuft…");
      }
    }).then((stop) => {
      if (cancelled) {
        stop();
        return;
      }
      unlisten = stop;
    });
    const jsonStore = isTauriRuntime()
      ? { load: () => loadNamingRulesJson(), save: (json: string) => saveNamingRulesJson(json) }
      : null;
    const learnedJsonStore = isTauriRuntime()
      ? { load: () => loadLearnedSendersJson(), save: (json: string) => saveLearnedSendersJson(json) }
      : null;
    const inspectStarted = typeof performance !== "undefined" ? performance.now() : Date.now();
    void Promise.all([
      inspectDocumentText(scanId, node.id),
      hydrateNamingRuleStore(jsonStore),
      hydrateLearnedSenderStore(learnedJsonStore),
    ])
      .then(([next, store, learned]) => {
        if (cancelled) {
          return;
        }
        const elapsed = Math.max(0, Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - inspectStarted));
        inspectMsRef.current = elapsed;
        setView(next);
        setRules(store);
        setLearnedStore(learned);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(toUserError(cause));
          publishNameSuggestTimings({
            ...emptyLocalAiTimings(),
            inspectMs: inspectMsRef.current,
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setOcrStatus(null);
        }
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [open, scanId, node === null || !isFile(node) ? null : node.id]);

  const senderCue = view === null ? null : senderLearningCue(aiFields?.absender ?? null, view.text ?? "");
  const learnedAbsender =
    view === null
      ? { absender: null as string | null, learned: false }
      : applyLearnedSender(aiFields?.absender ?? null, view.text ?? "", learnedStore, overrides.absender);
  const plan = useMemo(() => {
    if (view === null || node === null || !isFile(node)) {
      return null;
    }
    const base = planNameSuggestion(node.name, view, rules.rules, overrides);
    if (base.source === "rule") {
      return base;
    }
    if (aiFields !== null && hasLocalAiNameFields(aiFields)) {
      const fields = learnedAbsender.learned
        ? { ...aiFields, absender: learnedAbsender.absender }
        : aiFields;
      return planAiNameSuggestion(node.name, view, fields, overrides);
    }
    return base;
  }, [view, node, rules, overrides, aiFields, learnedAbsender.learned, learnedAbsender.absender]);

  useEffect(() => {
    if (!open || view === null || node === null || !isFile(node) || !isTauriRuntime()) {
      return;
    }
    let cancelled = false;
    const prefsStore = {
      load: () => loadLocalAiPrefsJson(),
      save: (json: string) => saveLocalAiPrefsJson(json),
    };
    void (async () => {
      const prefsStarted = typeof performance !== "undefined" ? performance.now() : Date.now();
      const prefs = await hydrateLocalAiPrefs(prefsStore);
      const prefsMs = Math.max(
        0,
        Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - prefsStarted),
      );
      if (cancelled) {
        return;
      }
      if (!shouldUseLocalAiFallback(rules.rules, view, prefs)) {
        publishNameSuggestTimings({
          ...emptyLocalAiTimings(),
          inspectMs: inspectMsRef.current,
          prefsMs,
          textSource: view.source,
          textChars: view.text?.length ?? 0,
          ocrAttempted: view.ocrAttempted === true,
          used: false,
        });
        return;
      }
      const cached = hasCachedLocalAiResult(prefs.model, node.name, documentTextForAi(view));
      setAiStatus(
        cached
          ? "Gespeicherter KI-Vorschlag wird verwendet…"
          : "Lokale KI erzeugt einen Namensvorschlag…",
      );
      const result = await requestLocalAiNameFields(
        createLocalAiClient(),
        prefs,
        node.name,
        view,
        rules.rules,
      );
      result.timings.inspectMs = inspectMsRef.current;
      result.timings.prefsMs = prefsMs;
      result.timings.textSource = view.source;
      result.timings.textChars = view.text?.length ?? 0;
      result.timings.ocrAttempted = view.ocrAttempted === true;
      publishNameSuggestTimings(result.timings);
      if (cancelled) {
        return;
      }
      setAiFields(result.fields);
      setOverrides((current) => keepManualOverrides(current, result.fields));
      setAiStatus(null);
      setAiNotice(result.fields === null ? result.message : null);
    })().catch(() => {
      if (!cancelled) {
        setAiStatus(null);
        setAiNotice("Die lokale KI ist fehlgeschlagen. Es wird der Standardvorschlag verwendet.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, view, node === null || !isFile(node) ? null : node.id, node === null || !isFile(node) ? "" : node.name, rules]);

  useEffect(() => {
    if (plan === null || nameTouched) {
      return;
    }
    setNameValue((current) =>
      nextAutoSuggestedFileName({
        nameTouched,
        suggestedName: plan.suggestedName,
        currentName: current,
      }),
    );
  }, [plan, nameTouched]);

  const extractedDateIso = documentDateFieldIso({
    override: overrides.datum,
    resolution: plan?.resolution ?? null,
    fileName: node !== null && isFile(node) ? node.name : "",
  });

  useEffect(() => {
    if (dateEditedRef.current || extractedDateIso === null) {
      return;
    }
    setDateDraft((current) => (current.trim().length > 0 ? current : formatGermanDocumentDate(extractedDateIso)));
  }, [extractedDateIso]);

  if (!open || node === null || !isFile(node)) {
    return null;
  }
  const selectedFile = node;
  const resolution: DocumentDateResolution | null = plan?.resolution ?? null;
  const needsDate = plan !== null && plan.missing.includes("datum");
  const defaultNeedsDate = plan?.source === "default" && (resolution === null || nameSuggestNeedsUserDate(resolution));
  const showDateChoices = needsDate || defaultNeedsDate;
  const choices = resolution === null ? [] : uniqueDocumentDateChoices(resolution.hits);
  const extraFields =
    plan === null
      ? []
      : plan.source === "rule" && plan.rule !== null
        ? schemaPlaceholders(plan.rule.schema).known.filter((item) => EXTRA_PLACEHOLDERS.includes(item))
        : EXTRA_PLACEHOLDERS;
  const fieldsToShow =
    extraFields.includes("absender") || senderCue !== null || learnedAbsender.learned
      ? extraFields.includes("absender")
        ? extraFields
        : (["absender", ...extraFields] as typeof extraFields)
      : extraFields;
  const displayedAbsender = nameSuggestFieldValue(overrides.absender, plan?.values.absender);
  const showRemember = canRememberSender(senderCue, displayedAbsender);
  const calendarValue = calendarInputValue(extractedDateIso);
  const showDateField = plan !== null;

  function applyDate(iso: string) {
    dateEditedRef.current = true;
    setDateError(null);
    setDateDraft(formatGermanDocumentDate(iso));
    setOverrides((current) => ({ ...current, datum: iso }));
  }

  function handleDiagnose() {
    if (view === null || diagnoseBusy) {
      return;
    }
    setDiagnoseBusy(true);
    setDiagnoseNotice(null);
    const prefsStore = {
      load: () => loadLocalAiPrefsJson(),
      save: (json: string) => saveLocalAiPrefsJson(json),
    };
    void (async () => {
      const prefs = isTauriRuntime() ? await hydrateLocalAiPrefs(prefsStore) : { version: 1, enabled: false, model: "" };
      const snapshot = await runNameSuggestDiagnose({
        fileName: selectedFile.name,
        view,
        prefs,
        client: isTauriRuntime() && prefs.enabled ? createLocalAiClient() : null,
      });
      setDiagnose(snapshot);
      setDiagnoseNotice(
        "Der Dokumenttext steht nur in diesem Fenster. Er wird nicht ins Laufzeitprotokoll geschrieben. Ist die lokale KI eingeschaltet, wird sie für diese Prüfung erneut befragt.",
      );
    })()
      .catch((cause) => {
        setDiagnoseNotice(cause instanceof Error ? cause.message : "Die Textprüfung ist fehlgeschlagen.");
      })
      .finally(() => setDiagnoseBusy(false));
  }

  function copyDiagnose() {
    if (diagnose === null) {
      return;
    }
    void navigator.clipboard?.writeText(diagnose.copyText).catch(() => undefined);
  }

  function applyDateCommit(commit: ReturnType<typeof commitNameSuggestDateInput>) {
    dateEditedRef.current = true;
    setDateDraft(commit.draft);
    setDateError(commit.error);
    if (commit.action === "keep") {
      return;
    }
    setOverrides((current) => {
      const next = { ...current };
      if (commit.action === "set" && commit.iso !== null) {
        next.datum = commit.iso;
      } else {
        delete next.datum;
      }
      return next;
    });
  }

  function handleDateTextChange(value: string) {
    applyDateCommit(commitNameSuggestDateInput(overrides.datum ?? null, value));
  }

  function handleCalendarChange(value: string) {
    applyDateCommit(commitCalendarDateInput(overrides.datum ?? null, value));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (applyBusy) {
      return;
    }
    if (loading) {
      const reason = "Der Dokumentinhalt wird noch gelesen. Die Umbenennung wurde nicht ausgeführt.";
      setApplyIssue(reason);
      onIssue?.(reason);
      return;
    }
    const typedName = nameValue.trim().length > 0 ? nameValue : (plan?.suggestedName ?? selectedFile.name);
    const prepared = prepareNameSuggestApply(scanRoot, selectedFile, selectedFile.name, typedName);
    if (prepared.status !== "ready") {
      setApplyIssue(prepared.reason);
      onIssue?.(prepared.reason);
      return;
    }
    setApplyIssue(null);
    setApplyBusy(true);
    try {
      const applied = await onApply(prepared.request);
      if (!applied.ok) {
        setApplyIssue(applied.reason);
        onIssue?.(applied.reason);
        return;
      }
      const confirmedAbsender = overrides.absender ?? plan?.values.absender ?? "";
      if (
        shouldPersistSenderMapping({
          remember: rememberSender,
          renameOk: true,
          from: senderCue,
          to: confirmedAbsender,
        })
      ) {
        const next = rememberSenderMapping(learnedStore, senderCue ?? "", confirmedAbsender);
        if (next.ok) {
          setLearnedStore(next.store);
          const learnedJsonStore = isTauriRuntime()
            ? { load: () => loadLearnedSendersJson(), save: (json: string) => saveLearnedSendersJson(json) }
            : null;
          try {
            await persistLearnedSenderStore(next.store, learnedJsonStore);
          } catch (cause) {
            onIssue?.(cause instanceof Error ? cause.message : "Die Absenderzuordnung konnte nicht gespeichert werden.");
          }
        }
      }
      onClose();
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "Die Umbenennung wurde nicht ausgeführt.";
      setApplyIssue(reason);
      onIssue?.(reason);
    } finally {
      setApplyBusy(false);
    }
  }

  return (
    <div
      className="report-dialog-backdrop name-suggest-backdrop"
      onMouseDown={() => {
        if (!applyBusy) {
          onClose();
        }
      }}
    >
      <form
        className={diagnose !== null ? "report-dialog name-suggest-dialog name-suggest-dialog-diagnose" : "report-dialog name-suggest-dialog"}
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            if (!applyBusy) {
              onClose();
            }
          }
        }}
      >
        <h2 id={titleId}>Namensvorschlag</h2>
        <p className="muted">Datei: {node.name}</p>
        {loading ? (
          <p className="muted">
            {ocrStatus ?? "Dokumentinhalt wird gelesen. Bei Scans und Bildern kann die Texterkennung etwas dauern."}
          </p>
        ) : null}
        {error !== null ? <p className="report-dialog-error">{error}</p> : null}
        {aiStatus !== null ? <p className="muted">{aiStatus}</p> : null}
        {aiNotice !== null ? <p className="muted">{aiNotice}</p> : null}
        {timingLine !== null ? <p className="muted name-suggest-timing">{timingLine}</p> : null}
        {!loading && error === null && plan !== null && resolution !== null ? (
          <>
            <p className="report-dialog-hint">Vorschlag aus: {nameSuggestSourceLabel(plan)}</p>
            {learnedAbsender.learned && plan.source !== "rule" ? (
              <p className="muted">Absender aus bestätigter Zuordnung</p>
            ) : null}
            {plan.source === "rule" && plan.rule !== null ? (
              <p className="muted">Regel: {plan.rule.name}</p>
            ) : null}
            {plan.source === "rule" && plan.rule !== null ? (
              <p className="muted">Schema: {plan.rule.schema}</p>
            ) : (
              <p className="muted">
                {resolution.status === "confident"
                  ? `Dokumentdatum ${resolution.iso} aus Fundstelle: ${resolution.evidence.snippet}`
                  : resolution.reason}
              </p>
            )}
            {view !== null && view.format !== null ? (
              <p className="muted">
                Quelle: {view.format.toUpperCase()} ({isOcrTextSource(view) ? "Texterkennung" : view.source})
              </p>
            ) : null}
            {showDateField ? (
              <div className="report-dialog-field">
                <label htmlFor={dateId}>Dokumentdatum</label>
                <div className="name-suggest-date-row">
                  <input
                    id={dateId}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="TT.MM.JJJJ"
                    value={dateDraft}
                    onChange={(event) => handleDateTextChange(event.target.value)}
                    spellCheck={false}
                  />
                  <input
                    className="name-suggest-date-picker"
                    type="date"
                    aria-label="Datum im Kalender wählen"
                    value={calendarValue}
                    onChange={(event) => handleCalendarChange(event.target.value)}
                  />
                </div>
                {dateError !== null ? <p className="report-dialog-error">{dateError}</p> : null}
              </div>
            ) : null}
            {showDateChoices && choices.length > 0 ? (
              <div className="name-suggest-choices">
                {choices.map((choice) => (
                  <button
                    key={`${choice.iso}-${choice.startIndex}`}
                    type="button"
                    title={choice.snippet}
                    onClick={() => applyDate(choice.iso)}
                  >
                    {choice.iso}
                  </button>
                ))}
              </div>
            ) : null}
            {fieldsToShow.map((placeholder) => (
              <div className="report-dialog-field" key={placeholder}>
                <label htmlFor={`name-suggest-${placeholder}`}>{NAMING_PLACEHOLDER_LABELS[placeholder]}</label>
                <input
                  id={`name-suggest-${placeholder}`}
                  type="text"
                  value={nameSuggestFieldValue(overrides[placeholder], plan.values[placeholder])}
                  onChange={(event) => {
                    const value = event.target.value;
                    setOverrides((current) => ({ ...current, [placeholder]: value }));
                  }}
                />
              </div>
            ))}
            {showRemember ? (
              <label className="check">
                <input
                  type="checkbox"
                  checked={rememberSender}
                  onChange={(event) => setRememberSender(event.target.checked)}
                />
                <span>Absenderzuordnung für zukünftige Dokumente merken</span>
              </label>
            ) : null}
            <div className="report-dialog-field">
              <label htmlFor={nameId}>Vorgeschlagener Dateiname</label>
              <input
                id={nameId}
                type="text"
                value={nameValue}
                onChange={(event) => {
                  setNameTouched(true);
                  setApplyIssue(null);
                  setNameValue(event.target.value);
                }}
                spellCheck={false}
              />
            </div>
            {applyIssue !== null ? <p className="report-dialog-error">{applyIssue}</p> : null}
          </>
        ) : null}
        {diagnoseNotice !== null ? <p className="muted">{diagnoseNotice}</p> : null}
        {diagnose !== null ? (
          <div className="name-suggest-diagnose">
            <label htmlFor={`${nameId}-diagnose`}>Textprüfung</label>
            <textarea
              id={`${nameId}-diagnose`}
              className="name-suggest-diagnose-text"
              readOnly
              spellCheck={false}
              value={diagnose.copyText}
            />
          </div>
        ) : null}
        <div className="report-dialog-actions">
          <button type="button" onClick={handleDiagnose} disabled={loading || view === null || diagnoseBusy}>
            {diagnoseBusy ? "Text wird geprüft…" : "Text prüfen"}
          </button>
          {diagnose !== null ? (
            <button type="button" onClick={copyDiagnose}>
              Textprüfung kopieren
            </button>
          ) : null}
          <button type="button" onClick={onClose} disabled={applyBusy}>
            Abbrechen
          </button>
          <button type="submit" disabled={loading || error !== null || applyBusy}>
            {applyBusy ? "Wird umbenannt…" : "Übernehmen"}
          </button>
        </div>
      </form>
    </div>
  );
}
