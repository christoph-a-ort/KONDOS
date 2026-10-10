/**
 * P2-J-E/G/I – Expanded insight-card detail body (READ-ONLY presentation).
 *
 * Renders explanation, structure summary extras, and element lists from the
 * ViewModel. J-I adds compact examples and path presentation. No H/I/J-A.
 */

import { useEffect, useMemo, useState } from "react";

import { InsightSearchHighlight } from "./InsightSearchHighlight";
import type {
  InsightCardModel,
  InsightElementRef,
  InsightSecondaryRecurringGroup,
} from "./structureInsightViewModel";
import {
  INSIGHT_EXPLANATION_HEADING,
  INSIGHT_INCOMPLETE_DETAIL_NOTE,
  INSIGHT_LIST_SHOW_LESS_LABEL,
  INSIGHT_LIST_SHOW_MORE_LABEL,
  INSIGHT_PRIMARY_ELEMENTS_HEADING,
  INSIGHT_SECONDARY_GROUPS_INTRO,
  INSIGHT_STRUCTURE_EXAMPLES_LABEL,
  INSIGHT_STRUCTURE_HEADING,
  INSIGHT_STRUCTURE_PARTS_LABEL,
  displayableExamples,
  displayableExplanationBullets,
  displayableStructuralParts,
  insightElementListHasMore,
  insightNestedListKey,
  otherElementsHeading,
  visibleInsightElements,
} from "./structureInsightDetailsHelpers";
import {
  cardDetailListKeysNeedingOpen,
  elementListNeedsShowAllForSearch,
  normalizeInsightSearchQuery,
  textMatchesInsightQuery,
} from "./structureInsightFilters";
import {
  countDisplayNames,
  insightElementPathPresentation,
  insightExamplesHaveMore,
  visibleInsightExamples,
} from "./structureInsightPresentation";

export interface InsightCardDetailsProps {
  card: InsightCardModel;
  onNavigateToNode?: (nodeId: string) => void;
  /** Raw search query from J-G filter bar (may be empty). */
  searchQuery?: string;
  /** Fundort breadcrumb display names for path redundancy checks. */
  locationSegmentNames?: readonly string[];
}

