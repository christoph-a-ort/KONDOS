import type { ScanProgress } from "../model";

interface ProgressPanelProps {
  scanning: boolean;
  progress: ScanProgress | null;
}

export function ProgressPanel({ scanning, progress }: ProgressPanelProps) {
  const statusLabel = scanning
    ? "Analyse läuft"
    : progress?.status === "completed"
      ? "Analyse abgeschlossen"
      : progress?.status === "cancelled"
        ? "Analyse abgebrochen"
        : progress?.status === "failed"
          ? "Analyse fehlgeschlagen"
          : "Keine Analyse";

  return (
    <section className="panel">
      <h2>Fortschritt</h2>
      <p className={scanning ? "status active" : "status"}>{statusLabel}</p>
      <p>Analysierte Elemente: {progress?.processedCount ?? 0}</p>
      <p className="current-path" title={progress?.currentPath}>
        Aktueller Pfad: {progress?.currentPath || "–"}
      </p>
    </section>
  );
}
