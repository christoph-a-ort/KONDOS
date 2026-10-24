/** P2-L.4a: read-only preflight and simulated single confirmation. No filesystem writes. */
import type { VirtualPlan } from "./virtualPlan";
import { normalizeVirtualPlanPath } from "./virtualPlan";
import type { DryRunOperationKind, VirtualDryRunOperation } from "./virtualPlanDryRun";
import type { BoundExecutionStatus } from "./virtualPlanJournal";

export type PreflightStatus = "ready" | "readySimulated" | "blocked" | "unverifiable";
export type PreflightOutcome = "pending" | "simulatedConfirmed" | "blocked" | "aborted" | "undoPreviewed";
export interface PathObservation {
  exists: boolean; isFile: boolean; isDir: boolean; isReparse: boolean; readable: boolean;
  withinRoot: boolean; sizeBytes: number | null; modifiedAtMs: number | null;
}
export interface PlannedOperationFacts {
  kind: string; bindingStatus: BoundExecutionStatus; bindingMessage: string;
  source: PathObservation; target: PathObservation;
  targetParentExists: boolean; targetParentIsDir: boolean; targetParentIsReparse: boolean;
  reminder: string;
}
export interface PreflightDecision {
  status: PreflightStatus; reason: string; canConfirm: boolean; halt: boolean;
}
export interface PreflightSession {
  schemaVersion: 1; currentIndex: number; halted: boolean; reason: string | null;
  outcomes: Record<string, PreflightOutcome>;
}

export const PREFLIGHT_REMINDER = "Ein erfolgreiches Prüfungsergebnis ist keine Ausführungsfreigabe. Unmittelbar vor einer späteren echten Operation muss erneut geprüft werden.";

export function preflightStatusLabel(status: PreflightStatus): string {
  if (status === "readySimulated") return "Bereit (nur Simulation)";
  if (status === "ready") return "Prüfung erfolgreich";
  if (status === "blocked") return "Blockiert";
  return "Nicht sicher verifizierbar";
}

const allowedKinds = new Set<DryRunOperationKind>(["createVirtualFolder", "moveFile", "renameFile"]);

export function absoluteScanPath(scanRoot: string, relative: string): string {
  if (relative === "." || relative === "") return scanRoot;
  const slash = scanRoot.includes("\\") ? "\\" : "/";
  return `${scanRoot.replace(/[\\/]+$/, "")}${slash}${relative.replace(/[\\/]/g, slash)}`;
}

export function bindingHaltsPreflight(status: BoundExecutionStatus): boolean {
  return status === "inconsistent" || status === "blocked" || status === "releasePrepared";
}

export function shouldAutoConfirmNext(_session: PreflightSession): false {
  return false;
}

export function shouldAutoResumePreflight(_status: BoundExecutionStatus, _session: PreflightSession | null): false {
  return false;
}

export function createPreflightSession(operations: ReadonlyArray<VirtualDryRunOperation>): PreflightSession {
  return {
    schemaVersion: 1, currentIndex: 0, halted: false, reason: null,
    outcomes: Object.fromEntries(operations.map((operation) => [operation.id, "pending"])),
  };
}

