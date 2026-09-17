import { useEffect, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { parseExtensionInput } from "./filter";
import {
  createDefaultScanConfig,
  type ExportFormat,
  type ScanConfig,
  type ScanProgress,
  type ScanResult,
} from "./model";
import {
  cancelScan,
  copyExport,
  isCancelledError,
  isProgressForScan,
  pickDirectory,
  pickExportPath,
  saveExport,
  shouldClearScanResultOnError,
  startScan,
  subscribeScanProgress,
  suggestExportFilename,
  toUserError,
} from "./scan";
import { ConfigPanel } from "./ui/ConfigPanel";
import { ExportPanel } from "./ui/ExportPanel";
import { ProgressPanel } from "./ui/ProgressPanel";
import { TreeView } from "./ui/TreeView";
import "./App.css";

function formatLabel(format: ExportFormat): string {
  return format.toUpperCase();
}

function App() {
  const [config, setConfig] = useState<ScanConfig>(createDefaultScanConfig);
  const [extensionInput, setExtensionInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [resultScanId, setResultScanId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [exportNoticeKind, setExportNoticeKind] = useState<"progress" | "saved" | "failed" | null>(
    null,
  );
  const [exportFormat, setExportFormat] = useState<ExportFormat>("txt");
  const [exportBusy, setExportBusy] = useState(false);
  const scanLockRef = useRef(false);
  const scanIdRef = useRef(0);
  const activeScanIdRef = useRef<number | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void subscribeScanProgress((next) => {
      if (disposed || !isProgressForScan(activeScanIdRef.current, next)) {
        return;
      }
      setProgress(next);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  function clearExportNotice() {
    setExportNotice(null);
    setExportNoticeKind(null);
  }

  async function handlePickDirectory() {
    setError(null);
    try {
      const path = await pickDirectory();
      if (path !== null) {
        setConfig((current) => ({ ...current, rootPath: path }));
      }
    } catch (cause) {
      setError(toUserError(cause));
    }
  }

  async function handleStartScan() {
    if (scanLockRef.current || exportBusy) {
      return;
    }
    scanLockRef.current = true;
    const scanId = scanIdRef.current + 1;
    scanIdRef.current = scanId;
    activeScanIdRef.current = scanId;

    setError(null);
    clearExportNotice();
    const previousResult = result;
    const previousScanId = resultScanId;
    setResult(null);
    setResultScanId(null);
    setScanning(true);
    setProgress({
      scanId,
      processedCount: 0,
      currentPath: config.rootPath,
      status: "running",
    });

    const scanConfig: ScanConfig = {
      ...config,
      extensions: parseExtensionInput(extensionInput),
    };

    try {
      const next = await startScan(scanConfig, scanId);
      if (activeScanIdRef.current !== scanId) {
        return;
      }
      setResult(next);
      setResultScanId(scanId);
      setProgress({
        scanId,
        processedCount: next.stats.directoryCount + next.stats.fileCount,
        currentPath: config.rootPath,
        status: "completed",
      });
    } catch (cause) {
      if (activeScanIdRef.current !== scanId) {
        return;
      }
      if (shouldClearScanResultOnError(cause)) {
        setResult(null);
        setResultScanId(null);
      } else {
        setResult(previousResult);
        setResultScanId(previousScanId);
      }
      if (isCancelledError(cause)) {
        setError(null);
        setProgress((current) => ({
          scanId,
          processedCount: current?.processedCount ?? 0,
          currentPath: current?.currentPath ?? config.rootPath,
          status: "cancelled",
        }));
      } else {
        setError(toUserError(cause));
        setProgress((current) => ({
          scanId,
          processedCount: current?.processedCount ?? 0,
          currentPath: current?.currentPath ?? config.rootPath,
          status: "failed",
        }));
      }
    } finally {
      if (activeScanIdRef.current === scanId) {
        setScanning(false);
        scanLockRef.current = false;
      }
    }
  }

  async function handleCancelScan() {
    const scanId = activeScanIdRef.current;
    if (scanId === null) {
      return;
    }
    try {
      await cancelScan(scanId);
    } catch (cause) {
      setError(toUserError(cause));
    }
  }

  async function handleCopy() {
    if (result === null || resultScanId === null) {
      return;
    }
    setExportBusy(true);
    setError(null);
    clearExportNotice();
    try {
      const contents = await copyExport(exportFormat, resultScanId);
      await writeText(contents);
      setExportNotice(`${formatLabel(exportFormat)}-Inhalt in die Zwischenablage kopiert.`);
      setExportNoticeKind("saved");
    } catch (cause) {
      setExportNotice(toUserError(cause));
      setExportNoticeKind("failed");
    } finally {
      setExportBusy(false);
    }
  }

  async function handleSave() {
    if (result === null || resultScanId === null) {
      return;
    }
    setExportBusy(true);
    setError(null);
    clearExportNotice();
    try {
      const defaultName = await suggestExportFilename(exportFormat, resultScanId);
      const path = await pickExportPath(exportFormat, defaultName);
      if (path === null) {
        return;
      }
      setExportNotice(`${formatLabel(exportFormat)} wird gespeichert …`);
      setExportNoticeKind("progress");
      const saved = await saveExport(path, exportFormat, resultScanId);
      setExportNotice(
        `${formatLabel(exportFormat)}-Datei erfolgreich gespeichert:\n${saved.path}`,
      );
      setExportNoticeKind("saved");
    } catch (cause) {
      setExportNotice(toUserError(cause));
      setExportNoticeKind("failed");
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <div className="app">
      <header>
        <h1>KONDOS</h1>
        <p>Ordner- und Dateistrukturen erfassen, anzeigen und exportieren.</p>
      </header>
      {error !== null ? <p className="error">{error}</p> : null}
      {exportNotice !== null ? (
        <p
          className={
            exportNoticeKind === "failed"
              ? "error"
              : exportNoticeKind === "saved"
                ? "success"
                : "status-line"
          }
        >
          {exportNotice}
        </p>
      ) : null}
      <div className="layout">
        <aside>
          <ConfigPanel
            config={config}
            extensionInput={extensionInput}
            scanning={scanning}
            locked={exportBusy}
            onConfigChange={setConfig}
            onExtensionInputChange={setExtensionInput}
            onPickDirectory={() => {
              void handlePickDirectory();
            }}
            onStartScan={() => {
              void handleStartScan();
            }}
            onCancelScan={() => {
              void handleCancelScan();
            }}
          />
          <ProgressPanel scanning={scanning} progress={progress} />
          <ExportPanel
            format={exportFormat}
            disabled={result === null || resultScanId === null || scanning}
            busy={exportBusy}
            onFormatChange={setExportFormat}
            onCopy={() => {
              void handleCopy();
            }}
            onSave={() => {
              void handleSave();
            }}
          />
        </aside>
        <TreeView result={result} />
      </div>
    </div>
  );
}

export default App;
