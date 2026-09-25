import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";

import {
  CONTENT_PROGRESS_EVENT,
  SCAN_PROGRESS_EVENT,
  type ContentProgress,
  type ContentSearchResult,
  type ExportFormat,
  type ScanConfig,
  type ScanProgress,
  type ScanResult,
} from "../model";
import type { InventoryReportModel } from "../ui/inventoryReportModel";

export async function pickDirectory(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Startverzeichnis wählen",
  });

  if (typeof selected === "string" && selected.length > 0) {
    return selected;
  }

  return null;
}

export function classifyScanRoot(path: string): Promise<"directory" | "file"> {
  return invoke<"directory" | "file">("classify_scan_root", { path });
}

export function startScan(config: ScanConfig, scanId: number): Promise<ScanResult> {
  return invoke<ScanResult>("start_scan", { config, scanId });
}

export function cancelScan(scanId: number): Promise<void> {
  return invoke("cancel_scan", { scanId });
}

export function saveExport(
  path: string,
  format: ExportFormat,
  scanId: number,
  txtColumns?: { size: boolean; modified: boolean; created: boolean },
): Promise<{ path: string }> {
  return invoke("save_export", { path, format, scanId, txtColumns });
}

export function copyExport(
  format: ExportFormat,
  scanId: number,
  txtColumns?: { size: boolean; modified: boolean; created: boolean },
): Promise<string> {
  return invoke<string>("copy_export", { format, scanId, txtColumns });
}

export function openInExplorer(path: string, directory: boolean): Promise<void> {
  return invoke("open_in_explorer", { path, directory });
}

export function openWithDefault(scanId: number, nodeId: string): Promise<void> {
  return invoke("open_with_default", { scanId, nodeId });
}

export function suggestExportFilename(format: ExportFormat, scanId: number): Promise<string> {
  return invoke<string>("suggest_export_filename", { format, scanId });
}

export function exportInventoryReportXlsx(
  path: string,
  report: InventoryReportModel,
): Promise<{ path: string }> {
  return invoke("export_inventory_report_xlsx", { path, report });
}

export function exportInventoryReportPdf(
  path: string,
  report: InventoryReportModel,
): Promise<{ path: string }> {
  return invoke("export_inventory_report_pdf", { path, report });
}

export function subscribeScanProgress(
  handler: (progress: ScanProgress) => void,
): Promise<UnlistenFn> {
  return listen<ScanProgress>(SCAN_PROGRESS_EVENT, (event) => {
    handler(event.payload);
  });
}

export function startPrepareContent(scanId: number): Promise<ContentProgress> {
  return invoke<ContentProgress>("start_prepare_content", { scanId });
}

export function cancelPrepareContent(scanId: number): Promise<void> {
  return invoke("cancel_prepare_content", { scanId });
}

export function subscribeContentProgress(
  handler: (progress: ContentProgress) => void,
): Promise<UnlistenFn> {
  return listen<ContentProgress>(CONTENT_PROGRESS_EVENT, (event) => {
    handler(event.payload);
  });
}

export function searchFileContent(scanId: number, query: string): Promise<ContentSearchResult> {
  return invoke<ContentSearchResult>("search_file_content", { scanId, query });
}

export async function pickExportPath(
  format: ExportFormat,
  defaultPath: string,
): Promise<string | null> {
  const selected = await save({
    title: "Export speichern",
    defaultPath,
    filters: [
      {
        name: format.toUpperCase(),
        extensions: [format],
      },
    ],
  });

  if (typeof selected === "string" && selected.length > 0) {
    return selected;
  }

  return null;
}
