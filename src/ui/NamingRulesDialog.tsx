import { useEffect, useId, useState } from "react";

import { isTauriRuntime } from "./workbenchPrefsApi";
import {
  addNamingRule,
  createNamingRule,
  deleteNamingRule,
  emptyNamingRuleStore,
  hydrateNamingRuleStore,
  moveNamingRule,
  NAMING_FORMATS,
  NAMING_FORMAT_LABELS,
  NAMING_PLACEHOLDER_LABELS,
  namingRuleSchemaError,
  persistNamingRuleStore,
  setNamingRuleEnabled,
  updateNamingRule,
  type NamingRule,
  type NamingRuleFormat,
  type NamingRuleStore,
  type NamingRulesJsonStore,
} from "./namingRules";
import { loadNamingRulesJson, saveNamingRulesJson } from "./namingRulesApi";

interface NamingRulesDialogProps {
  open: boolean;
  onClose: () => void;
  onIssue?: (message: string) => void;
}

function createJsonStore(): NamingRulesJsonStore | null {
  if (!isTauriRuntime()) {
    return null;
  }
  return {
    load: () => loadNamingRulesJson(),
    save: (json) => saveNamingRulesJson(json),
  };
}

export function NamingRulesDialog({ open, onClose, onIssue }: NamingRulesDialogProps) {
  const titleId = useId();
  const [store, setStore] = useState<NamingRuleStore>(emptyNamingRuleStore);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setNotice(null);
    void hydrateNamingRuleStore(createJsonStore())
      .then((next) => {
        if (cancelled) {
          return;
        }
        setStore(next);
        setSelectedId(next.rules[0]?.id ?? null);
      })
      .catch((cause) => {
        if (!cancelled) {
          onIssue?.(cause instanceof Error ? cause.message : "Die Benennungsregeln konnten nicht geladen werden.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, onIssue]);

  if (!open) {
    return null;
  }

  const selected = store.rules.find((rule) => rule.id === selectedId) ?? null;

  function commit(next: NamingRuleStore, message: string, selectId: string | null = selectedId) {
    setStore(next);
    setSelectedId(selectId);
    setNotice(message);
    void persistNamingRuleStore(next, createJsonStore()).catch((cause) => {
      onIssue?.(cause instanceof Error ? cause.message : "Die Benennungsregeln konnten nicht gespeichert werden.");
    });
  }

  return (
    <div className="report-dialog-backdrop naming-rules-backdrop" onMouseDown={onClose}>
      <div
        className="report-dialog naming-rules-dialog"
        role="dialog"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <h2 id={titleId}>Benennungsregeln</h2>
        <p className="muted">
          Eigene Regeln haben Vorrang. Ohne passende Regel bleibt der bisherige Namensvorschlag. Fehlende Angaben
          werden nicht erfunden.
        </p>
        {loading ? <p className="muted">Benennungsregeln werden geladen…</p> : null}
        {!loading ? (
          <>
            <div className="naming-rules-toolbar">
              <button
                type="button"
                onClick={() => {
                  const rule = createNamingRule(store.rules);
                  commit(addNamingRule(store, rule), "Regel angelegt.", rule.id);
                }}
              >
                Neue Regel
              </button>
            </div>
            {store.rules.length === 0 ? (
              <p className="muted">Noch keine Regeln. Der bisherige Namensvorschlag bleibt aktiv.</p>
            ) : (
              <ul className="naming-rules-list">
                {store.rules.map((rule, index) => (
                  <li key={rule.id} className={rule.id === selectedId ? "is-selected" : undefined}>
                    <button type="button" className="naming-rules-select" onClick={() => setSelectedId(rule.id)}>
                      {rule.name}
                      {rule.enabled ? "" : " (inaktiv)"}
                    </button>
                    <span className="naming-rules-order">
                      <button
                        type="button"
                        disabled={index === 0}
                        title="Höhere Priorität"
                        onClick={() => commit(moveNamingRule(store, rule.id, -1), "Reihenfolge gespeichert.", rule.id)}
                      >
                        Nach oben
                      </button>
                      <button
                        type="button"
                        disabled={index === store.rules.length - 1}
                        title="Niedrigere Priorität"
                        onClick={() => commit(moveNamingRule(store, rule.id, 1), "Reihenfolge gespeichert.", rule.id)}
                      >
                        Nach unten
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const next = deleteNamingRule(store, rule.id);
                          commit(next, "Regel gelöscht.", next.rules[Math.max(0, index - 1)]?.id ?? null);
                        }}
                      >
                        Löschen
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {selected !== null ? (
              <NamingRuleEditor
                rule={selected}
                onChange={(patch) => commit(updateNamingRule(store, selected.id, patch), "Regel gespeichert.", selected.id)}
                onToggle={(enabled) =>
                  commit(setNamingRuleEnabled(store, selected.id, enabled), enabled ? "Regel aktiv." : "Regel inaktiv.", selected.id)
                }
              />
            ) : null}
            {notice !== null ? <p className="muted">{notice}</p> : null}
          </>
        ) : null}
        <div className="report-dialog-actions">
          <button type="button" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}

function NamingRuleEditor({
  rule,
  onChange,
  onToggle,
}: {
  rule: NamingRule;
  onChange: (patch: Partial<NamingRule>) => void;
  onToggle: (enabled: boolean) => void;
}) {
  const [name, setName] = useState(rule.name);
  const [keywordsText, setKeywordsText] = useState(rule.keywords.join(", "));
  const [documentType, setDocumentType] = useState(rule.documentType);
  const [schema, setSchema] = useState(rule.schema);
  useEffect(() => {
    setName(rule.name);
    setKeywordsText(rule.keywords.join(", "));
    setDocumentType(rule.documentType);
    setSchema(rule.schema);
  }, [rule]);
  const schemaError = namingRuleSchemaError(schema);
  return (
    <div className="naming-rule-editor">
      <label className="check">
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <span>Regel aktiv</span>
      </label>
      <div className="report-dialog-field">
        <label htmlFor={`naming-rule-name-${rule.id}`}>Regelname</label>
        <input
          id={`naming-rule-name-${rule.id}`}
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => onChange({ name })}
        />
      </div>
      <fieldset className="report-dialog-fieldset">
        <legend>Dateityp (nur wenn zuverlässig erkannt)</legend>
        {NAMING_FORMATS.map((format) => (
          <label className="report-dialog-check" key={format}>
            <input
              type="checkbox"
              checked={rule.formats.includes(format)}
              onChange={(event) => onChange({ formats: toggleFormat(rule.formats, format, event.target.checked) })}
            />
            <span>{NAMING_FORMAT_LABELS[format]}</span>
          </label>
        ))}
        <p className="muted">Ohne Auswahl gilt die Regel für alle unterstützten Dateitypen.</p>
      </fieldset>
      <div className="report-dialog-field">
        <label htmlFor={`naming-rule-keywords-${rule.id}`}>Schlüsselwörter im Dokumentinhalt</label>
        <input
          id={`naming-rule-keywords-${rule.id}`}
          type="text"
          value={keywordsText}
          placeholder="z. B. Rechnung, Invoice"
          onChange={(event) => setKeywordsText(event.target.value)}
          onBlur={() =>
            onChange({
              keywords: keywordsText
                .split(",")
                .map((item) => item.trim())
                .filter((item) => item.length > 0),
            })
          }
        />
        <p className="muted">Alle Wörter müssen vorkommen. Ohne Wörter zählt nur der Dateityp bzw. die Reihenfolge.</p>
      </div>
      <div className="report-dialog-field">
        <label htmlFor={`naming-rule-type-${rule.id}`}>Dokumentart für {"{dokumenttyp}"}</label>
        <input
          id={`naming-rule-type-${rule.id}`}
          type="text"
          value={documentType}
          placeholder="z. B. Rechnung"
          onChange={(event) => setDocumentType(event.target.value)}
          onBlur={() => onChange({ documentType })}
        />
        <p className="muted">Wird nicht aus dem Dokument geraten. Leer lassen, wenn die Art jeweils erfragt werden soll.</p>
      </div>
      <div className="report-dialog-field">
        <label htmlFor={`naming-rule-schema-${rule.id}`}>Dateinamensschema</label>
        <input
          id={`naming-rule-schema-${rule.id}`}
          type="text"
          value={schema}
          spellCheck={false}
          onChange={(event) => setSchema(event.target.value)}
          onBlur={() => onChange({ schema })}
        />
        {schemaError !== null ? <p className="report-dialog-error">{schemaError}</p> : null}
        <p className="muted">
          Platzhalter: {Object.entries(NAMING_PLACEHOLDER_LABELS).map(([key, label]) => `{${key}} ${label}`).join(" · ")}
        </p>
      </div>
    </div>
  );
}

function toggleFormat(formats: NamingRuleFormat[], format: NamingRuleFormat, enabled: boolean): NamingRuleFormat[] {
  if (enabled) {
    return formats.includes(format) ? formats : [...formats, format];
  }
  return formats.filter((item) => item !== format);
}
