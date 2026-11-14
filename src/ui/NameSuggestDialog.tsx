import { useEffect, useId, useMemo, useState, type FormEvent } from "react";

import { isFile, type FsNode } from "../model";
import { subscribeOcrProgress, toUserError } from "../scan";
import { inspectDocumentText } from "./documentTextApi";
import {
  applySuggestedFileName,
  hydrateNamingRuleStore,
  NAMING_PLACEHOLDER_LABELS,
  planNameSuggestion,
  schemaPlaceholders,
  type NamingPlaceholder,
  type NamingRuleStore,
} from "./namingRules";
import { loadNamingRulesJson, saveNamingRulesJson } from "./namingRulesApi";
import {
  isOcrTextSource,
  nameSuggestNeedsUserDate,
  parseUserDocumentDate,
  uniqueDocumentDateChoices,
  workbenchNameSuggestRequest,
  type DocumentDateResolution,
  type DocumentTextView,
} from "./treeWorkbenchNameSuggest";
import type { WorkbenchRenameRequest } from "./treeWorkbenchRename";
import { isTauriRuntime } from "./workbenchPrefsApi";

interface NameSuggestDialogProps {
  open: boolean;
  scanId: number | null;
  scanRoot: string;
  node: FsNode | null;
  onClose: () => void;
  onApply: (request: WorkbenchRenameRequest) => void;
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
  const [nameValue, setNameValue] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [applyIssue, setApplyIssue] = useState<string | null>(null);
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);

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
    setOcrStatus(null);
    setApplyIssue(null);
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
    void Promise.all([inspectDocumentText(scanId, node.id), hydrateNamingRuleStore(jsonStore)])
      .then(([next, store]) => {
        if (cancelled) {
          return;
        }
        setView(next);
        setRules(store);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(toUserError(cause));
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
  }, [open, scanId, node]);

  const plan = useMemo(() => {
    if (view === null || node === null || !isFile(node)) {
      return null;
    }
    return planNameSuggestion(node.name, view, rules.rules, overrides);
  }, [view, node, rules, overrides]);

  useEffect(() => {
    if (plan === null || nameTouched) {
      return;
    }
    if (plan.suggestedName !== null) {
      setNameValue(plan.suggestedName);
    } else if (node !== null && isFile(node)) {
      setNameValue(node.name);
    }
  }, [plan, nameTouched, node]);

  if (!open || node === null || !isFile(node)) {
    return null;
  }
  const selectedFile = node;
  const resolution: DocumentDateResolution | null = plan?.resolution ?? null;
  const needsDate = plan !== null && plan.missing.includes("datum");
  const defaultNeedsDate = plan?.source === "default" && (resolution === null || nameSuggestNeedsUserDate(resolution));
  const showDate = needsDate || defaultNeedsDate;
  const choices = resolution === null ? [] : uniqueDocumentDateChoices(resolution.hits);
  const extraFields =
    plan?.source === "rule" && plan.rule !== null
      ? schemaPlaceholders(plan.rule.schema).known.filter((item) => EXTRA_PLACEHOLDERS.includes(item))
      : [];
  const dateValue = overrides.datum ?? plan?.values.datum ?? "";

  function applyDate(iso: string) {
    setOverrides((current) => ({ ...current, datum: iso }));
  }

  function handleDateChange(value: string) {
    const iso = parseUserDocumentDate(value);
    setOverrides((current) => {
      const next = { ...current };
      if (iso !== null) {
        next.datum = iso;
      } else {
        delete next.datum;
      }
      return next;
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (loading) {
      return;
    }
    const typedName = nameValue.trim().length > 0 ? nameValue : (plan?.suggestedName ?? selectedFile.name);
    const preparedName = applySuggestedFileName(selectedFile.name, typedName);
    if (!preparedName.ok) {
      if (preparedName.unchanged) {
        onClose();
        return;
      }
      setApplyIssue(preparedName.reason);
      onIssue?.(preparedName.reason);
      return;
    }
    const prepared = workbenchNameSuggestRequest(scanRoot, selectedFile, preparedName.fileName);
    if (!prepared.ok) {
      if (prepared.unchanged) {
        onClose();
        return;
      }
      setApplyIssue(prepared.reason);
      onIssue?.(prepared.reason);
      return;
    }
    setApplyIssue(null);
    onApply(prepared.request);
  }

  return (
    <div className="report-dialog-backdrop name-suggest-backdrop" onMouseDown={onClose}>
      <form
        className="report-dialog name-suggest-dialog"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
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
        {!loading && error === null && plan !== null && resolution !== null ? (
          <>
            {plan.source === "rule" && plan.rule !== null ? (
              <p className="report-dialog-hint">Regel: {plan.rule.name}</p>
            ) : (
              <p className="report-dialog-hint">
                {resolution.status === "confident"
                  ? `Dokumentdatum ${resolution.iso} aus Fundstelle: ${resolution.evidence.snippet}`
                  : resolution.reason}
              </p>
            )}
            {plan.source === "rule" && plan.rule !== null ? (
              <p className="muted">Schema: {plan.rule.schema}</p>
            ) : null}
            {view !== null && view.format !== null ? (
              <p className="muted">
                Quelle: {view.format.toUpperCase()} ({isOcrTextSource(view) ? "Texterkennung" : view.source})
              </p>
            ) : null}
            {showDate ? (
              <div className="report-dialog-field">
                <label htmlFor={dateId}>Dokumentdatum</label>
                <input
                  id={dateId}
                  type="date"
                  value={dateValue}
                  onChange={(event) => handleDateChange(event.target.value)}
                />
              </div>
            ) : null}
            {showDate && choices.length > 0 ? (
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
            {extraFields.map((placeholder) => (
              <div className="report-dialog-field" key={placeholder}>
                <label htmlFor={`name-suggest-${placeholder}`}>{NAMING_PLACEHOLDER_LABELS[placeholder]}</label>
                <input
                  id={`name-suggest-${placeholder}`}
                  type="text"
                  value={overrides[placeholder] ?? plan.values[placeholder] ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    setOverrides((current) => ({ ...current, [placeholder]: value }));
                  }}
                />
              </div>
            ))}
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
        <div className="report-dialog-actions">
          <button type="button" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" disabled={loading || error !== null}>
            Übernehmen
          </button>
        </div>
      </form>
    </div>
  );
}
