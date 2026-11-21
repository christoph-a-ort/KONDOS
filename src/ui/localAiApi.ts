import { invoke } from "@tauri-apps/api/core";

import type { LocalAiClient, LocalAiProbe } from "./localAi";

export function loadLocalAiPrefsJson(): Promise<string | null> {
  return invoke<string | null>("load_local_ai_prefs");
}

export function saveLocalAiPrefsJson(prefsJson: string): Promise<void> {
  return invoke("save_local_ai_prefs", { prefsJson });
}

export function probeLocalOllama(): Promise<LocalAiProbe> {
  return invoke<LocalAiProbe>("probe_local_ollama");
}

export function generateLocalOllama(
  model: string,
  prompt: string,
): Promise<{
  ok: boolean;
  response?: string | null;
  message: string;
  timings?: { totalMs: number; loadMs: number; promptEvalMs: number; evalMs: number } | null;
  doneReason?: string | null;
  evalCount?: number | null;
}> {
  return invoke("generate_local_ollama", { model, prompt });
}

export function logNameSuggestTimings(message: string): Promise<void> {
  return invoke("log_name_suggest_timings", { message });
}

export function createLocalAiClient(): LocalAiClient {
  return {
    probe: () => probeLocalOllama(),
    generate: (model, prompt) => generateLocalOllama(model, prompt),
  };
}
