import { useEffect, useState } from "react";

import {
  deleteLearnedSenderMapping,
  emptyLearnedSenderStore,
  hydrateLearnedSenderStore,
  persistLearnedSenderStore,
  updateLearnedSenderMapping,
  type LearnedSenderStore,
  type LearnedSendersJsonStore,
} from "./learnedSenders";
import { loadLearnedSendersJson, saveLearnedSendersJson } from "./learnedSendersApi";
import { isTauriRuntime } from "./workbenchPrefsApi";

function jsonStore(): LearnedSendersJsonStore | null {
  if (!isTauriRuntime()) {
    return null;
  }
  return {
    load: () => loadLearnedSendersJson(),
    save: (json) => saveLearnedSendersJson(json),
  };
}

export function LearnedSendersPanel({ onIssue }: { onIssue?: (message: string) => void }) {
  const [store, setStore] = useState<LearnedSenderStore>(emptyLearnedSenderStore);

  useEffect(() => {
    let cancelled = false;
    void hydrateLearnedSenderStore(jsonStore()).then((next) => {
      if (!cancelled) {
        setStore(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function commit(next: LearnedSenderStore) {
    setStore(next);
    void persistLearnedSenderStore(next, jsonStore()).catch((cause) => {
      onIssue?.(cause instanceof Error ? cause.message : "Die Absenderzuordnungen konnten nicht gespeichert werden.");
    });
  }

  return (
    <fieldset className="meta learned-senders-panel">
      <legend>Gelernte Absender</legend>
      <p className="muted">
        Nur ausdrücklich bestätigte Korrekturen. Die Zuordnungen bleiben lokal auf diesem Gerät und werden nicht in die
        Cloud gesendet.
      </p>
      {store.mappings.length === 0 ? (
        <p className="muted">Noch keine Absenderzuordnung gespeichert.</p>
      ) : (
        <ul className="learned-senders-list">
          {store.mappings.map((mapping) => (
            <li key={mapping.id}>
              <label className="field">
                <span>Erkannt</span>
                <input
                  type="text"
                  value={mapping.from}
                  spellCheck={false}
                  onChange={(event) => commit(updateLearnedSenderMapping(store, mapping.id, { from: event.target.value }))}
                />
              </label>
              <span className="learned-senders-arrow" aria-hidden="true">
                →
              </span>
              <label className="field">
                <span>Bestätigt</span>
                <input
                  type="text"
                  value={mapping.to}
                  spellCheck={false}
                  onChange={(event) => commit(updateLearnedSenderMapping(store, mapping.id, { to: event.target.value }))}
                />
              </label>
              <button type="button" onClick={() => commit(deleteLearnedSenderMapping(store, mapping.id))}>
                Löschen
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
