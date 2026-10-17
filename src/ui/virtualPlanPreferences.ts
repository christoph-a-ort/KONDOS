/** P2-K.5b/c – Pure preference candidates and immutable preference-store edits. */

import type { PreferenceRecord, VirtualPlan } from "./virtualPlan";

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

function key(value: string): string {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `vpp_${(hash >>> 0).toString(16)}`;
}

export function deriveVirtualPlanPreferenceCandidates(plan: VirtualPlan): VirtualPlanPreferenceCandidate[] {
  if (plan.status !== "virtuallyApproved") return [];
  const candidates: VirtualPlanPreferenceCandidate[] = [];
  for (const decision of plan.decisions) {
    if (decision.origin !== "user" || decision.kind !== "edit") continue;
    if (decision.virtualFolderId !== undefined && decision.previousFolderName !== undefined) {
      const folder = plan.virtualFolders?.find((entry) => entry.id === decision.virtualFolderId);
      if (folder === undefined || folder.name === decision.previousFolderName) continue;
      const semanticKey = `rename:${plan.scope.kind}:${folder.parentVirtualPath}:${folder.name}`;
      candidates.push({
        id: key(`${decision.id}:${semanticKey}`), semanticKey,
        description: `Virtuellen Zielordner „${folder.name}“ bevorzugen`,
        scope: plan.scope, sourceDecisionId: decision.id,
        rationale: "Ausdrückliche Umbenennung eines virtuellen Zielordners durch den Benutzer.",
        limitation: "Gilt nur als Hinweis im festgelegten Scanbereich und löst keine Umbenennung aus.",
      });
      continue;
    }
    if (decision.planItemId !== undefined && decision.previousVirtualTargetPath !== undefined) {
      const item = plan.items.find((entry) => entry.id === decision.planItemId);
      if (item === undefined || item.virtualTargetPath === decision.previousVirtualTargetPath) continue;
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
  return candidates
    .filter((candidate, index, all) => all.findIndex((other) => other.semanticKey === candidate.semanticKey) === index)
    .sort((left, right) => left.id.localeCompare(right.id));
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
