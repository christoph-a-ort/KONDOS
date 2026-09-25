import { invoke } from "@tauri-apps/api/core";

/** Load raw prefs JSON from the app-data file. `null` = file missing. */
export function loadWorkbenchPrefsJson(): Promise<string | null> {
  return invoke<string | null>("load_workbench_prefs");
}

/** Persist sanitized prefs JSON to the app-data file. */
export function saveWorkbenchPrefsJson(prefsJson: string): Promise<void> {
  return invoke("save_workbench_prefs", { prefsJson });
}

export function isTauriRuntime(): boolean {
  try {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  } catch {
    return false;
  }
}
