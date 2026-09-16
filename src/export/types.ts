import type { FsNode, ScanResult } from "../model";
import { isDirectory } from "../model";

export interface ExportMetaFlags {
  includeSize: boolean;
  includeCreatedAt: boolean;
  includeModifiedAt: boolean;
}

export function metaFlagsFromRoot(result: ScanResult): ExportMetaFlags {
  return collectMetaFlags(result.root);
}

function collectMetaFlags(node: FsNode): ExportMetaFlags {
  const flags: ExportMetaFlags = {
    includeSize: node.sizeBytes !== undefined,
    includeCreatedAt: node.createdAtMs !== undefined,
    includeModifiedAt: node.modifiedAtMs !== undefined,
  };

  if (!isDirectory(node)) {
    return flags;
  }

  for (const child of node.children) {
    const childFlags = collectMetaFlags(child);
    flags.includeSize = flags.includeSize || childFlags.includeSize;
    flags.includeCreatedAt = flags.includeCreatedAt || childFlags.includeCreatedAt;
    flags.includeModifiedAt = flags.includeModifiedAt || childFlags.includeModifiedAt;
    if (flags.includeSize && flags.includeCreatedAt && flags.includeModifiedAt) {
      break;
    }
  }

  return flags;
}

export function formatIso(ms: number | undefined): string | undefined {
  if (ms === undefined) {
    return undefined;
  }
  return new Date(ms).toISOString();
}
