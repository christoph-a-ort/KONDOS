import { isDirectory, isFile, type FsNode } from "../model";
import { formatByteSize } from "./treeFormat";

export interface ViewWorkStats {
  directoryCount: number;
  fileCount: number;
  filesWithSize: number;
  sizeBytes: number;
}

export function collectViewWorkStats(root: FsNode | null): ViewWorkStats {
  const stats: ViewWorkStats = {
    directoryCount: 0,
    fileCount: 0,
    filesWithSize: 0,
    sizeBytes: 0,
  };
  if (root === null) {
    return stats;
  }
  function walk(node: FsNode): void {
    if (isFile(node)) {
      stats.fileCount += 1;
      if (node.sizeBytes !== undefined) {
        stats.filesWithSize += 1;
        stats.sizeBytes += node.sizeBytes;
      }
      return;
    }
    if (isDirectory(node)) {
      stats.directoryCount += 1;
      for (const child of node.children) {
        walk(child);
      }
    }
  }
  walk(root);
  return stats;
}

export function formatViewWorkStats(stats: ViewWorkStats): string {
  const parts = [`${stats.directoryCount} Ordner`, `${stats.fileCount} Dateien`];
  if (stats.fileCount === 0) {
    return `Aktuelle Ansicht: ${parts.join(" · ")}`;
  }
  if (stats.filesWithSize === 0) {
    return `Aktuelle Ansicht: ${parts.join(" · ")}`;
  }
  const sizeText = formatByteSize(stats.sizeBytes);
  if (stats.filesWithSize < stats.fileCount) {
    parts.push(`${sizeText} (unvollständig)`);
  } else {
    parts.push(sizeText);
  }
  return `Aktuelle Ansicht: ${parts.join(" · ")}`;
}
