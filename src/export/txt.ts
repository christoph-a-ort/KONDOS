import { isDirectory, type FsNode, type ScanResult } from "../model";
import { formatIso, metaFlagsFromRoot, type ExportMetaFlags } from "./types";

export function exportTxt(result: ScanResult): string {
  const flags = metaFlagsFromRoot(result);
  const lines: string[] = [formatRootLine(result.root, flags)];
  appendChildren(result.root, "", flags, lines);
  return `${lines.join("\n")}\n`;
}

function formatRootLine(node: FsNode, flags: ExportMetaFlags): string {
  return `[Root] ${node.name}/${formatMetaSuffix(node, flags)}`;
}

function appendChildren(
  node: FsNode,
  prefix: string,
  flags: ExportMetaFlags,
  lines: string[],
): void {
  if (!isDirectory(node)) {
    return;
  }

  const children = node.children;
  children.forEach((child, index) => {
    const isLast = index === children.length - 1;
    const connector = isLast ? "└── " : "├── ";
    lines.push(`${prefix}${connector}${formatNodeLabel(child, flags)}`);

    if (isDirectory(child) && child.children.length > 0) {
      const nextPrefix = `${prefix}${isLast ? "    " : "│   "}`;
      appendChildren(child, nextPrefix, flags, lines);
    }
  });
}

function formatNodeLabel(node: FsNode, flags: ExportMetaFlags): string {
  const suffix = isDirectory(node) ? "/" : "";
  return `${node.name}${suffix}${formatMetaSuffix(node, flags)}`;
}

function formatMetaSuffix(node: FsNode, flags: ExportMetaFlags): string {
  const parts: string[] = [];
  if (flags.includeSize && node.sizeBytes !== undefined) {
    parts.push(`${node.sizeBytes} B`);
  }
  if (flags.includeCreatedAt && node.createdAtMs !== undefined) {
    parts.push(`erstellt ${formatIso(node.createdAtMs)}`);
  }
  if (flags.includeModifiedAt && node.modifiedAtMs !== undefined) {
    parts.push(`geändert ${formatIso(node.modifiedAtMs)}`);
  }
  if (parts.length === 0) {
    return "";
  }
  return ` (${parts.join(", ")})`;
}
