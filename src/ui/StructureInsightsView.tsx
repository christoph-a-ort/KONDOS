/**
 * P2-J-C/D/E/F – Structure insights view with cards, details, and navigation.
 *
 * Presentation + navigation callbacks only. No H/I/J-A, no filesystem.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { InsightCard } from "./InsightCard";
import type { InsightAnalysisPhase } from "./structureInsightAnalysis";
import {
  formatInsightLocationHeading,
  insightViewModelExpansionKey,
  listInsightLocationSections,
} from "./structureInsightCardsHelpers";
import type { InsightFocusRequest } from "./structureInsightNavigation";
import type { InsightLocationGroup, StructureInsightViewModel } from "./structureInsightViewModel";
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
  focusRequest?: InsightFocusRequest | null;
  onNavigateToNode?: (nodeId: string) => void;
}

function LocationPath({
  location,
  onNavigateToNode,
}: {
  location: InsightLocationGroup;
  onNavigateToNode?: (nodeId: string) => void;
}) {
  if (location.kind === "root" || location.displayPathSegments.length === 0) {
    const label = formatInsightLocationHeading(location);
    if (onNavigateToNode === undefined) {
      return <span className="insight-location-path-text">{label}</span>;
    }
    return (
      <button
        type="button"
        className="insight-location-path-segment"
        onClick={() => {
          onNavigateToNode(location.locationId);
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <span className="insight-location-path-segments">
      {location.displayPathSegments.map((segment, index) => (
        <span key={segment.nodeId} className="insight-location-path-piece">
          {index > 0 ? (
            <span className="insight-location-path-sep" aria-hidden="true">
              {" › "}
            </span>
          ) : null}
          {onNavigateToNode !== undefined ? (
            <button
              type="button"
              className="insight-location-path-segment"
              onClick={() => {
                onNavigateToNode(segment.nodeId);
              }}
            >
              {segment.displayName}
            </button>
          ) : (
            <span className="insight-location-path-text">{segment.displayName}</span>
          )}
        </span>
      ))}
    </span>
  );
}

export function StructureInsightsView({
  phase,
  viewModel,
  focusRequest = null,
  onNavigateToNode,
}: StructureInsightsViewProps) {
  const expansionKey = insightViewModelExpansionKey(viewModel);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [highlightedInsightId, setHighlightedInsightId] = useState<string | null>(null);
  const locationSectionEls = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    setExpandedIds(new Set());
    setHighlightedInsightId(null);
  }, [expansionKey]);

  const sections = useMemo(
    () => (viewModel === null ? [] : listInsightLocationSections(viewModel)),
    [viewModel],
  );

  useEffect(() => {
    if (focusRequest === null) {
      return;
    }
    setHighlightedInsightId(focusRequest.firstInsightId);
    const sectionEl = locationSectionEls.current.get(focusRequest.locationId);
    if (sectionEl !== undefined) {
      sectionEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [focusRequest?.id]);

  function toggleCard(cardId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  }

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
      <div className="insight-view-body">
        <div className="insight-locations">
          {sections.map(({ location, cards }) => {
            if (cards.length === 0) {
              return null;
            }
            const heading = formatInsightLocationHeading(location);
            return (
              <section
                key={location.locationId}
                className="insight-location"
                aria-label={heading}
                ref={(element) => {
                  if (element === null) {
                    locationSectionEls.current.delete(location.locationId);
                  } else {
                    locationSectionEls.current.set(location.locationId, element);
                  }
                }}
              >
                <h3 className="insight-location-path">
                  <LocationPath location={location} onNavigateToNode={onNavigateToNode} />
                </h3>
                <div className="insight-location-cards">
                  {cards.map((card) => (
                    <InsightCard
                      key={card.id}
                      card={card}
                      expanded={expandedIds.has(card.id)}
                      highlighted={highlightedInsightId === card.id}
                      onToggleDetails={() => {
                        toggleCard(card.id);
                      }}
                      onNavigateToLocation={
                        onNavigateToNode !== undefined
                          ? () => {
                              onNavigateToNode(card.locationId);
                            }
                          : undefined
                      }
                      onNavigateToNode={onNavigateToNode}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </section>
  );
}
