// P2-L.11c: suggest one missing folder when no suitable existing target exists.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");
const assert = (value, label) => { if (!value) throw new Error(label); };
const helper = read("src/ui/treeWorkbenchFolderSuggest.ts");
const check = read("src/ui/treeWorkbenchFolderSuggestCheck.ts");
const dialog = read("src/ui/FolderSuggestDialog.tsx");
assert(helper.includes("proposeNewFolder") && helper.includes("status: \"newFolder\""), "missing-folder proposals reuse the existing planner");
assert(helper.includes("FOLDER_SUGGEST_NEW") && helper.includes("FOLDER_SUGGEST_NEW_UNCLEAR"), "new-folder and ambiguous-new outcomes exist");
assert(helper.includes("isAllowedWindowsComponent") || helper.includes("isAcceptableNewFolderName"), "Windows folder-name rules are applied");
assert(helper.includes("stripFolderStatusSuffix"), "closed-vendor suffixes are not copied into new names");
assert(helper.includes("joinScanPath") && helper.includes("folderIsInsideScanRoot"), "new folders stay inside the scan root");
assert(!helper.includes("createDir") && !helper.includes("mkdir"), "no folder is created");
assert(!helper.includes("requestLocalAiNameFields") && !helper.includes("executeWorkbenchMoveFile"), "no extra KI and no MOVE");
assert(dialog.includes("FOLDER_SUGGEST_NEW") && dialog.includes("Der Ordner existiert noch nicht."), "the dialog distinguishes a proposed new folder");
assert(dialog.includes("FOLDER_SUGGEST_NO_CREATE") && dialog.includes("Elternordner"), "new-folder details are shown without creating anything");
assert(!dialog.includes("executeWorkbenchMoveFile") && !dialog.includes("createDir"), "the dialog still does not move or mkdir");
assert(check.includes("runNewFolderSuggestCheck"), "new-folder cases A–J are tested");
assert(!helper.includes("Stadtwerke Hamm") && !helper.includes("Vattenfall") && !helper.includes("Eprimo"), "no hardcoded vendor special cases");
const { runTreeWorkbenchFolderSuggestCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchFolderSuggestCheck.ts")).href,
);
runTreeWorkbenchFolderSuggestCheck();
console.log("virtual plan p2l11c checks passed");
