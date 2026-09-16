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

export function startScan(config: ScanConfig, scanId: number): Promise<ScanResult> {
  return invoke<ScanResult>("start_scan", { config, scanId });
}

export function cancelScan(scanId: number): Promise<void> {
  return invoke("cancel_scan", { scanId });
}

export function saveExport(path: string, contents: string): Promise<void> {
  return invoke("save_export", { path, contents });
}

export function subscribeScanProgress(
  handler: (progress: ScanProgress) => void,
): Promise<UnlistenFn> {
  return listen<ScanProgress>(SCAN_PROGRESS_EVENT, (event) => {
    handler(event.payload);
  });
}

export async function pickExportPath(format: ExportFormat): Promise<string | null> {
  const selected = await save({
    title: "Export speichern",
    defaultPath: `KONDOS.${format}`,
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
