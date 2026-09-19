import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type UIEvent } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { isDirectory, type FsNode, type ScanResult, type ScanWarning } from "../model";
import { openInExplorer, toUserError } from "../scan";
import {
  applyColumnResizeDelta,
  beginColumnResize,
  columnLabel,
  effectiveColumnWidths,
  resizeStartWidth,
  resizeTargetForBoundary,
  visibleColumns,
  type ColumnId,
  type ColumnVisibility,
  type ColumnWidths,
  type OptionalColumn,
} from "./treeColumns";
import { formatByteSize, formatDateTime, formatExtensionFilter, formatTreeStatsLine, createdColumnText } from "./treeFormat";
import {
  buildNodeDetails,
  DETAIL_NONE_LABEL,
  emptyNodeDetailModel,
  type NodeDetailModel,
} from "./nodeDetails";
import { collectViewWorkStats, formatViewWorkStats } from "./viewStats";
import { resolveWarningJump } from "./warningNavigation";
import {
  ROW_HEIGHT,
  TREE_INDENT_PX,
  collapseAllExpandedIds,
  collectExpandableDirectoryIds,
  computeTreeWindow,
  defaultExpandedIds,
  deriveVisibleRows,
  findNodeById,
  listingHint,
  rowIndexById,
  selectedIdAfterCollapseAll,
  type VisibleTreeRow,
} from "./treeRows";
import {
  ancestorDirectoryIds,
  clipboardPath,
  collectMatchIds,
  createMatchIdSet,
  emptySearchQuery,
  matchIndexAfterReorder,
  nextMatchIndex,
  previousMatchIndex,
  searchCountLabel,
  withAncestorsExpanded,
} from "./treeSearch";
import { sortAfterHidingColumn, type SortColumn, type TreeSort } from "./treeSort";
import {
  buildDisplayFilterView,
  canScanFromHere,
  collectDisplayExtensionOptions,
  displayFilterApplyError,
  displayFilterHasConstraint,
  emptyDisplayFilterDraft,
  formatActiveFilterSummary,
  nodeVisibleInDisplayTree,
  snapshotHasModifiedTimestamps,
  type AppliedDisplayFilter,
  type DisplayFilterDraft,
} from "./displayFilter";

interface TreeViewProps {
  result: ScanResult | null;
  scanning: boolean;
  appliedExtensions: string[];
  sort: TreeSort;
  visibility: ColumnVisibility;
  widths: ColumnWidths;
  preferStoredWidths: boolean;
  onSortChange: (sort: TreeSort) => void;
  onVisibilityChange: (visibility: ColumnVisibility) => void;
  onWidthsChange: (widths: ColumnWidths) => void;
  onScanFromHere: (path: string) => void;
}

export function TreeView({
  result,
  scanning,
  appliedExtensions,
  sort,
  visibility,
  widths,
  preferStoredWidths,
  onSortChange,
  onVisibilityChange,
  onWidthsChange,
  onScanFromHere,
}: TreeViewProps) {
  if (result === null) {
    return (
      <section className="tree-panel">
        <h2>Struktur</h2>
        <div className="tree-toolbar">
          <button type="button" disabled>
            Alles aufklappen
          </button>
          <button type="button" disabled>
            Alles zuklappen
          </button>
        </div>
        <TreeSearchBar
          query=""
          countLabel={null}
          canNavigate={false}
          disabled
          onQueryChange={() => {}}
          onPrevious={() => {}}
          onNext={() => {}}
          onKeyDown={() => {}}
        />
        <p className="muted">Noch keine Analyse durchgeführt.</p>
        <div className="tree-viewport tree-viewport-empty" />
        <TreePathBar
          path={null}
          hasSelection={false}
          canScanFromHere={false}
          disabled
          notice={null}
          noticeKind={null}
          onCopy={() => {}}
          onOpen={() => {}}
          onScanFromHere={() => {}}
        />
        <TreeDetailsBar model={emptyNodeDetailModel()} />
      </section>
    );
  }

  return (
    <PopulatedTreeView
      result={result}
      scanning={scanning}
      appliedExtensions={appliedExtensions}
      sort={sort}
      visibility={visibility}
      widths={widths}
      preferStoredWidths={preferStoredWidths}
      onSortChange={onSortChange}
      onVisibilityChange={onVisibilityChange}
      onWidthsChange={onWidthsChange}
      onScanFromHere={onScanFromHere}
    />
  );
}

interface PopulatedTreeViewProps {
  result: ScanResult;
  scanning: boolean;
  appliedExtensions: string[];
  sort: TreeSort;
  visibility: ColumnVisibility;
  widths: ColumnWidths;
  preferStoredWidths: boolean;
  onSortChange: (sort: TreeSort) => void;
  onVisibilityChange: (visibility: ColumnVisibility) => void;
  onWidthsChange: (widths: ColumnWidths) => void;
  onScanFromHere: (path: string) => void;
}

