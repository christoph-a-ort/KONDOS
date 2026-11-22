// P2-L.11b.1: scan-root names belong to the filing pattern of their subfolders.
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
assert(helper.includes("const pathNames = isScanRoot ? [node.name] : relativeNames"), "the scan root name is part of the scored path");
assert(helper.includes("[...pathNames, child.name]"), "subfolders inherit the scan-root path context");
assert(helper.includes("nach Jahren gegliederte Ablagestruktur"), "a year pattern under the scan root is explained");
assert(helper.includes("applyRecurringYearPattern"), "recurring year-folder file names reinforce the pattern");
assert(!helper.includes("requestLocalAiNameFields") && !helper.includes("executeWorkbenchMoveFile"), "no extra KI and no MOVE");
assert(check.includes("runSubtreeFolderSuggestCheck"), "subtree scan-root cases are tested");
assert(!helper.includes("Stadtwerke Hamm") && !helper.includes("Vattenfall"), "no hardcoded vendor special cases");
const { runTreeWorkbenchFolderSuggestCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchFolderSuggestCheck.ts")).href,
);
runTreeWorkbenchFolderSuggestCheck();
console.log("virtual plan p2l11b1 checks passed");
