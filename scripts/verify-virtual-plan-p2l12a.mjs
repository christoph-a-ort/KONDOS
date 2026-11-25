// P2-L.12a: read-only batch analysis of selected documents. No rename, MOVE, or mkdir.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");
const assert = (value, label) => { if (!value) throw new Error(label); };
const model = read("src/ui/batchDocument.ts");
const analysis = read("src/ui/batchAnalysis.ts");
const run = read("src/ui/batchAnalysisRun.ts");
const tree = read("src/ui/TreeView.tsx");
const app = read("src/App.tsx");
const panel = read("src/ui/BatchAnalysisPanel.tsx");
const css = read("src/App.css");
assert(model.includes("wholeFile") && model.includes("pdfPageRange"), "logical documents distinguish whole files and later page ranges");
assert(model.includes("documentId") && model.includes("createDocumentId"), "document ids are separate from file paths");
assert(model.includes("BATCH_PAGE_RANGE_UNSUPPORTED"), "unimplemented page ranges are explicit");
assert(analysis.includes("planNameSuggestion") && analysis.includes("planFolderSuggestions"), "batch analysis reuses naming and folder planners");
assert(analysis.includes("planAiNameSuggestion"), "optional KI naming reuses the existing planner");
assert(!analysis.includes("executeWorkbenchMoveFile") && !analysis.includes("executeWorkbenchCreateFolder"), "batch analysis does not MOVE or mkdir");
assert(!run.includes("executeWorkbenchMoveFile") && !run.includes("execute_workbench_create_folder"), "the runner stays read-only");
assert(run.includes("inspect(") && run.includes("requestLocalAiNameFields"), "inspect and sequential KI are reused");
assert(tree.includes("BATCH_ACTION_LABEL") && tree.includes("nextTreeSelection"), "tree multi-select and context action exist");
assert(tree.includes("ctrlKey") && tree.includes("shiftKey"), "Ctrl and Shift selection are wired");
assert(panel.includes("Nur lesen") && !panel.includes("executeWorkbench"), "the overview cannot execute file operations");
assert(
  analysis.includes('BATCH_PROGRESS_TITLE = "Stapelanalyse läuft"') &&
    analysis.includes('BATCH_CANCEL_LABEL = "Analyse abbrechen"') &&
    panel.includes("BATCH_PROGRESS_TITLE") &&
    panel.includes("BATCH_CANCEL_LABEL"),
  "running progress has title and cancel",
);
assert(
  analysis.includes('BATCH_STEP_CANCELLING = "Abbruch angefordert …"') &&
    panel.includes("BATCH_STEP_CANCELLING"),
  "cancel requested copy is shown",
);
assert(panel.includes("disabled={progress.cancelling}"), "cancel cannot be triggered repeatedly");
{
  const progressFn = panel.indexOf("export function BatchAnalysisProgress");
  const resultsFn = panel.indexOf("export function BatchAnalysisPanel");
  assert(progressFn >= 0 && resultsFn > progressFn, "progress and results are separate components");
  assert(
    panel.slice(progressFn, resultsFn).includes("BATCH_CANCEL_LABEL") &&
      !panel.slice(resultsFn).includes("BATCH_CANCEL_LABEL"),
    "results overview has no abort button",
  );
}
assert(
  app.includes("BatchAnalysisProgress") &&
    app.indexOf("<BatchAnalysisProgress") < app.indexOf("main-view-panels") &&
    app.indexOf("<BatchAnalysisProgress") > app.indexOf("insight-view-switcher"),
  "running progress sits above the scrollable work panels",
);
assert(app.includes("open={batchPanelOpen && !batchBusy}"), "results overview is hidden while the run is busy");
assert(!app.includes("window.confirm") && !panel.includes("confirm("), "cancel has no extra confirmation");
assert(
  css.includes("batch-analysis-progress-banner") &&
    css.includes("flex-shrink: 0") &&
    css.includes(".main-workbench") &&
    css.includes("overflow: hidden"),
  "progress banner stays in a non-scrolling workbench strip",
);
assert(analysis.includes("completeBatchResults") && analysis.includes("batchAnalysisOverview"), "cancel results are completed for the overview");
assert(analysis.includes('BATCH_CANCELLED_HINT = "Stapelanalyse durch Anwender abgebrochen."'), "unprocessed files use the abort hint");
assert(panel.includes("batchAnalysisOverview") && panel.includes("rows.map"), "the overview renders the completed row list");
assert(
  panel.includes("batchResultHintExtras") &&
    analysis.includes("seen.has(part)") &&
    !panel.includes("item.reasons.join"),
  "the hint column does not print error and reasons twice",
);
assert(
  /\.tree-data-row\s*\{[^}]*user-select:\s*none/.test(css) &&
    /\.tree-rename-input\s*\{[^}]*user-select:\s*text/.test(css) &&
    !/\.app\s*\{[^}]*user-select:\s*none/.test(css),
  "tree rows suppress native text selection without a global user-select",
);
assert(app.includes("completeBatchResults") && app.includes("setBatchDocuments"), "App keeps the original document list and completes results");
assert(!css.includes("max-height: min(42%, 280px)"), "the results panel is not clipped to 280px");
assert(app.includes("runBatchAnalysis") && app.includes("inspectDocumentText"), "App runs inspect through the existing API");
assert(!app.includes("console.log(view.text") && !run.includes("console.log(view"), "document text is not logged");
const { runBatchAnalysisCheck, runBatchAnalysisRunCheck } = await import(
  pathToFileURL(join(root, "src/ui/batchAnalysisCheck.ts")).href,
);
runBatchAnalysisCheck();
await runBatchAnalysisRunCheck();
const { runTreeMultiSelectCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeMultiSelectCheck.ts")).href,
);
runTreeMultiSelectCheck();
const { runTreeWorkbenchNameSuggestCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchNameSuggestCheck.ts")).href,
);
runTreeWorkbenchNameSuggestCheck();
const { runTreeWorkbenchFolderSuggestCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchFolderSuggestCheck.ts")).href,
);
runTreeWorkbenchFolderSuggestCheck();
console.log("virtual plan p2l12a checks passed");
