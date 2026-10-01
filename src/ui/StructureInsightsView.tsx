/**
 * P2-J-C – Structure insights ground view (presentation only).
 *
 * Renders analysis phase / ViewModel summaries. Does not run H/I/J-A,
 * does not scan, does not mutate the filesystem, and has no retry UI.
 */

import type { InsightAnalysisPhase } from "./structureInsightAnalysis";
import type { StructureInsightViewModel } from "./structureInsightViewModel";
import {
  INSIGHT_EVIDENCE_INFO,
  formatInsightEvidenceSummary,
  formatInsightReadyHeadline,
} from "./structureInsightsViewHelpers";

export type { MainView } from "./structureInsightsViewHelpers";
export {
  INSIGHT_EVIDENCE_INFO,
  canSelectInsightsView,
  defaultMainView,
  formatInsightEvidenceSummary,
  formatInsightReadyHeadline,
  insightNavCountLabel,
  mainViewAfterScanStart,
  shouldAutoSwitchMainViewOnPhase,
} from "./structureInsightsViewHelpers";

export interface StructureInsightsViewProps {
  phase: InsightAnalysisPhase;
  viewModel: StructureInsightViewModel | null;
}

export function StructureInsightsView({ phase, viewModel }: StructureInsightsViewProps) {
  if (phase === "running") {
    return (
      <section className="insight-view tree-panel" aria-label="Erkenntnisse">
        <header className="insight-view-header">
          <h2>Erkenntnisse</h2>
          <p className="insight-state" role="status" aria-live="polite">
            <span className="insight-activity" aria-hidden="true" />
            Erkenntnisse werden ermittelt …
          </p>
        </header>
      </section>
    );
  }

  if (phase === "failed") {
    return (
      <section className="insight-view tree-panel" aria-label="Erkenntnisse">
        <header className="insight-view-header">
          <h2>Erkenntnisse</h2>
          <p className="insight-state">
            Die Erkenntnisse konnten für diesen eingelesenen Bestand nicht ermittelt werden.
          </p>
          <p className="insight-state-note muted">
            Die eingelesene Ordnerstruktur steht weiterhin zur Verfügung.
          </p>
        </header>
      </section>
    );
  }

  if (phase === "idle" || viewModel === null) {
    return (
      <section className="insight-view tree-panel" aria-label="Erkenntnisse">
        <header className="insight-view-header">
          <h2>Erkenntnisse</h2>
          <p className="insight-state">
            Für diesen eingelesenen Bestand liegen noch keine Analyseergebnisse vor.
          </p>
        </header>
      </section>
    );
  }

  // ready
  const count = viewModel.insights.length;
  const incomplete = viewModel.globallyIncomplete;
  const evidenceSummary = formatInsightEvidenceSummary(viewModel.countsByEvidence);

  if (count === 0 && !incomplete) {
    return (
      <section className="insight-view tree-panel" aria-label="Erkenntnisse">
        <header className="insight-view-header">
          <h2>Erkenntnisse</h2>
          <p className="insight-summary">
            Dotty hat im eingelesenen Bestand keine strukturellen Muster erkannt.
          </p>
          <p className="insight-state-note muted">Das ist keine Bewertung der Ablage.</p>
          <p className="insight-evidence-info muted">{INSIGHT_EVIDENCE_INFO}</p>
        </header>
      </section>
    );
  }

  if (count === 0 && incomplete) {
    return (
      <section className="insight-view tree-panel" aria-label="Erkenntnisse">
        <header className="insight-view-header">
          <h2>Erkenntnisse</h2>
          <p className="insight-partial-note" role="note">
            <strong>Analyse teilweise eingeschränkt</strong>
            <span>
              Für Teile des eingelesenen Bestands war die Datengrundlage eingeschränkt.
            </span>
          </p>
          <p className="insight-summary">
            Es wurden keine strukturellen Muster ermittelt. Die Analyse war teilweise
            eingeschränkt.
          </p>
          <p className="insight-evidence-info muted">{INSIGHT_EVIDENCE_INFO}</p>
        </header>
      </section>
    );
  }

  return (
    <section className="insight-view tree-panel" aria-label="Erkenntnisse">
      <header className="insight-view-header">
        <h2>Erkenntnisse</h2>
        <p className="insight-summary">{formatInsightReadyHeadline(count)}</p>
        {evidenceSummary.length > 0 ? (
          <p className="insight-evidence-counts">{evidenceSummary}</p>
        ) : null}
        {incomplete ? (
          <p className="insight-partial-note" role="note">
            <strong>Analyse teilweise eingeschränkt</strong>
            <span>
              Für Teile des eingelesenen Bestands war die Datengrundlage eingeschränkt.
            </span>
          </p>
        ) : null}
        <p className="insight-evidence-info muted">{INSIGHT_EVIDENCE_INFO}</p>
      </header>
      <div className="insight-view-body" aria-hidden="true" />
    </section>
  );
}
