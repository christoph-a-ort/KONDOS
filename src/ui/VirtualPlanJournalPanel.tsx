import { useEffect, useState } from "react";
import type { ScanResult } from "../model";
import { toUserError } from "../scan";
import type { SnapshotBinding, VirtualPlan } from "./virtualPlan";
import { buildVirtualPlanDryRun } from "./virtualPlanDryRun";
import {
  inspectBoundExecution, prepareBoundRelease, progressBoundExecution,
  releaseBoundExecution, startBoundExecution, type BoundExecutionView,
} from "./virtualPlanJournalApi";
import {
  bindingAllowsProgress, bindingBlocksNewRun,
  createVirtualPlanJournal, journalForBoundWrite, parsePersistedJournal,
  shouldAutoResumeSimulation, simulateJournal, simulateJournalRecovery,
  type BoundExecutionStatus, type VirtualPlanJournal,
} from "./virtualPlanJournal";
import {
  buildConfirmReleaseJournal, buildPrepareReleaseJournal, canConfirmReservationRelease,
  canPrepareReservationRelease, reservationBindingLabel,
} from "./virtualPlanReservationAdmin";

function bindingLabel(status: BoundExecutionStatus): string {
  return reservationBindingLabel(status) === "Keine aktive Reservierung"
    ? "Kein gespeichertes Journal"
    : reservationBindingLabel(status);
}

