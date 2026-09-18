import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";

import {
  SCAN_PROGRESS_EVENT,
  type ExportFormat,
  type ScanConfig,
  type ScanProgress,
  type ScanResult,
} from "../model";

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

export function suggestExportFilename(format: ExportFormat, scanId: number): Promise<string> {
  return invoke<string>("suggest_export_filename", { format, scanId });
}

export function subscribeScanProgress(
  handler: (progress: ScanProgress) => void,
): Promise<UnlistenFn> {
  return listen<ScanProgress>(SCAN_PROGRESS_EVENT, (event) => {
    handler(event.payload);
  });
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
