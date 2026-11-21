import { useEffect, useState } from "react";

import {
  defaultLocalAiPrefs,
  hydrateLocalAiPrefs,
  persistLocalAiPrefs,
  sanitizeModelName,
  type LocalAiJsonStore,
  type LocalAiPrefs,
  type LocalAiProbe,
} from "./localAi";
import { createLocalAiClient, loadLocalAiPrefsJson, saveLocalAiPrefsJson } from "./localAiApi";
import { isTauriRuntime } from "./workbenchPrefsApi";

function jsonStore(): LocalAiJsonStore | null {
  if (!isTauriRuntime()) {
    return null;
  }
  return {
    load: () => loadLocalAiPrefsJson(),
    save: (json) => saveLocalAiPrefsJson(json),
  };
}

export function LocalAiPanel({ onIssue }: { onIssue?: (message: string) => void }) {
  const [prefs, setPrefs] = useState<LocalAiPrefs>(defaultLocalAiPrefs);
  const [probe, setProbe] = useState<LocalAiProbe | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await hydrateLocalAiPrefs(jsonStore());
      if (cancelled) {
        return;
      }
      setPrefs(next);
      if (!isTauriRuntime()) {
        return;
      }
      try {
        const probed = await createLocalAiClient().probe();
        if (cancelled) {
          return;
        }
        setProbe(probed);
        if (probed.reachable && sanitizedModelMissing(next.model, probed.models) && probed.models[0]) {
          const picked = { ...next, model: probed.models[0] };
          setPrefs(picked);
          try {
            await persistLocalAiPrefs(picked, jsonStore());
          } catch (cause) {
            onIssue?.(
              cause instanceof Error ? cause.message : "Die KI-Einstellungen konnten nicht gespeichert werden.",
            );
          }
        }
      } catch {
        if (!cancelled) {
          setProbe({
            reachable: false,
            message: "Ollama ist lokal nicht erreichbar.",
            models: [],
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function commit(next: LocalAiPrefs) {
    const sanitized = {
      ...next,
      model: sanitizeModelName(next.model),
    };
    setPrefs(sanitized);
    void persistLocalAiPrefs(sanitized, jsonStore()).catch((cause) => {
      onIssue?.(cause instanceof Error ? cause.message : "Die KI-Einstellungen konnten nicht gespeichert werden.");
    });
  }

  function testConnection() {
    setBusy(true);
    void createLocalAiClient()
      .probe()
      .then((next) => {
        setProbe(next);
        if (next.reachable && sanitizedModelMissing(prefs.model, next.models) && next.models[0]) {
          commit({ ...prefs, model: next.models[0] });
        }
      })
      .catch(() => {
        setProbe({
          reachable: false,
          message: "Ollama ist lokal nicht erreichbar.",
          models: [],
        });
      })
      .finally(() => setBusy(false));
  }

  const models = probe?.models ?? (prefs.model ? [prefs.model] : []);
  const status = probe?.message
    ?? (prefs.enabled
      ? "Verbindung noch nicht geprüft. Ollama muss lokal laufen."
      : "Lokale KI ist ausgeschaltet. Namensvorschläge funktionieren weiter ohne Ollama.");

  return (
    <fieldset className="meta local-ai-panel">
      <legend>Lokale KI</legend>
      <p className="muted">
        Optional und vollständig lokal über Ollama. Ohne Ollama bleibt DottyFM unverändert nutzbar. Es werden keine
        Dokumente in die Cloud gesendet.
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={prefs.enabled}
          onChange={(event) => commit({ ...prefs, enabled: event.target.checked })}
        />
        <span>Lokale KI für Namensvorschläge verwenden</span>
      </label>
      <p className={probe?.reachable ? "muted" : "muted"}>{status}</p>
      <label className="field">
        <span>Modell</span>
        <select
          value={prefs.model}
          disabled={models.length === 0}
          onChange={(event) => commit({ ...prefs, model: event.target.value })}
        >
          {models.length === 0 ? <option value="">Kein Modell gefunden</option> : null}
          {models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={testConnection} disabled={busy}>
        {busy ? "Verbindung wird geprüft…" : "Verbindung testen"}
      </button>
    </fieldset>
  );
}

function sanitizedModelMissing(model: string, models: string[]): boolean {
  const current = sanitizeModelName(model);
  return current.length === 0 || !models.includes(current);
}
