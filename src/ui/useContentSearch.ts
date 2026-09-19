import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ContentProgress, ContentSearchResult, FsNode } from "../model";
import {
  cancelPrepareContent,
  searchFileContent,
  startPrepareContent,
  subscribeContentProgress,
} from "../scan";
import {
  collectNodeIds,
  contentSearchUserError,
  CONTENT_STALE_SNAPSHOT_MESSAGE,
  emptyContentStatus,
  formatContentHitSummary,
  formatPartialCacheNotice,
  hasContentQuery,
  isProgressForContent,
  normalizeContentQuery,
  shouldPrepareContent,
  visibleContentHits,
} from "./contentSearch";
import { displayFilterHasConstraint, type AppliedDisplayFilter } from "./displayFilter";
import { nextMatchIndex, previousMatchIndex, searchCountLabel } from "./treeSearch";

interface UseContentSearchOptions {
  scanId: number | null;
  viewRoot: FsNode | null;
  appliedFilter: AppliedDisplayFilter | null;
  onPreparingChange: (busy: boolean) => void;
}

export function useContentSearch({
  scanId,
  viewRoot,
  appliedFilter,
  onPreparingChange,
}: UseContentSearchOptions) {
  const [query, setQuery] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState<ContentProgress | null>(null);
  const [result, setResult] = useState<ContentSearchResult | null>(null);
  const [cacheComplete, setCacheComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [jumped, setJumped] = useState(false);
  const [cancelledPartial, setCancelledPartial] = useState(false);

  const queryRef = useRef(query);
  const scanIdRef = useRef(scanId);
  const requestRef = useRef(0);
  const preparingRef = useRef(false);
  const onPreparingChangeRef = useRef(onPreparingChange);
  queryRef.current = query;
  scanIdRef.current = scanId;
  onPreparingChangeRef.current = onPreparingChange;

  const filterActive = appliedFilter !== null && displayFilterHasConstraint(appliedFilter);
  const visibleIds = useMemo(() => collectNodeIds(viewRoot), [viewRoot]);
  const visibleHits = useMemo(
    () => (result === null ? [] : visibleContentHits(result.hits, visibleIds)),
    [result, visibleIds],
  );
  const activeIndex = activeNodeId === null ? -1 : visibleHits.findIndex((hit) => hit.nodeId === activeNodeId);
  const countLabel = searchCountLabel(result === null ? "" : "x", visibleHits.length, Math.max(0, activeIndex));
  const summary = formatContentHitSummary({
    hasResult: result !== null,
    filterActive,
    visibleCount: visibleHits.length,
    totalHitCount: result?.totalHitCount ?? 0,
    returnedHitCount: result?.returnedHitCount ?? 0,
  });
  const emptyStatus = emptyContentStatus({
    hasResult: result !== null && !preparing,
    cacheComplete: result?.cacheComplete ?? cacheComplete,
    totalDocumentCount: result?.totalDocumentCount ?? progress?.totalDocumentCount ?? 0,
    processedDocumentCount: result?.processedDocumentCount ?? progress?.processedDocumentCount ?? 0,
    visibleCount: visibleHits.length,
    totalHitCount: result?.totalHitCount ?? 0,
    filterActive,
    noTextCount: progress?.noTextCount ?? 0,
    problemCount: progress?.problemCount ?? 0,
  });
  const notice =
    cancelledPartial && result !== null && !result.cacheComplete
      ? formatPartialCacheNotice(result.processedDocumentCount, result.totalDocumentCount)
      : error;

  const setBusy = useCallback((busy: boolean) => {
    preparingRef.current = busy;
    setPreparing(busy);
    onPreparingChangeRef.current(busy);
  }, []);

  useEffect(() => {
    requestRef.current += 1;
    setQuery("");
    setResult(null);
    setError(null);
    setActiveNodeId(null);
    setJumped(false);
    setCancelledPartial(false);
    setProgress(null);
    setCacheComplete(false);
    setBusy(false);
  }, [scanId, setBusy]);

  useEffect(() => {
    return () => {
      onPreparingChangeRef.current(false);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void subscribeContentProgress((incoming) => {
      if (disposed || !isProgressForContent(scanIdRef.current, incoming)) {
        return;
      }
      setProgress(incoming);
      if (incoming.status === "completed") {
        setCacheComplete(true);
        setCancelledPartial(false);
      }
      if (incoming.status === "cancelled") {
        setCacheComplete(false);
        setCancelledPartial(true);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const applySearchResult = useCallback((next: ContentSearchResult, expectedQuery: string) => {
    if (normalizeContentQuery(queryRef.current) !== normalizeContentQuery(expectedQuery)) {
      return;
    }
    if (next.scanId !== scanIdRef.current) {
      return;
    }
    setResult(next);
    setCacheComplete(next.cacheComplete);
    setError(null);
    setActiveNodeId(null);
    setJumped(false);
    if (next.cacheComplete) {
      setCancelledPartial(false);
    }
  }, []);

  const searchCurrent = useCallback(
    async (rawQuery: string) => {
      const currentScanId = scanIdRef.current;
      if (currentScanId === null) {
        setError(CONTENT_STALE_SNAPSHOT_MESSAGE);
        return;
      }
      const expected = normalizeContentQuery(rawQuery);
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      try {
        const next = await searchFileContent(currentScanId, expected);
        if (requestRef.current !== requestId) {
          return;
        }
        applySearchResult(next, expected);
      } catch (cause) {
        if (requestRef.current !== requestId) {
          return;
        }
        setResult(null);
        setError(contentSearchUserError(cause));
      }
    },
    [applySearchResult],
  );

  const runContentSearch = useCallback(async () => {
    if (preparingRef.current || !hasContentQuery(queryRef.current)) {
      return;
    }
    const expected = normalizeContentQuery(queryRef.current);
    const currentScanId = scanIdRef.current;
    if (currentScanId === null) {
      setError(CONTENT_STALE_SNAPSHOT_MESSAGE);
      return;
    }
    setError(null);
    if (!shouldPrepareContent(cacheComplete)) {
      await searchCurrent(expected);
      return;
    }
    setBusy(true);
    try {
      const outcome = await startPrepareContent(currentScanId);
      if (scanIdRef.current !== currentScanId) {
        return;
      }
      setProgress(outcome);
      if (outcome.status === "cancelled") {
        setCacheComplete(false);
        setCancelledPartial(true);
      } else if (outcome.status === "completed") {
        setCacheComplete(true);
        setCancelledPartial(false);
      }
      if (hasContentQuery(queryRef.current)) {
        await searchCurrent(queryRef.current);
      }
    } catch (cause) {
      setError(contentSearchUserError(cause));
    } finally {
      setBusy(false);
    }
  }, [cacheComplete, searchCurrent, setBusy]);

  const cancelPrepare = useCallback(async () => {
    const currentScanId = scanIdRef.current;
    if (currentScanId === null) {
      return;
    }
    try {
      await cancelPrepareContent(currentScanId);
    } catch (cause) {
      setError(contentSearchUserError(cause));
    }
  }, []);

  const clearQueryAndHits = useCallback(() => {
    requestRef.current += 1;
    setQuery("");
    setResult(null);
    setError(null);
    setActiveNodeId(null);
    setJumped(false);
    setCancelledPartial(false);
  }, []);

  function handleQueryChange(value: string) {
    setQuery(value);
  }

  function activateHit(nodeId: string): string | null {
    if (!visibleHits.some((hit) => hit.nodeId === nodeId)) {
      return null;
    }
    setActiveNodeId(nodeId);
    setJumped(true);
    return nodeId;
  }

  function stepHit(direction: "next" | "prev"): string | null {
    if (visibleHits.length === 0) {
      return null;
    }
    const index =
      direction === "next"
        ? nextMatchIndex(activeIndex, visibleHits.length, jumped)
        : previousMatchIndex(activeIndex, visibleHits.length, jumped);
    const id = visibleHits[index]?.nodeId;
    if (id === undefined) {
      return null;
    }
    setActiveNodeId(id);
    setJumped(true);
    return id;
  }

  return {
    query,
    preparing,
    progress,
    result,
    visibleHits,
    activeNodeId,
    jumped,
    notice,
    summary,
    emptyStatus,
    countLabel: result === null || visibleHits.length === 0 ? null : countLabel,
    canNavigate: visibleHits.length > 0 && !preparing,
    handleQueryChange,
    runContentSearch,
    cancelPrepare,
    clearQueryAndHits,
    activateHit,
    stepHit,
  };
}
