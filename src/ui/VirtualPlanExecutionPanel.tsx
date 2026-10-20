import { useEffect, useState } from "react";
import type { ScanResult } from "../model";
import { toUserError } from "../scan";
import type { SnapshotBinding, VirtualPlan } from "./virtualPlan";
import { buildVirtualPlanDryRun } from "./virtualPlanDryRun";
import {
  inspectBoundExecution, startBoundExecution, type BoundExecutionView,
} from "./virtualPlanJournalApi";
import {
  bindingBlocksNewRun, createVirtualPlanJournal, journalForBoundWrite, parsePersistedJournal,
  type BoundExecutionStatus, type VirtualPlanJournal,
} from "./virtualPlanJournal";
import { inspectPlannedOperation } from "./virtualPlanPreflightApi";
import { evaluatePreflight, preflightStatusLabel, type PreflightDecision } from "./virtualPlanPreflight";
import {
  approveTestScanRoot, executeCreateFolder, inspectTestScanRoot, type TestRootApprovalView,
} from "./virtualPlanExecutionApi";
import {
  REAL_FOLDER_CHANGE_NOTICE, canSubmitRealFolderCreate, confirmedTargetPath, executionMustHalt,
  isRealFolderCreateKind, nextRealFolderOperation, realFolderOperationLabel,
  shouldAutoExecuteNext, shouldAutoResumeExecution,
} from "./virtualPlanExecution";

function bindingLabel(status: BoundExecutionStatus): string {
  if (status === "reserved") return "Aktive Reservierung – keine automatische Fortsetzung";
  if (status === "inconsistent") return "Unklarer Zustand – gesperrt";
  if (status === "blocked") return "Beschädigte Daten – gesperrt";
  if (status === "releasePrepared") return "Freigabe vorbereitet – gesperrt";
  return "Keine aktive Reservierung";
}

