import { useEffect, useId, useState, type FormEvent } from "react";

import { isFile, type FsNode } from "../model";
import { toUserError } from "../scan";
import { inspectDocumentText } from "./documentTextApi";
import {
  buildDatedFileName,
  nameSuggestNeedsUserDate,
  parseUserDocumentDate,
  resolveDocumentDateFromView,
  uniqueDocumentDateChoices,
  workbenchNameSuggestRequest,
  type DocumentDateResolution,
  type DocumentTextView,
} from "./treeWorkbenchNameSuggest";
import type { WorkbenchRenameRequest } from "./treeWorkbenchRename";

interface NameSuggestDialogProps {
  open: boolean;
  scanId: number | null;
  scanRoot: string;
  node: FsNode | null;
  onClose: () => void;
  onApply: (request: WorkbenchRenameRequest) => void;
  onIssue?: (message: string) => void;
}

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
  const [resolution, setResolution] = useState<DocumentDateResolution | null>(null);
  const [dateValue, setDateValue] = useState("");
  const [nameValue, setNameValue] = useState("");

  useEffect(() => {
    if (!open || node === null || !isFile(node) || scanId === null) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setView(null);
    setResolution(null);
    setDateValue("");
    setNameValue(node.name);
    void inspectDocumentText(scanId, node.id)
      .then((next) => {
        if (cancelled) {
          return;
        }
        const resolved = resolveDocumentDateFromView(next);
        setView(next);
        setResolution(resolved);
        if (resolved.status === "confident") {
          setDateValue(resolved.iso);
          setNameValue(buildDatedFileName(node.name, resolved.iso));
        } else {
          setDateValue("");
          setNameValue(node.name);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(toUserError(cause));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, scanId, node]);

  if (!open || node === null || !isFile(node)) {
    return null;
  }
  const selectedFile = node;

  const needsDate = resolution === null || nameSuggestNeedsUserDate(resolution);
  const choices = resolution === null ? [] : uniqueDocumentDateChoices(resolution.hits);

  function applyDate(iso: string) {
    setDateValue(iso);
    setNameValue(buildDatedFileName(selectedFile.name, iso));
  }

  function handleDateChange(value: string) {
    setDateValue(value);
    const iso = parseUserDocumentDate(value);
    if (iso !== null) {
      setNameValue(buildDatedFileName(selectedFile.name, iso));
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (loading) {
      return;
    }
    const iso = parseUserDocumentDate(dateValue);
    if (needsDate && iso === null) {
      onIssue?.("Bitte ein Dokumentdatum eingeben.");
      return;
    }
    const nextName = iso !== null ? (nameValue.trim().length > 0 ? nameValue : buildDatedFileName(selectedFile.name, iso)) : nameValue;
    const prepared = workbenchNameSuggestRequest(scanRoot, selectedFile, nextName);
    if (!prepared.ok) {
      if (prepared.unchanged) {
        onClose();
        return;
      }
      onIssue?.(prepared.reason);
      return;
    }
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
        {loading ? <p className="muted">Dokumentinhalt wird gelesen…</p> : null}
        {error !== null ? <p className="report-dialog-error">{error}</p> : null}
        {!loading && error === null && resolution !== null ? (
          <>
            {resolution.status === "confident" ? (
              <p className="report-dialog-hint">
                Dokumentdatum {resolution.iso} aus Fundstelle: {resolution.evidence.snippet}
              </p>
            ) : (
              <p className="report-dialog-hint">{resolution.reason}</p>
            )}
            {view !== null && view.format !== null ? (
              <p className="muted">Quelle: {view.format.toUpperCase()} ({view.source})</p>
            ) : null}
            {needsDate ? (
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
            {needsDate && choices.length > 0 ? (
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
            <div className="report-dialog-field">
              <label htmlFor={nameId}>Vorgeschlagener Dateiname</label>
              <input
                id={nameId}
                type="text"
                value={nameValue}
                onChange={(event) => setNameValue(event.target.value)}
                spellCheck={false}
              />
            </div>
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
