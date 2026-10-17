import { useEffect, useMemo, useState } from "react";
import type { VirtualPlan } from "./virtualPlan";
import {
  addSelectedPreferenceCandidates,
  deriveVirtualPlanPreferenceCandidates,
  parseVirtualPlanPreferenceStore,
  updateVirtualPlanPreference,
  type VirtualPlanPreferenceStore,
} from "./virtualPlanPreferences";
import { loadVirtualPlanPreferences, saveVirtualPlanPreferences } from "./virtualPlanApi";

const emptyStore = (): VirtualPlanPreferenceStore => ({ schemaVersion: 1, revision: 0, preferences: [] });

export function VirtualPlanPreferencesPanel({ plan, revalidationCurrent }: { plan: VirtualPlan | null; revalidationCurrent: boolean }) {
  const [store, setStore] = useState<VirtualPlanPreferenceStore | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [descriptionEdits, setDescriptionEdits] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const candidates = useMemo(
    () => plan !== null && revalidationCurrent ? deriveVirtualPlanPreferenceCandidates(plan) : [],
    [plan, revalidationCurrent],
  );

  useEffect(() => {
    void loadVirtualPlanPreferences()
      .then((raw) => {
        if (raw === null) setStore(emptyStore());
        else setStore(parseVirtualPlanPreferenceStore(raw));
      })
      .catch(() => setStore(null));
  }, []);

  const persist = (next: VirtualPlanPreferenceStore, success: string, onSuccess?: () => void) => {
    if (store === null || next === store) return;
    void saveVirtualPlanPreferences(store.revision, JSON.stringify(next))
      .then(() => {
        setStore(next);
        setMessage(success);
        onSuccess?.();
      })
      .catch(() => setMessage("Präferenzen konnten wegen einer konkurrierenden Änderung oder beschädigter Daten nicht gespeichert werden."));
  };

  if (store === null) {
    return <p className="muted">Präferenzen sind nicht lesbar und werden nicht verändert.</p>;
  }
  return (
    <details className="plan-preferences">
      <summary>Präferenzen ({store.preferences.length})</summary>
      <details className="plan-preference-candidates">
        <summary>Präferenzen aus Entscheidungen übernehmen ({candidates.length})</summary>
        {!revalidationCurrent ? <p className="muted">Nur ein aktuell gültiger, virtuell bestätigter Plan kann Kandidaten liefern.</p> : null}
        {candidates.map((candidate) => (
          <label className="plan-preference-candidate" key={candidate.id}>
            <input
              type="checkbox"
              checked={selected.has(candidate.id)}
              onChange={(event) => setSelected((current) => {
                const next = new Set(current);
                if (event.target.checked) next.add(candidate.id); else next.delete(candidate.id);
                return next;
              })}
            />
            <span><strong>{candidate.description}</strong><br />Scope: {candidate.scope.kind} · {candidate.rationale}<br />{candidate.limitation}</span>
          </label>
        ))}
        <button
          type="button"
          disabled={selected.size === 0}
          onClick={() => {
            const next = addSelectedPreferenceCandidates(store, candidates.filter((candidate) => selected.has(candidate.id)));
            persist(next, "Ausgewählte Präferenzen gespeichert.");
            setSelected(new Set());
          }}
        >
          Präferenzen aus Entscheidungen übernehmen
        </button>
      </details>
      <div className="plan-preference-list">
        {store.preferences.map((preference) => (
          <article key={preference.id}>
            <input
              aria-label={`Beschreibung ${preference.description}`}
              value={descriptionEdits[preference.id] ?? preference.description}
              onChange={(event) => setDescriptionEdits((current) => ({
                ...current,
                [preference.id]: event.target.value,
              }))}
            />
            <p className="muted">Scope: {preference.scope.kind} · Quelle: {preference.sourceDecisionId ?? "nicht verfügbar"} · Revision {preference.revision}</p>
            <p className="muted">{preference.rationale ?? "Keine zusätzliche Begründung verfügbar."}</p>
            {descriptionEdits[preference.id] !== undefined && descriptionEdits[preference.id] !== preference.description ? (
              <>
                <button
                  type="button"
                  onClick={() => persist(
                    updateVirtualPlanPreference(store, preference.id, {
                      description: descriptionEdits[preference.id]!,
                      active: preference.active,
                    }),
                    "Präferenz bearbeitet.",
                    () => setDescriptionEdits((current) => {
                      const next = { ...current };
                      delete next[preference.id];
                      return next;
                    }),
                  )}
                >
                  Änderung speichern
                </button>
                <button
                  type="button"
                  onClick={() => setDescriptionEdits((current) => {
                    const next = { ...current };
                    delete next[preference.id];
                    return next;
                  })}
                >
                  Abbrechen
                </button>
              </>
            ) : null}
            <button type="button" onClick={() => persist(updateVirtualPlanPreference(store, preference.id, { description: preference.description, active: !preference.active }), preference.active ? "Präferenz deaktiviert." : "Präferenz erneut aktiviert.")}>
              {preference.active ? "Deaktivieren" : "Erneut aktivieren"}
            </button>
          </article>
        ))}
      </div>
      {message !== null ? <p className="muted">{message}</p> : null}
    </details>
  );
}
