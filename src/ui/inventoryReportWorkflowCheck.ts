import {
  INVENTORY_REPORT_CHAPTER_IDS,
  createDefaultInventoryReportChapterSelection,
} from "./inventoryReportModel";
import {
  buildReportTargetPlan,
  canSubmitReportDialog,
  createDefaultReportFormatSelection,
  formatReportPartialBody,
  formatReportSuccessBody,
  hasAnyReportChapter,
  hasAnyReportFormat,
  inventoryReportChapterRows,
  joinDirAndFile,
  overwriteConfirmMessage,
  sanitizeReportNameStem,
  selectAllReportChapters,
  selectNoReportChapters,
  suggestedReportBasename,
  validateReportBasename,
} from "./inventoryReportWorkflow";

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(label);
  }
}

export function runInventoryReportWorkflowCheck(): void {
  assert(INVENTORY_REPORT_CHAPTER_IDS.length === 14, "r4: 14 chapter ids");
  assert(inventoryReportChapterRows().length === 14, "r4: 14 chapter rows");
  assert(
    inventoryReportChapterRows()[0]?.label === "Bestandsübersicht",
    "r4: first chapter label",
  );
  assert(
    inventoryReportChapterRows()[13]?.label === "Hinweise zur Interpretation",
    "r4: last chapter label",
  );

  const defaultFormats = createDefaultReportFormatSelection();
  assert(defaultFormats.pdf && defaultFormats.xlsx, "r4: both formats default on");

  const all = selectAllReportChapters();
  assert(hasAnyReportChapter(all), "r4: all chapters selected");
  assert(
    INVENTORY_REPORT_CHAPTER_IDS.every((id) => all[id] === true),
    "r4: every chapter true",
  );

  const none = selectNoReportChapters();
  assert(!hasAnyReportChapter(none), "r4: no chapters");
  assert(
    INVENTORY_REPORT_CHAPTER_IDS.every((id) => none[id] === false),
    "r4: every chapter false",
  );

  assert(sanitizeReportNameStem("A<>B:C") === "ABC", "r4: sanitize forbidden");
  assert(sanitizeReportNameStem("<>") === "Bestand", "r4: empty stem fallback");

  const when = new Date(2026, 8, 26, 20, 30, 0);
  const suggested = suggestedReportBasename("Projektablage", when);
  assert(
    suggested === "DottyFM_IST-Bericht_Projektablage_20260926-203000",
    `r4: suggested basename got ${suggested}`,
  );
  assert(!suggested.includes("."), "r4: suggested basename has no extension");

  assert(validateReportBasename("").ok === false, "r4: empty basename invalid");
  assert(validateReportBasename("a/b").ok === false, "r4: slash invalid");
  assert(validateReportBasename("ok-name").ok === true, "r4: ok basename");

  assert(
    !canSubmitReportDialog({
      formats: { pdf: false, xlsx: false },
      chapters: all,
      basename: "ok",
      busy: false,
    }),
    "r4: no format disables submit",
  );
  assert(
    !canSubmitReportDialog({
      formats: defaultFormats,
      chapters: none,
      basename: "ok",
      busy: false,
    }),
    "r4: no chapter disables submit",
  );
  assert(
    !canSubmitReportDialog({
      formats: defaultFormats,
      chapters: all,
      basename: "bad:name",
      busy: false,
    }),
    "r4: bad name disables submit",
  );
  assert(
    !canSubmitReportDialog({
      formats: defaultFormats,
      chapters: all,
      basename: "ok",
      busy: true,
    }),
    "r4: busy disables submit",
  );
  assert(
    canSubmitReportDialog({
      formats: defaultFormats,
      chapters: all,
      basename: "ok",
      busy: false,
    }),
    "r4: valid enables submit",
  );

  const both = buildReportTargetPlan(
    { pdf: true, xlsx: true },
    "ReportBase",
    { type: "folder", path: "C:\\Out" },
  );
  assert(both.targets.length === 2, "r4: two targets");
  assert(both.targets[0]?.format === "xlsx", "r4: xlsx first");
  assert(both.targets[1]?.format === "pdf", "r4: pdf second");
  assert(both.targets[0]?.path.endsWith("ReportBase.xlsx"), "r4: same basename xlsx");
  assert(both.targets[1]?.path.endsWith("ReportBase.pdf"), "r4: same basename pdf");

  const onlyPdf = buildReportTargetPlan(
    { pdf: true, xlsx: false },
    "ReportBase",
    { type: "file", path: "C:\\Out\\custom.pdf" },
  );
  assert(onlyPdf.targets.length === 1 && onlyPdf.targets[0]?.format === "pdf", "r4: pdf only");

  assert(
    overwriteConfirmMessage(["C:\\a\\Datei.pdf"]).includes("Datei.pdf"),
    "r4: overwrite single names file",
  );
  assert(
    overwriteConfirmMessage(["C:\\a\\a.pdf", "C:\\a\\a.xlsx"]).includes("a.pdf"),
    "r4: overwrite joint names both",
  );

  const successCopy = formatReportSuccessBody({
    status: "success",
    folderPath: "C:\\Out",
    saved: [
      { format: "xlsx", path: "C:\\Out\\a.xlsx" },
      { format: "pdf", path: "C:\\Out\\a.pdf" },
    ],
  });
  assert(successCopy.title === "Bericht wurde erstellt", "r4: success title");
  assert(successCopy.body.includes("PDF und Excel"), "r4: success both");

  const partialCopy = formatReportPartialBody({
    status: "partial",
    folderPath: "C:\\Out",
    saved: [{ format: "xlsx", path: "C:\\Out\\a.xlsx" }],
    failed: { format: "pdf", message: "Schreibfehler" },
  });
  assert(partialCopy.title === "Bericht nur teilweise erstellt", "r4: partial title");
  assert(partialCopy.body.includes("Schreibfehler"), "r4: partial error");

  assert(hasAnyReportFormat({ pdf: true, xlsx: false }), "r4: has format");
  assert(!hasAnyReportFormat({ pdf: false, xlsx: false }), "r4: no format");
  assert(joinDirAndFile("C:\\Out\\", "a.pdf").endsWith("\\a.pdf"), "r4: join");
  assert(
    createDefaultInventoryReportChapterSelection().overview === true,
    "r4: default selection still from R1",
  );
}
