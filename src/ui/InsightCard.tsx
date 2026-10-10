/**
 * P2-J-D – Compact insight card (closed by default).
 *
 * Expanded details (explanation, examples, element lists) are rendered by
 * InsightCardDetails (P2-J-E). No tree navigation / filter / search / retry.
 */

import { InsightCardDetails } from "./InsightCardDetails";
import {
  INSIGHT_DETAILS_HIDE_LABEL,
  INSIGHT_DETAILS_SHOW_LABEL,
  INSIGHT_INCOMPLETE_CARD_NOTE,
  insightCategoryClassName,
  insightCategoryIconLabel,
  insightEvidenceClassName,
} from "./structureInsightCardsHelpers";
import { INSIGHT_SHOW_IN_TREE_LABEL } from "./structureInsightNavigation";
import type { InsightCardModel, InsightUserCategoryKey } from "./structureInsightViewModel";

export interface InsightCardProps {
  card: InsightCardModel;
  expanded: boolean;
  highlighted?: boolean;
  onToggleDetails: () => void;
  onNavigateToLocation?: () => void;
  onNavigateToNode?: (nodeId: string) => void;
}

function CategoryGlyph({ category }: { category: InsightUserCategoryKey }) {
  const label = insightCategoryIconLabel(category);
  // Decorative SVG; category is also shown as text.
  switch (category) {
    case "file-names":
      return (
        <svg className="insight-card-category-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <title>{label}</title>
          <path
            fill="currentColor"
            d="M4 1.5h5.2L13 5.3V14a.75.75 0 0 1-.75.75H4A.75.75 0 0 1 3.25 14V2.25A.75.75 0 0 1 4 1.5Zm5 1.1v2.7h2.7L9 2.6ZM5.2 8h5.6v1.1H5.2V8Zm0 2.4h5.6v1.1H5.2v-1.1Z"
          />
        </svg>
      );
    case "folder-structure":
      return (
        <svg className="insight-card-category-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <title>{label}</title>
          <path
            fill="currentColor"
            d="M1.75 3.5A1.25 1.25 0 0 1 3 2.25h3.1c.3 0 .58.12.79.33L8 3.7h5a1.25 1.25 0 0 1 1.25 1.25v7.3A1.25 1.25 0 0 1 13 13.5H3A1.25 1.25 0 0 1 1.75 12.25V3.5Z"
          />
        </svg>
      );
    case "time-years":
      return (
        <svg className="insight-card-category-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <title>{label}</title>
          <path
            fill="currentColor"
            d="M5.2 1.4h1.1v1.2h3.4V1.4h1.1v1.2h1.45A1.25 1.25 0 0 1 13.5 3.85v8.4A1.25 1.25 0 0 1 12.25 13.5H3.75A1.25 1.25 0 0 1 2.5 12.25v-8.4A1.25 1.25 0 0 1 3.75 2.6H5.2V1.4Zm-1.6 4.1v6.75h9V5.5h-9Zm2.1 1.7h1.5v1.5H5.7V7.2Zm2.6 0h1.5v1.5H8.3V7.2Zm2.6 0h1.5v1.5h-1.5V7.2Z"
          />
        </svg>
      );
    case "file-distribution":
      return (
        <svg className="insight-card-category-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <title>{label}</title>
          <path
            fill="currentColor"
            d="M2.5 3.25h4.2v3.6H2.5v-3.6Zm0 5.1h4.2v4.4H2.5v-4.4Zm5.8-5.1H13.5v4.9H8.3V3.25Zm0 6.4H13.5v3.1H8.3v-3.1Z"
          />
        </svg>
      );
    default:
      return null;
  }
}

export function InsightCard({
  card,
  expanded,
  highlighted = false,
  onToggleDetails,
  onNavigateToLocation,
  onNavigateToNode,
}: InsightCardProps) {
  const detailsId = `insight-card-details-${card.id}`;
  const categoryClass = insightCategoryClassName(card.category);
  const evidenceClass = insightEvidenceClassName(card.evidenceLevel);
  const cardClass = [
    "insight-card",
    categoryClass,
    highlighted ? "insight-card--highlighted" : "",
  ]
    .filter((part) => part.length > 0)
    .join(" ");

  return (
    <article className={cardClass} data-insight-id={card.id}>
      <div className="insight-card-accent" aria-hidden="true" />
      <header className="insight-card-header">
        <div className="insight-card-category">
          <span className="insight-card-category-icon" aria-hidden="true">
            <CategoryGlyph category={card.category} />
          </span>
          <span className="insight-card-category-label">{card.categoryLabel}</span>
        </div>
        <h4 className="insight-card-title">{card.title}</h4>
      </header>
      <p className="insight-card-fact">{card.factLine}</p>
      <div className="insight-card-meta">
        <span className={`insight-card-evidence ${evidenceClass}`}>
          Evidenz: {card.evidenceLabel}
        </span>
        {card.incompleteData ? (
          <span className="insight-card-incomplete">{INSIGHT_INCOMPLETE_CARD_NOTE}</span>
        ) : null}
      </div>
      <div className="insight-card-actions">
        <button
          type="button"
          className="insight-card-details-toggle"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={onToggleDetails}
        >
          <span className="insight-card-details-chevron" aria-hidden="true">
            {expanded ? "▾" : "▸"}
          </span>
          {expanded ? INSIGHT_DETAILS_HIDE_LABEL : INSIGHT_DETAILS_SHOW_LABEL}
        </button>
        {onNavigateToLocation !== undefined ? (
          <button
            type="button"
            className="insight-card-tree-nav"
            onClick={onNavigateToLocation}
          >
            {INSIGHT_SHOW_IN_TREE_LABEL}
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div id={detailsId} className="insight-card-details">
          <InsightCardDetails card={card} onNavigateToNode={onNavigateToNode} />
        </div>
      ) : null}
    </article>
  );
}
