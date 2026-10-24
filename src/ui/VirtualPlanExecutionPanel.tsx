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
import {
  evaluatePreflight, expectedMetadata, isFileFingerprintValue, missingRealMoveFingerprintReason,
  preflightStatusLabel, type PreflightDecision,
} from "./virtualPlanPreflight";
import {
  approveTestScanRoot, executeCreateFolder, executeMoveFile, inspectTestScanRoot, type TestRootApprovalView,
} from "./virtualPlanExecutionApi";
import {
  REAL_FILE_MOVE_NOTICE, REAL_FOLDER_CHANGE_NOTICE, bindRealFileMoveConfirm, canSubmitRealFileMove,
  canSubmitRealFolderCreate, confirmedSourcePath, confirmedTargetPath, executionMustHalt,
  isRealFileMoveKind, isRealFolderCreateKind, journalBoundToApprovedPlan, nextRealExecutionOperation,
  realExecutionConfirmKey, realExecutionOperationsFrom, realExecutionUiOpen, realFileMoveDisableReason,
  realFileMoveOperationLabel, realFolderOperationLabel, shouldAutoExecuteNext, shouldAutoResumeExecution,
  type RealFileMoveConfirm,
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
  const [confirmFolder, setConfirmFolder] = useState(false);
  const [confirmMove, setConfirmMove] = useState(false);
  const [moveConfirm, setMoveConfirm] = useState<RealFileMoveConfirm | null>(null);
  const [inspectTick, setInspectTick] = useState(0);
  const scanRoot = binding.normalizedRootPath;
  const displayRoot = scanResult.root.path;
  const canPrepare = plan?.status === "virtuallyApproved" && current;
  const journalBound = journalBoundToApprovedPlan(journal, plan);
  const available = realExecutionUiOpen(plan, current, journal);
  const report = plan === null ? null : buildVirtualPlanDryRun({ plan, scanResult, binding, current });
  const dryRunOperations = report?.status === "restricted" ? report.operations : [];
  const fingerprintGap = plan !== null && dryRunOperations.length > 0
    ? missingRealMoveFingerprintReason(plan, dryRunOperations)
    : null;
  const operations = realExecutionOperationsFrom(dryRunOperations, journal, plan, current);
  const halt = executionMustHalt(journal);
  const operation = nextRealExecutionOperation(operations, journal);
  const folderOperation = operation !== null && isRealFolderCreateKind(operation.kind) ? operation : null;
  const moveOperation = operation !== null && isRealFileMoveKind(operation.kind) ? operation : null;
  const confirmKey = realExecutionConfirmKey(plan?.planId, plan?.revision, journal, operation);
  const moveMeta = plan !== null && moveOperation !== null ? expectedMetadata(plan, moveOperation) : {};
  const locked = view !== null && (view.status === "inconsistent" || view.status === "blocked" || view.status === "releasePrepared");
  const moveSubmit = {
    approvedTestRoot: approval?.approved === true,
    explicitConfirm: confirmMove,
    halt: halt.halt,
    snapshotCurrent: current,
    journalBoundToPlan: journalBound,
    operation: moveOperation,
    journalId: journal?.journalId ?? null,
    confirm: moveConfirm,
    decisionStatus: decision?.status ?? null,
    expectedSizeBytes: moveMeta.expectedSizeBytes,
    expectedModifiedAtMs: moveMeta.expectedModifiedAtMs,
  };
  const moveButtonDisabled = busy || locked || halt.halt || decision === null || !decision.canConfirm || decision.status !== "ready" || !canSubmitRealFileMove(moveSubmit);
  const moveBlockReason = moveOperation === null ? null : realFileMoveDisableReason({
    busy,
    locked,
    haltReason: halt.reason,
    decision,
    ...moveSubmit,
  });
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
  useEffect(() => {
    setConfirmFolder(false);
    setConfirmMove(false);
    setMoveConfirm(null);
    setDecision(null);
  }, [confirmKey]);
  const reload = async () => {
    const [nextApproval, nextView] = await Promise.all([inspectTestScanRoot(scanRoot), inspectBoundExecution(scanRoot)]);
    setApproval(nextApproval);
    applyView(nextView);
    return nextView;
  };
  const prepare = async () => {
    if (plan === null || !canPrepare || locked || busy) return;
    if (view !== null && bindingBlocksNewRun(view.status) && journal === null) return;
    if (journal !== null && view !== null && view.status === "reserved") return;
    const dryRun = buildVirtualPlanDryRun({ plan, scanResult, binding, current });
    if (dryRun.status !== "restricted") {
      setNotice("Reservierung nicht möglich: Dry-Run ist nicht freigabefähig.");
      return;
    }
    const gap = missingRealMoveFingerprintReason(plan, dryRun.operations);
    if (gap !== null) {
      setNotice(gap);
      return;
    }
    setBusy(true);
    try {
      const prepared = createVirtualPlanJournal(plan, binding, dryRun);
      const payload = journalForBoundWrite(prepared, 0, "reserved");
      applyView(await startBoundExecution(scanRoot, payload.ownerRunId, payload.journalId, 0, JSON.stringify(payload)));
      setNotice("Reservierung gespeichert. Keine automatische Ausführung.");
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
    const next = nextRealExecutionOperation(operations, active);
    if (plan === null || next === null) {
      setDecision(null);
      return;
    }
    if (!isRealFolderCreateKind(next.kind) && !isRealFileMoveKind(next.kind)) {
      setDecision(null);
      setNotice("Dieser Operationstyp ist für eine echte Ausführung nicht zulässig.");
      return;
    }
    setBusy(true);
    try {
      const sourcePath = isRealFolderCreateKind(next.kind) ? scanRoot : confirmedSourcePath(scanRoot, next);
      const facts = await inspectPlannedOperation(scanRoot, next.kind, sourcePath, confirmedTargetPath(scanRoot, next));
      const meta = isRealFileMoveKind(next.kind) ? expectedMetadata(plan, next) : {};
      setDecision(evaluatePreflight({ operation: next, facts, simulatedFolderTargets: [], ...meta }));
    } catch (cause) {
      setDecision(null);
      setNotice(toUserError(cause));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (inspectTick === 0 || journal === null || halt.halt) return;
    void inspectCurrent(journal);
  }, [inspectTick]);
  const confirmFolderCreate = async () => {
    if (journal === null || folderOperation === null || view === null || view.journalRevision === null || busy || halt.halt) return;
    if (!canSubmitRealFolderCreate({ approvedTestRoot: approval?.approved === true, explicitConfirm: confirmFolder, halt: halt.halt, operation: folderOperation })) return;
    if (shouldAutoExecuteNext(journal)) return;
    setBusy(true);
    try {
      const result = await executeCreateFolder({
        scanRoot,
        ownerRunId: journal.ownerRunId,
        journalId: journal.journalId,
        expectedRevision: view.journalRevision,
        operationId: folderOperation.id,
        confirmedKind: "createFolder",
        confirmedTargetPath: confirmedTargetPath(scanRoot, folderOperation),
        explicitConfirm: true,
      });
      setConfirmFolder(false);
      setNotice(result.message);
      await reload();
      if (result.created && !shouldAutoExecuteNext(journal)) setInspectTick((tick) => tick + 1);
    } catch (cause) {
      setNotice(toUserError(cause));
      try { await reload(); } catch { /* fail-closed reload */ }
    } finally {
      setBusy(false);
    }
  };
  const confirmFileMove = async () => {
    if (journal === null || moveOperation === null || view === null || view.journalRevision === null || busy || halt.halt) return;
    if (shouldAutoExecuteNext(journal)) return;
    if (!canSubmitRealFileMove({
      approvedTestRoot: approval?.approved === true,
      explicitConfirm: confirmMove,
      halt: halt.halt,
      snapshotCurrent: current,
      journalBoundToPlan: journalBound,
      operation: moveOperation,
      journalId: journal.journalId,
      confirm: moveConfirm,
      decisionStatus: decision?.status ?? null,
      expectedSizeBytes: moveMeta.expectedSizeBytes,
      expectedModifiedAtMs: moveMeta.expectedModifiedAtMs,
    })) return;
    const expectedSizeBytes = moveMeta.expectedSizeBytes;
    const expectedModifiedAtMs = moveMeta.expectedModifiedAtMs;
    if (!isFileFingerprintValue(expectedSizeBytes) || !isFileFingerprintValue(expectedModifiedAtMs)) return;
    setBusy(true);
    try {
      const result = await executeMoveFile({
        scanRoot,
        ownerRunId: journal.ownerRunId,
        journalId: journal.journalId,
        expectedRevision: view.journalRevision,
        operationId: moveOperation.id,
        confirmedKind: "moveFile",
        confirmedSourcePath: confirmedSourcePath(scanRoot, moveOperation),
        confirmedTargetPath: confirmedTargetPath(scanRoot, moveOperation),
        expectedSizeBytes,
        expectedModifiedAtMs,
        explicitConfirm: true,
      });
      setConfirmMove(false);
      setMoveConfirm(null);
      setNotice(result.message);
      await reload();
      if (result.moved && !shouldAutoExecuteNext(journal)) setInspectTick((tick) => tick + 1);
      if (!result.moved) setDecision(null);
    } catch (cause) {
      setNotice(toUserError(cause));
      setDecision(null);
      try { await reload(); } catch { /* fail-closed reload */ }
    } finally {
      setBusy(false);
    }
  };
  return <details className="plan-execution">
    <summary>Echte Ausführung (nur Testverzeichnis)</summary>
    <p className="muted">Nur die ausdrücklich freigegebene Testwurzel. Neue Ordner und einzelne Dateiverschiebungen nach aktueller Prüfung und Einzelbestätigung. Umbenennen und Löschen bleiben unzulässig.</p>
    <p><strong>Kopplung: {view === null ? "unbekannt" : bindingLabel(view.status)}</strong></p>
    <p className="plan-dry-run-path" title={displayRoot}>Ausgewählter Testpfad: {displayRoot}</p>
    <p className="muted">{approval?.message ?? "Testpfad-Freigabe wird geprüft."}</p>
    <label className="plan-execution-confirm">
      <input type="checkbox" checked={wantApprove} onChange={(event) => setWantApprove(event.target.checked)} />
      Ich gebe genau diesen ausgewählten Pfad als Test-Scanwurzel frei. Ein Name mit „Test“ reicht nicht.
    </label>
    <div className="actions">
      <button type="button" disabled={!wantApprove || busy || approval?.approved === true} onClick={() => { void approve(); }}>Testpfad ausdrücklich freigeben</button>
      <button type="button" disabled={!canPrepare || busy || locked || fingerprintGap !== null || (view !== null && bindingBlocksNewRun(view.status) && journal !== null)} onClick={() => { void prepare(); }}>Reservierung vorbereiten</button>
      <button type="button" disabled={busy || journal === null || operation === null || halt.halt} onClick={() => journal !== null && void inspectCurrent(journal)}>Sicherheitsprüfung</button>
    </div>
    {!available ? <p className="muted">Nur für einen aktuellen virtuell bestätigten Plan verfügbar.</p> : null}
    {available && !current && journalBound ? <p className="muted">Scan-ID hat sich geändert. Fortsetzung nur für dieses gebundene Journal und denselben Plan.</p> : null}
    {fingerprintGap !== null ? <p className="plan-journal-note">{fingerprintGap}</p> : null}
    {notice !== null ? <p className="plan-journal-note">{notice}</p> : null}
    {halt.halt ? <p className="plan-journal-note">{halt.reason}</p> : null}
    {folderOperation !== null ? <div className="plan-journal-body">
      <p><strong>Operationstyp: {realFolderOperationLabel(folderOperation.kind)}</strong></p>
      <p className="plan-dry-run-path" title={confirmedTargetPath(displayRoot, folderOperation)}>Vollständiger Zielpfad: {confirmedTargetPath(displayRoot, folderOperation)}</p>
      {decision !== null ? <p><strong>Sicherheitsprüfung: {preflightStatusLabel(decision.status)}</strong> · {decision.reason}</p> : <p className="muted">Sicherheitsprüfung noch nicht ausgeführt.</p>}
      <p className="plan-execution-warning">{REAL_FOLDER_CHANGE_NOTICE}</p>
      <label className="plan-execution-confirm">
        <input type="checkbox" checked={confirmFolder} onChange={(event) => setConfirmFolder(event.target.checked)} />
        Ich bestätige ausdrücklich genau diese eine Ordneranlage.
      </label>
      <div className="actions">
        <button
          type="button"
          disabled={busy || locked || halt.halt || decision === null || !decision.canConfirm || decision.status !== "ready" || !canSubmitRealFolderCreate({ approvedTestRoot: approval?.approved === true, explicitConfirm: confirmFolder, halt: halt.halt, operation: folderOperation })}
          onClick={() => { void confirmFolderCreate(); }}
        >Echte Ordneranlage jetzt ausführen</button>
      </div>
    </div> : moveOperation !== null ? <div className="plan-journal-body">
      <p><strong>Operationstyp: {realFileMoveOperationLabel(moveOperation.kind)}</strong></p>
      <p className="plan-dry-run-path" title={confirmedSourcePath(displayRoot, moveOperation)}>Vollständiger Quellpfad: {confirmedSourcePath(displayRoot, moveOperation)}</p>
      <p className="plan-dry-run-path" title={confirmedTargetPath(displayRoot, moveOperation)}>Vollständiger Zielpfad: {confirmedTargetPath(displayRoot, moveOperation)}</p>
      {decision !== null ? <p><strong>Sicherheitsprüfung: {preflightStatusLabel(decision.status)}</strong> · {decision.reason}</p> : <p className="muted">Sicherheitsprüfung noch nicht ausgeführt.</p>}
      {decision !== null && decision.status === "readySimulated" ? <p className="plan-journal-note">Nur Simulation. Keine echte Ausführungsfreigabe, solange der Zielordner nicht real im aktuellen Scan existiert.</p> : null}
      <p className="plan-execution-warning">{REAL_FILE_MOVE_NOTICE}</p>
      <label className="plan-execution-confirm">
        <input
          type="checkbox"
          checked={confirmMove}
          onChange={(event) => {
            if (event.target.checked && journal !== null) {
              setConfirmMove(true);
              setMoveConfirm(bindRealFileMoveConfirm(moveOperation, journal.journalId));
            } else {
              setConfirmMove(false);
              setMoveConfirm(null);
            }
          }}
        />
        Ich bestätige ausdrücklich genau diese eine Dateiverschiebung.
      </label>
      <div className="actions">
        <button
          type="button"
          disabled={moveButtonDisabled}
          onClick={() => { void confirmFileMove(); }}
        >Diese Datei jetzt verschieben</button>
      </div>
      {moveButtonDisabled && moveBlockReason !== null ? <p className="plan-journal-note">{moveBlockReason}</p> : null}
    </div> : journal !== null ? <p className="muted">Keine weiteren echten Operationen in diesem Plan. Umbenennen bleibt unzulässig.</p> : null}
  </details>;
}
