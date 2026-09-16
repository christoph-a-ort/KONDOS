import type { Dispatch, SetStateAction } from "react";

import { MAX_DEPTH, MIN_DEPTH, type ScanConfig } from "../model";

interface ConfigPanelProps {
  config: ScanConfig;
  extensionInput: string;
  scanning: boolean;
  locked: boolean;
  onConfigChange: Dispatch<SetStateAction<ScanConfig>>;
  onExtensionInputChange: (value: string) => void;
  onPickDirectory: () => void;
  onStartScan: () => void;
  onCancelScan: () => void;
}

export function ConfigPanel({
  config,
  extensionInput,
  scanning,
  locked,
  onConfigChange,
  onExtensionInputChange,
  onPickDirectory,
  onStartScan,
  onCancelScan,
}: ConfigPanelProps) {
  const inputsLocked = scanning || locked;
  return (
    <section className="panel">
      <h2>Konfiguration</h2>

      <label className="field">
        <span>Startverzeichnis</span>
        <div className="path-row">
          <input
            readOnly
            value={config.rootPath}
            placeholder="Kein Ordner gewählt"
          />
          <button type="button" onClick={onPickDirectory} disabled={inputsLocked}>
            Ordner wählen
          </button>
        </div>
      </label>

      <label className="field">
        <span>Maximale Tiefe ({config.maxDepth})</span>
        <input
          type="range"
          min={MIN_DEPTH}
          max={MAX_DEPTH}
          value={config.maxDepth}
          disabled={inputsLocked}
          onChange={(event) => {
            onConfigChange((current) => ({
              ...current,
              maxDepth: Number(event.target.value),
            }));
          }}
        />
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={config.excludeHidden}
          disabled={inputsLocked}
          onChange={(event) => {
            onConfigChange((current) => ({
              ...current,
              excludeHidden: event.target.checked,
            }));
          }}
        />
        <span>Versteckte Dateien und Ordner ausschließen</span>
      </label>

      <label className="field">
        <span>Dateiendungen (optional)</span>
        <input
          value={extensionInput}
          disabled={inputsLocked}
          placeholder=".pdf, .png, .docx"
          onChange={(event) => onExtensionInputChange(event.target.value)}
        />
      </label>

      <fieldset className="meta">
        <legend>Metadaten</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={config.includeSize}
            disabled={inputsLocked}
            onChange={(event) => {
              onConfigChange((current) => ({
                ...current,
                includeSize: event.target.checked,
              }));
            }}
          />
          <span>Dateigröße</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={config.includeCreatedAt}
            disabled={inputsLocked}
            onChange={(event) => {
              onConfigChange((current) => ({
                ...current,
                includeCreatedAt: event.target.checked,
              }));
            }}
          />
          <span>Erstellungsdatum</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={config.includeModifiedAt}
            disabled={inputsLocked}
            onChange={(event) => {
              onConfigChange((current) => ({
                ...current,
                includeModifiedAt: event.target.checked,
              }));
            }}
          />
          <span>Änderungsdatum</span>
        </label>
      </fieldset>

      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={onStartScan}
          disabled={inputsLocked || config.rootPath.trim() === ""}
        >
          Analyse starten
        </button>
        <button type="button" onClick={onCancelScan} disabled={!scanning}>
          Abbrechen
        </button>
      </div>
    </section>
  );
}
