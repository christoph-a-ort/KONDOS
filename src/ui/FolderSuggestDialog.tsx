import { useEffect, useId, useState } from "react";

import { isFile, type DirectoryNode, type FsNode } from "../model";
import { subscribeOcrProgress, toUserError } from "../scan";
import { inspectDocumentText } from "./documentTextApi";
import { hydrateLearnedSenderStore, type LearnedSenderStore } from "./learnedSenders";
import { loadLearnedSendersJson, saveLearnedSendersJson } from "./learnedSendersApi";
import {
  calendarInputValue,
  commitCalendarDateInput,
  commitNameSuggestDateInput,
  formatGermanDocumentDate,
} from "./nameSuggestForm";
import {
  FOLDER_SUGGEST_ALREADY_HERE,
  FOLDER_SUGGEST_DATE_HINT,
  FOLDER_SUGGEST_NEW,
  FOLDER_SUGGEST_NO_CREATE,
  FOLDER_SUGGEST_NO_MOVE,
  FOLDER_SUGGEST_YEAR_UNKNOWN,
  folderSuggestShowsDateField,
  planFolderSuggestions,
  type FolderSuggestOutcome,
  type FolderSuggestion,
} from "./treeWorkbenchFolderSuggest";
import {
  isOcrTextSource,
  preferredAskIso,
  uniqueDocumentDateChoices,
  type DocumentTextView,
} from "./treeWorkbenchNameSuggest";
import { isTauriRuntime } from "./workbenchPrefsApi";

interface FolderSuggestDialogProps {
  open: boolean;
  scanId: number | null;
  scanRoot: string;
  root: DirectoryNode;
  node: FsNode | null;
  onClose: () => void;
}