function ElementRows({
  elements,
  allElements,
  onNavigateToNode,
  normalizedQuery,
  locationSegmentNames,
}: {
  elements: readonly InsightElementRef[];
  allElements: readonly InsightElementRef[];
  onNavigateToNode?: (nodeId: string) => void;
  normalizedQuery: string;
  locationSegmentNames: readonly string[];
}) {
  const nameCounts = useMemo(() => countDisplayNames(allElements), [allElements]);

  return (
    <ul className="insight-detail-element-list">
      {elements.map((element) => {
        const presentation = insightElementPathPresentation(
          element,
          locationSegmentNames,
          nameCounts,
        );
        const nameNode = (
          <span className="insight-detail-element-name">
            <InsightSearchHighlight text={presentation.name} normalizedQuery={normalizedQuery} />
          </span>
        );
        const pathNode =
          presentation.secondaryPath !== null ? (
            <span className="insight-detail-element-path">
              <InsightSearchHighlight
                text={presentation.secondaryPath}
                normalizedQuery={normalizedQuery}
              />
            </span>
          ) : null;
        const title =
          presentation.fullPathTitle !== null ? presentation.fullPathTitle : undefined;
        const ariaLabel =
          presentation.fullPathTitle !== null
            ? `${presentation.name}, ${presentation.fullPathTitle}`
            : presentation.name;
        return (
          <li key={element.nodeId} className="insight-detail-element">
            {onNavigateToNode !== undefined ? (
              <button
                type="button"
                className="insight-detail-element-nav"
                title={title}
                aria-label={ariaLabel}
                onClick={() => {
                  onNavigateToNode(element.nodeId);
                }}
              >
                {nameNode}
                {pathNode}
              </button>
            ) : (
              <span className="insight-detail-element-static" title={title}>
                {nameNode}
                {pathNode}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CollapsibleElementList({
  listKey,
  heading,
  elements,
  open,
  onToggle,
  regionId,
  onNavigateToNode,
  normalizedQuery,
  locationSegmentNames,
}: {
  listKey: string;
  heading: string;
  elements: readonly InsightElementRef[];
  open: boolean;
  onToggle: () => void;
  regionId: string;
  onNavigateToNode?: (nodeId: string) => void;
  normalizedQuery: string;
  locationSegmentNames: readonly string[];
}) {
  const [showAll, setShowAll] = useState(false);
  const needsShowAll = elementListNeedsShowAllForSearch(elements, normalizedQuery);
  const effectiveShowAll = showAll || needsShowAll;
  const hasMore = insightElementListHasMore(elements.length);
  const visible = visibleInsightElements(elements, effectiveShowAll);

  useEffect(() => {
    if (!open) {
      setShowAll(false);
    }
  }, [open]);

  useEffect(() => {
    if (needsShowAll) {
      setShowAll(true);
    }
  }, [needsShowAll]);

  if (elements.length === 0) {
    return null;
  }

  return (
    <div className="insight-detail-list-block" data-list-key={listKey}>
      <button
        type="button"
        className="insight-detail-list-toggle"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={onToggle}
      >
        <span className="insight-card-details-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        {heading}
      </button>
      {open ? (
        <div id={regionId} className="insight-detail-list-region">
          <ElementRows
            elements={visible}
            allElements={elements}
            onNavigateToNode={onNavigateToNode}
            normalizedQuery={normalizedQuery}
            locationSegmentNames={locationSegmentNames}
          />
          {hasMore ? (
            <button
              type="button"
              className="insight-detail-list-more"
              onClick={() => {
                setShowAll((current) => !current);
              }}
            >
              {effectiveShowAll ? INSIGHT_LIST_SHOW_LESS_LABEL : INSIGHT_LIST_SHOW_MORE_LABEL}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SecondaryGroupBlock({
  cardId,
  group,
  open,
  onToggle,
  onNavigateToNode,
  normalizedQuery,
  locationSegmentNames,
}: {
  cardId: string;
  group: InsightSecondaryRecurringGroup;
  open: boolean;
  onToggle: () => void;
  onNavigateToNode?: (nodeId: string) => void;
  normalizedQuery: string;
  locationSegmentNames: readonly string[];
}) {
  const listKey = insightNestedListKey(cardId, "secondary", group.groupKey);
  const regionId = `insight-detail-list-${cardId}-sec-${group.groupKey}`;
  return (
    <CollapsibleElementList
      listKey={listKey}
      heading={group.label}
      elements={group.elements}
      open={open}
      onToggle={onToggle}
      regionId={regionId}
      onNavigateToNode={onNavigateToNode}
      normalizedQuery={normalizedQuery}
      locationSegmentNames={locationSegmentNames}
    />
  );
}

export function InsightCardDetails({
  card,
  onNavigateToNode,
  searchQuery = "",
  locationSegmentNames = [],
}: InsightCardDetailsProps) {
  const normalizedQuery = normalizeInsightSearchQuery(searchQuery);
  const [openLists, setOpenLists] = useState<ReadonlySet<string>>(() => new Set());
  const [showAllExamples, setShowAllExamples] = useState(false);

  useEffect(() => {
    if (normalizedQuery.length === 0) {
      return;
    }
    const keys = cardDetailListKeysNeedingOpen(card, normalizedQuery);
    if (keys.length === 0) {
      return;
    }
    setOpenLists((current) => {
      const next = new Set(current);
      let changed = false;
      for (const key of keys) {
        if (!next.has(key)) {
          next.add(key);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [card, normalizedQuery]);

  const plainDescription = card.structureSummary.plainDescription.trim();
  const bullets = displayableExplanationBullets(card.explanationBullets);
  const examples = displayableExamples(card.structureSummary.examples);
  const parts = displayableStructuralParts(card.structureSummary.structuralParts);

  const exampleNeedsShowAll =
    normalizedQuery.length > 0 &&
    examples.some(
      (example, index) =>
        index >= 3 && textMatchesInsightQuery(example, normalizedQuery),
    );

  useEffect(() => {
    if (exampleNeedsShowAll) {
      setShowAllExamples(true);
    }
  }, [exampleNeedsShowAll]);

  useEffect(() => {
    if (normalizedQuery.length === 0) {
      setShowAllExamples(false);
    }
  }, [normalizedQuery]);

  function toggleList(key: string) {
    setOpenLists((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const primary = card.primaryElements;
  const secondary = card.secondaryRecurringGroups.filter((group) => group.elements.length > 0);
  const other = card.otherElements;
  const otherHeading = otherElementsHeading(other);

  const primaryKey = insightNestedListKey(card.id, "primary");
  const otherKey = insightNestedListKey(card.id, "other");

  const hasExplanation = plainDescription.length > 0 || bullets.length > 0;
  const hasStructureExtras = examples.length > 0 || parts.length > 0;
  const effectiveShowAllExamples = showAllExamples || exampleNeedsShowAll;
  const visibleExamples = visibleInsightExamples(examples, effectiveShowAllExamples);
  const examplesHaveMore = insightExamplesHaveMore(examples.length);

  return (
    <div className="insight-card-details-body">
      {hasExplanation ? (
        <section className="insight-detail-section" aria-label={INSIGHT_EXPLANATION_HEADING}>
          <h5 className="insight-detail-heading">{INSIGHT_EXPLANATION_HEADING}</h5>
          {plainDescription.length > 0 ? (
            <p className="insight-card-details-summary">
              <InsightSearchHighlight text={plainDescription} normalizedQuery={normalizedQuery} />
            </p>
          ) : null}
          {bullets.length > 0 ? (
            <ul className="insight-detail-bullets">
              {bullets.map((bullet, index) => (
                <li key={`${card.id}-bullet-${index}`}>
                  <InsightSearchHighlight text={bullet} normalizedQuery={normalizedQuery} />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : (
        <p className="insight-card-details-summary muted">Keine weitere Kurzbeschreibung vorhanden.</p>
      )}

      {hasStructureExtras ? (
        <section className="insight-detail-section" aria-label={INSIGHT_STRUCTURE_HEADING}>
          <h5 className="insight-detail-heading">{INSIGHT_STRUCTURE_HEADING}</h5>
          {parts.length > 0 ? (
            <div className="insight-detail-parts">
              <p className="insight-detail-sublabel">{INSIGHT_STRUCTURE_PARTS_LABEL}</p>
              <ul className="insight-detail-parts-list">
                {parts.map((part, index) => (
                  <li key={`${card.id}-part-${index}`}>
                    <InsightSearchHighlight text={part} normalizedQuery={normalizedQuery} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {examples.length > 0 ? (
            <div className="insight-detail-examples">
              <p className="insight-detail-sublabel">{INSIGHT_STRUCTURE_EXAMPLES_LABEL}</p>
              <ul className="insight-detail-examples-list">
                {visibleExamples.map((example, index) => (
                  <li key={`${card.id}-ex-${index}`}>
                    <span className="insight-detail-example-mark">Beispiel:</span>{" "}
                    <InsightSearchHighlight text={example} normalizedQuery={normalizedQuery} />
                  </li>
                ))}
              </ul>
              {examplesHaveMore ? (
                <button
                  type="button"
                  className="insight-detail-list-more"
                  onClick={() => {
                    setShowAllExamples((current) => !current);
                  }}
                >
                  {effectiveShowAllExamples
                    ? INSIGHT_LIST_SHOW_LESS_LABEL
                    : INSIGHT_LIST_SHOW_MORE_LABEL}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {primary.length > 0 ? (
        <section className="insight-detail-section" aria-label={INSIGHT_PRIMARY_ELEMENTS_HEADING}>
          <CollapsibleElementList
            listKey={primaryKey}
            heading={INSIGHT_PRIMARY_ELEMENTS_HEADING}
            elements={primary}
            open={openLists.has(primaryKey)}
            onToggle={() => {
              toggleList(primaryKey);
            }}
            regionId={`insight-detail-list-${card.id}-primary`}
            onNavigateToNode={onNavigateToNode}
            normalizedQuery={normalizedQuery}
            locationSegmentNames={locationSegmentNames}
          />
        </section>
      ) : null}

      {secondary.length > 0 ? (
        <section className="insight-detail-section" aria-label={INSIGHT_SECONDARY_GROUPS_INTRO}>
          <h5 className="insight-detail-heading">{INSIGHT_SECONDARY_GROUPS_INTRO}</h5>
          <p className="insight-detail-note muted">
            Weitere wiederkehrende Muster in denselben Daten — keine Bewertung der Ablage.
          </p>
          <div className="insight-detail-secondary-groups">
            {secondary.map((group) => {
              const key = insightNestedListKey(card.id, "secondary", group.groupKey);
              return (
                <SecondaryGroupBlock
                  key={group.groupKey}
                  cardId={card.id}
                  group={group}
                  open={openLists.has(key)}
                  onToggle={() => {
                    toggleList(key);
                  }}
                  onNavigateToNode={onNavigateToNode}
                  normalizedQuery={normalizedQuery}
                  locationSegmentNames={locationSegmentNames}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {other.length > 0 ? (
        <section className="insight-detail-section" aria-label={otherHeading}>
          <CollapsibleElementList
            listKey={otherKey}
            heading={otherHeading}
            elements={other}
            open={openLists.has(otherKey)}
            onToggle={() => {
              toggleList(otherKey);
            }}
            regionId={`insight-detail-list-${card.id}-other`}
            onNavigateToNode={onNavigateToNode}
            normalizedQuery={normalizedQuery}
            locationSegmentNames={locationSegmentNames}
          />
        </section>
      ) : null}

      {card.incompleteData ? (
        <p className="insight-detail-incomplete-note muted">{INSIGHT_INCOMPLETE_DETAIL_NOTE}</p>
      ) : null}
    </div>
  );
}
