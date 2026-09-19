import { useEffect, useRef, type KeyboardEvent } from "react";

import type { ContentProgress, ContentSearchHit } from "../model";
import {
  CONTENT_PREPARE_TITLE,
  formatMatchCount,
  formatPrepareCounts,
  formatPrepareStats,
  hitFolderLabel,
  snippetHighlightParts,
} from "./contentSearch";

interface ContentSearchResultsProps {
  preparing: boolean;
  progress: ContentProgress | null;
  notice: string | null;
  emptyStatus: string | null;
  summary: string | null;
  hits: ContentSearchHit[];
  activeNodeId: string | null;
  prepareDisabled: boolean;
  onCancelPrepare: () => void;
  onActivateHit: (nodeId: string) => void;
  onOpenHit: (nodeId: string) => void;
}

export function ContentSearchResults({
  preparing,
  progress,
  notice,
  emptyStatus,
  summary,
  hits,
  activeNodeId,
  prepareDisabled,
  onCancelPrepare,
  onActivateHit,
  onOpenHit,
}: ContentSearchResultsProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeNodeId === null || listRef.current === null) {
      return;
    }
    const active = listRef.current.querySelector<HTMLElement>('[aria-current="true"]');
    active?.scrollIntoView({ block: "nearest" });
  }, [activeNodeId]);

  return (
    <div className="content-search-panel">
      {preparing ? (
        <div className="content-search-progress" aria-live="polite">
          <p className="content-search-progress-title">{CONTENT_PREPARE_TITLE}</p>
          {progress !== null ? (
            <>
              <p>{formatPrepareCounts(progress.processedPdfCount, progress.totalPdfCount)}</p>
              {progress.currentFileName.length > 0 ? (
                <p className="muted content-search-current" title={progress.currentFileName}>
                  {progress.currentFileName}
                </p>
              ) : null}
              <p className="muted">
                {formatPrepareStats(
                  progress.searchableCount,
                  progress.noTextCount,
                  progress.problemCount,
                )}
              </p>
            </>
          ) : null}
          <button type="button" disabled={prepareDisabled} onClick={onCancelPrepare}>
            Abbrechen
          </button>
        </div>
      ) : null}
      {notice !== null ? <p className="content-search-notice">{notice}</p> : null}
      {summary !== null ? <p className="content-search-summary">{summary}</p> : null}
      {emptyStatus !== null ? <p className="muted content-search-empty">{emptyStatus}</p> : null}
      {hits.length > 0 ? (
        <div className="content-search-hits" ref={listRef} role="list">
          {hits.map((hit) => (
            <ContentHitRow
              key={hit.nodeId}
              hit={hit}
              active={hit.nodeId === activeNodeId}
              onActivate={() => onActivateHit(hit.nodeId)}
              onOpen={() => onOpenHit(hit.nodeId)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ContentHitRow({
  hit,
  active,
  onActivate,
  onOpen,
}: {
  hit: ContentSearchHit;
  active: boolean;
  onActivate: () => void;
  onOpen: () => void;
}) {
  const folder = hitFolderLabel(hit.path, hit.name);
  const parts = snippetHighlightParts(hit.snippet, hit.highlights);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate();
    }
  }

  return (
    <button
      type="button"
      className={active ? "content-hit is-active" : "content-hit"}
      data-hit-id={hit.nodeId}
      role="listitem"
      aria-current={active ? "true" : undefined}
      title={hit.path}
      onClick={onActivate}
      onDoubleClick={(event) => {
        event.preventDefault();
        onOpen();
      }}
      onKeyDown={handleKeyDown}
    >
      <span className="content-hit-name">{hit.name}</span>
      <span className="content-hit-folder" title={hit.path}>
        {folder}
      </span>
      <span className="content-hit-snippet">
        {parts.map((part, index) =>
          part.hit ? (
            <mark key={index} className="content-hit-mark">
              {part.text}
            </mark>
          ) : (
            <span key={index}>{part.text}</span>
          ),
        )}
      </span>
      <span className="content-hit-count">{formatMatchCount(hit.matchCount)}</span>
    </button>
  );
}