export function FolderSuggestDialog({
  open,
  scanId,
  scanRoot,
  root,
  node,
  onClose,
}: FolderSuggestDialogProps) {
  const titleId = useId();
  const dateId = useId();
  const [loading, setLoading] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<DocumentTextView | null>(null);
  const [learned, setLearned] = useState<LearnedSenderStore | null>(null);
  const [confirmedIso, setConfirmedIso] = useState<string | null>(null);
  const [dateDraft, setDateDraft] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<FolderSuggestOutcome | null>(null);

  useEffect(() => {
    if (!open || node === null || !isFile(node) || scanId === null) {
      setLoading(false);
      setOcrStatus(null);
      setError(null);
      setView(null);
      setLearned(null);
      setConfirmedIso(null);
      setDateDraft("");
      setDateError(null);
      setOutcome(null);
      return;
    }
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    setLoading(true);
    setOcrStatus(null);
    setError(null);
    setView(null);
    setLearned(null);
    setConfirmedIso(null);
    setDateDraft("");
    setDateError(null);
    setOutcome(null);
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
    const learnedJsonStore = isTauriRuntime()
      ? { load: () => loadLearnedSendersJson(), save: (json: string) => saveLearnedSendersJson(json) }
      : null;
    void Promise.all([inspectDocumentText(scanId, node.id), hydrateLearnedSenderStore(learnedJsonStore)])
      .then(([nextView, nextLearned]: [DocumentTextView, LearnedSenderStore]) => {
        if (cancelled) {
          return;
        }
        setView(nextView);
        setLearned(nextLearned);
        const planned = planFolderSuggestions({
          scanRoot,
          root,
          source: node,
          view: nextView,
          learnedStore: nextLearned,
          confirmedIso: null,
        });
        setOutcome(planned);
        const offered = planned.cues.dateResolution === null ? "" : preferredAskIso(planned.cues.dateResolution);
        setDateDraft(offered.length > 0 ? formatGermanDocumentDate(offered) : "");
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
  }, [open, scanId, scanRoot, node === null || !isFile(node) ? null : node.id]);

  if (!open || node === null || !isFile(node)) {
    return null;
  }
  const source = node;

  function applyConfirmedIso(iso: string | null) {
    setConfirmedIso(iso);
    if (view === null || learned === null) {
      return;
    }
    setOutcome(
      planFolderSuggestions({
        scanRoot,
        root,
        source,
        view,
        learnedStore: learned,
        confirmedIso: iso,
      }),
    );
  }

  function applyDateCommit(commit: ReturnType<typeof commitNameSuggestDateInput>) {
    setDateDraft(commit.draft);
    setDateError(commit.error);
    if (commit.action === "keep") {
      return;
    }
    applyConfirmedIso(commit.action === "set" ? commit.iso : null);
  }

  const showDateField = outcome !== null && folderSuggestShowsDateField(outcome);
  const choices = outcome?.cues.dateResolution == null ? [] : uniqueDocumentDateChoices(outcome.cues.dateResolution.hits);

  return (
    <div className="report-dialog-backdrop folder-suggest-backdrop" onMouseDown={onClose}>
      <div
        className="report-dialog folder-suggest-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <h2 id={titleId}>Ordner vorschlagen</h2>
        <p className="muted">Datei: {node.name}</p>
        {loading ? (
          <p className="muted">
            {ocrStatus ?? "Dokumentinhalt wird gelesen. Vorhandene Analyseergebnisse und der ContentCache werden wiederverwendet."}
          </p>
        ) : null}
        {error !== null ? <p className="report-dialog-error">{error}</p> : null}
        {!loading && error === null && outcome !== null ? <FolderSuggestCues outcome={outcome} view={view} /> : null}
        {showDateField ? (
          <div className="report-dialog-field">
            <p className="muted">{FOLDER_SUGGEST_DATE_HINT}</p>
            <label htmlFor={dateId}>Dokumentdatum</label>
            <div className="name-suggest-date-row">
              <input
                id={dateId}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="TT.MM.JJJJ"
                value={dateDraft}
                onChange={(event) => applyDateCommit(commitNameSuggestDateInput(confirmedIso, event.target.value))}
                spellCheck={false}
              />
              <input
                className="name-suggest-date-picker"
                type="date"
                aria-label="Datum im Kalender wählen"
                value={calendarInputValue(confirmedIso)}
                onChange={(event) => applyDateCommit(commitCalendarDateInput(confirmedIso, event.target.value))}
              />
            </div>
            {dateError !== null ? <p className="report-dialog-error">{dateError}</p> : null}
            {choices.length > 0 ? (
              <div className="name-suggest-choices">
                {choices.map((choice) => (
                  <button
                    key={`${choice.iso}-${choice.startIndex}`}
                    type="button"
                    title={choice.snippet}
                    onClick={() => {
                      setDateDraft(formatGermanDocumentDate(choice.iso));
                      setDateError(null);
                      applyConfirmedIso(choice.iso);
                    }}
                  >
                    {choice.iso}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {!loading && error === null && outcome !== null ? <FolderSuggestBody outcome={outcome} /> : null}
        <p className="report-dialog-hint">{FOLDER_SUGGEST_NO_MOVE}</p>
        {outcome?.status === "newFolder" ? <p className="report-dialog-hint">{FOLDER_SUGGEST_NO_CREATE}</p> : null}
        <div className="report-dialog-actions">
          <button type="button" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}

function FolderSuggestCues({
  outcome,
  view,
}: {
  outcome: FolderSuggestOutcome;
  view: DocumentTextView | null;
}) {
  const resolution = outcome.cues.dateResolution;
  const sourceLabel =
    view === null
      ? null
      : view.format !== null
        ? `${view.format.toUpperCase()} (${isOcrTextSource(view) ? "Texterkennung" : view.source})`
        : isOcrTextSource(view)
          ? "Texterkennung"
          : view.source;
  return (
    <>
      {outcome.cues.dokumenttyp !== null ? <p className="muted">Dokumentart: {outcome.cues.dokumenttyp}</p> : null}
      {outcome.cues.absender !== null ? (
        <p className="muted">
          Absender: {outcome.cues.absender}
          {outcome.cues.learnedAbsender ? " (gelernte Zuordnung)" : ""}
        </p>
      ) : null}
      {outcome.cues.documentYear !== null ? (
        <p className="muted">
          Dokumentjahr: {outcome.cues.documentYear}
          {outcome.cues.documentDateStatus === "confirmed" ? " (bestätigt)" : ""}
          {outcome.cues.documentDateStatus === "confident" ? " (sicher erkannt)" : ""}
        </p>
      ) : null}
      {sourceLabel !== null ? <p className="muted">Quelle: {sourceLabel}</p> : null}
      {resolution !== null && resolution.status === "ask" ? <p className="muted">{resolution.reason}</p> : null}
      {resolution !== null && resolution.status === "confident" ? (
        <p className="muted">Dokumentdatum {resolution.iso} aus Fundstelle: {resolution.evidence.snippet}</p>
      ) : null}
    </>
  );
}

function FolderSuggestItem({ item }: { item: FolderSuggestion }) {
  return (
    <li className="folder-suggest-item">
      <p className="folder-suggest-path" title={item.path}>
        {item.path}
      </p>
      <p className="folder-suggest-summary">{item.summary}</p>
      <ul className="folder-suggest-reasons">
        {item.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </li>
  );
}

function FolderSuggestBody({ outcome }: { outcome: FolderSuggestOutcome }) {
  if (outcome.status === "alreadyHere") {
    return (
      <>
        <p className="folder-suggest-summary">{FOLDER_SUGGEST_ALREADY_HERE}</p>
        <ul className="folder-suggest-list">
          {outcome.suggestions.map((item) => (
            <FolderSuggestItem key={item.path} item={item} />
          ))}
        </ul>
      </>
    );
  }
  if (outcome.status === "yearUnknown") {
    return <p className="folder-suggest-summary">{FOLDER_SUGGEST_YEAR_UNKNOWN}</p>;
  }
  if (outcome.status === "newFolder") {
    const proposal = outcome.newFolder;
    return (
      <>
        <h3 className="folder-suggest-summary">{FOLDER_SUGGEST_NEW}</h3>
        <p className="folder-suggest-new-note">Der Ordner existiert noch nicht.</p>
        <div className="folder-suggest-item folder-suggest-new">
          <p className="folder-suggest-meta">Elternordner: {proposal.parentPath}</p>
          <p className="folder-suggest-meta">Neuer Ordnername: {proposal.folderName}</p>
          <p className="folder-suggest-path" title={proposal.path}>
            Zielpfad: {proposal.path}
          </p>
          <ul className="folder-suggest-reasons">
            {proposal.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      </>
    );
  }
  if (outcome.status !== "suggestions") {
    return <p className="report-dialog-error">{outcome.reason}</p>;
  }
  return (
    <ul className="folder-suggest-list">
      {outcome.suggestions.map((item) => (
        <FolderSuggestItem key={item.path} item={item} />
      ))}
    </ul>
  );
}
