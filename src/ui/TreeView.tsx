import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type UIEvent } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { isDirectory, type FsNode, type ScanResult } from "../model";
import { openInExplorer, toUserError } from "../scan";
import {
  DEFAULT_COLUMN_WIDTHS,
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
  selectedIdAfterClick,
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
import { DEFAULT_TREE_SORT, sortAfterHidingColumn, type SortColumn, type TreeSort } from "./treeSort";

interface TreeViewProps {
  result: ScanResult | null;
  scanning: boolean;
  appliedExtensions: string[];
  visibility: ColumnVisibility;
  onVisibilityChange: (visibility: ColumnVisibility) => void;
}

export function TreeView({
  result,
  scanning,
  appliedExtensions,
  visibility,
  onVisibilityChange,
}: TreeViewProps) {
  const [sort, setSort] = useState<TreeSort>(DEFAULT_TREE_SORT);
  const [widths, setWidths] = useState<ColumnWidths>(DEFAULT_COLUMN_WIDTHS);

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
          disabled
          notice={null}
          noticeKind={null}
          onCopy={() => {}}
          onOpen={() => {}}
        />
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
      onSortChange={setSort}
      onVisibilityChange={onVisibilityChange}
      onWidthsChange={setWidths}
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
  onSortChange: (sort: TreeSort) => void;
  onVisibilityChange: (visibility: ColumnVisibility) => void;
  onWidthsChange: (widths: ColumnWidths) => void;
}

function PopulatedTreeView({
  result,
  scanning,
  appliedExtensions,
  sort,
  visibility,
  widths,
  onSortChange,
  onVisibilityChange,
  onWidthsChange,
}: PopulatedTreeViewProps) {
  const [expandedIds, setExpandedIds] = useState(() => defaultExpandedIds(result.root.id));
  const [activeResult, setActiveResult] = useState(result);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [nameAutoFill, setNameAutoFill] = useState(true);
  const [searchQuery, setSearchQuery] = useState(emptySearchQuery);
  const [pinnedMatchId, setPinnedMatchId] = useState<string | null>(null);
  const [searchJumped, setSearchJumped] = useState(false);
  const [pathNotice, setPathNotice] = useState<string | null>(null);
  const [pathNoticeKind, setPathNoticeKind] = useState<"ok" | "error" | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const skipSelectionRef = useRef(false);
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
  }

  const columns = visibleColumns(visibility);
  const layoutWidths = effectiveColumnWidths(columns, widths, viewportWidth, nameAutoFill);
  const gridTemplate = columns
    .map((column) => `${layoutWidths[column]}px`)
    .join(" ");
  const tableWidth = columns.reduce((sum, column) => sum + layoutWidths[column], 0);
  const rows = useMemo(
    () => deriveVisibleRows(result.root, expandedIds, sort),
    [result.root, expandedIds, sort],
  );
  const matchIds = useMemo(
    () => collectMatchIds(result.root, searchQuery, sort),
    [result.root, searchQuery, sort],
  );
  const matchIdSet = useMemo(() => createMatchIdSet(matchIds), [matchIds]);
  const currentMatchIndex = matchIndexAfterReorder(matchIds, pinnedMatchId);
  const currentMatchId =
    searchJumped && currentMatchIndex >= 0 ? matchIds[currentMatchIndex] : undefined;
  const searchLabel = searchCountLabel(searchQuery, matchIds.length, currentMatchIndex);
  const canNavigateMatches = matchIds.length > 0;

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

  const treeWindow = computeTreeWindow(rows.length, scrollTop, viewportHeight);
  const visibleRows = rows.slice(treeWindow.start, treeWindow.end);
  const selectedNode = selectedId === null ? undefined : findNodeById(result.root, selectedId);
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
    skipSelectionRef.current = true;
    toggleExpanded(id);
  }

  function handleRowClick(row: VisibleTreeRow) {
    const keepCurrent = skipSelectionRef.current;
    skipSelectionRef.current = false;
    setSelectedId(selectedIdAfterClick(selectedId, row.id, keepCurrent));
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
    setExpandedIds(collectExpandableDirectoryIds(result.root));
  }

  function handleCollapseAll() {
    setExpandedIds(collapseAllExpandedIds());
    setSelectedId(selectedIdAfterCollapseAll(result.root.id));
    queueMicrotask(() => scrollRowIntoView(result.root.id));
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
      withAncestorsExpanded(current, ancestorDirectoryIds(result.root, id)),
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
      setSelectedId(null);
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
        {filterLabel.length > 0 ? (
          <span className="tree-filter-chip">
            <svg className="tree-filter-icon" viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
              <path
                fill="currentColor"
                d="M1.25 1.5h9.5L7.1 6.05v3.2L4.9 10.5V6.05L1.25 1.5z"
              />
            </svg>
            Filter: {filterLabel}
          </span>
        ) : null}
      </p>
      <div className="tree-toolbar">
        <button type="button" disabled={actionsDisabled} onClick={handleExpandAll}>
          Alles aufklappen
        </button>
        <button type="button" disabled={actionsDisabled} onClick={handleCollapseAll}>
          Alles zuklappen
        </button>
      </div>
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
          <div
            className="tree-table-body"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                setSelectedId(null);
              }
            }}
          >
            {treeWindow.topSpacerHeight > 0 ? (
              <div
                className="tree-spacer"
                aria-hidden="true"
                style={{ height: treeWindow.topSpacerHeight }}
                onClick={() => setSelectedId(null)}
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
                onClick={() => setSelectedId(null)}
              />
            ) : null}
          </div>
        </div>
      </div>
      <TreePathBar
        path={selectedPath ?? null}
        hasSelection={selectedNode !== undefined}
        disabled={false}
        notice={pathNotice}
        noticeKind={pathNoticeKind}
        onCopy={() => {
          void handleCopyPath();
        }}
        onOpen={() => {
          void handleOpenExplorer();
        }}
      />
      {result.warnings.length > 0 ? (
        <details className="warnings">
          <summary>Warnungen ({result.warnings.length})</summary>
          <ul>
            {result.warnings.map((warning, index) => (
              <li key={`${warning.path}:${warning.code}:${index}`}>
                {warning.path}: {warning.message}
              </li>
            ))}
          </ul>
        </details>
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
  disabled: boolean;
  notice: string | null;
  noticeKind: "ok" | "error" | null;
  onCopy: () => void;
  onOpen: () => void;
}

function TreePathBar({
  path,
  hasSelection,
  disabled,
  notice,
  noticeKind,
  onCopy,
  onOpen,
}: TreePathBarProps) {
  const actionsOff = disabled || !hasSelection;
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
        {notice !== null ? (
          <span className={noticeKind === "error" ? "tree-path-notice is-error" : "tree-path-notice is-ok"}>
            {notice}
          </span>
        ) : null}
      </div>
    </div>
  );
}
