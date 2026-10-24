/** P2-L.4b.2: reservation admin without editablePlan; isolated pure checks. */
import type { BoundExecutionView } from "./virtualPlanJournalApi";
import type { VirtualDryRunOperation } from "./virtualPlanDryRun";
import type { VirtualPlanJournal } from "./virtualPlanJournal";
import {
  RESERVATION_ADMIN_TITLE,
  buildConfirmReleaseJournal, buildPrepareReleaseJournal, canConfirmReservationRelease,
  canPrepareReservationRelease, countJournalOperations, releasePreservesOperationStatus,
  reservationBindingLabel, reservationLoadNotice, summarizeBoundReservation,
} from "./virtualPlanReservationAdmin";
import { journalStatusLabel, shouldAutoResumeSimulation } from "./virtualPlanJournal";

function assert(value: boolean, label: string): void {
  if (!value) throw new Error(label);
}

function op(id: string, kind: VirtualDryRunOperation["kind"], source: string, target: string): VirtualDryRunOperation {
  return {
    id, kind, objectId: id, sourcePath: source, targetPath: target,
    expectedSource: "s", preconditions: [], expectedTarget: "t",
    collisionStatus: "mustCheckAtExecution", checkStatus: "mustCheckAtExecution",
    rationale: "r", recovery: "later",
  };
}

function sampleJournal(overrides: Partial<VirtualPlanJournal> = {}): VirtualPlanJournal {
  const folder = op("op-folder", "createVirtualFolder", ".", "Rechnung");
  const a = op("op-a", "moveFile", "rechnung_a.txt", "Rechnung/rechnung_a.txt");
  const b = op("op-b", "moveFile", "rechnung_b.txt", "Rechnung/rechnung_b.txt");
  const c = op("op-c", "moveFile", "rechnung_test.txt", "Rechnung/rechnung_test.txt");
  return {
    schemaVersion: 1,
    journalId: "vj_vp_vp1-40b9fbe1_test",
    revision: 3,
    createdAtMs: 1,
    planId: "vp_vp1-40b9fbe1",
    planRevision: 3,
    binding: {
      sourceScanId: 1,
      normalizedRootPath: "c:/dotty-test",
      scanConfig: {
        maxDepth: 16, excludeHidden: true, extensions: [], includeSize: true, includeCreatedAt: false, includeModifiedAt: true,
      },
      snapshotFingerprint: "vp1-40b9fbe1",
      incomplete: false,
    },
    operations: [folder, a, b, c],
    status: "executing",
    operationStatus: {
      "op-folder": "executed",
      "op-a": "pending",
      "op-b": "pending",
      "op-c": "pending",
    },
    events: [],
    reason: null,
    scanRoot: "c:/dotty-test",
    ownerRunId: "run_test",
    bindingStatus: "reserved",
    ...overrides,
  };
}

function viewFrom(journal: VirtualPlanJournal, status: BoundExecutionView["status"] = "reserved"): BoundExecutionView {
  return {
    status,
    journalId: journal.journalId,
    ownerRunId: journal.ownerRunId,
    journalRevision: journal.revision,
    journalJson: JSON.stringify(journal),
    message: "ok",
  };
}