export function evaluatePreflight(options: {
  operation: VirtualDryRunOperation;
  facts: PlannedOperationFacts;
  expectedSizeBytes?: number;
  expectedModifiedAtMs?: number;
  simulatedFolderTargets: ReadonlyArray<string>;
}): PreflightDecision {
  const { operation, facts } = options;
  if (!allowedKinds.has(operation.kind)) {
    return { status: "blocked", reason: "Diese Operation gehört nicht zum zulässigen Funktionsumfang.", canConfirm: false, halt: true };
  }
  if (bindingHaltsPreflight(facts.bindingStatus)) {
    return { status: "blocked", reason: facts.bindingMessage, canConfirm: false, halt: true };
  }
  if (!facts.source.readable || !facts.target.readable) {
    return { status: "unverifiable", reason: "Der Dateisystemzustand ist nicht sicher lesbar.", canConfirm: false, halt: true };
  }
  if (pathLooksUnsafe(operation.sourcePath) || pathLooksUnsafe(operation.targetPath) || !facts.source.withinRoot || !facts.target.withinRoot) {
    return { status: "blocked", reason: "Quelle oder Ziel liegt außerhalb der Scanwurzel oder enthält einen unzulässigen Pfad.", canConfirm: false, halt: true };
  }
  if (facts.source.isReparse || facts.target.isReparse || facts.targetParentIsReparse) {
    return { status: "blocked", reason: "Symlink, Junction oder anderer Reparse-Point blockiert die Operation.", canConfirm: false, halt: true };
  }
  if (operation.kind === "createVirtualFolder") {
    if (facts.target.exists) return { status: "blocked", reason: "Der Zielordner existiert bereits.", canConfirm: false, halt: true };
    if (!facts.targetParentExists) {
      const simulatedParent = options.simulatedFolderTargets.some((path) => normalizeVirtualPlanPath(path) === parentPath(operation.targetPath));
      if (simulatedParent) {
        return { status: "readySimulated", reason: "Elternordner existiert real noch nicht; nur simuliert vorgemerkt. Keine echte Anlage.", canConfirm: true, halt: false };
      }
      return { status: "blocked", reason: "Der Elternordner des Ziels existiert nicht.", canConfirm: false, halt: true };
    }
    if (!facts.targetParentIsDir) return { status: "blocked", reason: "Der Elternpfad ist kein Ordner.", canConfirm: false, halt: true };
    return { status: "ready", reason: "Read-only-Prüfung erfolgreich. Noch keine Dateioperation.", canConfirm: true, halt: false };
  }
  if (!facts.source.exists) return { status: "blocked", reason: "Die erwartete Quelldatei fehlt.", canConfirm: false, halt: true };
  if (facts.source.isDir || !facts.source.isFile) return { status: "blocked", reason: "Die Quelle ist keine reguläre Datei. Ordner dürfen nicht verschoben oder umbenannt werden.", canConfirm: false, halt: true };
  if (facts.target.exists) return { status: "blocked", reason: "Das Ziel ist bereits belegt. Vorhandene Dateien werden nicht überschrieben.", canConfirm: false, halt: true };
  if (!facts.targetParentExists) {
    const simulatedParent = options.simulatedFolderTargets.some((path) => normalizeVirtualPlanPath(path) === parentPath(operation.targetPath));
    if (simulatedParent) {
      return { status: "readySimulated", reason: "Zielordner existiert real noch nicht; nur simuliert vorgemerkt. Keine echte Verschiebung.", canConfirm: true, halt: false };
    }
    return { status: "blocked", reason: "Der Zielordner existiert nicht.", canConfirm: false, halt: true };
  }
  if (!hasCompleteFileFingerprint(options.expectedSizeBytes, options.expectedModifiedAtMs)) {
    return {
      status: "unverifiable",
      reason: incompleteFileFingerprintReason(options.expectedSizeBytes, options.expectedModifiedAtMs),
      canConfirm: false,
      halt: true,
    };
  }
  if (facts.source.sizeBytes !== options.expectedSizeBytes) {
    return { status: "blocked", reason: "Die Quelldatei hat sich seit der Planung verändert. Ablauf angehalten.", canConfirm: false, halt: true };
  }
  if (facts.source.modifiedAtMs !== null && facts.source.modifiedAtMs !== options.expectedModifiedAtMs) {
    return { status: "blocked", reason: "Die Quelldatei hat sich seit der Planung verändert. Ablauf angehalten.", canConfirm: false, halt: true };
  }
  return { status: "ready", reason: "Read-only-Prüfung erfolgreich. Noch keine Dateioperation.", canConfirm: true, halt: false };
}

export function applyPreflightDecision(session: PreflightSession, operationId: string, decision: PreflightDecision): PreflightSession {
  if (session.halted) return session;
  if (decision.halt) {
    return { ...session, halted: true, reason: decision.reason, outcomes: { ...session.outcomes, [operationId]: "blocked" } };
  }
  return session;
}

