import { useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from "react";

import { type ScanResult } from "../model";
import {
  ROW_HEIGHT,
  TREE_INDENT_PX,
  computeTreeWindow,
  deriveVisibleRows,
  type VisibleTreeRow,
} from "./treeRows";

interface TreeViewProps {
  result: ScanResult | null;
}

export function TreeView({ result }: TreeViewProps) {
  if (result === null) {
    return (
      <section className="tree-panel">
        <h2>Struktur</h2>
        <p className="muted">Noch keine Analyse durchgeführt.</p>
      </section>
    );
  }

  return <PopulatedTreeView result={result} />;
}

function defaultExpandedIds(rootId: string): Set<string> {
  return new Set([rootId]);
}

function PopulatedTreeView({ result }: { result: ScanResult }) {
  const [expandedIds, setExpandedIds] = useState(() => defaultExpandedIds(result.root.id));
  const [activeResult, setActiveResult] = useState(result);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);

  if (result !== activeResult) {
    setActiveResult(result);
    setExpandedIds(defaultExpandedIds(result.root.id));
    setScrollTop(0);
  }

  const rows = useMemo(
    () => deriveVisibleRows(result.root, expandedIds),
    [result.root, expandedIds],
  );

  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) {
      return;
    }

    const syncHeight = () => {
      setViewportHeight(element.clientHeight);
    };

    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (element !== null) {
      element.scrollTop = 0;
    }
  }, [result]);

  const treeWindow = computeTreeWindow(rows.length, scrollTop, viewportHeight);
  const visibleRows = rows.slice(treeWindow.start, treeWindow.end);

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

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    setScrollTop(event.currentTarget.scrollTop);
  }

  return (
    <section className="tree-panel">
      <h2>Struktur</h2>
      <p className="muted">
        {result.stats.directoryCount} Ordner, {result.stats.fileCount} Dateien
        {result.warnings.length > 0 ? `, ${result.warnings.length} Warnungen` : ""}
        {` · ${result.stats.durationMs} ms`}
      </p>
      <div className="tree-viewport" ref={viewportRef} onScroll={handleScroll}>
        {treeWindow.topSpacerHeight > 0 ? (
          <div
            className="tree-spacer"
            aria-hidden="true"
            style={{ height: treeWindow.topSpacerHeight }}
          />
        ) : null}
        <ul className="tree" role="tree">
          {visibleRows.map((row) => (
            <VirtualTreeRow
              key={row.id}
              row={row}
              expanded={row.directory && expandedIds.has(row.id)}
              onToggle={toggleExpanded}
            />
          ))}
        </ul>
        {treeWindow.bottomSpacerHeight > 0 ? (
          <div
            className="tree-spacer"
            aria-hidden="true"
            style={{ height: treeWindow.bottomSpacerHeight }}
          />
        ) : null}
      </div>
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

interface VirtualTreeRowProps {
  row: VisibleTreeRow;
  expanded: boolean;
  onToggle: (id: string) => void;
}

function VirtualTreeRow({ row, expanded, onToggle }: VirtualTreeRowProps) {
  const { node, depth, directory } = row;
  const isRoot = depth === 0;

  let icon: ReactNode;
  if (isRoot) {
    icon = <span className="badge">Root</span>;
  } else if (directory) {
    icon = <span className="icon folder" aria-hidden="true" />;
  } else {
    icon = <span className="icon file" aria-hidden="true" />;
  }

  return (
    <li
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={directory ? expanded : undefined}
      className={isRoot ? "root-node" : undefined}
      style={{ height: ROW_HEIGHT }}
    >
      <div
        className="tree-row"
        style={{ paddingLeft: depth * TREE_INDENT_PX, height: ROW_HEIGHT }}
      >
        {directory ? (
          <button
            type="button"
            className="twist"
            aria-label={expanded ? "Ordner einklappen" : "Ordner aufklappen"}
            onClick={() => onToggle(node.id)}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="twist spacer" />
        )}
        {icon}
        <span className={directory ? "name directory" : "name file"} title={node.name}>
          {node.name}
        </span>
        {directory ? <span className="muted">/</span> : null}
      </div>
    </li>
  );
}
