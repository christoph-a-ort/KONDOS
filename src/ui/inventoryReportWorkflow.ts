import {
  INVENTORY_REPORT_CHAPTER_IDS,
  createDefaultInventoryReportChapterSelection,
  type InventoryReportChapterId,
  type InventoryReportChapterSelection,
} from "./inventoryReportModel";

/** Ordered UI labels for the 14 InventoryReportChapterId values (R4). */
export const INVENTORY_REPORT_CHAPTER_LABELS: Record<InventoryReportChapterId, string> = {
  overview: "Bestandsübersicht",
  fileTypes: "Dateitypen",
  folders: "Ordnerübersicht",
  emptyFolders: "Leere Ordner",
  singleFileFolders: "Ordner mit nur einer Datei",
  unreadable: "Nicht prüfbare Bereiche",
  repeatedFolderNames: "Wiederkehrende Ordnernamen",
  repeatedFileNames: "Wiederkehrende Dateinamen",
  yearStructures: "Jahresstrukturen",
  fileNamePatterns: "Muster in Dateinamen",
  sameFileStems: "Gleiche Dateistämme",
  exactFileNameStructures: "Exakte Dateinamensstrukturen",
  extensionDistributions: "Endungsverteilungen",
  interpretation: "Hinweise zur Interpretation",
};

export interface ReportFormatSelection {
  xlsx: boolean;
  pdf: boolean;
}

export type ReportExportKind = "xlsx" | "pdf";

export interface ReportTargetPlan {
  kind: "single" | "folder";
  /** Absolute paths to write, in export order (xlsx before pdf when both). */
  targets: Array<{ format: ReportExportKind; path: string }>;
  /** Folder that should be opened after success / partial success. */
  folderPath: string;
}

export type ReportBasenameValidation =
  | { ok: true; basename: string }
  | { ok: false; message: string };

const FORBIDDEN_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

/** Sanitize a folder/display name for use inside a suggested report basename (R2/R3 parity). */
export function sanitizeReportNameStem(name: string): string {
  const cleaned = Array.from(name)
    .filter((ch) => !isForbiddenReportFileChar(ch))
    .join("");
  const trimmed = cleaned.replace(/[ .]+$/g, "");
  return trimmed.length === 0 ? "Bestand" : trimmed;
}

export function isForbiddenReportFileChar(ch: string): boolean {
  if (ch.length !== 1) {
    return true;
  }
  const code = ch.charCodeAt(0);
  if (code < 32) {
    return true;
  }
  return FORBIDDEN_CHARS.has(ch);
}

/** Local wall-clock stamp YYYYMMDD-HHMMSS. */
export function formatReportTimestamp(when: Date = new Date()): string {
  const y = when.getFullYear();
  const m = String(when.getMonth() + 1).padStart(2, "0");
  const d = String(when.getDate()).padStart(2, "0");
  const hh = String(when.getHours()).padStart(2, "0");
  const mm = String(when.getMinutes()).padStart(2, "0");
  const ss = String(when.getSeconds()).padStart(2, "0");
  return `${y}${m}${d}-${hh}${mm}${ss}`;
}

/**
 * Suggested basename without extension:
 * DottyFM_IST-Bericht_<Startordner>_<YYYYMMDD-HHMMSS>
 */
export function suggestedReportBasename(rootName: string, when: Date = new Date()): string {
  const stem = sanitizeReportNameStem(rootName);
  return `DottyFM_IST-Bericht_${stem}_${formatReportTimestamp(when)}`;
}

/**
 * Validate a user-edited basename. No silent rewrite — returns a clear message.
 */
export function validateReportBasename(raw: string): ReportBasenameValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "Bitte einen Dateinamen eingeben." };
  }
  for (const ch of trimmed) {
    if (isForbiddenReportFileChar(ch)) {
      return {
        ok: false,
        message:
          'Der Dateiname enthält ungültige Zeichen. Unzulässig sind: < > : " / \\ | ? * sowie Steuerzeichen.',
      };
    }
  }
  if (/[ .]$/.test(trimmed)) {
    return {
      ok: false,
      message: "Der Dateiname darf nicht mit einem Punkt oder Leerzeichen enden.",
    };
  }
  if (trimmed === "." || trimmed === "..") {
    return { ok: false, message: "Dieser Dateiname ist ungültig." };
  }
  return { ok: true, basename: trimmed };
}

export function createDefaultReportFormatSelection(): ReportFormatSelection {
  return { xlsx: true, pdf: true };
}

export function hasAnyReportFormat(formats: ReportFormatSelection): boolean {
  return formats.xlsx || formats.pdf;
}

export function hasAnyReportChapter(selection: InventoryReportChapterSelection): boolean {
  return INVENTORY_REPORT_CHAPTER_IDS.some((id) => selection[id] === true);
}

export function selectAllReportChapters(): InventoryReportChapterSelection {
  return createDefaultInventoryReportChapterSelection();
}

export function selectNoReportChapters(): InventoryReportChapterSelection {
  const selection = {} as InventoryReportChapterSelection;
  for (const id of INVENTORY_REPORT_CHAPTER_IDS) {
    selection[id] = false;
  }
  return selection;
}

