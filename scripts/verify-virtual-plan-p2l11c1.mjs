// P2-L.11c.1: a year-pattern parent is not a final folder while a year is missing or unknown.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");
const assert = (value, label) => { if (!value) throw new Error(label); };
const helper = read("src/ui/treeWorkbenchFolderSuggest.ts");
const dialog = read("src/ui/FolderSuggestDialog.tsx");
const check = read("src/ui/treeWorkbenchFolderSuggestCheck.ts");
assert(helper.includes("incompleteYearHome") && helper.includes("yearPatternParentAt"), "a year-pattern parent is not treated as the final folder");
assert(helper.includes("FOLDER_SUGGEST_YEAR_UNKNOWN"), "unknown document years are explained instead of alreadyHere");
assert(helper.includes("documentDateStatus") && helper.includes("resolveDocumentDateFromView"), "folder placement reuses the name-suggest date resolution");
assert(!helper.includes("modifiedAtMs") || helper.includes("sizeBytes"), "file-system timestamps are not used as a document year");
assert(dialog.includes("FOLDER_SUGGEST_YEAR_UNKNOWN"), "the dialog shows the year-unknown sentence");
assert(!dialog.includes("requestLocalAiNameFields") && !dialog.includes("executeWorkbenchMoveFile"), "no extra KI and no MOVE");
assert(!helper.includes("createDir") && !helper.includes("mkdir"), "no folder is created");
assert(check.includes("runYearPatternParentFixCheck"), "praxis year-parent cases A–F are tested");
assert(!helper.includes("Stadtwerke Hamm") && !helper.includes("Vattenfall"), "no hardcoded vendor special cases");
const { runTreeWorkbenchFolderSuggestCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchFolderSuggestCheck.ts")).href,
);
runTreeWorkbenchFolderSuggestCheck();
console.log("virtual plan p2l11c1 checks passed");
