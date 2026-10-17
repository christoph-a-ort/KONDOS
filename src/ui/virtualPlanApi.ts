import { invoke } from "@tauri-apps/api/core";

export interface VirtualPlanDraftListEntry {
  planId: string;
  draftJson: string | null;
  modifiedAtMs: number | null;
  blocked: boolean;
}

/** App-data draft store. The backend enforces revision and blocked-draft protection. */
export function loadVirtualPlanDraft(planId: string): Promise<string | null> {
  return invoke<string | null>("load_virtual_plan_draft", { planId });
}
export function saveVirtualPlanDraft(planId: string, expectedRevision: number, draftJson: string): Promise<void> {
  return invoke("save_virtual_plan_draft", { planId, expectedRevision, draftJson });
}
/** Read-only discovery of drafts held in the app-data virtual-plan store. */
export function listVirtualPlanDrafts(): Promise<VirtualPlanDraftListEntry[]> {
  return invoke<VirtualPlanDraftListEntry[]>("list_virtual_plan_drafts");
}
export function loadVirtualPlanPreferences(): Promise<string | null> {
  return invoke<string | null>("load_virtual_plan_preferences");
}
export function saveVirtualPlanPreferences(expectedRevision: number, preferencesJson: string): Promise<void> {
  return invoke("save_virtual_plan_preferences", { expectedRevision, preferencesJson });
}
/** Explicit user-only destructive decision; no generic overwrite command exists. */
export function discardVirtualPlanDraft(planId: string): Promise<void> {
  return invoke("discard_virtual_plan_draft", { planId });
}
