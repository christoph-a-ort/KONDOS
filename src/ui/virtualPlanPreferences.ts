/** P2-K.5b/c – Pure preference candidates and immutable preference-store edits. */

import type { DecisionRecord, PreferenceRecord, VirtualPlan } from "./virtualPlan";

export const VIRTUAL_PLAN_PREFERENCES_SCHEMA_VERSION = 1 as const;

export interface VirtualPlanPreferenceStore {
  schemaVersion: typeof VIRTUAL_PLAN_PREFERENCES_SCHEMA_VERSION;
  revision: number;
  preferences: PreferenceRecord[];
}

export interface VirtualPlanPreferenceCandidate {
  id: string;
  semanticKey: string;
  description: string;
  scope: PreferenceRecord["scope"];
  sourceDecisionId: string;
  rationale: string;
  limitation: string;
}
export interface VirtualPlanPreferenceConflict {
  sourceDecisionId: string;
  description: string;
}
export interface VirtualPlanPreferenceAnalysis {
  candidates: VirtualPlanPreferenceCandidate[];
  conflicts: VirtualPlanPreferenceConflict[];
}

function key(value: string): string {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `vpp_${(hash >>> 0).toString(16)}`;
}

export function analyzeVirtualPlanPreferenceCandidates(plan: VirtualPlan): VirtualPlanPreferenceAnalysis {
  if (plan.status !== "virtuallyApproved") return { candidates: [], conflicts: [] };
  const candidates: VirtualPlanPreferenceCandidate[] = [];
  const conflicts: VirtualPlanPreferenceConflict[] = [];
  const lastItemDecision = new Map<string, DecisionRecord>();
  const lastFolderDecision = new Map<string, DecisionRecord>();
  for (const decision of plan.decisions) {
    if (decision.origin !== "user") continue;
    if (decision.planItemId !== undefined) lastItemDecision.set(decision.planItemId, decision);
    if (decision.virtualFolderId !== undefined) lastFolderDecision.set(decision.virtualFolderId, decision);
  }
  for (const decision of lastFolderDecision.values()) {
    if (decision.kind !== "edit" || decision.previousFolderName === undefined || decision.virtualFolderId === undefined) continue;
    const folder = plan.virtualFolders?.find((entry) => entry.id === decision.virtualFolderId);
    if (folder === undefined) {
      conflicts.push({ sourceDecisionId: decision.id, description: "Die letzte Ordnerentscheidung kann keinem aktuellen virtuellen Zielordner eindeutig zugeordnet werden." });
      continue;
    }
    if (folder.name !== decision.previousFolderName) {
      const semanticKey = `rename:${plan.scope.kind}:${folder.parentVirtualPath}:${folder.name}`;
      candidates.push({
        id: key(`${decision.id}:${semanticKey}`), semanticKey,
        description: `Virtuellen Zielordner „${folder.name}“ bevorzugen`,
        scope: plan.scope, sourceDecisionId: decision.id,
        rationale: "Ausdrückliche Umbenennung eines virtuellen Zielordners durch den Benutzer.",
        limitation: "Gilt nur als Hinweis im festgelegten Scanbereich und löst keine Umbenennung aus.",
      });
    }
  }
  for (const decision of lastItemDecision.values()) {
    if (decision.kind !== "edit" || decision.previousVirtualTargetPath === undefined || decision.planItemId === undefined) continue;
    const item = plan.items.find((entry) => entry.id === decision.planItemId);
    if (item === undefined) {
      conflicts.push({ sourceDecisionId: decision.id, description: "Die letzte Dateientscheidung kann keinem aktuellen Objekt eindeutig zugeordnet werden." });
      continue;
    }
    if (item.virtualTargetPath !== decision.previousVirtualTargetPath) {
      const semanticKey = `assignment:${plan.scope.kind}:${item.observed.relativePath}:${item.virtualTargetPath}`;
      candidates.push({
        id: key(`${decision.id}:${semanticKey}`), semanticKey,
        description: `„${item.observed.relativePath}“ virtuell „${item.virtualTargetPath}“ zuordnen`,
        scope: plan.scope, sourceDecisionId: decision.id,
        rationale: "Ausdrückliche virtuelle Dateizuordnung durch den Benutzer.",
        limitation: "Bezieht sich nur auf dieses beobachtete Objekt und ist keine allgemeine Dateinamensregel.",
      });
    }
  }
  return {
    candidates: candidates
      .filter((candidate, index, all) => all.findIndex((other) => other.semanticKey === candidate.semanticKey) === index)
      .sort((left, right) => left.id.localeCompare(right.id)),
    conflicts,
  };
}

export function deriveVirtualPlanPreferenceCandidates(plan: VirtualPlan): VirtualPlanPreferenceCandidate[] {
  return analyzeVirtualPlanPreferenceCandidates(plan).candidates;
}

export function addSelectedPreferenceCandidates(
  store: VirtualPlanPreferenceStore,
  candidates: readonly VirtualPlanPreferenceCandidate[],
): VirtualPlanPreferenceStore {
  const existing = new Set(store.preferences.map((preference) => `${preference.sourceDecisionId}:${preference.semanticKey}`));
  const additions = candidates
    .filter((candidate) => !existing.has(`${candidate.sourceDecisionId}:${candidate.semanticKey}`))
    .map((candidate) => ({
      id: candidate.id, scope: candidate.scope, description: candidate.description, revision: store.revision + 1,
      active: true, origin: "user" as const, sourceDecisionId: candidate.sourceDecisionId,
      rationale: candidate.rationale, limitation: candidate.limitation, semanticKey: candidate.semanticKey,
    }));
  if (additions.length === 0) return store;
  return { ...store, revision: store.revision + 1, preferences: [...store.preferences, ...additions].sort((a, b) => a.id.localeCompare(b.id)) };
}

export function updateVirtualPlanPreference(
  store: VirtualPlanPreferenceStore,
  id: string,
  changes: Pick<PreferenceRecord, "description" | "active">,
): VirtualPlanPreferenceStore {
  const found = store.preferences.find((preference) => preference.id === id);
  if (found === undefined) return store;
  return {
    ...store, revision: store.revision + 1,
    preferences: store.preferences.map((preference) => preference.id === id
      ? { ...preference, ...changes, revision: store.revision + 1 }
      : preference),
  };
}

export function parseVirtualPlanPreferenceStore(raw: string): VirtualPlanPreferenceStore | null {
  try {
    const value = JSON.parse(raw) as Partial<VirtualPlanPreferenceStore>;
    if (value.schemaVersion !== 1 || typeof value.revision !== "number" || !Array.isArray(value.preferences)) return null;
    if (!value.preferences.every((item) => item && typeof item.id === "string" && item.origin === "user" && typeof item.active === "boolean")) return null;
    return value as VirtualPlanPreferenceStore;
  } catch {
    return null;
  }
}
