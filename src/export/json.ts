import { isDirectory, type FsNode, type ScanResult } from "../model";
import { formatIso, metaFlagsFromRoot, type ExportMetaFlags } from "./types";

export interface JsonExportNode {
  kind: "file" | "directory";
  name: string;
  path: string;
  depth: number;
  sizeBytes?: number;
  createdAt?: string;
  modifiedAt?: string;
  children?: JsonExportNode[];
}

export interface JsonExportDocument {
  format: "kondos-tree";
  version: 1;
  stats: ScanResult["stats"];
  warnings: ScanResult["warnings"];
  root: JsonExportNode;
}

export function exportJson(result: ScanResult): string {
  const flags = metaFlagsFromRoot(result);
  const document: JsonExportDocument = {
    format: "kondos-tree",
    version: 1,
    stats: result.stats,
    warnings: result.warnings,
    root: toJsonNode(result.root, flags),
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

function toJsonNode(node: FsNode, flags: ExportMetaFlags): JsonExportNode {
  const exported: JsonExportNode = {
    kind: node.kind,
    name: node.name,
    path: node.path,
    depth: node.depth,
  };

  if (flags.includeSize && node.sizeBytes !== undefined) {
    exported.sizeBytes = node.sizeBytes;
  }
  if (flags.includeCreatedAt && node.createdAtMs !== undefined) {
    exported.createdAt = formatIso(node.createdAtMs);
  }
  if (flags.includeModifiedAt && node.modifiedAtMs !== undefined) {
    exported.modifiedAt = formatIso(node.modifiedAtMs);
  }

  if (isDirectory(node)) {
    exported.children = node.children.map((child) => toJsonNode(child, flags));
  }

  return exported;
}