export function VirtualPlanJournalPanel({ plan, scanResult, binding, current }: { plan: VirtualPlan | null; scanResult: ScanResult; binding: SnapshotBinding; current: boolean }) {
  const [view, setView] = useState<BoundExecutionView | null>(null);
  const [journal, setJournal] = useState<VirtualPlanJournal | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scanRoot = binding.normalizedRootPath;
  const available = plan?.status === "virtuallyApproved" && current;
  const locked = view !== null && (view.status === "inconsistent" || view.status === "blocked");
  const applyView = (next: BoundExecutionView, fallback: VirtualPlanJournal | null = null) => {
    setView(next);
    const parsed = next.journalJson === null ? null : parsePersistedJournal(next.journalJson);
    setJournal(parsed ?? fallback);
    setNotice(next.status === "unbound" && parsed === null ? null : next.message);
  };
  const reload = async () => {
    const next = await inspectBoundExecution(scanRoot);
    applyView(next);
    return next;
  };
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    inspectBoundExecution(scanRoot).then((next) => {
      if (cancelled) return;
      applyView(next);
      if (shouldAutoResumeSimulation(next.status, next.journalJson === null ? null : parsePersistedJournal(next.journalJson))) {
        setNotice("Automatischer Neustart ist nicht zulässig.");
      }
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
  const persist = async (
    action: (expected: number, payload: string) => Promise<BoundExecutionView>,
    nextJournal: VirtualPlanJournal,
    expected: number,
  ) => {
    setBusy(true);
    try {
      applyView(await action(expected, JSON.stringify(nextJournal)), nextJournal);
    } catch (cause) {
      setNotice(toUserError(cause));
      try { await reload(); } catch { /* fail-closed reload */ }
    } finally {
      setBusy(false);
    }
  };
  const startOrProgress = async (next: VirtualPlanJournal) => {
    if (view === null || view.status === "unbound" || view.status === "released") {
      const payload = journalForBoundWrite(next, 0, "reserved");
      await persist((expected, journalJson) => startBoundExecution(scanRoot, payload.ownerRunId, payload.journalId, expected, journalJson), payload, 0);
      return;
    }
    if (!bindingAllowsProgress(view.status) || view.journalRevision === null || view.ownerRunId === null || view.journalId === null) {
      setNotice("Die Simulation darf in diesem Zustand nicht fortgeschrieben werden.");
      return;
    }
    const payload = journalForBoundWrite(next, view.journalRevision, "reserved");
    await persist((expected, journalJson) => progressBoundExecution(scanRoot, payload.ownerRunId, payload.journalId, expected, journalJson), payload, view.journalRevision);
  };
  const prepare = () => {
    if (plan === null || locked || (view !== null && bindingBlocksNewRun(view.status))) return;
    const report = buildVirtualPlanDryRun({ plan, scanResult, binding, current });
    try { setJournal(createVirtualPlanJournal(plan, binding, report)); setNotice("Journal lokal vorbereitet. Start erst nach Rust-Sicherheitsprüfung."); }
    catch { setJournal(null); setNotice("Das Journal konnte nicht vorbereitet werden."); }
  };
  const runSim = async (failAfter?: number, abort = false) => {
    if (journal === null || locked || busy) return;
    if (view !== null && view.status !== "unbound" && view.status !== "released" && !bindingAllowsProgress(view.status)) return;
    await startOrProgress(simulateJournal(journal, failAfter, abort));
  };
  const recover = async () => {
    if (journal === null || locked || busy || view === null || !bindingAllowsProgress(view.status)) return;
    await startOrProgress(simulateJournalRecovery(journal));
  };
  const prepareRelease = async () => {
    if (!canPrepareReservationRelease({ view, journal, busy }) || locked || journal === null || view === null || view.journalRevision === null) return;
    const payload = buildPrepareReleaseJournal(journal, view.journalRevision);
    await persist((expected, journalJson) => prepareBoundRelease(scanRoot, payload.ownerRunId, payload.journalId, expected, journalJson), payload, view.journalRevision);
  };
  const release = async () => {
    if (!canConfirmReservationRelease({ view, journal, busy }) || locked || journal === null || view === null || view.journalRevision === null) return;
    const payload = buildConfirmReleaseJournal(journal, view.journalRevision);
    await persist((expected, journalJson) => releaseBoundExecution(scanRoot, payload.ownerRunId, payload.journalId, expected, journalJson), payload, view.journalRevision);
  };
  return <details className="plan-journal">
    <summary>Ausführungsjournal (Simulation)</summary>
    <p className="muted">Nur Simulation – keine Änderung an Dateien oder Ordnern.</p>
    {view !== null ? <p><strong>Kopplung: {bindingLabel(view.status)}</strong></p> : null}
    {notice !== null ? <p className="plan-journal-note">{notice}</p> : null}
    <button type="button" disabled={!available || busy || locked || (view !== null && bindingBlocksNewRun(view.status))} onClick={prepare}>Simulation vorbereiten</button>
    {!available ? <p className="muted">Nur für einen aktuellen virtuell bestätigten Plan verfügbar.</p> : null}
    {locked ? <p className="plan-journal-note">Keine neue Simulation, keine Fortschreibung und keine Freigabe, solange der Zustand unklar oder beschädigt ist.</p> : null}
    {journal !== null ? <div className="plan-journal-body">
      <p><strong>Status: {journal.status}</strong> · Plan {journal.planId} · Planrevision {journal.planRevision} · Journalrevision {journal.revision} · {journal.operations.length} Operationen</p>
      <div className="actions">
        <button type="button" disabled={busy || locked || journal.status !== "prepared" || (view !== null && view.status !== "unbound" && view.status !== "released" && !bindingAllowsProgress(view.status))} onClick={() => { void runSim(); }}>Simulationslauf starten</button>
        <button type="button" disabled={busy || locked || journal.status !== "prepared" || (view !== null && view.status !== "unbound" && view.status !== "released" && !bindingAllowsProgress(view.status))} onClick={() => { void runSim(0); }}>Fehler simulieren</button>
        <button type="button" disabled={busy || locked || journal.status !== "prepared" || (view !== null && view.status !== "unbound" && view.status !== "released" && !bindingAllowsProgress(view.status))} onClick={() => { void runSim(undefined, true); }}>Abbruch simulieren</button>
        <button type="button" disabled={busy || locked || view === null || !bindingAllowsProgress(view.status) || !["simulatedComplete", "interrupted", "failed", "recoveryRequired"].includes(journal.status)} onClick={() => { void recover(); }}>Wiederherstellung simulieren</button>
        <button type="button" disabled={locked || !canPrepareReservationRelease({ view, journal, busy })} onClick={() => { void prepareRelease(); }}>Freigabe vorbereiten</button>
        <button type="button" disabled={locked || !canConfirmReservationRelease({ view, journal, busy })} onClick={() => { void release(); }}>Reservierung freigeben</button>
      </div>
      <p className="muted">Abgeschlossen: {Object.values(journal.operationStatus).filter((status) => status === "simulatedComplete").length} · Offen: {Object.values(journal.operationStatus).filter((status) => status === "pending").length}</p>
      {journal.reason !== null ? <p className="muted">Grund: {journal.reason}</p> : null}
      <details><summary>Ereignishistorie ({journal.events.length})</summary>{journal.events.map((entry) => <p className="muted" key={entry.sequence}>[{entry.sequence}] {entry.message}</p>)}</details>
    </div> : null}
  </details>;
}