export function canSubmitReportDialog(options: {
  formats: ReportFormatSelection;
  chapters: InventoryReportChapterSelection;
  basename: string;
  busy: boolean;
}): boolean {
  if (options.busy) {
    return false;
  }
  if (!hasAnyReportFormat(options.formats)) {
    return false;
  }
  if (!hasAnyReportChapter(options.chapters)) {
    return false;
  }
  return validateReportBasename(options.basename).ok;
}

/** Join directory + file name using the separator already present in `dir`. */
export function joinDirAndFile(dir: string, fileName: string): string {
  const trimmed = dir.replace(/[/\\]+$/g, "");
  const sep = dir.includes("/") && !dir.includes("\\") ? "/" : "\\";
  return `${trimmed}${sep}${fileName}`;
}

export function parentDirectoryOf(filePath: string): string {
  const normalized = filePath.replace(/[/\\]+$/g, "");
  const idx = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  if (idx <= 0) {
    return normalized;
  }
  return normalized.slice(0, idx);
}

export function fileNameOf(filePath: string): string {
  const normalized = filePath.replace(/[/\\]+$/g, "");
  const idx = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

/**
 * Build write targets. Export order for both formats: XLSX then PDF.
 */
export function buildReportTargetPlan(
  formats: ReportFormatSelection,
  basename: string,
  choice: { type: "file"; path: string } | { type: "folder"; path: string },
): ReportTargetPlan {
  const targets: ReportTargetPlan["targets"] = [];
  if (choice.type === "file") {
    const format: ReportExportKind = formats.xlsx ? "xlsx" : "pdf";
    targets.push({ format, path: choice.path });
    return {
      kind: "single",
      targets,
      folderPath: parentDirectoryOf(choice.path),
    };
  }

  if (formats.xlsx) {
    targets.push({ format: "xlsx", path: joinDirAndFile(choice.path, `${basename}.xlsx`) });
  }
  if (formats.pdf) {
    targets.push({ format: "pdf", path: joinDirAndFile(choice.path, `${basename}.pdf`) });
  }
  return {
    kind: "folder",
    targets,
    folderPath: choice.path.replace(/[/\\]+$/g, ""),
  };
}

export function overwriteConfirmMessage(existingPaths: string[]): string {
  if (existingPaths.length === 1) {
    const name = fileNameOf(existingPaths[0]!);
    return `Die Datei „${name}“ ist bereits vorhanden.\nMöchten Sie sie überschreiben?`;
  }
  const names = existingPaths.map((p) => `„${fileNameOf(p)}“`).join(" und ");
  return `Die Dateien ${names} sind bereits vorhanden.\nMöchten Sie sie überschreiben?`;
}

export type ReportRunOutcome =
  | {
      status: "success";
      folderPath: string;
      saved: Array<{ format: ReportExportKind; path: string }>;
    }
  | {
      status: "partial";
      folderPath: string;
      saved: Array<{ format: ReportExportKind; path: string }>;
      failed: { format: ReportExportKind; message: string };
    }
  | {
      status: "failed";
      message: string;
    };

export function formatReportSuccessBody(outcome: Extract<ReportRunOutcome, { status: "success" }>): {
  title: string;
  body: string;
} {
  const formats = outcome.saved.map((s) => s.format);
  if (formats.includes("pdf") && formats.includes("xlsx")) {
    return {
      title: "Bericht wurde erstellt",
      body: `PDF und Excel wurden erfolgreich gespeichert.\n\nZielordner:\n${outcome.folderPath}`,
    };
  }
  if (formats.includes("pdf")) {
    return {
      title: "Bericht wurde erstellt",
      body: `PDF-Bericht wurde erfolgreich gespeichert.\n\nZielordner:\n${outcome.folderPath}`,
    };
  }
  return {
    title: "Bericht wurde erstellt",
    body: `Excel-Arbeitsdatei wurde erfolgreich gespeichert.\n\nZielordner:\n${outcome.folderPath}`,
  };
}

export function formatReportPartialBody(outcome: Extract<ReportRunOutcome, { status: "partial" }>): {
  title: string;
  body: string;
} {
  const okLabel = outcome.saved.map((s) => (s.format === "pdf" ? "PDF" : "Excel")).join(", ");
  const failLabel = outcome.failed.format === "pdf" ? "PDF" : "Excel";
  return {
    title: "Bericht nur teilweise erstellt",
    body:
      `Erfolgreich gespeichert: ${okLabel}\n` +
      `Fehlgeschlagen: ${failLabel}\n` +
      `${outcome.failed.message}\n\n` +
      `Zielordner:\n${outcome.folderPath}`,
  };
}

export function formatLabelForKind(format: ReportExportKind): string {
  return format === "pdf" ? "PDF" : "Excel";
}

/** Numbered chapter rows for the dialog (1..14). */
export function inventoryReportChapterRows(): Array<{
  id: InventoryReportChapterId;
  index: number;
  label: string;
}> {
  return INVENTORY_REPORT_CHAPTER_IDS.map((id, index) => ({
    id,
    index: index + 1,
    label: INVENTORY_REPORT_CHAPTER_LABELS[id],
  }));
}
