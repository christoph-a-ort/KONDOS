import { useEffect, useState } from "react";
import type { ScanResult } from "../model";
import { toUserError } from "../scan";
import type { SnapshotBinding, VirtualPlan } from "./virtualPlan";
import { buildVirtualPlanDryRun } from "./virtualPlanDryRun";
import { inspectBoundExecution } from "./virtualPlanJournalApi";
import {
  bindingBlocksNewRun, journalForBoundWrite, parsePersistedJournal,
  type BoundExecutionStatus, type VirtualPlanJournal,
} from "./virtualPlanJournal";
import { progressBoundExecution } from "./virtualPlanJournalApi";
import { inspectPlannedOperation } from "./virtualPlanPreflightApi";
import {
  abortPreflight, absoluteScanPath, applyPreflightDecision, bindingHaltsPreflight,
  confirmSimulatedOperation, createPreflightSession, evaluatePreflight, expectedMetadata,
  operationKindLabel, previewSimulatedUndo, PREFLIGHT_REMINDER, preflightStatusLabel,
  shouldAutoConfirmNext, shouldAutoResumePreflight, simulatedFolderTargets,
  type PreflightDecision, type PreflightSession,
} from "./virtualPlanPreflight";

function statusLabel(status: BoundExecutionStatus): string {
  if (status === "reserved") return "Aktive Reservierung – keine automatische Fortsetzung";
  if (status === "inconsistent") return "Unklarer Zustand – gesperrt";
  if (status === "blocked") return "Beschädigte Daten – gesperrt";
  if (status === "releasePrepared") return "Freigabe vorbereitet – keine weitere Bestätigung";
  return "Keine blockierende Kopplung";
}