export function runVirtualPlanReservationAdminCheck(): void {
  const journal = sampleJournal();
  const reservedView = viewFrom(journal, "reserved");

  // B: existing reservation summarized from real journal fields
  const summary = summarizeBoundReservation(reservedView, "c:/dotty-test");
  assert(summary !== null, "B: reserved view yields summary");
  assert(summary!.scanRoot === "c:/dotty-test", "B: scan root from journal");
  assert(summary!.journalId === journal.journalId, "B: journal id");
  assert(summary!.journalStatus === "executing", "B: journal status");
  assert(summary!.journalBindingStatus === "reserved", "B: binding status");
  assert(summary!.counts.executed === 1 && summary!.counts.pending === 3, "B: executed/pending counts");

  // C: unbound = neutral empty
  assert(summarizeBoundReservation({
    status: "unbound", journalId: null, ownerRunId: null, journalRevision: null, journalJson: null, message: "",
  }, "c:/dotty-test") === null, "C: unbound has no active reservation summary");

  // D: two-step release gating
  assert(canPrepareReservationRelease({ view: reservedView, journal, busy: false }), "D: prepare allowed when reserved");
  assert(!canConfirmReservationRelease({ view: reservedView, journal, busy: false }), "D: confirm blocked before prepare");
  const preparedJournal = buildPrepareReleaseJournal(journal, journal.revision);
  const preparedView = viewFrom(preparedJournal, "releasePrepared");
  assert(preparedJournal.bindingStatus === "releasePrepared", "D: prepare sets releasePrepared");
  assert(preparedJournal.revision === journal.revision + 1, "D: prepare bumps revision");
  assert(!canPrepareReservationRelease({ view: preparedView, journal: preparedJournal, busy: false }), "D: prepare not repeatable after prepare");
  assert(canConfirmReservationRelease({ view: preparedView, journal: preparedJournal, busy: false }), "D: confirm after prepare");

  // E / F / G: release payload preserves operation statuses
  const released = buildConfirmReleaseJournal(preparedJournal, preparedJournal.revision);
  assert(releasePreservesOperationStatus(journal, preparedJournal), "E: prepare preserves operationStatus");
  assert(releasePreservesOperationStatus(preparedJournal, released), "E: confirm preserves operationStatus");
  assert(preparedJournal.operationStatus["op-folder"] === "executed", "F: folder stays executed after prepare");
  assert(released.operationStatus["op-folder"] === "executed", "F: folder stays executed after release");
  assert(
    released.operationStatus["op-a"] === "pending"
      && released.operationStatus["op-b"] === "pending"
      && released.operationStatus["op-c"] === "pending",
    "G: pending moves stay pending / unexecuted",
  );
  assert(released.status === journal.status, "E: journal workflow status unchanged by release write");

  // H: foreign scan root blocked
  const foreign = summarizeBoundReservation(reservedView, "c:/dotty - test");
  assert(foreign !== null && foreign.releaseBlocked, "H: foreign preferred root blocks release");
  assert((foreign?.blockReason ?? "").includes("Scanwurzel"), "H: mismatch reason names scan root");

  // I: inconsistent / corrupt blocked
  const inconsistent = summarizeBoundReservation({
    ...reservedView,
    status: "inconsistent",
    journalJson: "{bad",
  }, "c:/dotty-test");
  assert(inconsistent !== null && inconsistent.releaseBlocked, "I: inconsistent/corrupt blocks");
  assert(!canPrepareReservationRelease({
    view: { ...reservedView, status: "inconsistent" },
    journal,
    busy: false,
  }), "I: prepare disabled when inconsistent");
  assert(!canConfirmReservationRelease({
    view: preparedView,
    journal: { ...preparedJournal, journalId: "other" },
    busy: false,
  }), "I: journal id mismatch blocks confirm");

  // J: no auto resume / auto release on load
  assert(!shouldAutoResumeSimulation("reserved", journal), "J: simulation auto-resume stays false");
  assert(reservationLoadNotice(reservedView, journal) === null, "J: load does not invent auto-release notice");

  // K: dedicated admin title and complete operation counts
  assert(RESERVATION_ADMIN_TITLE === "Aktive Ausführungssperre verwalten", "K: dedicated admin title constant");
  assert(countJournalOperations(journal).total === 4, "K: counts cover all operations");

  const completedOps = {
    "op-folder": "executed" as const,
    "op-a": "executed" as const,
    "op-b": "executed" as const,
    "op-c": "executed" as const,
  };
  const completedReserved = sampleJournal({ status: "completed", operationStatus: completedOps, bindingStatus: "reserved" });
  const completedReleased = sampleJournal({ status: "completed", operationStatus: completedOps, bindingStatus: "released" });
  assert(summarizeBoundReservation(viewFrom(completedReserved, "reserved"), "c:/dotty-test")?.journalStatus === "completed", "FV2-01: completed stays visible with reserved binding");
  assert(summarizeBoundReservation(viewFrom(completedReleased, "released"), "c:/dotty-test")?.journalStatus === "completed", "FV2-01: completed stays visible with released binding");
  assert(completedReleased.status === "completed" && completedReleased.bindingStatus === "released", "FV2-01: journal completed and binding released stay independent");
  assert(journalStatusLabel(completedReserved.status) === "Abgeschlossen", "FV2-01a: completed is labeled Abgeschlossen");
  assert(reservationBindingLabel("released") === "Freigegeben", "FV2-01a: released is labeled Freigegeben");
  assert(!reservationBindingLabel("released").includes("Abgeschlossen"), "FV2-01a: released label does not use Abgeschlossen");
  const legacyReleased = sampleJournal({ status: "executing", bindingStatus: "released" });
  assert(journalStatusLabel(legacyReleased.status) !== "Abgeschlossen", "FV2-01a: legacy executing is not Abgeschlossen");
  assert(reservationBindingLabel(legacyReleased.bindingStatus) === "Freigegeben", "FV2-01a: legacy released binding stays Freigegeben");
  assert(
    journalStatusLabel(completedReleased.status) === "Abgeschlossen"
      && reservationBindingLabel(completedReleased.bindingStatus) === "Freigegeben",
    "FV2-01a: completed and released labels stay independent",
  );
}

