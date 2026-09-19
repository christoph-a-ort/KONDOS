import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { parseExtensionInput } from "./filter";
import {
  type ExportFormat,
  type ScanConfig,
  type ScanProgress,
  type ScanResult,
} from "./model";
import {
  cancelScan,
  classifyScanRoot,
  copyExport,
  decideDroppedPaths,
  DROP_FILE_MESSAGE,
  DROP_MULTIPLE_MESSAGE,
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
import { withScanRootPath } from "./ui/displayFilter";
import { TreeView } from "./ui/TreeView";
import {
  txtExportColumns,
  type ColumnVisibility,
  type ColumnWidths,
} from "./ui/treeColumns";
import { type TreeSort } from "./ui/treeSort";
import {
  hadStoredWorkbenchPrefs,
  loadWorkbenchPrefs,
  prefsToScanConfig,
  saveWorkbenchPrefs,
  workbenchPrefsFromState,
} from "./ui/workbenchPrefs";
import "./App.css";

function formatLabel(format: ExportFormat): string {
  return format.toUpperCase();
}

function App() {
  const [initialPrefs] = useState(() => loadWorkbenchPrefs());
  const [preferStoredWidths] = useState(() => hadStoredWorkbenchPrefs());
  const [config, setConfig] = useState<ScanConfig>(() => prefsToScanConfig(initialPrefs));
  const [extensionInput, setExtensionInput] = useState(() => initialPrefs.extensionInput);
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
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(
    () => initialPrefs.columnVisibility,
  );
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => initialPrefs.columnWidths);
  const [treeSort, setTreeSort] = useState<TreeSort>(() => initialPrefs.sort);
  const [exportBusy, setExportBusy] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [appliedExtensions, setAppliedExtensions] = useState<string[]>([]);
  const scanLockRef = useRef(false);
  const scanIdRef = useRef(0);
  const activeScanIdRef = useRef<number | null>(null);
  const scanningRef = useRef(false);
  const exportBusyRef = useRef(false);
  const configRef = useRef(config);
  const extensionInputRef = useRef(extensionInput);
  const resultRef = useRef(result);
  const resultScanIdRef = useRef(resultScanId);
  const handleDroppedPathsRef = useRef<(paths: string[]) => void>(() => {});

  scanningRef.current = scanning;
  exportBusyRef.current = exportBusy;
  configRef.current = config;
  extensionInputRef.current = extensionInput;
  resultRef.current = result;
  resultScanIdRef.current = resultScanId;

  useEffect(() => {
    let disposed = false;
    let unlistenProgress: (() => void) | undefined;
    let unlistenDragDrop: (() => void) | undefined;

    void subscribeScanProgress((next) => {
      if (disposed || !isProgressForScan(activeScanIdRef.current, next)) {
        return;
      }
      setProgress(next);
    }).then((fn) => {
      unlistenProgress = fn;
    });

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (disposed) {
          return;
        }

        const busy = scanningRef.current || exportBusyRef.current || scanLockRef.current;
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setDropActive(!busy);
          return;
        }

        setDropActive(false);
        if (event.payload.type === "leave" || busy) {
          return;
        }

        handleDroppedPathsRef.current(event.payload.paths);
      })
      .then((fn) => {
        unlistenDragDrop = fn;
      });

    return () => {
      disposed = true;
      unlistenProgress?.();
      unlistenDragDrop?.();
    };
  }, []);

  useEffect(() => {
    if (scanning || exportBusy) {
      setDropActive(false);
    }
  }, [scanning, exportBusy]);

  useEffect(() => {
    saveWorkbenchPrefs(
      workbenchPrefsFromState({
        config,
        extensionInput,
        columnVisibility,
        columnWidths,
        sort: treeSort,
      }),
    );
  }, [config, extensionInput, columnVisibility, columnWidths, treeSort]);

  function clearExportNotice() {
    setExportNotice(null);
    setExportNoticeKind(null);
  }

  function handleUseAsScanRoot(path: string) {
    setConfig((current) => withScanRootPath(current, path));
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

  async function handleStartScan(rootPathOverride?: string) {
    if (scanLockRef.current || exportBusyRef.current || scanningRef.current) {
      return;
    }
    const rootPath = rootPathOverride ?? configRef.current.rootPath;
    if (rootPath.length === 0) {
      return;
    }

    scanLockRef.current = true;
    const scanId = scanIdRef.current + 1;
    scanIdRef.current = scanId;
    activeScanIdRef.current = scanId;

    if (rootPathOverride !== undefined) {
      setConfig((current) =>
        current.rootPath === rootPathOverride ? current : { ...current, rootPath: rootPathOverride },
      );
    }

    setError(null);
    clearExportNotice();
    const previousResult = resultRef.current;
    const previousScanId = resultScanIdRef.current;
    setResult(null);
    setResultScanId(null);
    setScanning(true);
    setProgress({
      scanId,
      processedCount: 0,
      currentPath: rootPath,
      status: "running",
    });

    const scanConfig: ScanConfig = {
      ...configRef.current,
      rootPath,
      extensions: parseExtensionInput(extensionInputRef.current),
    };

    try {
      const next = await startScan(scanConfig, scanId);
      if (activeScanIdRef.current !== scanId) {
        return;
      }
      setResult(next);
      setResultScanId(scanId);
      setAppliedExtensions(scanConfig.extensions);
      setProgress({
        scanId,
        processedCount: next.stats.directoryCount + next.stats.fileCount,
        currentPath: rootPath,
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
          currentPath: current?.currentPath ?? rootPath,
          status: "cancelled",
        }));
      } else {
        setError(toUserError(cause));
        setProgress((current) => ({
          scanId,
          processedCount: current?.processedCount ?? 0,
          currentPath: current?.currentPath ?? rootPath,
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

  async function handleDroppedPaths(paths: string[]) {
    if (scanningRef.current || exportBusyRef.current || scanLockRef.current) {
      return;
    }

    const decision = decideDroppedPaths(paths);
    if (decision.action !== "accept") {
      setError(DROP_MULTIPLE_MESSAGE);
      return;
    }

    try {
      const kind = await classifyScanRoot(decision.path);
      if (scanningRef.current || exportBusyRef.current || scanLockRef.current) {
        return;
      }
      if (kind !== "directory") {
        setError(DROP_FILE_MESSAGE);
        return;
      }
      await handleStartScan(decision.path);
    } catch (cause) {
      if (scanningRef.current || exportBusyRef.current || scanLockRef.current) {
        return;
      }
      setError(toUserError(cause));
    }
  }

  handleDroppedPathsRef.current = (paths) => {
    void handleDroppedPaths(paths);
  };

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
      const contents = await copyExport(
        exportFormat,
        resultScanId,
        exportFormat === "txt" ? txtExportColumns(columnVisibility) : undefined,
      );
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
      const saved = await saveExport(
        path,
        exportFormat,
        resultScanId,
        exportFormat === "txt" ? txtExportColumns(columnVisibility) : undefined,
      );
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
    <div className={dropActive ? "app drop-active" : "app"}>
      <header>
        <h1>KONDOS</h1>
        <p>Ordner- und Dateistrukturen erfassen, anzeigen und exportieren.</p>
      </header>
      {dropActive ? <p className="drop-hint">Ordner hier ablegen</p> : null}
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
        <TreeView
          result={result}
          scanning={scanning}
          appliedExtensions={appliedExtensions}
          sort={treeSort}
          visibility={columnVisibility}
          widths={columnWidths}
          preferStoredWidths={preferStoredWidths}
          onSortChange={setTreeSort}
          onVisibilityChange={setColumnVisibility}
          onWidthsChange={setColumnWidths}
          onScanFromHere={handleUseAsScanRoot}
        />
      </div>
    </div>
  );
}

export default App;
