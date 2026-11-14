// P2-L.8: document-date file name suggestions reuse extract_path and workbench rename.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");
const assert = (value, label) => { if (!value) throw new Error(label); };
const tree = read("src/ui/TreeView.tsx");
const dialog = read("src/ui/NameSuggestDialog.tsx");
const helper = read("src/ui/treeWorkbenchNameSuggest.ts");
const inspectRs = read("src-tauri/src/content/inspect.rs");
const extractRs = read("src-tauri/src/content/extract.rs");
const moveRs = read("src-tauri/src/commands/execution_move.rs");
const app = read("src/App.tsx");
const { runTreeWorkbenchNameSuggestCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchNameSuggestCheck.ts")).href,
);
const { runTreeWorkbenchMoveCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchMoveCheck.ts")).href,
);
runTreeWorkbenchNameSuggestCheck();
runTreeWorkbenchMoveCheck();
assert(helper.includes("resolveDocumentDate"), "document dates are resolved from extracted text");
assert(helper.includes("buildDatedFileName"), "names are built as YYYY-MM-DD_Name.ext");
assert(helper.includes("stripLeadingDatePrefix"), "existing date prefixes are normalized");
assert(helper.includes("parseUserDocumentDate"), "the user can enter a date");
assert(helper.includes("workbenchRenameRequest"), "apply reuses the productive rename request");
assert(!helper.includes("Date.now"), "today is not used as a fallback date");
assert(!helper.includes("createdAtMs") && !helper.includes("modifiedAtMs"), "filesystem timestamps are not used as document dates");
assert(inspectRs.includes("extract_path"), "single-file inspect reuses extract_path");
assert(extractRs.includes("extract_docx_text") && extractRs.includes("extract_xlsx_text"), "PDF/DOCX/XLSX extractors remain the shared path");
assert(!helper.includes("openai"), "no cloud AI");
assert(tree.includes("Namensvorschlag"), "workbench offers Namensvorschlag");
assert(tree.includes("NameSuggestDialog"), "suggestion UI is a dialog");
assert(tree.includes("isWorkbenchRenameShortcut"), "Ctrl+Shift+U remains");
assert(!tree.includes('event.key === "F2"'), "F2 stays unused");
assert(tree.includes("onPointerDown"), "drag-and-drop pointer path remains");
assert(dialog.includes("Abbrechen") && dialog.includes("Übernehmen"), "apply and cancel exist");
assert(dialog.includes("workbenchNameSuggestRequest"), "dialog apply uses the rename helper");
assert(app.includes("executeWorkbenchMoveFile"), "existing MOVE/rename engine remains the apply path");
assert(moveRs.includes("fn execute_workbench_move_file_locked"), "productive workbench MOVE command is unchanged");
console.log("virtual plan p2l8 checks passed");
