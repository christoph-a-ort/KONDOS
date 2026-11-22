import { useEffect, useId, useState } from "react";

import { isFile, type DirectoryNode, type FsNode } from "../model";
import { subscribeOcrProgress, toUserError } from "../scan";
import { inspectDocumentText } from "./documentTextApi";
import { hydrateLearnedSenderStore, type LearnedSenderStore } from "./learnedSenders";
import { loadLearnedSendersJson, saveLearnedSendersJson } from "./learnedSendersApi";
import {
  FOLDER_SUGGEST_ALREADY_HERE,
  FOLDER_SUGGEST_NO_MOVE,
  FOLDER_SUGGEST_UNCLEAR,
  planFolderSuggestions,
  type FolderSuggestOutcome,
} from "./treeWorkbenchFolderSuggest";
import type { DocumentTextView } from "./treeWorkbenchNameSuggest";
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
  const [loading, setLoading] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<FolderSuggestOutcome | null>(null);

  useEffect(() => {
    if (!open || node === null || !isFile(node) || scanId === null) {
      setLoading(false);
      setOcrStatus(null);
      setError(null);
      setOutcome(null);
      return;
    }
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    setLoading(true);
    setOcrStatus(null);
    setError(null);
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
      .then(([view, learned]: [DocumentTextView, LearnedSenderStore]) => {
        if (cancelled) {
          return;
        }
        setOutcome(
          planFolderSuggestions({
            scanRoot,
            root,
            source: node,
            view,
            learnedStore: learned,
          }),
        );
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
        {!loading && error === null && outcome !== null ? <FolderSuggestBody outcome={outcome} /> : null}
        <p className="report-dialog-hint">{FOLDER_SUGGEST_NO_MOVE}</p>
        <div className="report-dialog-actions">
          <button type="button" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}

function FolderSuggestCues({ outcome }: { outcome: FolderSuggestOutcome }) {
  return (
    <>
      {outcome.cues.dokumenttyp !== null ? <p className="muted">Dokumentart: {outcome.cues.dokumenttyp}</p> : null}
      {outcome.cues.absender !== null ? (
        <p className="muted">
          Absender: {outcome.cues.absender}
          {outcome.cues.learnedAbsender ? " (gelernte Zuordnung)" : ""}
        </p>
      ) : null}
      {outcome.cues.documentYear !== null ? <p className="muted">Dokumentjahr: {outcome.cues.documentYear}</p> : null}
    </>
  );
}

function FolderSuggestItem({ item }: { item: FolderSuggestOutcome["suggestions"][number] }) {
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
        <FolderSuggestCues outcome={outcome} />
        <p className="folder-suggest-summary">{FOLDER_SUGGEST_ALREADY_HERE}</p>
        <ul className="folder-suggest-list">
          {outcome.suggestions.map((item) => (
            <FolderSuggestItem key={item.path} item={item} />
          ))}
        </ul>
      </>
    );
  }
  if (outcome.status !== "suggestions") {
    return (
      <>
        <FolderSuggestCues outcome={outcome} />
        <p className="report-dialog-error">{outcome.status === "unclear" ? FOLDER_SUGGEST_UNCLEAR : outcome.reason}</p>
      </>
    );
  }
  return (
    <>
      <FolderSuggestCues outcome={outcome} />
      <ul className="folder-suggest-list">
        {outcome.suggestions.map((item) => (
          <FolderSuggestItem key={item.path} item={item} />
        ))}
      </ul>
    </>
  );
}

