import { invoke } from "@tauri-apps/api/core";

export function loadLearnedSendersJson(): Promise<string | null> {
  return invoke<string | null>("load_learned_senders");
}

export function saveLearnedSendersJson(mappingsJson: string): Promise<void> {
  return invoke("save_learned_senders", { mappingsJson });
}
