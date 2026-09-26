import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ScanResult } from "../model";
import {
  exportInventoryReportPdf,
  exportInventoryReportXlsx,
  openInExplorer,
  pathExists,
  pickDirectory,
  pickReportSavePath,
  toUserError,
} from "../scan";
import type { InventoryAnalysis } from "./inventoryAnalysis";
import type { InventoryExactFolderFileStructureContext } from "./inventoryExactFolderFileStructure";
import type { InventoryFileNameSyntaxContext } from "./inventoryFileNameSyntax";
import {
  buildInventoryReportModel,
  setInventoryReportChapter,
  type InventoryReportChapterSelection,
  type InventoryReportModel,
} from "./inventoryReportModel";
import type { InventoryStructureContext } from "./inventoryStructureContext";
import {
  buildReportTargetPlan,
  canSubmitReportDialog,
  createDefaultReportFormatSelection,
  formatReportPartialBody,
  formatReportSuccessBody,
  hasAnyReportChapter,
  hasAnyReportFormat,
  inventoryReportChapterRows,
  overwriteConfirmMessage,
  selectAllReportChapters,
  selectNoReportChapters,
  suggestedReportBasename,
  validateReportBasename,
  type ReportFormatSelection,
  type ReportRunOutcome,
  type ReportTargetPlan,
} from "./inventoryReportWorkflow";

export interface InventoryReportDialogProps {
  open: boolean;
  result: ScanResult;
  resultScanId: number | null;
  analysis: InventoryAnalysis;
  structure: InventoryStructureContext;
  exactFolderStructures: InventoryExactFolderFileStructureContext;
  fileNameSyntax: InventoryFileNameSyntaxContext;
  exportBusy: boolean;
  onExportBusyChange: (busy: boolean) => void;
  onClose: () => void;
}

type DialogPhase = "form" | "overwrite" | "result";

