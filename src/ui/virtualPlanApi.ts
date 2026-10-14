import { invoke } from "@tauri-apps/api/core";

/** App-data draft store. The backend enforces revision and blocked-draft protection. */
export function loadVirtualPlanDraft(planId: string): Promise<string | null> {
  return invoke<string | null>("load_virtual_plan_draft", { planId });
}
export function saveVirtualPlanDraft(planId: string, expectedRevision: number, draftJson: string): Promise<void> {
  return invoke("save_virtual_plan_draft", { planId, expectedRevision, draftJson });
}
/** Explicit user-only destructive decision; no generic overwrite command exists. */
export function discardVirtualPlanDraft(planId: string): Promise<void> {
  return invoke("discard_virtual_plan_draft", { planId });
}
