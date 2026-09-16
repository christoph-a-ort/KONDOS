import { useEffect, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { renderExport } from "./export";
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
  pickDirectory,
  pickExportPath,
  saveExport,
  startScan,
  subscribeScanProgress,
  toUserError,
} from "./scan";
import { ConfigPanel } from "./ui/ConfigPanel";
import { ExportPanel } from "./ui/ExportPanel";
import { ProgressPanel } from "./ui/ProgressPanel";
import { TreeView } from "./ui/TreeView";
import "./App.css";

function App() {
  const [config, setConfig] = useState<ScanConfig>(createDefaultScanConfig);
  const [extensionInput, setExtensionInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("txt");
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void subscribeScanProgress((next) => {
      if (!disposed) {
        setProgress(next);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

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
    setError(null);
    setScanning(true);
    setProgress({
      processedCount: 0,
      currentPath: config.rootPath,
      status: "running",
    });

    const scanConfig: ScanConfig = {
      ...config,
      extensions: parseExtensionInput(extensionInput),
    };

    try {
      const next = await startScan(scanConfig);
      setResult(next);
    } catch (cause) {
      setError(toUserError(cause));
      setProgress((current) =>
        current === null
          ? current
          : {
              ...current,
              status: "failed",
            },
      );
    } finally {
      setScanning(false);
    }
  }

  async function handleCancelScan() {
    try {
      await cancelScan();
    } catch (cause) {
      setError(toUserError(cause));
    }
  }

  async function handleCopy() {
    if (result === null) {
      return;
    }
    setExportBusy(true);
    setError(null);
    try {
      await writeText(renderExport(result, exportFormat));
    } catch (cause) {
      setError(toUserError(cause));
    } finally {
      setExportBusy(false);
    }
  }

  async function handleSave() {
    if (result === null) {
      return;
    }
    setExportBusy(true);
    setError(null);
    try {
      const path = await pickExportPath(exportFormat);
      if (path === null) {
        return;
      }
      await saveExport(path, renderExport(result, exportFormat));
    } catch (cause) {
      setError(toUserError(cause));
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <div className="app">
      <header>
        <h1>Dateiliste</h1>
        <p>Ordner- und Dateistrukturen erfassen, anzeigen und exportieren.</p>
      </header>
      {error !== null ? <p className="error">{error}</p> : null}
      <div className="layout">
        <aside>
          <ConfigPanel
            config={config}
            extensionInput={extensionInput}
            scanning={scanning}
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
            disabled={result === null}
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
