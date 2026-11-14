import { invoke } from "@tauri-apps/api/core";

export function loadNamingRulesJson(): Promise<string | null> {
  return invoke<string | null>("load_naming_rules");
}

export function saveNamingRulesJson(rulesJson: string): Promise<void> {
  return invoke("save_naming_rules", { rulesJson });
}