export function InventoryReportDialog({
  open,
  result,
  resultScanId,
  analysis,
  structure,
  exactFolderStructures,
  fileNameSyntax,
  exportBusy,
  onExportBusyChange,
  onClose,
}: InventoryReportDialogProps) {
  const titleId = useId();
  const basenameId = useId();
  const exportInFlightRef = useRef(false);
  const [formats, setFormats] = useState<ReportFormatSelection>(createDefaultReportFormatSelection);
  const [chapters, setChapters] = useState<InventoryReportChapterSelection>(selectAllReportChapters);
  const [basename, setBasename] = useState("");
  const [phase, setPhase] = useState<DialogPhase>("form");
  const [pendingPlan, setPendingPlan] = useState<ReportTargetPlan | null>(null);
  const [existingPaths, setExistingPaths] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<ReportRunOutcome | null>(null);
  const [localBusy, setLocalBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setFormats(createDefaultReportFormatSelection());
    setChapters(selectAllReportChapters());
    setBasename(suggestedReportBasename(result.root.name));
    setPhase("form");
    setPendingPlan(null);
    setExistingPaths([]);
    setOutcome(null);
    setLocalBusy(false);
    exportInFlightRef.current = false;
  }, [open, result.root.name, result.root.id]);

  if (!open) {
    return null;
  }

  const busy = localBusy || exportBusy;
  const basenameValidation = validateReportBasename(basename);
  const canSubmit = canSubmitReportDialog({
    formats,
    chapters,
    basename,
    busy,
  });
  const chapterRows = inventoryReportChapterRows();

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !busy) {
      event.stopPropagation();
      onClose();
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || exportInFlightRef.current || localBusy) {
      return;
    }
    const validated = validateReportBasename(basename);
    if (!validated.ok) {
      return;
    }

    setLocalBusy(true);
    let plan: ReportTargetPlan;
    try {
      if (formats.xlsx && formats.pdf) {
        const folder = await pickDirectory({ title: "Zielordner für Bericht wählen" });
        if (folder === null) {
          setLocalBusy(false);
          return;
        }
        plan = buildReportTargetPlan(formats, validated.basename, {
          type: "folder",
          path: folder,
        });
      } else if (formats.xlsx) {
        const path = await pickReportSavePath("xlsx", `${validated.basename}.xlsx`);
        if (path === null) {
          setLocalBusy(false);
          return;
        }
        plan = buildReportTargetPlan(formats, validated.basename, { type: "file", path });
      } else {
        const path = await pickReportSavePath("pdf", `${validated.basename}.pdf`);
        if (path === null) {
          setLocalBusy(false);
          return;
        }
        plan = buildReportTargetPlan(formats, validated.basename, { type: "file", path });
      }
    } catch (cause) {
      setLocalBusy(false);
      setOutcome({ status: "failed", message: toUserError(cause) });
      setPhase("result");
      return;
    }

    const existing: string[] = [];
    for (const target of plan.targets) {
      try {
        if (await pathExists(target.path)) {
          existing.push(target.path);
        }
      } catch {
        // Existence probe failed — continue; Safe Write still protects races.
      }
    }

    if (existing.length > 0) {
      setLocalBusy(false);
      setPendingPlan(plan);
      setExistingPaths(existing);
      setPhase("overwrite");
      return;
    }

    await runExport(plan);
  }

  async function runExport(plan: ReportTargetPlan) {
    if (exportInFlightRef.current) {
      return;
    }
    exportInFlightRef.current = true;
    setLocalBusy(true);
    onExportBusyChange(true);
    setPhase("form");
    setPendingPlan(null);
    setExistingPaths([]);

    const report: InventoryReportModel = buildInventoryReportModel({
      result,
      analysis,
      structure,
      fileNameSyntax,
      exactFolderStructures,
      scanId: resultScanId,
      chapterSelection: chapters,
    });

    const saved: Array<{ format: "xlsx" | "pdf"; path: string }> = [];
    let failed: { format: "xlsx" | "pdf"; message: string } | null = null;

    try {
      for (const target of plan.targets) {
        try {
          const written =
            target.format === "xlsx"
              ? await exportInventoryReportXlsx(target.path, report)
              : await exportInventoryReportPdf(target.path, report);
          saved.push({ format: target.format, path: written.path });
        } catch (cause) {
          failed = { format: target.format, message: toUserError(cause) };
          break;
        }
      }

      if (failed === null && saved.length > 0) {
        setOutcome({ status: "success", folderPath: plan.folderPath, saved });
      } else if (failed !== null && saved.length > 0) {
        setOutcome({
          status: "partial",
          folderPath: plan.folderPath,
          saved,
          failed,
        });
      } else {
        setOutcome({
          status: "failed",
          message: failed?.message ?? "Bericht konnte nicht erstellt werden.",
        });
      }
      setPhase("result");
    } finally {
      exportInFlightRef.current = false;
      setLocalBusy(false);
      onExportBusyChange(false);
    }
  }

  async function handleOpenFolder() {
    const folder =
      outcome?.status === "success" || outcome?.status === "partial"
        ? outcome.folderPath
        : null;
    if (folder === null) {
      return;
    }
    try {
      await openInExplorer(folder, true);
    } catch (cause) {
      setOutcome({
        status: "failed",
        message: toUserError(cause),
      });
      setPhase("result");
    }
  }

  if (phase === "overwrite" && pendingPlan !== null) {
    return (
      <div
        className="report-dialog-backdrop"
        role="presentation"
        onKeyDown={handleKeyDown}
      >
        <div
          className="report-dialog report-dialog-confirm"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <h2 id={titleId}>Datei bereits vorhanden</h2>
          <p className="report-dialog-message">{overwriteConfirmMessage(existingPaths)}</p>
          <div className="report-dialog-actions">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => {
                void runExport(pendingPlan);
              }}
            >
              Überschreiben
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPendingPlan(null);
                setExistingPaths([]);
                setPhase("form");
              }}
            >
              Abbrechen
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "result" && outcome !== null) {
    if (outcome.status === "success") {
      const copy = formatReportSuccessBody(outcome);
      return (
        <ResultDialog
          titleId={titleId}
          title={copy.title}
          body={copy.body}
          onOpenFolder={() => {
            void handleOpenFolder();
          }}
          onClose={onClose}
          onKeyDown={handleKeyDown}
        />
      );
    }
    if (outcome.status === "partial") {
      const copy = formatReportPartialBody(outcome);
      return (
        <ResultDialog
          titleId={titleId}
          title={copy.title}
          body={copy.body}
          onOpenFolder={() => {
            void handleOpenFolder();
          }}
          onClose={onClose}
          onKeyDown={handleKeyDown}
        />
      );
    }
    return (
      <ResultDialog
        titleId={titleId}
        title="Bericht konnte nicht erstellt werden"
        body={outcome.message}
        onClose={onClose}
        onKeyDown={handleKeyDown}
      />
    );
  }

  return (
    <div
      className="report-dialog-backdrop"
      role="presentation"
      onKeyDown={handleKeyDown}
    >
      <form
        className="report-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <h2 id={titleId}>Bericht erstellen</h2>

        <fieldset className="report-dialog-fieldset" disabled={busy}>
          <legend>Ausgabeformat</legend>
          <label className="report-dialog-check">
            <input
              type="checkbox"
              checked={formats.xlsx}
              onChange={(event) =>
                setFormats((prev) => ({ ...prev, xlsx: event.target.checked }))
              }
            />
            <span>Excel-Arbeitsdatei (.xlsx)</span>
          </label>
          <label className="report-dialog-check">
            <input
              type="checkbox"
              checked={formats.pdf}
              onChange={(event) =>
                setFormats((prev) => ({ ...prev, pdf: event.target.checked }))
              }
            />
            <span>PDF-Bericht (.pdf)</span>
          </label>
          {!hasAnyReportFormat(formats) ? (
            <p className="muted report-dialog-hint">Mindestens ein Format auswählen.</p>
          ) : null}
        </fieldset>

        <div className="report-dialog-field">
          <label htmlFor={basenameId}>Dateiname</label>
          <input
            id={basenameId}
            type="text"
            value={basename}
            disabled={busy}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setBasename(event.target.value)}
          />
          <p className="muted report-dialog-hint">
            Ohne Endung. Endungen (.pdf / .xlsx) werden automatisch ergänzt.
          </p>
          {!basenameValidation.ok ? (
            <p className="report-dialog-error" role="alert">
              {basenameValidation.message}
            </p>
          ) : null}
        </div>

        <fieldset className="report-dialog-fieldset report-dialog-chapters" disabled={busy}>
          <legend>Inhalte des Berichts</legend>
          <div className="report-dialog-chapter-actions">
            <button
              type="button"
              onClick={() => setChapters(selectAllReportChapters())}
            >
              Alle auswählen
            </button>
            <button
              type="button"
              onClick={() => setChapters(selectNoReportChapters())}
            >
              Keine auswählen
            </button>
          </div>
          <div className="report-dialog-chapter-list" role="group" aria-label="Kapitel">
            {chapterRows.map((row) => (
              <label key={row.id} className="report-dialog-check">
                <input
                  type="checkbox"
                  checked={chapters[row.id]}
                  onChange={(event) =>
                    setChapters((prev) =>
                      setInventoryReportChapter(prev, row.id, event.target.checked),
                    )
                  }
                />
                <span>
                  {row.index}. {row.label}
                </span>
              </label>
            ))}
          </div>
          {!hasAnyReportChapter(chapters) ? (
            <p className="muted report-dialog-hint">Mindestens ein Kapitel auswählen.</p>
          ) : null}
        </fieldset>

        <div className="report-dialog-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="primary" disabled={!canSubmit}>
            {busy ? "Bericht wird erstellt…" : "Bericht erstellen"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ResultDialog({
  titleId,
  title,
  body,
  onOpenFolder,
  onClose,
  onKeyDown,
}: {
  titleId: string;
  title: string;
  body: string;
  onOpenFolder?: () => void;
  onClose: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className="report-dialog-backdrop"
      role="presentation"
      onKeyDown={onKeyDown}
    >
      <div
        className="report-dialog report-dialog-result"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId}>{title}</h2>
        <p className="report-dialog-message">{body}</p>
        <div className="report-dialog-actions">
          {onOpenFolder !== undefined ? (
            <button type="button" className="primary" onClick={onOpenFolder}>
              Ordner öffnen
            </button>
          ) : null}
          <button type="button" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
