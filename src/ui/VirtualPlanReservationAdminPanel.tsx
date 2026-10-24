/** P2-L.4b.2: manage bound reservation without requiring an editable plan. No file ops. */
import { useEffect, useState } from "react";
import { toUserError } from "../scan";
import {
  inspectBoundExecution, prepareBoundRelease, releaseBoundExecution, type BoundExecutionView,
} from "./virtualPlanJournalApi";
import { journalStatusLabel, parsePersistedJournal, type VirtualPlanJournal } from "./virtualPlanJournal";
import {
  RESERVATION_ADMIN_TITLE, RESERVATION_NO_AUTO_CONTINUE, RESERVATION_RELEASE_NOTICE,
  buildConfirmReleaseJournal, buildPrepareReleaseJournal, canConfirmReservationRelease,
  canPrepareReservationRelease, reservationBindingLabel, reservationLoadNotice,
  summarizeBoundReservation,
} from "./virtualPlanReservationAdmin";

export function VirtualPlanReservationAdminPanel({ scanRoot }: { scanRoot: string }) {
  const [view, setView] = useState<BoundExecutionView | null>(null);
  const [journal, setJournal] = useState<VirtualPlanJournal | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const applyView = (next: BoundExecutionView, fallback: VirtualPlanJournal | null = null) => {
    setView(next);
    const parsed = next.journalJson === null ? null : parsePersistedJournal(next.journalJson);
    setJournal(parsed ?? fallback);
    const auto = reservationLoadNotice(next, parsed);
    if (auto !== null) setNotice(auto);
    else if (next.status === "unbound" && parsed === null) setNotice(null);
    else setNotice(next.message.length > 0 ? next.message : null);
  };
  const reload = async () => {
    const next = await inspectBoundExecution(scanRoot);
    applyView(next);
    return next;
  };
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setView(null);
    setJournal(null);
    setNotice(null);
    inspectBoundExecution(scanRoot).then((next) => {
      if (cancelled) return;
      applyView(next);
    }).catch((cause) => {
      if (!cancelled) {
        setView(null);
        setJournal(null);
        setNotice(toUserError(cause));
      }
    }).finally(() => {
      if (!cancelled) setBusy(false);
    });
    return () => { cancelled = true; };
  }, [scanRoot]);
  const summary = view === null ? null : summarizeBoundReservation(view, scanRoot);
  const prepareEnabled = canPrepareReservationRelease({ view, journal, busy });
  const releaseEnabled = canConfirmReservationRelease({ view, journal, busy });
  const prepareRelease = async () => {
    if (!prepareEnabled || journal === null || view === null || view.journalRevision === null
      || view.ownerRunId === null || view.journalId === null) return;
    const payload = buildPrepareReleaseJournal(journal, view.journalRevision);
    setBusy(true);
    try {
      applyView(await prepareBoundRelease(scanRoot, payload.ownerRunId, payload.journalId, view.journalRevision, JSON.stringify(payload)), payload);
      setNotice("Freigabe vorbereitet. Noch keine Aufhebung der Reservierung.");
    } catch (cause) {
      setNotice(toUserError(cause));
      try { await reload(); } catch { /* fail-closed reload */ }
    } finally {
      setBusy(false);
    }
  };
  const confirmRelease = async () => {
    if (!releaseEnabled || journal === null || view === null || view.journalRevision === null
      || view.ownerRunId === null || view.journalId === null) return;
    const payload = buildConfirmReleaseJournal(journal, view.journalRevision);
    setBusy(true);
    try {
      applyView(await releaseBoundExecution(scanRoot, payload.ownerRunId, payload.journalId, view.journalRevision, JSON.stringify(payload)), payload);
      setNotice("Reservierung freigegeben. Keine automatische Fortsetzung und keine neue Reservierung.");
    } catch (cause) {
      setNotice(toUserError(cause));
      try { await reload(); } catch { /* fail-closed reload */ }
    } finally {
      setBusy(false);
    }
  };
  return <details className="plan-journal plan-reservation-admin">
    <summary>{RESERVATION_ADMIN_TITLE}</summary>
    <p className="muted">
      Nur Einsicht und kontrollierte Freigabe einer vorhandenen Sperre für diese Scanwurzel.
      Keine Datei- oder Ordneroperationen in diesem Bereich.
    </p>
    <p className="muted">{RESERVATION_NO_AUTO_CONTINUE}</p>
    <p className="plan-dry-run-path" title={scanRoot}>Ausgewählte Scanwurzel: {scanRoot}</p>
    {busy && view === null ? <p className="muted">Reservierung wird geprüft …</p> : null}
    {notice !== null ? <p className="plan-journal-note">{notice}</p> : null}
    {view !== null && summary === null ? (
      <p className="muted">Keine aktive Reservierung für diese Scanwurzel.</p>
    ) : null}
    {summary !== null ? <div className="plan-journal-body">
      <p><strong>Kopplung: {reservationBindingLabel(summary.bindingStatus)}</strong></p>
      <p className="plan-dry-run-path" title={summary.scanRoot}>Scanwurzel laut Journal: {summary.scanRoot}</p>
      <p>Journal-ID: {summary.journalId}</p>
      <p>Journalstatus: {journalStatusLabel(summary.journalStatus)}</p>
      <p>Reservierungsstatus (Binding): {summary.journalBindingStatus}</p>
      <p>
        Erfolgreich ausgeführt: {summary.counts.executed}
        {" · "}Ausstehend: {summary.counts.pending}
        {summary.counts.other > 0 ? ` · Sonstige Zustände: ${summary.counts.other}` : ""}
      </p>
      {summary.blockReason !== null ? <p className="plan-journal-note">{summary.blockReason}</p> : null}
      {summary.bindingStatus === "reserved" || summary.bindingStatus === "releasePrepared" ? (
        <p className="plan-execution-warning">{RESERVATION_RELEASE_NOTICE}</p>
      ) : null}
      <div className="actions">
        <button
          type="button"
          disabled={!prepareEnabled || summary.releaseBlocked}
          onClick={() => { void prepareRelease(); }}
        >Freigabe vorbereiten</button>
        <button
          type="button"
          disabled={!releaseEnabled || summary.releaseBlocked}
          onClick={() => { void confirmRelease(); }}
        >Reservierung freigeben</button>
      </div>
      {summary.bindingStatus === "released" || summary.bindingStatus === "unbound" ? (
        <p className="muted">Keine aktive Reservierung mehr für diese Scanwurzel.</p>
      ) : null}
    </div> : null}
  </details>;
}
