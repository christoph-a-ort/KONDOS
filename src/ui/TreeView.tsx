import { useState, type ReactNode } from "react";

import { isDirectory, type FsNode, type ScanResult } from "../model";

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

  return (
    <section className="tree-panel">
      <h2>Struktur</h2>
      <p className="muted">
        {result.stats.directoryCount} Ordner, {result.stats.fileCount} Dateien
        {result.warnings.length > 0
          ? `, ${result.warnings.length} Warnungen`
          : ""}
        {` · ${result.stats.durationMs} ms`}
      </p>
      <ul className="tree" role="tree">
        <TreeNode node={result.root} isRoot defaultExpanded />
      </ul>
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

interface TreeNodeProps {
  node: FsNode;
  isRoot?: boolean;
  defaultExpanded?: boolean;
}

function TreeNode({ node, isRoot = false, defaultExpanded = false }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const directory = isDirectory(node);

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
      aria-expanded={directory ? expanded : undefined}
      className={isRoot ? "root-node" : undefined}
    >
      <div className="tree-row">
        {directory ? (
          <button
            type="button"
            className="twist"
            aria-label={expanded ? "Ordner einklappen" : "Ordner aufklappen"}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="twist spacer" />
        )}
        {icon}
        <span className={directory ? "name directory" : "name file"}>{node.name}</span>
        {directory ? <span className="muted">/</span> : null}
      </div>
      {directory && expanded ? (
        <ul role="group">
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
