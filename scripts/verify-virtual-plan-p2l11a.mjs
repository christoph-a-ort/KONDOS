// P2-L.11a: rule-based folder suggestions for a single file. No extra KI, no MOVE.
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
const tree = read("src/ui/TreeView.tsx");
const moveRs = read("src-tauri/src/commands/execution_move.rs");
const inspectRs = read("src-tauri/src/content/inspect.rs");
assert(tree.includes("Ordner vorschlagen") && tree.includes("FolderSuggestDialog"), "tree action opens the folder-suggest dialog");
assert(tree.includes("Namensvorschlag"), "existing name suggestion remains");
assert(helper.includes("planFolderSuggestions") && helper.includes("FOLDER_SUGGEST_UNCLEAR"), "rule-based planner and unclear outcome exist");
assert(helper.includes("collectFolderCandidates") && helper.includes("folderIsInsideScanRoot"), "only scanned folders inside the scan root are candidates");
assert(helper.includes("enrichLocalAiFields") && helper.includes("inspectDocumentText") === false, "cues reuse local rule extractors, not a new inspect API");
assert(dialog.includes("inspectDocumentText") && dialog.includes("planFolderSuggestions"), "dialog reuses document inspect and the planner");
assert(!dialog.includes("requestLocalAiNameFields") && !dialog.includes("ollama") && !dialog.includes("planAiNameSuggestion"), "first stage does not call extra KI");
assert(!dialog.includes("executeWorkbenchMoveFile") && !dialog.includes("execute_workbench_move_file"), "dialog does not move files");
assert(dialog.includes("FOLDER_SUGGEST_NO_MOVE") && dialog.includes("Schließen"), "no-move notice and close-only actions");
assert(helper.includes("FOLDER_SUGGEST_MAX = 3"), "at most three folders are suggested");
assert(!helper.includes("createDir") && !helper.includes("mkdir"), "no new folders are created");
assert(inspectRs.includes("inspect_document_text"), "existing inspect/content cache remains");
assert(moveRs.includes("fn execute_workbench_move_file"), "existing MOVE engine is unchanged by this stage");
const { runTreeWorkbenchFolderSuggestCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchFolderSuggestCheck.ts")).href,
);
runTreeWorkbenchFolderSuggestCheck();
const { runTreeWorkbenchNameSuggestCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchNameSuggestCheck.ts")).href,
);
runTreeWorkbenchNameSuggestCheck();
const { runTreeWorkbenchMoveCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchMoveCheck.ts")).href,
);
runTreeWorkbenchMoveCheck();
console.log("virtual plan p2l11a checks passed");
