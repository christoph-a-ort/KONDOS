import { isDirectory, type FsNode, type ScanResult } from "../model";
import { formatIso, metaFlagsFromRoot, type ExportMetaFlags } from "./types";

/**
 * CSV-Schema (UTF-8 mit BOM, RFC-4180-Quoting)
 *
 * Pflichtspalten:
 * - path:  absoluter Pfad
 * - kind:  `file` oder `directory`
 * - name:  Basisname
 * - depth: 0 = Startverzeichnis, 1–8 = darunterliegende Ebenen
 *
 * Optionale Spalten, nur wenn die jeweilige Metadatenoption im Scan aktiv war:
 * - sizeBytes:    Dateigröße in Bytes
 * - createdAt:    Erstellungszeit als ISO-8601 (UTC)
 * - modifiedAt:   Änderungszeit als ISO-8601 (UTC)
 *
 * Jede Zeile ist ein Knoten (Ordner oder Datei). Ordner bleiben enthalten,
 * auch wenn ein Dateiendungsfilter Dateien in ihnen ausgeblendet hat.
 */
export function exportCsv(result: ScanResult): string {
  const flags = metaFlagsFromRoot(result);
  const headers = ["path", "kind", "name", "depth"];
  if (flags.includeSize) {
    headers.push("sizeBytes");
  }
  if (flags.includeCreatedAt) {
    headers.push("createdAt");
  }
  if (flags.includeModifiedAt) {
    headers.push("modifiedAt");
  }

  const rows: string[] = [headers.join(",")];
  visit(result.root, flags, rows);
  return `\uFEFF${rows.join("\r\n")}\r\n`;
}

function visit(node: FsNode, flags: ExportMetaFlags, rows: string[]): void {
  rows.push(toCsvRow(node, flags));
  if (isDirectory(node)) {
    for (const child of node.children) {
      visit(child, flags, rows);
    }
  }
}

function toCsvRow(node: FsNode, flags: ExportMetaFlags): string {
  const values: string[] = [
    csvEscape(node.path),
    csvEscape(node.kind),
    csvEscape(node.name),
    String(node.depth),
  ];

  if (flags.includeSize) {
    values.push(node.sizeBytes === undefined ? "" : String(node.sizeBytes));
  }
  if (flags.includeCreatedAt) {
    values.push(csvEscape(formatIso(node.createdAtMs) ?? ""));
  }
  if (flags.includeModifiedAt) {
    values.push(csvEscape(formatIso(node.modifiedAtMs) ?? ""));
  }

  return values.join(",");
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}
