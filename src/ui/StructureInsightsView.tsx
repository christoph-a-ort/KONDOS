/**
 * P2-J-C/D/E/F/G/H/I – Structure insights view with cards, navigation, search/filters.
 *
 * Presentation + navigation callbacks only. No H/I/J-A, no filesystem.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { InsightCard } from "./InsightCard";
import type { InsightAnalysisError, InsightAnalysisPhase } from "./structureInsightAnalysis";
import {
  formatInsightLocationHeading,
  insightViewModelExpansionKey,
} from "./structureInsightCardsHelpers";
import {
  INSIGHT_FAILED_HEADLINE,
  INSIGHT_FAILED_STRUCTURE_NOTE,
  INSIGHT_PARTIAL_GLOBAL_HEADLINE,
  INSIGHT_PARTIAL_GLOBAL_NOTE,
  INSIGHT_PARTIAL_ZERO_SUMMARY,
  INSIGHT_RETRY_LABEL,
  INSIGHT_RUNNING_MESSAGE,
  INSIGHT_TECH_DETAILS_HIDE_LABEL,
  INSIGHT_TECH_DETAILS_SHOW_LABEL,
  INSIGHT_ZERO_EXPLANATION,
  INSIGHT_ZERO_HEADLINE,
  INSIGHT_ZERO_NEUTRAL_NOTE,
  formatInsightAnalysisErrorDetailLines,
  insightFailedDetailsRegionId,
} from "./structureInsightErrorHelpers";
import {
  DEFAULT_INSIGHT_FILTER_STATE,
  INSIGHT_CATEGORY_FILTER_LABEL,
  INSIGHT_CATEGORY_FILTER_OPTIONS,
  INSIGHT_DETAILS_COLLAPSE_ALL_LABEL,
  INSIGHT_DETAILS_EXPAND_ALL_LABEL,
  INSIGHT_EVIDENCE_FILTER_LABEL,
  INSIGHT_EVIDENCE_FILTER_OPTIONS,
  INSIGHT_FILTER_EMPTY_MESSAGE,
  INSIGHT_FILTER_RESET_LABEL,
  INSIGHT_SEARCH_CLEAR_LABEL,
  INSIGHT_SEARCH_LABEL,
  INSIGHT_SEARCH_PLACEHOLDER,
  cardNeedsDetailOpenForSearch,
  countFilteredInsights,
  filterInsightLocationSections,
  filtersAreActive,
  formatInsightHitCount,
  isInsightCategoryFilter,
  isInsightEvidenceFilter,
  normalizeInsightSearchQuery,
  resetInsightFilters,
  type InsightFilterState,
} from "./structureInsightFilters";
import type { InsightFocusRequest } from "./structureInsightNavigation";
import { formatInsightLocationCountLabel } from "./structureInsightPresentation";
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
  analysisError?: InsightAnalysisError | null;
  /** Retry failed analysis using the current ScanResult (wired in App). */
  onRetryAnalysis?: () => void;
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
  analysisError = null,
  onRetryAnalysis,
  focusRequest = null,
  onNavigateToNode,
}: StructureInsightsViewProps) {
  const expansionKey = insightViewModelExpansionKey(viewModel);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [highlightedInsightId, setHighlightedInsightId] = useState<string | null>(null);
  const [filters, setFilters] = useState<InsightFilterState>(() => DEFAULT_INSIGHT_FILTER_STATE);
  /** Cards the user closed while the current normalized query is active (prevents reopen loop). */
  const [suppressedAutoOpenIds, setSuppressedAutoOpenIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [autoOpenQueryKey, setAutoOpenQueryKey] = useState("");
  const [techDetailsOpen, setTechDetailsOpen] = useState(false);
  const locationSectionEls = useRef<Map<string, HTMLElement>>(new Map());
  const searchInputId = "insight-search-input";
  const evidenceFilterId = "insight-evidence-filter";
  const categoryFilterId = "insight-category-filter";
  const techDetailsId = insightFailedDetailsRegionId();

  useEffect(() => {
    setExpandedIds(new Set());
    setHighlightedInsightId(null);
    setFilters((current) => ({
      ...current,
      query: "",
    }));
    setSuppressedAutoOpenIds(new Set());
    setAutoOpenQueryKey("");
  }, [expansionKey]);

  useEffect(() => {
    setTechDetailsOpen(false);
  }, [phase, analysisError?.detail, analysisError?.name]);

  const normalizedQuery = useMemo(
    () => normalizeInsightSearchQuery(filters.query),
    [filters.query],
  );

  const sections = useMemo(() => {
    if (viewModel === null) {
      return [];
    }
    return filterInsightLocationSections(viewModel, filters);
  }, [viewModel, filters]);

  const visibleCount = useMemo(() => countFilteredInsights(sections), [sections]);
  const totalCount = viewModel?.insights.length ?? 0;
  const hitCountLabel = formatInsightHitCount(visibleCount, totalCount);
  const detailsAllOpen =
    visibleCount > 0 &&
    sections.every((section) => section.cards.every((card) => expandedIds.has(card.id)));

  useEffect(() => {
    if (normalizedQuery !== autoOpenQueryKey) {
      setSuppressedAutoOpenIds(new Set());
      setAutoOpenQueryKey(normalizedQuery);
    }
  }, [normalizedQuery, autoOpenQueryKey]);

  useEffect(() => {
    if (normalizedQuery.length === 0 || viewModel === null) {
      return;
    }
    setExpandedIds((current) => {
      const next = new Set(current);
      let changed = false;
      for (const section of sections) {
        for (const card of section.cards) {
          if (suppressedAutoOpenIds.has(card.id)) {
            continue;
          }
          if (cardNeedsDetailOpenForSearch(card, normalizedQuery) && !next.has(card.id)) {
            next.add(card.id);
            changed = true;
          }
        }
      }
      return changed ? next : current;
    });
  }, [normalizedQuery, sections, suppressedAutoOpenIds, viewModel]);

  useEffect(() => {
    if (focusRequest === null) {
      return;
    }
    setFilters(resetInsightFilters());
    setSuppressedAutoOpenIds(new Set());
    setAutoOpenQueryKey("");
    setHighlightedInsightId(focusRequest.firstInsightId);
  }, [focusRequest?.id]);

  useEffect(() => {
    if (focusRequest === null) {
      return;
    }
    const sectionEl = locationSectionEls.current.get(focusRequest.locationId);
    if (sectionEl !== undefined) {
      sectionEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [focusRequest?.id, sections]);

  const toggleCard = useCallback(
    (cardId: string) => {
      setExpandedIds((current) => {
        const next = new Set(current);
        if (next.has(cardId)) {
          next.delete(cardId);
          if (normalizedQuery.length > 0) {
            setSuppressedAutoOpenIds((suppressed) => {
              const updated = new Set(suppressed);
              updated.add(cardId);
              return updated;
            });
          }
        } else {
          next.add(cardId);
          setSuppressedAutoOpenIds((suppressed) => {
            if (!suppressed.has(cardId)) {
              return suppressed;
            }
            const updated = new Set(suppressed);
            updated.delete(cardId);
            return updated;
          });
        }
        return next;
      });
    },
    [normalizedQuery],
  );

  const navigateToNode = useCallback(
    (nodeId: string) => {
      onNavigateToNode?.(nodeId);
    },
    [onNavigateToNode],
  );

  function expandAllVisibleDetails() {
    setExpandedIds((current) => {
      const next = new Set(current);
      for (const section of sections) {
        for (const card of section.cards) {
          next.add(card.id);
        }
      }
      return next;
    });
    setSuppressedAutoOpenIds(new Set());
  }

  function collapseAllVisibleDetails() {
    const visibleIds = new Set<string>();
    for (const section of sections) {
      for (const card of section.cards) {
        visibleIds.add(card.id);
      }
    }
    setExpandedIds((current) => {
      const next = new Set(current);
      for (const id of visibleIds) {
        next.delete(id);
      }
      return next;
    });
    if (normalizedQuery.length > 0) {
      setSuppressedAutoOpenIds((current) => {
        const next = new Set(current);
        for (const id of visibleIds) {
          next.add(id);
        }
        return next;
      });
    }
  }

  function resetSearchAndFilters() {
    setFilters(resetInsightFilters());
    setSuppressedAutoOpenIds(new Set());
    setAutoOpenQueryKey("");
  }

  if (phase === "running") {
    return (
      <section className="insight-view tree-panel" aria-label="Erkenntnisse">
        <header className="insight-view-header">
          <h2>Erkenntnisse</h2>
          <p className="insight-state" role="status" aria-live="polite">
            <span className="insight-activity" aria-hidden="true" />
            {INSIGHT_RUNNING_MESSAGE}
          </p>
        </header>
      </section>
    );
  }

  if (phase === "failed") {
    const detailLines = formatInsightAnalysisErrorDetailLines(analysisError);
    const retryEnabled = onRetryAnalysis !== undefined;
    return (
      <section className="insight-view tree-panel" aria-label="Erkenntnisse">
        <header className="insight-view-header">
          <h2>Erkenntnisse</h2>
          <div className="insight-failed" role="alert">
            <p className="insight-failed-headline">{INSIGHT_FAILED_HEADLINE}</p>
            <p className="insight-failed-note muted">{INSIGHT_FAILED_STRUCTURE_NOTE}</p>
            <div className="insight-failed-actions">
              {retryEnabled ? (
                <button
                  type="button"
                  className="insight-failed-retry"
                  onClick={onRetryAnalysis}
                >
                  {INSIGHT_RETRY_LABEL}
                </button>
              ) : null}
              {detailLines.length > 0 ? (
                <button
                  type="button"
                  className="insight-failed-details-toggle"
                  aria-expanded={techDetailsOpen}
                  aria-controls={techDetailsId}
                  onClick={() => {
                    setTechDetailsOpen((current) => !current);
                  }}
                >
                  {techDetailsOpen
                    ? INSIGHT_TECH_DETAILS_HIDE_LABEL
                    : INSIGHT_TECH_DETAILS_SHOW_LABEL}
                </button>
              ) : null}
            </div>
            {techDetailsOpen && detailLines.length > 0 ? (
              <pre id={techDetailsId} className="insight-failed-details">
                {detailLines.join("\n")}
              </pre>
            ) : null}
          </div>
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
          <p className="insight-summary">{INSIGHT_ZERO_HEADLINE}</p>
          <p className="insight-state-note muted">{INSIGHT_ZERO_EXPLANATION}</p>
          <p className="insight-state-note muted">{INSIGHT_ZERO_NEUTRAL_NOTE}</p>
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
            <strong>{INSIGHT_PARTIAL_GLOBAL_HEADLINE}</strong>
            <span>{INSIGHT_PARTIAL_GLOBAL_NOTE}</span>
          </p>
          <p className="insight-summary">{INSIGHT_PARTIAL_ZERO_SUMMARY}</p>
          <p className="insight-evidence-info muted">{INSIGHT_EVIDENCE_INFO}</p>
        </header>
      </section>
    );
  }

  const showFilterEmpty = visibleCount === 0 && filtersAreActive(filters);

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
            <strong>{INSIGHT_PARTIAL_GLOBAL_HEADLINE}</strong>
            <span>{INSIGHT_PARTIAL_GLOBAL_NOTE}</span>
          </p>
        ) : null}
        <p className="insight-evidence-info muted">{INSIGHT_EVIDENCE_INFO}</p>
      </header>
      <div className="insight-view-body">
        <div className="insight-filter-bar" role="search">
          <div className="insight-filter-search">
            <label className="insight-filter-label" htmlFor={searchInputId}>
              {INSIGHT_SEARCH_LABEL}
            </label>
            <div className="insight-filter-search-row">
              <input
                id={searchInputId}
                type="search"
                className="insight-filter-search-input"
                value={filters.query}
                placeholder={INSIGHT_SEARCH_PLACEHOLDER}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  const value = event.target.value;
                  setFilters((current) => ({ ...current, query: value }));
                }}
              />
              {filters.query.length > 0 ? (
                <button
                  type="button"
                  className="insight-filter-clear"
                  onClick={() => {
                    setFilters((current) => ({ ...current, query: "" }));
                  }}
                >
                  {INSIGHT_SEARCH_CLEAR_LABEL}
                </button>
              ) : null}
            </div>
          </div>
          <div className="insight-filter-selects">
            <div className="insight-filter-field">
              <label className="insight-filter-label" htmlFor={evidenceFilterId}>
                {INSIGHT_EVIDENCE_FILTER_LABEL}
              </label>
              <select
                id={evidenceFilterId}
                className="insight-filter-select"
                value={filters.evidence}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!isInsightEvidenceFilter(value)) {
                    return;
                  }
                  setFilters((current) => ({ ...current, evidence: value }));
                }}
              >
                {INSIGHT_EVIDENCE_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="insight-filter-field">
              <label className="insight-filter-label" htmlFor={categoryFilterId}>
                {INSIGHT_CATEGORY_FILTER_LABEL}
              </label>
              <select
                id={categoryFilterId}
                className="insight-filter-select"
                value={filters.category}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!isInsightCategoryFilter(value)) {
                    return;
                  }
                  setFilters((current) => ({ ...current, category: value }));
                }}
              >
                {INSIGHT_CATEGORY_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="insight-filter-meta">
            <p className="insight-filter-hit-count" aria-live="polite">
              {hitCountLabel}
            </p>
            <button
              type="button"
              className="insight-filter-details-all"
              onClick={() => {
                if (detailsAllOpen) {
                  collapseAllVisibleDetails();
                } else {
                  expandAllVisibleDetails();
                }
              }}
              disabled={visibleCount === 0}
            >
              {detailsAllOpen
                ? INSIGHT_DETAILS_COLLAPSE_ALL_LABEL
                : INSIGHT_DETAILS_EXPAND_ALL_LABEL}
            </button>
          </div>
        </div>

        {showFilterEmpty ? (
          <div className="insight-filter-empty" role="status">
            <p className="insight-filter-empty-message">{INSIGHT_FILTER_EMPTY_MESSAGE}</p>
            <button
              type="button"
              className="insight-filter-reset"
              onClick={resetSearchAndFilters}
            >
              {INSIGHT_FILTER_RESET_LABEL}
            </button>
          </div>
        ) : (
          <div className="insight-locations">
            {sections.map(({ location, cards }) => {
              const heading = formatInsightLocationHeading(location);
              const locationSegmentNames = location.displayPathSegments.map(
                (segment) => segment.displayName,
              );
              const countLabel = formatInsightLocationCountLabel(cards.length);
              return (
                <section
                  key={location.locationId}
                  className="insight-location"
                  aria-label={`${heading}, ${countLabel}`}
                  ref={(element) => {
                    if (element === null) {
                      locationSectionEls.current.delete(location.locationId);
                    } else {
                      locationSectionEls.current.set(location.locationId, element);
                    }
                  }}
                >
                  <div className="insight-location-heading">
                    <h3 className="insight-location-path">
                      <LocationPath location={location} onNavigateToNode={onNavigateToNode} />
                    </h3>
                    <span className="insight-location-count">{countLabel}</span>
                  </div>
                  <div className="insight-location-cards">
                    {cards.map((card) => (
                      <InsightCard
                        key={card.id}
                        card={card}
                        expanded={expandedIds.has(card.id)}
                        highlighted={highlightedInsightId === card.id}
                        searchQuery={filters.query}
                        locationSegmentNames={locationSegmentNames}
                        onToggleDetails={() => {
                          toggleCard(card.id);
                        }}
                        onNavigateToLocation={
                          onNavigateToNode !== undefined
                            ? () => {
                                navigateToNode(card.locationId);
                              }
                            : undefined
                        }
                        onNavigateToNode={
                          onNavigateToNode !== undefined ? navigateToNode : undefined
                        }
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
