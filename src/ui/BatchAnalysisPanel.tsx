import {
  BATCH_ACTION_LABEL,
  BATCH_CANCEL_LABEL,
  BATCH_PROGRESS_TITLE,
  BATCH_STEP_CANCELLING,
  batchAnalysisOverview,
  batchProcessedCountLine,
  batchResultHintExtras,
  outcomeKindLabel,
  technicalStatusLabel,
  type BatchDocumentResult,
  type BatchProgress,
  type BatchSkip,
} from "./batchAnalysis";
import type { LogicalDocument } from "./batchDocument";

interface BatchAnalysisProgressProps {
  busy: boolean;
  progress: BatchProgress | null;
  onCancel: () => void;
}

export function BatchAnalysisProgress({ busy, progress, onCancel }: BatchAnalysisProgressProps) {
  if (!busy || progress === null) {
    return null;
  }
  const percent = progress.total === 0 ? 0 : Math.round((progress.processed / progress.total) * 100);
  const step = progress.cancelling ? BATCH_STEP_CANCELLING : progress.step;
  return (
    <div
      className="batch-analysis-progress-banner"
      role="status"
      aria-live="polite"
      aria-label={BATCH_PROGRESS_TITLE}
    >
      <h2>{BATCH_PROGRESS_TITLE}</h2>
      {progress.currentName !== null ? (
        <p className="batch-analysis-current" title={progress.currentName}>
          {progress.currentName}
        </p>
      ) : (
        <p className="muted">Keine Datei in Bearbeitung</p>
      )}
      <p className="muted">{step}</p>
      <p>{batchProcessedCountLine(progress)}</p>
      <progress max={100} value={percent}>
        {percent} %
      </progress>
      <div className="batch-analysis-actions">
        <button type="button" onClick={onCancel} disabled={progress.cancelling}>
          {BATCH_CANCEL_LABEL}
        </button>
      </div>
    </div>
  );
}

interface BatchAnalysisPanelProps {
  open: boolean;
  runId: number;
  documents: readonly LogicalDocument[];
  results: BatchDocumentResult[];
  skipped: BatchSkip[];
  onClose: () => void;
}

export function BatchAnalysisPanel({
  open,
  runId,
  documents,
  results,
  skipped,
  onClose,
}: BatchAnalysisPanelProps) {
  if (!open) {
    return null;
  }
  const { rows, summary } = batchAnalysisOverview(runId, documents, results, skipped);
  return (
    <div className="batch-analysis-panel" role="region" aria-label={BATCH_ACTION_LABEL}>
      <div className="batch-analysis-header">
        <h2>Stapelanalyse</h2>
        <p className="muted">Nur lesen. Es werden keine Dateien umbenannt, verschoben oder angelegt.</p>
      </div>
      <div className="batch-analysis-summary">
        <p>
          Ausgewählt: {summary.selected}
          {" · "}vollständig: {summary.completeProposal}
          {" · "}Rückfragen: {summary.needsDecision}
          {" · "}kein Vorschlag: {summary.noProposal}
          {" · "}bereits passend: {summary.alreadyFitting}
          {" · "}fehlgeschlagen: {summary.failed}
          {" · "}nicht analysiert: {summary.cancelled}
          {" · "}übersprungen: {summary.skipped}
        </p>
      </div>
      {skipped.length > 0 ? (
        <ul className="batch-analysis-skips">
          {skipped.map((item) => (
            <li key={`${item.path}:${item.reason}`}>
              {item.name}: {item.reason}
            </li>
          ))}
        </ul>
      ) : null}
      {rows.length > 0 ? (
        <div className="batch-analysis-table-wrap">
          <table className="batch-analysis-table">
            <thead>
              <tr>
                <th>Datei</th>
                <th>Zustand</th>
                <th>Namensvorschlag</th>
                <th>Ablage</th>
                <th>Rückfragen / Hinweise</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.document.documentId}>
                  <td title={item.document.file.path}>{item.originalName}</td>
                  <td>
                    {technicalStatusLabel(item.technicalStatus)}
                    {item.technicalStatus === "done" ? ` · ${outcomeKindLabel(item.outcomeKind)}` : ""}
                  </td>
                  <td>{item.proposedFileName ?? "—"}</td>
                  <td title={item.folderPath ?? ""}>
                    {item.newFolder && item.folderName !== null
                      ? `Neuer Ordner: ${item.folderName}`
                      : item.folderPath ?? (item.alreadyPlaced ? "bereits passend" : "—")}
                  </td>
                  <td>
                    {item.error !== null ? <span className="batch-analysis-error">{item.error}</span> : null}
                    {batchResultHintExtras(item)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="batch-analysis-actions">
        <button type="button" onClick={onClose}>
          Schließen
        </button>
      </div>
    </div>
  );
}
