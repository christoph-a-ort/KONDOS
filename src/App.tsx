import { useEffect, useMemo, useRef, useState } from "react";
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
  StructureInsightsView,
  canSelectInsightsView,
  canSelectPlanningView,
  insightNavCountLabel,
  mainViewAfterScanStart,
  type MainView,
} from "./ui/StructureInsightsView";
import { VirtualPlanPreviewView } from "./ui/VirtualPlanPreviewView";
import {
  listVirtualPlanDrafts,
  loadVirtualPlanDraft,
  saveVirtualPlanDraft,
  type VirtualPlanDraftListEntry,
} from "./ui/virtualPlanApi";
import {
  makeSnapshotBinding,
  parseVirtualPlan,
  type DraftLoadResult,
  type VirtualPlan,
} from "./ui/virtualPlan";
import {
  buildVirtualSollPreview,
  planIdForBinding,
} from "./ui/virtualPlanPreview";
import {
  createVirtualPlanFromProposal,
  prepareVirtualPlanForSave,
  validateVirtualPlan,
} from "./ui/virtualPlanEditor";
import {
  assessVirtualPlanApproval,
  prepareVirtualPlanApproval,
} from "./ui/virtualPlanApproval";
import type { VirtualReorgProposal } from "./ui/virtualPlanSuggestions";
import {
  scheduleStructureInsightAnalysis,
  type InsightAnalysisError,
  type InsightAnalysisPhase,
} from "./ui/structureInsightAnalysis";
import type { StructureInsightViewModel } from "./ui/structureInsightViewModel";
import {
  buildFolderInsightIdsByLocation,
  canNavigateToScanNode,
  firstInsightIdForLocation,
  type InsightFocusRequest,
  type TreeRevealRequest,
} from "./ui/structureInsightNavigation";
import {
  captureInsightAnalysisUiSnapshot,
  type InsightAnalysisUiSnapshot,
} from "./ui/structureInsightIntegration";
import {
  txtExportColumns,
  type ColumnVisibility,
  type ColumnWidths,
} from "./ui/treeColumns";
import { type TreeSort } from "./ui/treeSort";
import {
  canPersistWorkbenchPrefs,
  defaultWorkbenchPrefs,
  hydrateWorkbenchPrefs,
  persistWorkbenchPrefs,
  prefsToScanConfig,
  workbenchPrefsFromState,
  type WorkbenchPrefsJsonStore,
} from "./ui/workbenchPrefs";
import { isTauriRuntime, loadWorkbenchPrefsJson, saveWorkbenchPrefsJson } from "./ui/workbenchPrefsApi";
import {
  applyUiZoom,
  getUiZoomStorage,
  isUiZoomResetShortcut,
  persistUiZoom,
  readStoredUiZoom,
  stepUiZoom,
  UI_ZOOM_DEFAULT,
  UI_ZOOM_MAX,
  UI_ZOOM_MIN,
  zoomDirectionForWheel,
} from "./ui/uiZoom";
import "./App.css";
import dottyFmLogo from "./assets/dottyfm-logo.png";

function formatLabel(format: ExportFormat): string {
  return format.toUpperCase();
}

function createJsonPrefsStore(): WorkbenchPrefsJsonStore | null {
  if (!isTauriRuntime()) {
    return null;
  }
  return {
    load: () => loadWorkbenchPrefsJson(),
    save: (json) => saveWorkbenchPrefsJson(json),
  };
}

