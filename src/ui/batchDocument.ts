/** P2-L.12a: logical documents vs physical files. Page ranges are reserved, not implemented. */
import { isFile, type FsNode } from "../model";
import { NAMING_FORMATS, type NamingRuleFormat } from "./namingRules";

export type DocumentSourceKind = "wholeFile" | "pdfPageRange";

export interface DocumentPageRange {
  startPage: number;
  endPage: number;
}

export interface PhysicalFileRef {
  nodeId: string;
  path: string;
  name: string;
  sizeBytes: number;
  modifiedAtMs: number;
}

export interface LogicalDocument {
  documentId: string;
  sourceKind: DocumentSourceKind;
  file: PhysicalFileRef;
  pageRange: DocumentPageRange | null;
}

export const BATCH_PAGE_RANGE_UNSUPPORTED =
  "Seitenbereiche innerhalb einer PDF werden in diesem Schritt nicht analysiert.";

export function createDocumentId(runId: number, index: number): string {
  return `batch-${runId}-doc-${index}`;
}

export function physicalFileRefFromNode(node: FsNode): PhysicalFileRef {
  return {
    nodeId: node.id,
    path: node.path,
    name: node.name,
    sizeBytes: node.sizeBytes ?? 0,
    modifiedAtMs: node.modifiedAtMs ?? 0,
  };
}

export function createLogicalDocument(options: {
  documentId: string;
  sourceKind: DocumentSourceKind;
  file: PhysicalFileRef;
  pageRange?: DocumentPageRange | null;
}): LogicalDocument {
  if (options.sourceKind === "wholeFile") {
    return {
      documentId: options.documentId,
      sourceKind: "wholeFile",
      file: options.file,
      pageRange: null,
    };
  }
  return {
    documentId: options.documentId,
    sourceKind: "pdfPageRange",
    file: options.file,
    pageRange: options.pageRange ?? { startPage: 1, endPage: 1 },
  };
}

export function documentSourceIsSupported(kind: DocumentSourceKind): boolean {
  return kind === "wholeFile";
}

export function normalizeBatchPathKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function batchFileFormatFromName(name: string): NamingRuleFormat | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    return null;
  }
  const ext = name.slice(dot + 1).toLowerCase();
  if (ext === "jpg" || ext === "jpeg") {
    return "jpeg";
  }
  return NAMING_FORMATS.find((format) => format === ext) ?? null;
}

export function isSupportedBatchFileName(name: string): boolean {
  return batchFileFormatFromName(name) !== null;
}

export function samePhysicalFile(left: PhysicalFileRef, right: PhysicalFileRef): boolean {
  return normalizeBatchPathKey(left.path) === normalizeBatchPathKey(right.path);
}

export function fingerprintChanged(captured: PhysicalFileRef, current: FsNode): boolean {
  if (!isFile(current)) {
    return true;
  }
  if (captured.sizeBytes === 0 && captured.modifiedAtMs === 0) {
    return false;
  }
  const size = current.sizeBytes ?? 0;
  const modified = current.modifiedAtMs ?? 0;
  return size !== captured.sizeBytes || modified !== captured.modifiedAtMs;
}