export function assertReservationAdminSourceGuards(sources: {
  preview: string;
  panel: string;
  journalPanel: string;
  executionPanel: string;
}): void {
  const { preview, panel, journalPanel, executionPanel } = sources;
  assert(preview.includes("VirtualPlanReservationAdminPanel"), "A: admin panel imported in preview");
  assert(
    preview.includes("<VirtualPlanReservationAdminPanel scanRoot={preview.binding.normalizedRootPath} />"),
    "A: admin panel mounted on scan binding, not gated by editablePlan",
  );
  {
    const adminAt = preview.indexOf("<VirtualPlanReservationAdminPanel");
    const editorGateAt = preview.indexOf("{mainView === \"editor\" && editablePlan !== null ? (");
    assert(adminAt >= 0 && editorGateAt >= 0 && adminAt < editorGateAt, "A: reservation admin appears before editablePlan-gated blocks");
  }
  assert(panel.includes("onClick={() => { void prepareRelease(); }}"), "J: prepare only via explicit button");
  assert(panel.includes("onClick={() => { void confirmRelease(); }}"), "J: release only via explicit button");
  assert(panel.includes("disabled={!prepareEnabled || summary.releaseBlocked}"), "J: prepare gated");
  assert(panel.includes("disabled={!releaseEnabled || summary.releaseBlocked}"), "J: release gated");
  const effectStart = panel.indexOf("useEffect(() => {");
  const effectEnd = panel.indexOf("}, [scanRoot]);");
  assert(effectStart >= 0 && effectEnd > effectStart, "J: load effect present");
  const effectSlice = panel.slice(effectStart, effectEnd);
  assert(effectSlice.includes("inspectBoundExecution(scanRoot)"), "J: load only inspects");
  assert(!effectSlice.includes("prepareBoundRelease(") && !effectSlice.includes("releaseBoundExecution("), "J: load effect does not call release APIs");
  assert(journalPanel.includes("buildPrepareReleaseJournal") && journalPanel.includes("buildConfirmReleaseJournal"), "K: journal panel reuses shared release builders");
  assert(journalPanel.includes("Simulation abgeschlossen:"), "FV2-01a: simulatedComplete counter is labeled as simulation");
  assert(!journalPanel.includes("Abgeschlossen:"), "FV2-01a: journal panel no longer uses bare Abgeschlossen counter");
  assert(panel.includes("{RESERVATION_ADMIN_TITLE}"), "K: panel renders admin title");
  assert(panel.includes("{RESERVATION_RELEASE_NOTICE}"), "K: release notice present");
  assert(panel.includes("{RESERVATION_NO_AUTO_CONTINUE}"), "K: no-auto-continue notice present");
  assert(panel.includes("journalStatusLabel(summary.journalStatus)"), "K: reservation admin shows labeled journal status");
  assert(panel.includes("Keine Datei- oder Ordneroperationen"), "K: no file ops in admin panel");
  assert(executionPanel.includes("Echte Ausführung (nur Testverzeichnis)"), "K: execution panel title unchanged");
}
