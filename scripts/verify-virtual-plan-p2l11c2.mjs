// P2-L.11c.2: reuse name-suggest date resolution for folder placement confirmation.
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
assert(helper.includes("confirmedIso") && helper.includes("dateResolution"), "folder cues keep the existing date resolution");
assert(helper.includes("parseUserDocumentDate") && helper.includes("resolveDocumentDateFromView"), "confirmation reuses the name-suggest date parsers");
assert(helper.includes("FOLDER_SUGGEST_DATE_HINT") && helper.includes("folderSuggestShowsDateField"), "uncertain dates can be confirmed in the folder dialog");
assert(dialog.includes("inspectDocumentText") && dialog.includes("preferredAskIso"), "the dialog reuses inspect and offered date candidates");
assert(dialog.includes("commitNameSuggestDateInput") && dialog.includes("commitCalendarDateInput"), "manual date entry reuses the name-suggest field");
assert(!dialog.includes("requestLocalAiNameFields") && !helper.includes("requestLocalAiNameFields"), "no extra KI call");
assert(!dialog.includes("executeWorkbenchMoveFile") && !helper.includes("mkdir"), "no MOVE and no folder creation");
assert(check.includes("runFolderDateConfirmCheck"), "date confirmation cases A–H are tested");
assert(!helper.includes("modifiedAtMs") || helper.includes("sizeBytes"), "file-system timestamps are not used as a document year");
const { runTreeWorkbenchFolderSuggestCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchFolderSuggestCheck.ts")).href,
);
runTreeWorkbenchFolderSuggestCheck();
console.log("virtual plan p2l11c2 checks passed");