function PopulatedTreeView({
  result,
  scanning,
  appliedExtensions,
  sort,
  visibility,
  widths,
  preferStoredWidths,
  onSortChange,
  onVisibilityChange,
  onWidthsChange,
  onScanFromHere,
}: PopulatedTreeViewProps) {
  const [expandedIds, setExpandedIds] = useState(() => defaultExpandedIds(result.root.id));
  const [activeResult, setActiveResult] = useState(result);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [nameAutoFill, setNameAutoFill] = useState(!preferStoredWidths);
  const [searchQuery, setSearchQuery] = useState(emptySearchQuery);
  const [pinnedMatchId, setPinnedMatchId] = useState<string | null>(null);
  const [searchJumped, setSearchJumped] = useState(false);
  const [pathNotice, setPathNotice] = useState<string | null>(null);
  const [pathNoticeKind, setPathNoticeKind] = useState<"ok" | "error" | null>(null);
  const [filterDraft, setFilterDraft] = useState<DisplayFilterDraft>(emptyDisplayFilterDraft);
  const [appliedFilter, setAppliedFilter] = useState<AppliedDisplayFilter | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [warningNotice, setWarningNotice] = useState<string | null>(null);
  const [warningOfferReset, setWarningOfferReset] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pendingRevealRef = useRef<string | null>(null);
  const pathNoticeTimerRef = useRef<number | null>(null);
  const widthsRef = useRef(widths);
  const nameAutoFillRef = useRef(nameAutoFill);
  widthsRef.current = widths;
  nameAutoFillRef.current = nameAutoFill;

  if (result !== activeResult) {
    setActiveResult(result);
    setExpandedIds(defaultExpandedIds(result.root.id));
    setSelectedId(null);
    setScrollTop(0);
    setMenuOpen(false);
    setSearchQuery(emptySearchQuery());
    setPinnedMatchId(null);
    setSearchJumped(false);
    setPathNotice(null);
    setPathNoticeKind(null);
    setFilterDraft(emptyDisplayFilterDraft());
    setAppliedFilter(null);
    setFilterError(null);
    setFilterOpen(false);
    setWarningNotice(null);
    setWarningOfferReset(false);
  }

  const columns = visibleColumns(visibility);
  const layoutWidths = effectiveColumnWidths(columns, widths, viewportWidth, nameAutoFill);
  const gridTemplate = columns
    .map((column) => `${layoutWidths[column]}px`)
    .join(" ");
  const tableWidth = columns.reduce((sum, column) => sum + layoutWidths[column], 0);
  const extensionOptions = useMemo(
    () => collectDisplayExtensionOptions(result.root),
    [result.root],
  );
  const hasModifiedTimestamps = useMemo(
    () => snapshotHasModifiedTimestamps(result.root),
    [result.root],
  );
  const displayView = useMemo(
    () => buildDisplayFilterView(result.root, appliedFilter, sort),
    [result.root, appliedFilter, sort],
  );
  const viewRoot = displayView.tree;
  const filterEmpty = displayView.constrained && displayView.fileMatchCount === 0;
  const filterSummary = appliedFilter === null ? null : formatActiveFilterSummary(appliedFilter, extensionOptions);
  const rows = useMemo(
    () => (viewRoot === null ? [] : deriveVisibleRows(viewRoot, expandedIds, sort)),
    [viewRoot, expandedIds, sort],
  );
  const matchIds = useMemo(
    () => (viewRoot === null ? [] : collectMatchIds(viewRoot, searchQuery, sort)),
    [viewRoot, searchQuery, sort],
  );
  const matchIdSet = useMemo(() => createMatchIdSet(matchIds), [matchIds]);
  const currentMatchIndex = matchIndexAfterReorder(matchIds, pinnedMatchId);
  const currentMatchId =
    searchJumped && currentMatchIndex >= 0 ? matchIds[currentMatchIndex] : undefined;
  const searchLabel = searchCountLabel(searchQuery, matchIds.length, currentMatchIndex);
  const canNavigateMatches = matchIds.length > 0;
  const viewWorkStats = useMemo(() => collectViewWorkStats(viewRoot), [viewRoot]);
  const detailModel = useMemo(
    () => buildNodeDetails(result.root, selectedId, result.warnings, appliedExtensions.length > 0),
    [result.root, result.warnings, selectedId, appliedExtensions],
  );

  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) {
      return;
    }
    const syncSize = () => {
      setViewportHeight(element.clientHeight);
      setViewportWidth(element.clientWidth);
    };
    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (element !== null) {
      element.scrollTop = 0;
    }
  }, [result]);

  useEffect(() => {
    if (matchIds.length === 0) {
      setPinnedMatchId(null);
      return;
    }
    setPinnedMatchId((current) => {
      if (current !== null && matchIds.includes(current)) {
        return current;
      }
      return matchIds[0];
    });
  }, [matchIds]);

  useEffect(() => {
    return () => {
      if (pathNoticeTimerRef.current !== null) {
        window.clearTimeout(pathNoticeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (selectedId === null) {
      return;
    }
    if (viewRoot === null || !nodeVisibleInDisplayTree(viewRoot, selectedId)) {
      setSelectedId(null);
    }
  }, [viewRoot, selectedId]);

  const treeWindow = computeTreeWindow(rows.length, scrollTop, viewportHeight);
  const visibleRows = rows.slice(treeWindow.start, treeWindow.end);
  const selectedNode =
    selectedId === null || viewRoot === null ? undefined : findNodeById(viewRoot, selectedId);
  const selectedPath = selectedNode?.path;

  function scrollRowIntoView(id: string, nextRows: VisibleTreeRow[] = rows) {
    const index = rowIndexById(nextRows, id);
    if (index < 0) {
      return;
    }
    const element = viewportRef.current;
    if (element === null) {
      return;
    }
    const headerHeight = ROW_HEIGHT;
    const top = index * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    const viewTop = element.scrollTop;
    const viewBottom = viewTop + element.clientHeight - headerHeight;
    if (top < viewTop) {
      element.scrollTop = top;
      setScrollTop(top);
    } else if (bottom > viewBottom) {
      const next = bottom - element.clientHeight + headerHeight;
      element.scrollTop = next;
      setScrollTop(next);
    }
  }

  function toggleExpanded(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleTwistClick(event: MouseEvent<HTMLButtonElement>, id: string) {
    event.preventDefault();
    event.stopPropagation();
    toggleExpanded(id);
  }

  function clearSelectionFromPointer() {
    setSelectedId(null);
    setWarningNotice(null);
    setWarningOfferReset(false);
  }

  function handleRowClick(row: VisibleTreeRow) {
    setSelectedId(row.id);
    setWarningNotice(null);
    setWarningOfferReset(false);
  }

  function handleRowDoubleClick(row: VisibleTreeRow) {
    if (row.expandable) {
      toggleExpanded(row.id);
    }
  }

  function handleSortClick(column: SortColumn) {
    if (column !== "name" && !visibility[column]) {
      return;
    }
    onSortChange(
      sort.column === column
        ? { column, direction: sort.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "asc" },
    );
  }

  function handleVisibilityToggle(column: OptionalColumn) {
    const next = { ...visibility, [column]: !visibility[column] };
    onVisibilityChange(next);
    if (!next[column]) {
      onSortChange(sortAfterHidingColumn(sort, column));
    }
  }

  function handleExpandAll() {
    setExpandedIds(collectExpandableDirectoryIds(viewRoot ?? result.root));
  }

  function handleCollapseAll() {
    setExpandedIds(collapseAllExpandedIds());
    setSelectedId(selectedIdAfterCollapseAll(result.root.id));
    queueMicrotask(() => scrollRowIntoView(result.root.id));
  }

  function toggleDraftExtension(key: string) {
    setFilterDraft((current) => {
      const selected = current.extensions.includes(key);
      return {
        ...current,
        extensions: selected
          ? current.extensions.filter((item) => item !== key)
          : [...current.extensions, key],
      };
    });
  }

  function handleApplyDisplayFilter() {
    const applyError = displayFilterApplyError(filterDraft, hasModifiedTimestamps);
    if (applyError !== null) {
      setFilterError(applyError);
      return;
    }
    const nextApplied: AppliedDisplayFilter = {
      extensions: [...filterDraft.extensions],
      modifiedFrom: filterDraft.modifiedFrom,
      modifiedUntil: filterDraft.modifiedUntil,
    };
    setFilterError(null);
    setAppliedFilter(nextApplied);
    const nextView = buildDisplayFilterView(result.root, nextApplied, sort);
    if (displayFilterHasConstraint(nextApplied) && nextView.tree !== null) {
      setExpandedIds(collectExpandableDirectoryIds(nextView.tree));
    }
    if (
      selectedId !== null &&
      (nextView.tree === null || !nodeVisibleInDisplayTree(nextView.tree, selectedId))
    ) {
      setSelectedId(null);
    }
  }

  function handleResetDisplayFilter() {
    setFilterDraft(emptyDisplayFilterDraft());
    setAppliedFilter(null);
    setFilterError(null);
    setExpandedIds(defaultExpandedIds(result.root.id));
    setWarningNotice(null);
    setWarningOfferReset(false);
  }

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    setPinnedMatchId(null);
    setSearchJumped(false);
  }

  function revealMatchAt(index: number) {
    const id = matchIds[index];
    if (id === undefined) {
      return;
    }
    setPinnedMatchId(id);
    setSearchJumped(true);
    setExpandedIds((current) =>
      withAncestorsExpanded(current, ancestorDirectoryIds(viewRoot ?? result.root, id)),
    );
    setSelectedId(id);
    pendingRevealRef.current = id;
  }

  function handleNextMatch() {
    revealMatchAt(nextMatchIndex(currentMatchIndex, matchIds.length, searchJumped));
  }

  function handlePreviousMatch() {
    revealMatchAt(previousMatchIndex(currentMatchIndex, matchIds.length, searchJumped));
  }

  function handleWarningActivate(warning: ScanWarning) {
    const jump = resolveWarningJump(result.root, viewRoot, warning.path);
    setWarningNotice(jump.notice);
    setWarningOfferReset(jump.offerFilterReset);
    if (!jump.applySelection || jump.targetId === null) {
      return;
    }
    setExpandedIds((current) => withAncestorsExpanded(current, jump.ancestorIds));
    setSelectedId(jump.targetId);
    pendingRevealRef.current = jump.targetId;
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (event.key === "Escape") {
      if (searchQuery.length > 0) {
        event.preventDefault();
        handleSearchChange(emptySearchQuery());
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) {
        handlePreviousMatch();
      } else {
        handleNextMatch();
      }
    }
  }

  function showPathNotice(message: string, kind: "ok" | "error") {
    if (pathNoticeTimerRef.current !== null) {
      window.clearTimeout(pathNoticeTimerRef.current);
      pathNoticeTimerRef.current = null;
    }
    setPathNotice(message);
    setPathNoticeKind(kind);
    if (kind === "ok") {
      pathNoticeTimerRef.current = window.setTimeout(() => {
        setPathNotice(null);
        setPathNoticeKind(null);
        pathNoticeTimerRef.current = null;
      }, 2500);
    }
  }

  async function handleCopyPath() {
    if (selectedNode === undefined) {
      return;
    }
    try {
      await writeText(clipboardPath(selectedNode));
      showPathNotice("Pfad kopiert", "ok");
    } catch (cause) {
      showPathNotice(toUserError(cause), "error");
    }
  }

  async function handleOpenExplorer() {
    if (selectedNode === undefined) {
      return;
    }
    try {
      await openInExplorer(selectedNode.path, isDirectory(selectedNode));
      setPathNotice(null);
      setPathNoticeKind(null);
    } catch (cause) {
      showPathNotice(toUserError(cause), "error");
    }
  }

  function handleViewportClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      clearSelectionFromPointer();
    }
  }

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    setScrollTop(event.currentTarget.scrollTop);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (rows.length === 0) {
      return;
    }
    const currentIndex = selectedId === null ? -1 : rowIndexById(rows, selectedId);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = Math.min(rows.length - 1, Math.max(0, currentIndex + 1));
      const nextId = rows[nextIndex].id;
      setSelectedId(nextId);
      scrollRowIntoView(nextId);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex = Math.max(0, currentIndex <= 0 ? 0 : currentIndex - 1);
      const nextId = rows[nextIndex].id;
      setSelectedId(nextId);
      scrollRowIntoView(nextId);
      return;
    }
    if (event.key === "ArrowRight" && currentIndex >= 0) {
      const row = rows[currentIndex];
      if (row.expandable && !expandedIds.has(row.id)) {
        event.preventDefault();
        toggleExpanded(row.id);
        return;
      }
      if (row.expandable && expandedIds.has(row.id) && currentIndex + 1 < rows.length) {
        event.preventDefault();
        const child = rows[currentIndex + 1];
        setSelectedId(child.id);
        scrollRowIntoView(child.id);
      }
      return;
    }
    if (event.key === "ArrowLeft" && currentIndex >= 0) {
      const row = rows[currentIndex];
      if (row.expandable && expandedIds.has(row.id)) {
        event.preventDefault();
        toggleExpanded(row.id);
        return;
      }
      if (row.depth > 0) {
        event.preventDefault();
        for (let index = currentIndex - 1; index >= 0; index -= 1) {
          if (rows[index].depth === row.depth - 1) {
            setSelectedId(rows[index].id);
            scrollRowIntoView(rows[index].id);
            break;
          }
        }
      }
    }
  }

  function startResize(column: ColumnId, event: MouseEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const effective = effectiveColumnWidths(
      columns,
      widthsRef.current,
      viewportWidth,
      nameAutoFillRef.current,
    );
    const started = beginColumnResize(column, widthsRef.current, effective);
    const startWidth = resizeStartWidth(column, effective);
    let sessionWidths = started.widths;
    nameAutoFillRef.current = started.nameAutoFill;
    setNameAutoFill(started.nameAutoFill);
    widthsRef.current = sessionWidths;
    onWidthsChange(sessionWidths);
    function onMove(moveEvent: globalThis.MouseEvent) {
      sessionWidths = applyColumnResizeDelta(
        sessionWidths,
        column,
        startWidth,
        moveEvent.clientX - startX,
      );
      widthsRef.current = sessionWidths;
      onWidthsChange(sessionWidths);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const filterLabel = formatExtensionFilter(appliedExtensions);
  const actionsDisabled = scanning;

  useEffect(() => {
    const id = pendingRevealRef.current;
    if (id === null) {
      return;
    }
    if (rowIndexById(rows, id) >= 0) {
      pendingRevealRef.current = null;
      scrollRowIntoView(id, rows);
    }
  }, [rows]);

  useEffect(() => {
    if (selectedId === null) {
      return;
    }
    const index = rowIndexById(rows, selectedId);
    if (index >= 0) {
      scrollRowIntoView(selectedId, rows);
    }
  }, [sort]);

  return (
    <section className="tree-panel">
      <h2>Struktur</h2>
      <p className="muted tree-stats">
        <span>
          {formatTreeStatsLine({
            directoryCount: result.stats.directoryCount,
            fileCount: result.stats.fileCount,
            skippedCount: result.stats.skippedCount,
            warningCount: result.warnings.length,
            durationMs: result.stats.durationMs,
          })}
        </span>
        <span className="tree-view-work">{formatViewWorkStats(viewWorkStats)}</span>
        {filterLabel.length > 0 ? (
          <TreeFilterChip>Einlesen: {filterLabel}</TreeFilterChip>
        ) : null}
        {filterSummary !== null ? <TreeFilterChip>{filterSummary}</TreeFilterChip> : null}
      </p>
      <div className="tree-toolbar">
        <button type="button" disabled={actionsDisabled} onClick={handleExpandAll}>
          Alles aufklappen
        </button>
        <button type="button" disabled={actionsDisabled} onClick={handleCollapseAll}>
          Alles zuklappen
        </button>
      </div>
      <details
        className="display-filter"
        open={filterOpen}
        onToggle={(event) => setFilterOpen(event.currentTarget.open)}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <summary>Anzeigefilter</summary>
        <div className="display-filter-body">
          <p className="muted display-filter-hint">
            Wirkt nur auf die aktuelle Ansicht. Der eingelesene Bestand bleibt unverändert.
          </p>
          <fieldset className="display-filter-types" disabled={extensionOptions.length === 0}>
            <legend>Dateitypen im Ergebnis</legend>
            {extensionOptions.length === 0 ? (
              <p className="muted">Keine Dateitypen im Ergebnis.</p>
            ) : (
              extensionOptions.map((option) => (
                <label key={option.key === "" ? "none" : option.key} className="check">
                  <input
                    type="checkbox"
                    checked={filterDraft.extensions.includes(option.key)}
                    onChange={() => toggleDraftExtension(option.key)}
                  />
                  <span>{option.label}</span>
                </label>
              ))
            )}
          </fieldset>
          <div className="display-filter-dates">
            <label className="field">
              <span>Geändert von</span>
              <input
                type="date"
                value={filterDraft.modifiedFrom}
                disabled={!hasModifiedTimestamps}
                title={
                  hasModifiedTimestamps
                    ? undefined
                    : "Datumsfilter benötigt Änderungsdaten. Beim Einlesen „Geändert“ aktivieren."
                }
                onChange={(event) =>
                  setFilterDraft((current) => ({ ...current, modifiedFrom: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Geändert bis</span>
              <input
                type="date"
                value={filterDraft.modifiedUntil}
                disabled={!hasModifiedTimestamps}
                title={
                  hasModifiedTimestamps
                    ? undefined
                    : "Datumsfilter benötigt Änderungsdaten. Beim Einlesen „Geändert“ aktivieren."
                }
                onChange={(event) =>
                  setFilterDraft((current) => ({ ...current, modifiedUntil: event.target.value }))
                }
              />
            </label>
          </div>
          {!hasModifiedTimestamps ? (
            <p className="muted">Datumsfilter nicht verfügbar: „Geändert“ wurde beim Einlesen nicht erfasst.</p>
          ) : null}
          {filterError !== null ? <p className="display-filter-error">{filterError}</p> : null}
          <div className="display-filter-actions">
            <button type="button" className="primary" onClick={handleApplyDisplayFilter}>
              Filter anwenden
            </button>
            <button type="button" onClick={handleResetDisplayFilter}>
              Filter zurücksetzen
            </button>
          </div>
        </div>
      </details>
      <TreeSearchBar
        query={searchQuery}
        countLabel={searchLabel}
        canNavigate={canNavigateMatches}
        disabled={false}
        onQueryChange={handleSearchChange}
        onPrevious={handlePreviousMatch}
        onNext={handleNextMatch}
        onKeyDown={handleSearchKeyDown}
      />
      <div
        className="tree-viewport"
        ref={viewportRef}
        tabIndex={0}
        onScroll={handleScroll}
        onClick={handleViewportClick}
        onKeyDown={handleKeyDown}
      >
        <div className="tree-table" style={{ minWidth: tableWidth }} role="tree">
          <div className="tree-header" style={{ gridTemplateColumns: gridTemplate }}>
            {columns.map((column, index) => {
              const resizeTarget = resizeTargetForBoundary(columns, index);
              return (
              <div
                key={column}
                className={`tree-cell tree-head-cell tree-col-${column}${column === "name" ? " sticky-name" : ""}`}
              >
                {resizeTarget !== null ? (
                  <span
                    className="col-resizer"
                    onMouseDown={(event) => startResize(resizeTarget, event)}
                  />
                ) : null}
                {column === "name" ? (
                  <div className="tree-head-name">
                    <button type="button" className="tree-sort" onClick={() => handleSortClick("name")}>
                      Name{sortMarker(sort, "name")}
                    </button>
                    <div className="column-menu">
                      <button
                        type="button"
                        className="column-menu-button"
                        aria-label="Spalten"
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuOpen((open) => !open);
                        }}
                      >
                        ⋮
                      </button>
                      {menuOpen ? (
                        <div
                          className="column-menu-list"
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <label>
                            <input type="checkbox" checked disabled />
                            Name
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={visibility.size}
                              onChange={() => handleVisibilityToggle("size")}
                            />
                            Größe
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={visibility.modified}
                              onChange={() => handleVisibilityToggle("modified")}
                            />
                            Geändert
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={visibility.created}
                              onChange={() => handleVisibilityToggle("created")}
                            />
                            Erstellt
                          </label>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="tree-sort"
                    onClick={() => handleSortClick(column)}
                  >
                    {columnLabel(column)}
                    {sortMarker(sort, column)}
                  </button>
                )}
              </div>
              );
            })}
          </div>
          {filterEmpty ? (
            <p className="muted tree-filter-empty">Keine Dateien entsprechen dem aktuellen Filter.</p>
          ) : (
          <div
            className="tree-table-body"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                clearSelectionFromPointer();
              }
            }}
          >
            {treeWindow.topSpacerHeight > 0 ? (
              <div
                className="tree-spacer"
                aria-hidden="true"
                style={{ height: treeWindow.topSpacerHeight }}
                onClick={() => clearSelectionFromPointer()}
              />
            ) : null}
            {visibleRows.map((row) => (
              <VirtualTreeRow
                key={row.id}
                row={row}
                columns={columns}
                gridTemplate={gridTemplate}
                expanded={row.directory && expandedIds.has(row.id)}
                selected={selectedId === row.id}
                match={matchIdSet.has(row.id)}
                currentMatch={row.id === currentMatchId}
                onSelect={() => handleRowClick(row)}
                onDoubleClick={() => handleRowDoubleClick(row)}
                onTwist={(event) => handleTwistClick(event, row.id)}
              />
            ))}
            {treeWindow.bottomSpacerHeight > 0 ? (
              <div
                className="tree-spacer"
                aria-hidden="true"
                style={{ height: treeWindow.bottomSpacerHeight }}
                onClick={() => clearSelectionFromPointer()}
              />
            ) : null}
          </div>
          )}
        </div>
      </div>
      <TreePathBar
        path={selectedPath ?? null}
        hasSelection={selectedNode !== undefined}
        canScanFromHere={canScanFromHere(selectedNode) && !scanning}
        disabled={false}
        notice={pathNotice}
        noticeKind={pathNoticeKind}
        onCopy={() => {
          void handleCopyPath();
        }}
        onOpen={() => {
          void handleOpenExplorer();
        }}
        onScanFromHere={() => {
          if (selectedNode !== undefined && canScanFromHere(selectedNode)) {
            onScanFromHere(selectedNode.path);
          }
        }}
      />
      <TreeDetailsBar model={detailModel} />
      {result.warnings.length > 0 ? (
        <details className="warnings" onKeyDown={(event) => event.stopPropagation()}>
          <summary>Warnungen ({result.warnings.length})</summary>
          <ul>
            {result.warnings.map((warning, index) => (
              <li key={`${warning.path}:${warning.code}:${index}`}>
                <button
                  type="button"
                  className="warning-item"
                  title="Zur betroffenen Stelle im Baum springen"
                  onClick={() => handleWarningActivate(warning)}
                >
                  {warning.path}: {warning.message}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {warningNotice !== null ? (
        <p className="warning-notice">
          <span>{warningNotice}</span>
          {warningOfferReset ? (
            <button type="button" onClick={handleResetDisplayFilter}>
              Filter zurücksetzen
            </button>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

function sortMarker(sort: TreeSort, column: SortColumn): string {
  if (sort.column !== column) {
    return "";
  }
  return sort.direction === "asc" ? " ↑" : " ↓";
}

interface VirtualTreeRowProps {
  row: VisibleTreeRow;
  columns: ColumnId[];
  gridTemplate: string;
  expanded: boolean;
  selected: boolean;
  match: boolean;
  currentMatch: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
  onTwist: (event: MouseEvent<HTMLButtonElement>) => void;
}

function VirtualTreeRow({
  row,
  columns,
  gridTemplate,
  expanded,
  selected,
  match,
  currentMatch,
  onSelect,
  onDoubleClick,
  onTwist,
}: VirtualTreeRowProps) {
  const { node, depth, directory, expandable } = row;
  const isRoot = depth === 0;
  const hint = listingHint(node);

  let icon: ReactNode;
  if (directory) {
    icon = (
      <span
        className={expanded ? "icon folder folder-open" : "icon folder folder-closed"}
        aria-hidden="true"
      />
    );
  } else {
    icon = <span className="icon file" aria-hidden="true" />;
  }

  const rowClass = [
    "tree-data-row",
    selected ? "selected" : "",
    match ? "match" : "",
    currentMatch ? "current-match" : "",
    isRoot ? "root-node" : "",
  ]
    .filter((part) => part.length > 0)
    .join(" ");

  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={expandable ? expanded : undefined}
      aria-selected={selected}
      className={rowClass}
      style={{ gridTemplateColumns: gridTemplate, height: ROW_HEIGHT }}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
    >
      {columns.map((column) => {
        if (column === "name") {
          return (
            <div
              key="name"
              className="tree-cell tree-col-name sticky-name"
              style={{ paddingLeft: depth * TREE_INDENT_PX }}
            >
              {expandable ? (
                <button
                  type="button"
                  className="twist"
                  aria-label={expanded ? "Ordner einklappen" : "Ordner aufklappen"}
                  onClick={onTwist}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                >
                  {expanded ? "▾" : "▸"}
                </button>
              ) : (
                <span className="twist spacer" />
              )}
              {icon}
              {isRoot ? <span className="badge">Root</span> : null}
              <span className={directory ? "name directory" : "name file"} title={node.name}>
                {node.name}
              </span>
              {hint === "depthLimited" ? (
                <span
                  className="listing-badge"
                  title="Inhalt dieses Ordners wurde wegen der eingestellten maximalen Tiefe nicht weiter eingelesen."
                >
                  Tiefe erreicht
                </span>
              ) : null}
              {hint === "incomplete" ? (
                <span
                  className="listing-warn"
                  title="Inhalt dieses Ordners konnte nicht vollständig eingelesen werden."
                >
                  !
                </span>
              ) : null}
            </div>
          );
        }
        return (
          <div key={column} className={`tree-cell tree-col-${column}`}>
            {cellValue(node, column, directory)}
          </div>
        );
      })}
    </div>
  );
}

function cellValue(node: FsNode, column: ColumnId, directory: boolean): ReactNode {
  if (directory || column === "name") {
    return <span className="cell-empty">—</span>;
  }
  if (column === "size") {
    return (
      <span className="cell-num">
        {node.sizeBytes === undefined ? "—" : formatByteSize(node.sizeBytes)}
      </span>
    );
  }
  if (column === "modified") {
    return node.modifiedAtMs === undefined ? "—" : formatDateTime(node.modifiedAtMs);
  }
  return createdColumnText(node.createdAtMs, false);
}

interface TreeSearchBarProps {
  query: string;
  countLabel: string | null;
  canNavigate: boolean;
  disabled: boolean;
  onQueryChange: (value: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

function TreeSearchBar({
  query,
  countLabel,
  canNavigate,
  disabled,
  onQueryChange,
  onPrevious,
  onNext,
  onKeyDown,
}: TreeSearchBarProps) {
  return (
    <div className="tree-search-row">
      <input
        type="search"
        className="tree-search-input"
        placeholder="Suchen …"
        value={query}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
        aria-label="Im Ergebnis suchen"
      />
      <button
        type="button"
        className="tree-search-nav"
        disabled={disabled || !canNavigate}
        onClick={onPrevious}
        aria-label="Vorheriger Treffer"
      >
        ‹
      </button>
      <span className="tree-search-count">{countLabel ?? ""}</span>
      <button
        type="button"
        className="tree-search-nav"
        disabled={disabled || !canNavigate}
        onClick={onNext}
        aria-label="Nächster Treffer"
      >
        ›
      </button>
    </div>
  );
}

interface TreePathBarProps {
  path: string | null;
  hasSelection: boolean;
  canScanFromHere: boolean;
  disabled: boolean;
  notice: string | null;
  noticeKind: "ok" | "error" | null;
  onCopy: () => void;
  onOpen: () => void;
  onScanFromHere: () => void;
}

function TreePathBar({
  path,
  hasSelection,
  canScanFromHere,
  disabled,
  notice,
  noticeKind,
  onCopy,
  onOpen,
  onScanFromHere,
}: TreePathBarProps) {
  const actionsOff = disabled || !hasSelection;
  const scanFromHereOff = disabled || !canScanFromHere;
  const scanFromHereTitle = !hasSelection
    ? "Zuerst einen Ordner auswählen"
    : !canScanFromHere
      ? "Nur für einen ausgewählten Ordner verfügbar"
      : "Ordner als Startverzeichnis übernehmen. Einlesen startet erst mit „Analyse starten“.";
  return (
    <div className="tree-path-row">
      <p className="tree-path muted" title={path ?? ""}>
        Pfad: {path ?? "—"}
      </p>
      <div className="tree-path-actions">
        <button type="button" disabled={actionsOff} onClick={onCopy}>
          Pfad kopieren
        </button>
        <button type="button" disabled={actionsOff} onClick={onOpen}>
          Im Explorer öffnen
        </button>
        <button
          type="button"
          disabled={scanFromHereOff}
          title={scanFromHereTitle}
          onClick={onScanFromHere}
        >
          Ab hier einlesen
        </button>
        {notice !== null ? (
          <span className={noticeKind === "error" ? "tree-path-notice is-error" : "tree-path-notice is-ok"}>
            {notice}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function TreeDetailsBar({ model }: { model: NodeDetailModel }) {
  return (
    <details className="tree-details">
      <summary>Details</summary>
      {model.selected ? (
        <dl className="tree-details-grid">
          <DetailRow label="Name" value={model.name ?? ""} />
          <DetailRow label="Typ" value={model.typeLabel ?? ""} />
          {model.path !== null ? <DetailRow label="Pfad" value={model.path} path /> : null}
          {model.kind === "file" && model.extension !== null ? (
            <DetailRow label="Dateiendung" value={model.extension} />
          ) : null}
          {model.depth !== null ? <DetailRow label="Tiefe" value={String(model.depth)} /> : null}
          {model.kind === "file" && model.size !== null ? (
            <DetailRow label="Größe" value={model.size.text} muted={model.size.state !== "present"} />
          ) : null}
          {model.kind === "file" && model.modified !== null ? (
            <DetailRow label="Geändert" value={model.modified.text} muted={model.modified.state !== "present"} />
          ) : null}
          {model.kind === "file" && model.created !== null ? (
            <DetailRow label="Erstellt" value={model.created.text} muted={model.created.state !== "present"} />
          ) : null}
          {model.kind === "directory" && model.listingLabel !== null ? (
            <DetailRow label="Einlesestatus" value={model.listingLabel} />
          ) : null}
          {model.kind === "directory" && model.directDirectories !== null ? (
            <DetailRow label="Direkte Unterordner" value={String(model.directDirectories)} />
          ) : null}
          {model.kind === "directory" && model.directFiles !== null ? (
            <DetailRow label="Direkte Dateien" value={String(model.directFiles)} />
          ) : null}
          {model.kind === "directory" && model.containedDirectories !== null ? (
            <DetailRow label="Enthaltene Ordner" value={String(model.containedDirectories)} />
          ) : null}
          {model.kind === "directory" && model.containedFiles !== null ? (
            <DetailRow label="Enthaltene Dateien" value={String(model.containedFiles)} />
          ) : null}
          {model.subtreeSize !== null ? (
            <DetailRow label="Größe" value={model.subtreeSize.text} muted={model.subtreeSize.incomplete} />
          ) : null}
          {model.warningSummary !== null ? (
            <DetailRow label="Warnungen" value={model.warningSummary} />
          ) : null}
        </dl>
      ) : (
        <p className="muted tree-details-empty">{DETAIL_NONE_LABEL}</p>
      )}
    </details>
  );
}

function DetailRow({
  label,
  value,
  path = false,
  muted = false,
}: {
  label: string;
  value: string;
  path?: boolean;
  muted?: boolean;
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={`${path ? "is-path" : ""}${muted ? " is-muted" : ""}`.trim() || undefined} title={value}>
        {value}
      </dd>
    </>
  );
}

function TreeFilterChip({ children }: { children: ReactNode }) {
  return (
    <span className="tree-filter-chip">
      <svg className="tree-filter-icon" viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
        <path
          fill="currentColor"
          d="M1.25 1.5h9.5L7.1 6.05v3.2L4.9 10.5V6.05L1.25 1.5z"
        />
      </svg>
      {children}
    </span>
  );
}
