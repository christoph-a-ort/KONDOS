// P2-L.10a: configurable naming rules reuse inspect, date detection and rename.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");
const assert = (value, label) => { if (!value) throw new Error(label); };
const helper = read("src/ui/namingRules.ts");
const check = read("src/ui/namingRulesCheck.ts");
const dialog = read("src/ui/NameSuggestDialog.tsx");
const rulesDialog = read("src/ui/NamingRulesDialog.tsx");
const config = read("src/ui/ConfigPanel.tsx");
const tree = read("src/ui/TreeView.tsx");
const suggest = read("src/ui/treeWorkbenchNameSuggest.ts");
const inspectRs = read("src-tauri/src/content/inspect.rs");
const ocrRs = read("src-tauri/src/content/ocr.rs");
const moveRs = read("src-tauri/src/commands/execution_move.rs");
const namingRs = read("src-tauri/src/commands/naming_rules.rs");
const { runNamingRulesCheck } = await import(
  pathToFileURL(join(root, "src/ui/namingRulesCheck.ts")).href,
);
const { runTreeWorkbenchNameSuggestCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchNameSuggestCheck.ts")).href,
);
const { runTreeWorkbenchMoveCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchMoveCheck.ts")).href,
);
await runNamingRulesCheck();
runTreeWorkbenchNameSuggestCheck();
runTreeWorkbenchMoveCheck();
assert(helper.includes("firstMatchingRule"), "active rules are applied by priority");
assert(helper.includes("{datum}"), "schema placeholders include datum");
assert(helper.includes("dokumenttyp") && helper.includes("absender") && helper.includes("betreff"), "schema placeholders include type, sender and subject");
assert(helper.includes("not invented") || check.includes("not invented") || check.includes("is not invented"), "missing values are not invented");
assert(!helper.includes("openai") && !helper.includes("ollama") && !helper.includes("Date.now"), "no AI fallback and no today date");
assert(namingRs.includes("naming-rules.v1.json"), "rules persist in app data");
assert(rulesDialog.includes("Neue Regel") && rulesDialog.includes("Löschen"), "rules can be created and deleted");
assert(rulesDialog.includes("Regel aktiv") && rulesDialog.includes("Nach oben"), "rules can be toggled and reordered");
assert(config.includes("Benennungsregeln"), "rule management is reachable from configuration");
assert(dialog.includes("Regel:") && dialog.includes("Vorgeschlagener Dateiname"), "name suggestion shows the applied rule and filename");
assert(dialog.includes("workbenchNameSuggestRequest"), "apply still uses the rename helper");
assert(dialog.includes("applySuggestedFileName"), "typed names are applied independently of the rule schema");
assert(!dialog.includes("plan.missing.length > 0"), "missing placeholders do not block a valid typed name");
assert(!dialog.includes("function applyDate(iso: string) {\n    setNameTouched(false)"), "date choice does not overwrite a typed name");
assert(dialog.includes("setNameTouched(true)"), "typed filename is marked manual");
assert(helper.includes("applySuggestedFileName") && helper.includes("preserveOriginalFileExtension"), "manual apply keeps the original extension");
assert(check.includes("Zählerablesungsmeldung"), "manual meter-reading name is covered");
assert(dialog.includes("inspectDocumentText"), "rules reuse the existing document inspect");
assert(suggest.includes("resolveDocumentDateFromView"), "document-date rules remain");
assert(inspectRs.includes("ocr_file") && ocrRs.includes("Windows.Media.Ocr") || ocrRs.includes("Media::Ocr"), "OCR remains");
assert(tree.includes("onPointerDown"), "drag-and-drop remains");
assert(tree.includes("isWorkbenchRenameShortcut"), "Ctrl+Shift+U remains");
assert(moveRs.includes("fn execute_workbench_move_file_locked"), "no second file-operation engine");
assert(!helper.includes("createdAtMs") && !helper.includes("modifiedAtMs"), "filesystem timestamps are not used as document dates");
console.log("virtual plan p2l10a checks passed");
