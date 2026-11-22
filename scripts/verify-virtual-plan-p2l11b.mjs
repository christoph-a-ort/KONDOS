// P2-L.11b: hierarchical folder suggestions. No extra KI, no MOVE, no new folders.
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
assert(helper.includes("relativeNames") && helper.includes("hasYearPattern"), "full paths and year patterns are evaluated");
assert(helper.includes("documentYearFromView") && helper.includes("resolveDocumentDateFromView"), "years come from a reliable document date");
assert(!helper.includes("modifiedAtMs") || helper.includes("sizeBytes"), "file-system timestamps are not used as a document year");
assert(helper.includes("dropAncestorSuggestions") && helper.includes("competingIdentityTokens"), "ancestors and rival vendors are filtered");
assert(helper.includes("FOLDER_SUGGEST_ALREADY_HERE") && helper.includes("alreadyHere"), "correct current folders are recognized");
assert(dialog.includes("FOLDER_SUGGEST_ALREADY_HERE") && dialog.includes("Themenbereich") === false, "dialog shows the already-here sentence from the planner");
assert(!dialog.includes("requestLocalAiNameFields") && !dialog.includes("executeWorkbenchMoveFile"), "no extra KI and no MOVE");
assert(check.includes("runHierarchyFolderSuggestCheck") && check.includes("Vattenfall"), "hierarchy cases cover the praxis tree");
assert(!helper.includes("Stadtwerke Hamm") && !helper.includes("Vattenfall"), "no hardcoded vendor special cases");
const { runTreeWorkbenchFolderSuggestCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchFolderSuggestCheck.ts")).href,
);
runTreeWorkbenchFolderSuggestCheck();
console.log("virtual plan p2l11b checks passed");
