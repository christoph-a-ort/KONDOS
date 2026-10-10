/**
 * P2-J-E – Expanded insight-card detail body (READ-ONLY presentation).
 *
 * Renders explanation, structure summary extras, and element lists from the
 * ViewModel. No tree navigation, no H/I/J-A, no filesystem.
 */

import { useEffect, useState } from "react";

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
  insightElementDisplayLines,
  insightElementListHasMore,
  insightNestedListKey,
  otherElementsHeading,
  visibleInsightElements,
} from "./structureInsightDetailsHelpers";

export interface InsightCardDetailsProps {
  card: InsightCardModel;
}

function ElementRows({ elements }: { elements: readonly InsightElementRef[] }) {
  return (
    <ul className="insight-detail-element-list">
      {elements.map((element) => {
        const { name, path } = insightElementDisplayLines(element);
        return (
          <li key={element.nodeId} className="insight-detail-element">
            <span className="insight-detail-element-name">{name}</span>
            {path !== null ? (
              <span className="insight-detail-element-path">{path}</span>
            ) : null}
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
}: {
  listKey: string;
  heading: string;
  elements: readonly InsightElementRef[];
  open: boolean;
  onToggle: () => void;
  regionId: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const hasMore = insightElementListHasMore(elements.length);
  const visible = visibleInsightElements(elements, showAll);

  useEffect(() => {
    if (!open) {
      setShowAll(false);
    }
  }, [open]);

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
          <ElementRows elements={visible} />
          {hasMore ? (
            <button
              type="button"
              className="insight-detail-list-more"
              onClick={() => {
                setShowAll((current) => !current);
              }}
            >
              {showAll ? INSIGHT_LIST_SHOW_LESS_LABEL : INSIGHT_LIST_SHOW_MORE_LABEL}
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
}: {
  cardId: string;
  group: InsightSecondaryRecurringGroup;
  open: boolean;
  onToggle: () => void;
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
    />
  );
}

export function InsightCardDetails({ card }: InsightCardDetailsProps) {
  const [openLists, setOpenLists] = useState<ReadonlySet<string>>(() => new Set());

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

  const plainDescription = card.structureSummary.plainDescription.trim();
  const bullets = displayableExplanationBullets(card.explanationBullets);
  const examples = displayableExamples(card.structureSummary.examples);
  const parts = displayableStructuralParts(card.structureSummary.structuralParts);
  const primary = card.primaryElements;
  const secondary = card.secondaryRecurringGroups.filter((group) => group.elements.length > 0);
  const other = card.otherElements;
  const otherHeading = otherElementsHeading(other);

  const primaryKey = insightNestedListKey(card.id, "primary");
  const otherKey = insightNestedListKey(card.id, "other");

  const hasExplanation = plainDescription.length > 0 || bullets.length > 0;
  const hasStructureExtras = examples.length > 0 || parts.length > 0;

  return (
    <div className="insight-card-details-body">
      {hasExplanation ? (
        <section className="insight-detail-section" aria-label={INSIGHT_EXPLANATION_HEADING}>
          <h5 className="insight-detail-heading">{INSIGHT_EXPLANATION_HEADING}</h5>
          {plainDescription.length > 0 ? (
            <p className="insight-card-details-summary">{plainDescription}</p>
          ) : null}
          {bullets.length > 0 ? (
            <ul className="insight-detail-bullets">
              {bullets.map((bullet, index) => (
                <li key={`${card.id}-bullet-${index}`}>{bullet}</li>
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
                  <li key={`${card.id}-part-${index}`}>{part}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {examples.length > 0 ? (
            <div className="insight-detail-examples">
              <p className="insight-detail-sublabel">{INSIGHT_STRUCTURE_EXAMPLES_LABEL}</p>
              <ul className="insight-detail-examples-list">
                {examples.map((example, index) => (
                  <li key={`${card.id}-ex-${index}`}>
                    <span className="insight-detail-example-mark">Beispiel:</span> {example}
                  </li>
                ))}
              </ul>
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
          />
        </section>
      ) : null}

      {card.incompleteData ? (
        <p className="insight-detail-incomplete-note muted">{INSIGHT_INCOMPLETE_DETAIL_NOTE}</p>
      ) : null}
    </div>
  );
}