export function VirtualPlanExecutionPanel({ plan, scanResult, binding, current }: { plan: VirtualPlan | null; scanResult: ScanResult; binding: SnapshotBinding; current: boolean }) {
  const [approval, setApproval] = useState<TestRootApprovalView | null>(null);
  const [wantApprove, setWantApprove] = useState(false);
  const [view, setView] = useState<BoundExecutionView | null>(null);
  const [journal, setJournal] = useState<VirtualPlanJournal | null>(null);
  const [decision, setDecision] = useState<PreflightDecision | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReal, setConfirmReal] = useState(false);
  const scanRoot = binding.normalizedRootPath;
  const displayRoot = scanResult.root.path;
  const available = plan?.status === "virtuallyApproved" && current;
  const report = plan === null ? null : buildVirtualPlanDryRun({ plan, scanResult, binding, current });
  const operations = report?.status === "restricted" ? report.operations : [];
  const halt = executionMustHalt(journal);
  const operation = nextRealFolderOperation(operations, journal);
  const locked = view !== null && (view.status === "inconsistent" || view.status === "blocked" || view.status === "releasePrepared");
  const applyView = (next: BoundExecutionView) => {
    setView(next);
    setJournal(next.journalJson === null ? null : parsePersistedJournal(next.journalJson));
  };
  useEffect(() => {
    let cancelled = false;
    Promise.all([inspectTestScanRoot(scanRoot), inspectBoundExecution(scanRoot)]).then(([nextApproval, nextView]) => {
      if (cancelled) return;
      setApproval(nextApproval);
      applyView(nextView);
      const parsed = nextView.journalJson === null ? null : parsePersistedJournal(nextView.journalJson);
      if (shouldAutoResumeExecution(nextView.status, parsed)) setNotice("Automatische Fortsetzung ist nicht zulässig.");
    }).catch((cause) => { if (!cancelled) setNotice(toUserError(cause)); });
    return () => { cancelled = true; };
  }, [scanRoot]);
  const reload = async () => {
    const [nextApproval, nextView] = await Promise.all([inspectTestScanRoot(scanRoot), inspectBoundExecution(scanRoot)]);
    setApproval(nextApproval);
    applyView(nextView);
    return nextView;
  };
  const prepare = async () => {
    if (plan === null || !available || locked || busy) return;
    if (view !== null && bindingBlocksNewRun(view.status) && journal === null) return;
    if (journal !== null && view !== null && view.status === "reserved") return;
    setBusy(true);
    try {
      const prepared = createVirtualPlanJournal(plan, binding, buildVirtualPlanDryRun({ plan, scanResult, binding, current }));
      const payload = journalForBoundWrite(prepared, 0, "reserved");
      applyView(await startBoundExecution(scanRoot, payload.ownerRunId, payload.journalId, 0, JSON.stringify(payload)));
      setNotice("Reservierung für echte Ordneranlage gespeichert. Keine automatische Ausführung.");
    } catch (cause) {
      setNotice(toUserError(cause));
    } finally {
      setBusy(false);
    }
  };
  const approve = async () => {
    if (!wantApprove || busy) return;
    setBusy(true);
    try {
      setApproval(await approveTestScanRoot(scanRoot, true));
      setWantApprove(false);
    } catch (cause) {
      setNotice(toUserError(cause));
    } finally {
      setBusy(false);
    }
  };
  const inspectCurrent = async (active: VirtualPlanJournal) => {
    const next = nextRealFolderOperation(operations, active);
    if (plan === null || next === null || !isRealFolderCreateKind(next.kind)) {
      setDecision(null);
      return;
    }
    setBusy(true);
    try {
      const facts = await inspectPlannedOperation(scanRoot, next.kind, scanRoot, confirmedTargetPath(scanRoot, next));
      setDecision(evaluatePreflight({ operation: next, facts, simulatedFolderTargets: [] }));
    } catch (cause) {
      setNotice(toUserError(cause));
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (journal === null || operation === null || view === null || view.journalRevision === null || busy || halt.halt) return;
    if (!canSubmitRealFolderCreate({ approvedTestRoot: approval?.approved === true, explicitConfirm: confirmReal, halt: halt.halt, operation })) return;
    if (shouldAutoExecuteNext(journal)) return;
    setBusy(true);
    try {
      const result = await executeCreateFolder({
        scanRoot,
        ownerRunId: journal.ownerRunId,
        journalId: journal.journalId,
        expectedRevision: view.journalRevision,
        operationId: operation.id,
        confirmedKind: "createFolder",
        confirmedTargetPath: confirmedTargetPath(scanRoot, operation),
        explicitConfirm: true,
      });
      setConfirmReal(false);
      setNotice(result.message);
      const nextView = await reload();
      const parsed = nextView.journalJson === null ? null : parsePersistedJournal(nextView.journalJson);
      if (result.created && parsed !== null && !shouldAutoExecuteNext(parsed)) {
        setDecision(null);
        await inspectCurrent(parsed);
      }
    } catch (cause) {
      setNotice(toUserError(cause));
      try { await reload(); } catch { /* fail-closed reload */ }
    } finally {
      setBusy(false);
    }
  };
  return <details className="plan-execution">
    <summary>Echte Ordneranlage (nur Testverzeichnis)</summary>
    <p className="muted">Nur neue Zielordner. Dateien werden nicht verschoben, umbenannt oder gelöscht. Simulation bleibt unabhängig nutzbar.</p>
    <p><strong>Kopplung: {view === null ? "unbekannt" : bindingLabel(view.status)}</strong></p>
    <p className="plan-dry-run-path" title={displayRoot}>Ausgewählter Testpfad: {displayRoot}</p>
    <p className="muted">{approval?.message ?? "Testpfad-Freigabe wird geprüft."}</p>
    <label className="plan-execution-confirm">
      <input type="checkbox" checked={wantApprove} onChange={(event) => setWantApprove(event.target.checked)} />
      Ich gebe genau diesen ausgewählten Pfad als Test-Scanwurzel frei. Ein Name mit „Test“ reicht nicht.
    </label>
    <div className="actions">
      <button type="button" disabled={!wantApprove || busy || approval?.approved === true} onClick={() => { void approve(); }}>Testpfad ausdrücklich freigeben</button>
      <button type="button" disabled={!available || busy || locked || (view !== null && bindingBlocksNewRun(view.status) && journal !== null)} onClick={() => { void prepare(); }}>Reservierung vorbereiten</button>
      <button type="button" disabled={busy || journal === null || operation === null || halt.halt} onClick={() => journal !== null && void inspectCurrent(journal)}>Sicherheitsprüfung</button>
    </div>
    {!available ? <p className="muted">Nur für einen aktuellen virtuell bestätigten Plan verfügbar.</p> : null}
    {notice !== null ? <p className="plan-journal-note">{notice}</p> : null}
    {halt.halt ? <p className="plan-journal-note">{halt.reason}</p> : null}
    {operation !== null ? <div className="plan-journal-body">
      <p><strong>Operationstyp: {realFolderOperationLabel(operation.kind)}</strong></p>
      <p className="plan-dry-run-path" title={confirmedTargetPath(displayRoot, operation)}>Vollständiger Zielpfad: {confirmedTargetPath(displayRoot, operation)}</p>
      {decision !== null ? <p><strong>Sicherheitsprüfung: {preflightStatusLabel(decision.status)}</strong> · {decision.reason}</p> : <p className="muted">Sicherheitsprüfung noch nicht ausgeführt.</p>}
      <p className="plan-execution-warning">{REAL_FOLDER_CHANGE_NOTICE}</p>
      <label className="plan-execution-confirm">
        <input type="checkbox" checked={confirmReal} onChange={(event) => setConfirmReal(event.target.checked)} />
        Ich bestätige ausdrücklich genau diese eine Ordneranlage.
      </label>
      <div className="actions">
        <button
          type="button"
          disabled={busy || locked || halt.halt || decision === null || !decision.canConfirm || decision.status !== "ready" || !canSubmitRealFolderCreate({ approvedTestRoot: approval?.approved === true, explicitConfirm: confirmReal, halt: halt.halt, operation })}
          onClick={() => { void confirm(); }}
        >Echte Ordneranlage jetzt ausführen</button>
      </div>
    </div> : journal !== null ? <p className="muted">Keine weiteren echten Ordneranlagen in diesem Plan. Dateioperationen sind hier nicht zulässig.</p> : null}
  </details>;
}