export function confirmSimulatedOperation(session: PreflightSession, operations: ReadonlyArray<VirtualDryRunOperation>, operationId: string, decision: PreflightDecision): PreflightSession {
  const current = operations[session.currentIndex];
  if (session.halted || current === undefined || current.id !== operationId || !decision.canConfirm) {
    return { ...session, halted: true, reason: "Die Einzelbestätigung ist in diesem Zustand unzulässig.", outcomes: { ...session.outcomes, [operationId]: "blocked" } };
  }
  return {
    ...session,
    currentIndex: session.currentIndex + 1,
    outcomes: { ...session.outcomes, [operationId]: "simulatedConfirmed" },
    reason: "Simuliert bestätigt. Nächster Vorschlag wird angezeigt, aber nicht ausgeführt.",
  };
}

export function abortPreflight(session: PreflightSession, operationId: string): PreflightSession {
  return { ...session, halted: true, reason: "Ablauf durch Benutzerabbruch angehalten.", outcomes: { ...session.outcomes, [operationId]: "aborted" } };
}

export function previewSimulatedUndo(session: PreflightSession, operationId: string): { allowed: false; reason: string } {
  if (session.outcomes[operationId] !== "simulatedConfirmed") {
    return { allowed: false, reason: "Nur simuliert bestätigte Schritte können später zur Rücknahme vorgemerkt werden." };
  }
  return { allowed: false, reason: "Echtes Rückgängigmachen ist in P2-L.4a nicht verfügbar. Später nur nach erneuter Prüfung und ausdrücklicher Einzelbestätigung." };
}

export function isFileFingerprintValue(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function hasCompleteFileFingerprint(expectedSizeBytes?: number, expectedModifiedAtMs?: number): boolean {
  return isFileFingerprintValue(expectedSizeBytes) && isFileFingerprintValue(expectedModifiedAtMs);
}

export function incompleteFileFingerprintReason(expectedSizeBytes?: number, expectedModifiedAtMs?: number): string {
  const sizeOk = isFileFingerprintValue(expectedSizeBytes);
  const modifiedOk = isFileFingerprintValue(expectedModifiedAtMs);
  if (!sizeOk && !modifiedOk) {
    return "Dateigröße und Änderungszeit aus der Planung fehlen. Der Zustand ist nicht sicher verifizierbar.";
  }
  if (!sizeOk) return "Die Dateigröße aus der Planung fehlt. Der Zustand ist nicht sicher verifizierbar.";
  return "Die Änderungszeit aus der Planung fehlt. Der Zustand ist nicht sicher verifizierbar.";
}

export function expectedMetadata(plan: VirtualPlan, operation: VirtualDryRunOperation): { expectedSizeBytes?: number; expectedModifiedAtMs?: number } {
  const item = plan.items.find((entry) => entry.observed.nodeId === operation.objectId || entry.id === operation.objectId);
  if (item === undefined) return {};
  return { expectedSizeBytes: item.observed.metadata.sizeBytes, expectedModifiedAtMs: item.observed.metadata.modifiedAtMs };
}

/** Fail closed before reservation when planned moves lack size/mtime from the scan snapshot. */
export function missingRealMoveFingerprintReason(
  plan: VirtualPlan,
  operations: ReadonlyArray<VirtualDryRunOperation>,
): string | null {
  for (const operation of operations) {
    if (operation.kind !== "moveFile") continue;
    const meta = expectedMetadata(plan, operation);
    if (!hasCompleteFileFingerprint(meta.expectedSizeBytes, meta.expectedModifiedAtMs)) {
      return incompleteFileFingerprintReason(meta.expectedSizeBytes, meta.expectedModifiedAtMs);
    }
  }
  return null;
}

export function simulatedFolderTargets(operations: ReadonlyArray<VirtualDryRunOperation>, session: PreflightSession): string[] {
  return operations.filter((operation) => operation.kind === "createVirtualFolder" && session.outcomes[operation.id] === "simulatedConfirmed").map((operation) => operation.targetPath);
}

function parentPath(path: string): string {
  const normalized = normalizeVirtualPlanPath(path);
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? normalized : normalized.slice(0, index);
}

function pathLooksUnsafe(path: string): boolean {
  return path.split(/[\\/]/).includes("..") || path.includes("\0");
}

export function operationKindLabel(kind: DryRunOperationKind): string {
  if (kind === "createVirtualFolder") return "Zielordner anlegen";
  if (kind === "moveFile") return "Datei verschieben";
  return "Datei umbenennen";
}