function App() {
  const [uiZoom, setUiZoom] = useState(() => readStoredUiZoom(getUiZoomStorage()));
  const [prefsReady, setPrefsReady] = useState(false);
  const [preferStoredWidths, setPreferStoredWidths] = useState(false);
  const [config, setConfig] = useState<ScanConfig>(() => prefsToScanConfig(defaultWorkbenchPrefs()));
  const [extensionInput, setExtensionInput] = useState(() => defaultWorkbenchPrefs().extensionInput);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [resultScanId, setResultScanId] = useState<number | null>(null);
  const [insightAnalysisPhase, setInsightAnalysisPhase] = useState<InsightAnalysisPhase>("idle");
  const [insightViewModel, setInsightViewModel] = useState<StructureInsightViewModel | null>(null);
  const [insightAnalysisError, setInsightAnalysisError] = useState<InsightAnalysisError | null>(null);
  const [insightAnalysisScanId, setInsightAnalysisScanId] = useState<number | null>(null);
  const [mainView, setMainView] = useState<MainView>("structure");
  const [planDraftLoad, setPlanDraftLoad] = useState<DraftLoadResult | null>(null);
  const [planDraftLoading, setPlanDraftLoading] = useState(false);
  const [editableVirtualPlan, setEditableVirtualPlan] = useState<VirtualPlan | null>(null);
  const [planSaving, setPlanSaving] = useState(false);
  const [planSaveMessage, setPlanSaveMessage] = useState<string | null>(null);
  const [historicalPlanEntries, setHistoricalPlanEntries] = useState<VirtualPlanDraftListEntry[]>([]);
  const [historicalPlansLoading, setHistoricalPlansLoading] = useState(false);
  const [treeRevealRequest, setTreeRevealRequest] = useState<TreeRevealRequest | null>(null);
  const [insightFocusRequest, setInsightFocusRequest] = useState<InsightFocusRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [exportNoticeKind, setExportNoticeKind] = useState<"progress" | "saved" | "failed" | null>(
    null,
  );
  const [exportFormat, setExportFormat] = useState<ExportFormat>("txt");
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(
    () => defaultWorkbenchPrefs().columnVisibility,
  );
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => defaultWorkbenchPrefs().columnWidths);
  const [treeSort, setTreeSort] = useState<TreeSort>(() => defaultWorkbenchPrefs().sort);
  const [exportBusy, setExportBusy] = useState(false);
  const [preparingContent, setPreparingContent] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [appliedExtensions, setAppliedExtensions] = useState<string[]>([]);
  const scanLockRef = useRef(false);
  const scanIdRef = useRef(0);
  const activeScanIdRef = useRef<number | null>(null);
  const scanningRef = useRef(false);
  const exportBusyRef = useRef(false);
  const preparingContentRef = useRef(false);
  const configRef = useRef(config);
  const extensionInputRef = useRef(extensionInput);
  const resultRef = useRef(result);
  const resultScanIdRef = useRef(resultScanId);
  const insightAnalysisGenerationRef = useRef(0);
  /** Immediate guard against double-click / overlapping insight analysis runs. */
  const insightAnalysisInFlightRef = useRef(false);

  useEffect(() => {
    persistUiZoom(getUiZoomStorage(), uiZoom);
    if (!isTauriRuntime()) {
      applyUiZoom(document.documentElement, uiZoom);
      return;
    }

    let disposed = false;
    applyUiZoom(document.documentElement, UI_ZOOM_DEFAULT);
    void getCurrentWebview()
      .setZoom(uiZoom / 100)
      .catch(() => {
        // Keep the UI usable in an unexpectedly restricted webview.
        if (!disposed) {
          applyUiZoom(document.documentElement, uiZoom);
        }
      });
    return () => {
      disposed = true;
    };
  }, [uiZoom]);

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      const direction = zoomDirectionForWheel(event);
      if (direction === null) {
        return;
      }
      event.preventDefault();
      setUiZoom((current) => stepUiZoom(current, direction));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isUiZoomResetShortcut(event)) {
        return;
      }
      event.preventDefault();
      setUiZoom(UI_ZOOM_DEFAULT);
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
  const navRequestIdRef = useRef(0);
  const handleDroppedPathsRef = useRef<(paths: string[]) => void>(() => {});
  const jsonStoreRef = useRef<WorkbenchPrefsJsonStore | null>(createJsonPrefsStore());
  const skipPersistAfterHydrateRef = useRef(true);

  scanningRef.current = scanning;
  exportBusyRef.current = exportBusy;
  preparingContentRef.current = preparingContent;
  configRef.current = config;
  extensionInputRef.current = extensionInput;
  resultRef.current = result;
  resultScanIdRef.current = resultScanId;

  /** Keep resultScanId State and resultScanIdRef in sync before any scheduled insight work. */
  function assignResultScanId(nextScanId: number | null): void {
    resultScanIdRef.current = nextScanId;
    setResultScanId(nextScanId);
  }

  function clearInsightNavigationState(): void {
    navRequestIdRef.current += 1;
    setTreeRevealRequest(null);
    setInsightFocusRequest(null);
  }

  function clearInsightAnalysisState(): void {
    insightAnalysisGenerationRef.current += 1;
    insightAnalysisInFlightRef.current = false;
    setInsightAnalysisPhase("idle");
    setInsightViewModel(null);
    setInsightAnalysisError(null);
    setInsightAnalysisScanId(null);
    setPlanDraftLoad(null);
    setPlanDraftLoading(false);
    clearInsightNavigationState();
    setMainView(mainViewAfterScanStart());
  }

  /** Restore prior insight UI after a rejected scan begin (invalid path/config). */
  function restoreInsightAnalysisUiSnapshot(snapshot: InsightAnalysisUiSnapshot): void {
    insightAnalysisInFlightRef.current = false;
    setInsightAnalysisPhase(snapshot.phase);
    setInsightViewModel(snapshot.viewModel);
    setInsightAnalysisError(snapshot.error);
    setInsightAnalysisScanId(snapshot.analysisScanId);
    clearInsightNavigationState();
    setMainView(snapshot.mainView);
  }

  function requestRevealInTree(nodeId: string): void {
    if (result === null || resultScanId === null) {
      return;
    }
    if (!canNavigateToScanNode(result.root, nodeId)) {
      return;
    }
    navRequestIdRef.current += 1;
    setTreeRevealRequest({
      id: navRequestIdRef.current,
      scanId: resultScanId,
      nodeId,
    });
    setMainView("structure");
  }

  function requestShowInsightsForLocation(locationId: string): void {
    if (
      resultScanId === null ||
      insightViewModel === null ||
      insightAnalysisPhase !== "ready"
    ) {
      return;
    }
    const firstInsightId = firstInsightIdForLocation(insightViewModel, locationId);
    if (firstInsightId === null) {
      return;
    }
    navRequestIdRef.current += 1;
    setInsightFocusRequest({
      id: navRequestIdRef.current,
      scanId: resultScanId,
      locationId,
      firstInsightId,
    });
    setMainView("insights");
  }

  const folderInsightIdsByLocation = useMemo(
    () =>
      insightAnalysisPhase === "ready"
        ? buildFolderInsightIdsByLocation(insightViewModel)
        : buildFolderInsightIdsByLocation(null),
    [insightAnalysisPhase, insightViewModel],
  );

  function beginInsightAnalysisForScan(scanResult: ScanResult, scanId: number): void {
    const generation = insightAnalysisGenerationRef.current;
    insightAnalysisInFlightRef.current = true;
    clearInsightNavigationState();
    setInsightAnalysisPhase("running");
    setInsightAnalysisError(null);
    setInsightViewModel(null);
    setInsightAnalysisScanId(scanId);
    scheduleStructureInsightAnalysis({
      scanResult,
      scanId,
      generation,
      getCurrentScanId: () => resultScanIdRef.current,
      getCurrentGeneration: () => insightAnalysisGenerationRef.current,
      onReady: (viewModel) => {
        insightAnalysisInFlightRef.current = false;
        setInsightViewModel(viewModel);
        setInsightAnalysisError(null);
        setInsightAnalysisPhase("ready");
      },
      onFailed: (analysisError) => {
        insightAnalysisInFlightRef.current = false;
        setInsightViewModel(null);
        setInsightAnalysisError(analysisError);
        setInsightAnalysisPhase("failed");
      },
    });
  }

  /** Reuses current ScanResult only — never starts a filesystem scan. */
  function retryInsightAnalysis(): void {
    if (insightAnalysisInFlightRef.current || scanningRef.current) {
      return;
    }
    if (insightAnalysisPhase !== "failed") {
      return;
    }
    const scanResult = resultRef.current;
    const scanId = resultScanIdRef.current;
    if (scanResult === null || scanId === null) {
      return;
    }
    insightAnalysisInFlightRef.current = true;
    insightAnalysisGenerationRef.current += 1;
    beginInsightAnalysisForScan(scanResult, scanId);
  }

  void insightAnalysisScanId;

  const insightsSelectable = canSelectInsightsView(result !== null && resultScanId !== null);
  const planningSelectable = canSelectPlanningView(result !== null && resultScanId !== null);
  const insightsNavCount = insightNavCountLabel(insightAnalysisPhase, insightViewModel);

  const virtualPlanPreview = useMemo(() => {
    if (result === null || resultScanId === null) {
      return null;
    }
    const existingDraft = planDraftLoad?.kind === "valid" ? planDraftLoad.plan : null;
    const draftBlocked = planDraftLoad?.kind === "blocked";
    return buildVirtualSollPreview({
      scanResult: result,
      scanConfig: config,
      sourceScanId: resultScanId,
      insightViewModel,
      existingDraft,
      draftBlocked,
    });
  }, [result, resultScanId, config, insightViewModel, planDraftLoad]);

  useEffect(() => {
    if (!planningSelectable || mainView !== "planning" || result === null || resultScanId === null) {
      return;
    }
    let cancelled = false;
    setPlanDraftLoading(true);
    const binding = makeSnapshotBinding(result, config, resultScanId);
    const planId = planIdForBinding(binding);
    void loadVirtualPlanDraft(planId)
      .then((raw) => {
        if (cancelled) {
          return;
        }
        if (raw === null) {
          setPlanDraftLoad({ kind: "missing" });
          setEditableVirtualPlan(null);
        } else {
          const parsed = parseVirtualPlan(raw);
          setPlanDraftLoad(parsed);
          setEditableVirtualPlan(parsed.kind === "valid" ? parsed.plan : null);
        }
        setPlanDraftLoading(false);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setPlanDraftLoad({ kind: "blocked", reason: "corrupt" });
        setEditableVirtualPlan(null);
        setPlanDraftLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [planningSelectable, mainView, result, resultScanId, config]);

  function refreshHistoricalVirtualPlans(): void {
    if (!planningSelectable || result === null || resultScanId === null) {
      return;
    }
    setHistoricalPlansLoading(true);
    void listVirtualPlanDrafts()
      .then((entries) => {
        setHistoricalPlanEntries(entries);
      })
      .catch(() => {
        // The current plan remains usable; history discovery is read-only.
        setHistoricalPlanEntries([]);
      })
      .finally(() => {
        setHistoricalPlansLoading(false);
      });
  }

  useEffect(() => {
    refreshHistoricalVirtualPlans();
  }, [planningSelectable, mainView, result, resultScanId, config]);

  function selectVirtualProposalForEditing(proposal: VirtualReorgProposal): void {
    if (result === null || virtualPlanPreview === null) {
      return;
    }
    const created = createVirtualPlanFromProposal({
      proposal,
      scanResult: result,
      binding: virtualPlanPreview.binding,
    });
    if (!created.ok) {
      setPlanSaveMessage(created.error);
      return;
    }
    setEditableVirtualPlan(created.plan);
    setPlanSaveMessage("Virtueller Entwurf aus dem ausgewählten Vorschlag angelegt. Noch nicht gespeichert.");
  }

  function changeEditableVirtualPlan(plan: VirtualPlan): void {
    setEditableVirtualPlan(plan);
    setPlanSaveMessage("Lokale virtuelle Bearbeitung noch nicht gespeichert.");
  }

  function saveEditableVirtualPlan(): void {
    if (
      editableVirtualPlan === null ||
      result === null ||
      resultScanId === null ||
      virtualPlanPreview === null ||
      planSaving
    ) {
      return;
    }
    const currentBinding = makeSnapshotBinding(result, config, resultScanId);
    const validation = validateVirtualPlan(editableVirtualPlan, result, currentBinding);
    if (!validation.valid) {
      setPlanSaveMessage(validation.errors[0] ?? "Der virtuelle Entwurf kann nicht gespeichert werden.");
      return;
    }
    const expectedRevision = planDraftLoad?.kind === "valid" ? planDraftLoad.plan.revision : 0;
    const candidate = prepareVirtualPlanForSave(editableVirtualPlan, expectedRevision);
    setPlanSaving(true);
    setPlanSaveMessage(null);
    void saveVirtualPlanDraft(candidate.planId, expectedRevision, JSON.stringify(candidate))
      .then(() => {
        setEditableVirtualPlan(candidate);
        setPlanDraftLoad({ kind: "valid", plan: candidate });
        setPlanSaveMessage(`Entwurf gespeichert (Revision ${candidate.revision}).`);
        refreshHistoricalVirtualPlans();
      })
      .catch(() => {
        setPlanSaveMessage("Der virtuelle Entwurf konnte nicht gespeichert werden. Es wurde keine Erfolgsmeldung erzeugt.");
      })
      .finally(() => {
        setPlanSaving(false);
      });
  }

  function approveEditableVirtualPlan(): void {
    if (
      editableVirtualPlan === null ||
      result === null ||
      resultScanId === null ||
      planSaving
    ) {
      return;
    }
    const currentBinding = makeSnapshotBinding(result, config, resultScanId);
    const approval = assessVirtualPlanApproval({
      plan: editableVirtualPlan,
      scanResult: result,
      binding: currentBinding,
      draftLoad: planDraftLoad,
    });
    if (!approval.eligible || planDraftLoad?.kind !== "valid") {
      setPlanSaveMessage(approval.blockers[0] ?? "Der virtuelle Plan kann nicht bestätigt werden.");
      return;
    }
    const candidate = prepareVirtualPlanApproval(editableVirtualPlan, planDraftLoad.plan.revision);
    setPlanSaving(true);
    setPlanSaveMessage(null);
    void saveVirtualPlanDraft(candidate.planId, planDraftLoad.plan.revision, JSON.stringify(candidate))
      .then(() => {
        setEditableVirtualPlan(candidate);
        setPlanDraftLoad({ kind: "valid", plan: candidate });
        setPlanSaveMessage("Virtueller Plan bestätigt. Es wurden keine Dateien oder Ordner verändert.");
        refreshHistoricalVirtualPlans();
      })
      .catch(() => {
        setPlanSaveMessage("Der virtuelle Plan konnte nicht bestätigt werden. Es wurde keine Erfolgsmeldung erzeugt.");
      })
      .finally(() => {
        setPlanSaving(false);
      });
  }

  useEffect(() => {
    let disposed = false;

    void (async () => {
      const hydration = await hydrateWorkbenchPrefs(jsonStoreRef.current);
      if (disposed) {
        return;
      }
      setConfig(prefsToScanConfig(hydration.prefs));
      setExtensionInput(hydration.prefs.extensionInput);
      setColumnVisibility(hydration.prefs.columnVisibility);
      setColumnWidths(hydration.prefs.columnWidths);
      setTreeSort(hydration.prefs.sort);
      setPreferStoredWidths(hydration.preferStoredWidths);
      if (hydration.notice !== null) {
        setError(hydration.notice);
      }
      skipPersistAfterHydrateRef.current = true;
      setPrefsReady(true);
    })();

    return () => {
      disposed = true;
    };
  }, []);

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

        const busy =
          scanningRef.current ||
          exportBusyRef.current ||
          preparingContentRef.current ||
          scanLockRef.current;
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
    if (scanning || exportBusy || preparingContent) {
      setDropActive(false);
    }
  }, [scanning, exportBusy, preparingContent]);

  useEffect(() => {
    if (result === null) {
      preparingContentRef.current = false;
      setPreparingContent(false);
    }
  }, [result]);

  useEffect(() => {
    if (!canPersistWorkbenchPrefs(prefsReady)) {
      return;
    }
    if (skipPersistAfterHydrateRef.current) {
      skipPersistAfterHydrateRef.current = false;
      return;
    }
    const prefs = workbenchPrefsFromState({
      config,
      extensionInput,
      columnVisibility,
      columnWidths,
      sort: treeSort,
    });
    void persistWorkbenchPrefs(prefs, jsonStoreRef.current).catch((cause) => {
      setError(toUserError(cause));
    });
  }, [prefsReady, config, extensionInput, columnVisibility, columnWidths, treeSort]);

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

  function handlePreparingContentChange(busy: boolean) {
    preparingContentRef.current = busy;
    setPreparingContent(busy);
  }

  async function handleStartScan(rootPathOverride?: string) {
    if (
      scanLockRef.current ||
      exportBusyRef.current ||
      scanningRef.current ||
      preparingContentRef.current
    ) {
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
    const previousInsightUi = captureInsightAnalysisUiSnapshot({
      phase: insightAnalysisPhase,
      viewModel: insightViewModel,
      error: insightAnalysisError,
      analysisScanId: insightAnalysisScanId,
      mainView,
    });
    clearInsightAnalysisState();
    setResult(null);
    assignResultScanId(null);
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
      assignResultScanId(scanId);
      setAppliedExtensions(scanConfig.extensions);
      setProgress({
        scanId,
        processedCount: next.stats.directoryCount + next.stats.fileCount,
        currentPath: rootPath,
        status: "completed",
      });
      // Structure is usable immediately; insight analysis starts after this turn.
      beginInsightAnalysisForScan(next, scanId);
    } catch (cause) {
      if (activeScanIdRef.current !== scanId) {
        return;
      }
      if (shouldClearScanResultOnError(cause)) {
        setResult(null);
        assignResultScanId(null);
      } else {
        // Rejected begin (invalidPath/invalidConfig): restore prior scan + insight analysis.
        setResult(previousResult);
        assignResultScanId(previousScanId);
        restoreInsightAnalysisUiSnapshot(previousInsightUi);
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
    if (
      scanningRef.current ||
      exportBusyRef.current ||
      preparingContentRef.current ||
      scanLockRef.current
    ) {
      return;
    }

    const decision = decideDroppedPaths(paths);
    if (decision.action !== "accept") {
      setError(DROP_MULTIPLE_MESSAGE);
      return;
    }

    try {
      const kind = await classifyScanRoot(decision.path);
      if (
        scanningRef.current ||
        exportBusyRef.current ||
        preparingContentRef.current ||
        scanLockRef.current
      ) {
        return;
      }
      if (kind !== "directory") {
        setError(DROP_FILE_MESSAGE);
        return;
      }
      await handleStartScan(decision.path);
    } catch (cause) {
      if (
        scanningRef.current ||
        exportBusyRef.current ||
        preparingContentRef.current ||
        scanLockRef.current
      ) {
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
    if (result === null || resultScanId === null || preparingContentRef.current) {
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
    if (result === null || resultScanId === null || preparingContentRef.current) {
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

  if (!prefsReady) {
    return (
      <div className="app">
        <header className="app-header">
          <div className="app-header-text">
            <h1>DottyFM</h1>
            <p>Ordner- und Dateistrukturen erfassen, anzeigen und exportieren.</p>
          </div>
          <img
            className="dottyfm-logo"
            src={dottyFmLogo}
            alt=""
            aria-hidden="true"
          />
        </header>
        <p className="status-line">Einstellungen werden geladen…</p>
      </div>
    );
  }

  return (
    <div className={dropActive ? "app drop-active" : "app"}>
      <header className="app-header">
        <div className="app-header-text">
          <h1>DottyFM</h1>
          <p>Ordner- und Dateistrukturen erfassen, anzeigen und exportieren.</p>
        </div>
        <div className="ui-zoom-control" role="group" aria-label="Oberflächenzoom">
          <button
            type="button"
            aria-label="Oberfläche verkleinern"
            disabled={uiZoom <= UI_ZOOM_MIN}
            onClick={() => setUiZoom((current) => stepUiZoom(current, -1))}
          >
            −
          </button>
          <button
            type="button"
            className="ui-zoom-value"
            aria-label="Zoom auf 100 Prozent zurücksetzen"
            title="Zoom auf 100 % zurücksetzen (Strg + 0)"
            onClick={() => setUiZoom(UI_ZOOM_DEFAULT)}
          >
            {uiZoom} %
          </button>
          <button
            type="button"
            aria-label="Oberfläche vergrößern"
            disabled={uiZoom >= UI_ZOOM_MAX}
            onClick={() => setUiZoom((current) => stepUiZoom(current, 1))}
          >
            +
          </button>
        </div>
        <img
          className="dottyfm-logo"
          src={dottyFmLogo}
          alt=""
          aria-hidden="true"
        />
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
            locked={exportBusy || preparingContent}
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
            disabled={result === null || resultScanId === null || scanning || preparingContent}
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
        <div className="main-workbench">
          <div
            className="insight-view-switcher"
            role="group"
            aria-label="Hauptansicht"
          >
            <button
              type="button"
              className="insight-view-tab"
              aria-pressed={mainView === "structure"}
              onClick={() => {
                setMainView("structure");
              }}
            >
              Struktur
            </button>
            <button
              type="button"
              className="insight-view-tab"
              aria-pressed={insightsSelectable && mainView === "insights"}
              disabled={!insightsSelectable}
              onClick={() => {
                if (insightsSelectable) {
                  setMainView("insights");
                }
              }}
            >
              Erkenntnisse
              {insightsNavCount !== null ? (
                <span className="insight-view-tab-count" aria-label={`${insightsNavCount} Erkenntnisse`}>
                  {insightsNavCount}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className="insight-view-tab"
              aria-pressed={planningSelectable && mainView === "planning"}
              disabled={!planningSelectable}
              onClick={() => {
                if (planningSelectable) {
                  setMainView("planning");
                }
              }}
            >
              Planung
            </button>
          </div>
          <div className="main-view-panels">
            <div
              className={
                mainView === "structure"
                  ? "main-view-panel"
                  : "main-view-panel main-view-panel-hidden"
              }
              aria-hidden={mainView !== "structure"}
              inert={mainView !== "structure" ? true : undefined}
            >
              <TreeView
                result={result}
                resultScanId={resultScanId}
                scanning={scanning}
                exportBusy={exportBusy}
                appliedExtensions={appliedExtensions}
                sort={treeSort}
                visibility={columnVisibility}
                widths={columnWidths}
                preferStoredWidths={preferStoredWidths}
                onSortChange={setTreeSort}
                onVisibilityChange={setColumnVisibility}
                onWidthsChange={setColumnWidths}
                onScanFromHere={handleUseAsScanRoot}
                onPreparingContentChange={handlePreparingContentChange}
                onExportBusyChange={setExportBusy}
                revealRequest={treeRevealRequest}
                folderInsightIdsByLocation={folderInsightIdsByLocation}
                onInsightMarkerActivate={requestShowInsightsForLocation}
              />
            </div>
            {insightsSelectable ? (
              <div
                className={
                  mainView === "insights"
                    ? "main-view-panel"
                    : "main-view-panel main-view-panel-hidden"
                }
                aria-hidden={mainView !== "insights"}
                inert={mainView !== "insights" ? true : undefined}
              >
                <StructureInsightsView
                  phase={insightAnalysisPhase}
                  viewModel={insightViewModel}
                  analysisError={insightAnalysisError}
                  onRetryAnalysis={retryInsightAnalysis}
                  focusRequest={insightFocusRequest}
                  onNavigateToNode={requestRevealInTree}
                />
              </div>
            ) : null}
            {planningSelectable ? (
              <div
                className={
                  mainView === "planning"
                    ? "main-view-panel"
                    : "main-view-panel main-view-panel-hidden"
                }
                aria-hidden={mainView !== "planning"}
                inert={mainView !== "planning" ? true : undefined}
              >
                <VirtualPlanPreviewView
                  preview={virtualPlanPreview}
                  scanResult={result}
                  draftLoad={planDraftLoad}
                  loadingDraft={planDraftLoading}
                  editablePlan={editableVirtualPlan}
                  planSaving={planSaving}
                  planSaveMessage={planSaveMessage}
                  historicalPlanEntries={historicalPlanEntries}
                  historicalPlansLoading={historicalPlansLoading}
                  onSelectProposal={selectVirtualProposalForEditing}
                  onPlanChange={changeEditableVirtualPlan}
                  onSavePlan={saveEditableVirtualPlan}
                  onApprovePlan={approveEditableVirtualPlan}
                  onRecheckHistoricalPlans={refreshHistoricalVirtualPlans}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