export function VirtualPlanPreflightPanel({ plan, scanResult, binding, current }: { plan: VirtualPlan | null; scanResult: ScanResult; binding: SnapshotBinding; current: boolean }) {
  const [bindingStatus, setBindingStatus] = useState<BoundExecutionStatus>("unbound");
  const [journal, setJournal] = useState<VirtualPlanJournal | null>(null);
  const [session, setSession] = useState<PreflightSession | null>(null);
  const [decision, setDecision] = useState<PreflightDecision | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [undoHint, setUndoHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scanRoot = scanResult.root.path;
  const available = plan?.status === "virtuallyApproved" && current;
  const report = plan === null ? null : buildVirtualPlanDryRun({ plan, scanResult, binding, current });
  const operations = report?.status === "restricted" ? report.operations : [];
  const currentOperation = session === null ? undefined : operations[session.currentIndex];
  const locked = bindingHaltsPreflight(bindingStatus);
  useEffect(() => {
    let cancelled = false;
    inspectBoundExecution(binding.normalizedRootPath).then((view) => {
      if (cancelled) return;
      setBindingStatus(view.status);
      const parsed = view.journalJson === null ? null : parsePersistedJournal(view.journalJson);
      setJournal(parsed);
      if (parsed?.preflight !== undefined) {
        const restored: PreflightSession = {
          schemaVersion: 1,
          currentIndex: parsed.preflight.currentIndex,
          halted: parsed.preflight.halted,
          reason: parsed.preflight.reason,
          outcomes: Object.fromEntries(Object.entries(parsed.preflight.outcomes).map(([id, outcome]) => [id, outcome as PreflightSession["outcomes"][string]])),
        };
        setSession(restored);
        setNotice("Gespeicherter Prüfstand geladen. Keine automatische Fortsetzung.");
        if (shouldAutoResumePreflight(view.status, restored)) setNotice("Automatische Fortsetzung ist nicht zulässig.");
      }
    }).catch((cause) => { if (!cancelled) setNotice(toUserError(cause)); });
    return () => { cancelled = true; };
  }, [binding.normalizedRootPath]);
  const persistSession = async (next: PreflightSession, message: string) => {
    setSession(next);
    if (journal === null || journal.bindingStatus !== "reserved") return;
    const payload = journalForBoundWrite({
      ...journal,
      events: [...journal.events, { sequence: journal.events.length + 1, atMs: Date.now(), message }],
      preflight: next,
    }, journal.revision, "reserved");
    try {
      const view = await progressBoundExecution(binding.normalizedRootPath, journal.ownerRunId, journal.journalId, journal.revision, JSON.stringify(payload));
      const parsed = view.journalJson === null ? null : parsePersistedJournal(view.journalJson);
      if (parsed !== null) setJournal(parsed);
    } catch (cause) {
      setNotice(toUserError(cause));
    }
  };
  const checkCurrent = async (active: PreflightSession) => {
    const operation = operations[active.currentIndex];
    if (plan === null || operation === undefined) return;
    setBusy(true);
    setUndoHint(null);
    try {
      const facts = await inspectPlannedOperation(
        scanRoot,
        operation.kind,
        operation.kind === "createVirtualFolder" ? scanRoot : absoluteScanPath(scanRoot, operation.sourcePath),
        absoluteScanPath(scanRoot, operation.targetPath),
      );
      const nextDecision = evaluatePreflight({
        operation, facts, simulatedFolderTargets: simulatedFolderTargets(operations, active),
        ...expectedMetadata(plan, operation),
      });
      const halted = applyPreflightDecision(active, operation.id, nextDecision);
      setDecision(nextDecision);
      if (halted.halted) {
        setNotice(nextDecision.reason);
        await persistSession(halted, `Dateiprüfung blockiert: ${nextDecision.reason}`);
      } else {
        setNotice(null);
        setSession(halted);
      }
    } catch (cause) {
      setNotice(toUserError(cause));
    } finally {
      setBusy(false);
    }
  };
  const start = async () => {
    if (!available || locked || operations.length === 0 || (bindingBlocksNewRun(bindingStatus) && journal === null)) return;
    const next = createPreflightSession(operations);
    setDecision(null);
    setNotice(null);
    await persistSession(next, "Simulierte Einzelbestätigung vorbereitet. Keine echte Dateioperation.");
    await checkCurrent(next);
  };
  const confirm = async () => {
    if (session === null || currentOperation === undefined || decision === null || busy || locked) return;
    if (shouldAutoConfirmNext(session)) return;
    const next = confirmSimulatedOperation(session, operations, currentOperation.id, decision);
    setDecision(null);
    await persistSession(next, `Simulierte Einzelbestätigung für ${currentOperation.id}. Keine echte Dateioperation.`);
    if (!next.halted && operations[next.currentIndex] !== undefined) await checkCurrent(next);
    else if (!next.halted) setNotice("Letzte geplante Operation simuliert bestätigt. Keine echte Dateioperation.");
  };
  const abort = async () => {
    if (session === null || currentOperation === undefined || busy) return;
    const next = abortPreflight(session, currentOperation.id);
    setDecision(null);
    setNotice(next.reason);
    await persistSession(next, "Simulierte Einzelbestätigung abgebrochen. Reservierung bleibt.");
  };
  return <details className="plan-preflight">
    <summary>Einzelbestätigung (nur Simulation)</summary>
    <p className="muted">Es werden keine Dateien verschoben, umbenannt, angelegt oder gelöscht. Jede Operation braucht eine eigene Bestätigung.</p>
    <p><strong>Kopplung: {statusLabel(bindingStatus)}</strong></p>
    <p className="muted">{PREFLIGHT_REMINDER}</p>
    {notice !== null ? <p className="plan-journal-note">{notice}</p> : null}
    <button type="button" disabled={!available || busy || locked || operations.length === 0} onClick={() => { void start(); }}>Dateiprüfung beginnen</button>
    {!available ? <p className="muted">Nur für einen aktuellen virtuell bestätigten Plan verfügbar.</p> : null}
    {session !== null && currentOperation !== undefined ? <div className="plan-journal-body">
      <p><strong>Operation {session.currentIndex + 1} von {operations.length}</strong> · {operationKindLabel(currentOperation.kind)}</p>
      {currentOperation.kind === "createVirtualFolder"
        ? <p className="plan-dry-run-path" title={absoluteScanPath(scanRoot, currentOperation.targetPath)}>Ziel: {absoluteScanPath(scanRoot, currentOperation.targetPath)}</p>
        : <>
          <p className="plan-dry-run-path" title={absoluteScanPath(scanRoot, currentOperation.sourcePath)}>Quelle: {absoluteScanPath(scanRoot, currentOperation.sourcePath)}</p>
          <p className="plan-dry-run-path" title={absoluteScanPath(scanRoot, currentOperation.targetPath)}>Ziel: {absoluteScanPath(scanRoot, currentOperation.targetPath)}</p>
        </>}
      {decision !== null ? <p><strong>Prüfung: {preflightStatusLabel(decision.status)}</strong>{decision.status === "ready" ? null : ` · ${decision.reason}`}</p> : null}
      <div className="actions">
        <button type="button" disabled={busy || locked || session.halted || decision === null || !decision.canConfirm} onClick={() => { void confirm(); }}>Einzeloperation bestätigen</button>
        <button type="button" disabled={busy || session.halted} onClick={() => { void abort(); }}>Abbrechen</button>
        <button type="button" disabled={busy} onClick={() => currentOperation !== undefined && setUndoHint(previewSimulatedUndo(session, currentOperation.id).reason)}>Rücknahme nur vorbereiten</button>
      </div>
      {undoHint !== null ? <p className="muted">{undoHint}</p> : null}
      <p className="muted">Bestätigt (Simulation): {Object.values(session.outcomes).filter((outcome) => outcome === "simulatedConfirmed").length} · Angehalten: {session.halted ? "ja" : "nein"}</p>
    </div> : session !== null && session.currentIndex >= operations.length ? <p className="muted">Alle geplanten Schritte wurden nur simuliert bestätigt.</p> : null}
  </details>;
}
