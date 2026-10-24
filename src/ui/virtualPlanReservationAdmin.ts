/** P2-L.4b.2: read-only summary + controlled release helpers for bound reservations. */
import type { BoundExecutionView } from "./virtualPlanJournalApi";
import {
  bindingAllowsProgress,
  bindingAllowsRelease,
  journalForBoundWrite,
  parsePersistedJournal,
  shouldAutoResumeSimulation,
  type BoundExecutionStatus,
  type VirtualPlanJournal,
} from "./virtualPlanJournal";

export const RESERVATION_ADMIN_TITLE = "Aktive Ausführungssperre verwalten";

export const RESERVATION_RELEASE_NOTICE =
  "Die Reservierung wird aufgehoben. Bereits ausgeführte Datei- oder Ordneroperationen bleiben bestehen. "
  + "Ausstehende Operationen werden nicht ausgeführt. Das Journal bleibt als Nachweis erhalten. "
  + "Eine spätere Fortsetzung dieses alten Laufs erfolgt nicht automatisch.";

export const RESERVATION_NO_AUTO_CONTINUE =
  "Keine automatische Fortsetzung und keine automatische Freigabe.";

export interface ReservationOperationCounts {
  executed: number;
  pending: number;
  other: number;
  total: number;
}

export interface ReservationAdminSummary {
  scanRoot: string;
  journalId: string;
  journalStatus: string;
  bindingStatus: BoundExecutionStatus;
  journalBindingStatus: string;
  counts: ReservationOperationCounts;
  releaseBlocked: boolean;
  blockReason: string | null;
}

export function reservationBindingLabel(status: BoundExecutionStatus): string {
  if (status === "reserved") return "Aktive Reservierung";
  if (status === "releasePrepared") return "Freigabe vorbereitet";
  if (status === "released") return "Abgeschlossen und freigegeben";
  if (status === "inconsistent") return "Unklarer Zustand – gesperrt";
  if (status === "blocked") return "Beschädigte Daten – gesperrt";
  return "Keine aktive Reservierung";
}

export function countJournalOperations(journal: VirtualPlanJournal): ReservationOperationCounts {
  let executed = 0;
  let pending = 0;
  let other = 0;
  for (const status of Object.values(journal.operationStatus)) {
    if (status === "executed") executed += 1;
    else if (status === "pending") pending += 1;
    else other += 1;
  }
  return { executed, pending, other, total: executed + pending + other };
}

/** Pure: release payload must not alter operation outcomes. */
export function releasePreservesOperationStatus(
  before: VirtualPlanJournal,
  after: VirtualPlanJournal,
): boolean {
  const beforeKeys = Object.keys(before.operationStatus);
  const afterKeys = Object.keys(after.operationStatus);
  if (beforeKeys.length !== afterKeys.length) return false;
  return beforeKeys.every((key) => before.operationStatus[key] === after.operationStatus[key]);
}

export function buildPrepareReleaseJournal(
  journal: VirtualPlanJournal,
  expectedRevision: number,
): VirtualPlanJournal {
  return journalForBoundWrite(journal, expectedRevision, "releasePrepared");
}

export function buildConfirmReleaseJournal(
  journal: VirtualPlanJournal,
  expectedRevision: number,
): VirtualPlanJournal {
  return journalForBoundWrite(journal, expectedRevision, "released");
}

export function canPrepareReservationRelease(options: {
  view: BoundExecutionView | null;
  journal: VirtualPlanJournal | null;
  busy: boolean;
}): boolean {
  if (options.busy || options.view === null || options.journal === null) return false;
  if (options.view.journalRevision === null || options.view.ownerRunId === null || options.view.journalId === null) {
    return false;
  }
  if (options.view.status === "inconsistent" || options.view.status === "blocked") return false;
  if (options.journal.journalId !== options.view.journalId) return false;
  if (options.journal.scanRoot.length === 0) return false;
  return bindingAllowsProgress(options.view.status);
}

export function canConfirmReservationRelease(options: {
  view: BoundExecutionView | null;
  journal: VirtualPlanJournal | null;
  busy: boolean;
}): boolean {
  if (options.busy || options.view === null || options.journal === null) return false;
  if (options.view.journalRevision === null || options.view.ownerRunId === null || options.view.journalId === null) {
    return false;
  }
  if (options.view.status === "inconsistent" || options.view.status === "blocked") return false;
  if (options.journal.journalId !== options.view.journalId) return false;
  if (options.journal.bindingStatus !== "releasePrepared") return false;
  return bindingAllowsRelease(options.view.status);
}

export function summarizeBoundReservation(
  view: BoundExecutionView,
  preferredScanRoot: string,
): ReservationAdminSummary | null {
  if (view.status === "unbound") return null;
  const journal = view.journalJson === null ? null : parsePersistedJournal(view.journalJson);
  if (journal === null) {
    return {
      scanRoot: preferredScanRoot,
      journalId: view.journalId ?? "unbekannt",
      journalStatus: "nicht lesbar",
      bindingStatus: view.status,
      journalBindingStatus: "unbekannt",
      counts: { executed: 0, pending: 0, other: 0, total: 0 },
      releaseBlocked: true,
      blockReason: view.status === "blocked" || view.status === "inconsistent"
        ? "Reservierung oder Journal ist unklar oder beschädigt und bleibt gesperrt."
        : "Journal konnte nicht gelesen werden. Keine Freigabe.",
    };
  }
  if (preferredScanRoot.length > 0 && journal.scanRoot !== preferredScanRoot) {
    return {
      scanRoot: journal.scanRoot,
      journalId: journal.journalId,
      journalStatus: journal.status,
      bindingStatus: view.status,
      journalBindingStatus: journal.bindingStatus,
      counts: countJournalOperations(journal),
      releaseBlocked: true,
      blockReason: "Das Journal gehört nicht zur ausgewählten Scanwurzel.",
    };
  }
  const blocked = view.status === "inconsistent" || view.status === "blocked";
  return {
    scanRoot: journal.scanRoot,
    journalId: journal.journalId,
    journalStatus: journal.status,
    bindingStatus: view.status,
    journalBindingStatus: journal.bindingStatus,
    counts: countJournalOperations(journal),
    releaseBlocked: blocked,
    blockReason: blocked
      ? "Reservierung oder Journal ist unklar oder beschädigt und bleibt gesperrt."
      : null,
  };
}

export function reservationLoadNotice(view: BoundExecutionView, journal: VirtualPlanJournal | null): string | null {
  if (shouldAutoResumeSimulation(view.status, journal)) {
    return "Automatischer Neustart ist nicht zulässig.";
  }
  return null;
}
