/**
 * P2-J-G – Safe search-hit highlighting (React text only, no HTML injection).
 */

import { splitInsightHighlightSegments } from "./structureInsightFilters";

export function InsightSearchHighlight({
  text,
  normalizedQuery,
}: {
  text: string;
  normalizedQuery: string;
}) {
  if (normalizedQuery.length === 0 || text.length === 0) {
    return <>{text}</>;
  }
  const segments = splitInsightHighlightSegments(text, normalizedQuery);
  return (
    <>
      {segments.map((segment, index) =>
        segment.hit ? (
          <mark key={`h-${index}`} className="insight-search-hit">
            {segment.text}
          </mark>
        ) : (
          <span key={`t-${index}`}>{segment.text}</span>
        ),
      )}
    </>
  );
}
