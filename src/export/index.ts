import type { ExportFormat, ScanResult } from "../model";
import { exportCsv } from "./csv";
import { exportJson } from "./json";
import { exportTxt } from "./txt";

export type { ExportMetaFlags } from "./types";
export { exportCsv } from "./csv";
export { exportJson } from "./json";
export { exportTxt } from "./txt";

export function renderExport(result: ScanResult, format: ExportFormat): string {
  switch (format) {
    case "txt":
      return exportTxt(result);
    case "json":
      return exportJson(result);
    case "csv":
      return exportCsv(result);
  }
}
