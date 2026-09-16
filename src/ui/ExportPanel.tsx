import type { ExportFormat } from "../model";

interface ExportPanelProps {
  format: ExportFormat;
  disabled: boolean;
  busy: boolean;
  onFormatChange: (format: ExportFormat) => void;
  onCopy: () => void;
  onSave: () => void;
}

const FORMATS: ExportFormat[] = ["txt", "json", "csv"];

export function ExportPanel({
  format,
  disabled,
  busy,
  onFormatChange,
  onCopy,
  onSave,
}: ExportPanelProps) {
  return (
    <section className="panel">
      <h2>Export</h2>
      <label className="field">
        <span>Format</span>
        <select
          value={format}
          disabled={disabled || busy}
          onChange={(event) => onFormatChange(event.target.value as ExportFormat)}
        >
          {FORMATS.map((item) => (
            <option key={item} value={item}>
              {item.toUpperCase()}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button type="button" onClick={onCopy} disabled={disabled || busy}>
          In Zwischenablage kopieren
        </button>
        <button type="button" onClick={onSave} disabled={disabled || busy}>
          Als Datei speichern
        </button>
      </div>
    </section>
  );
}
