// P2-L.7a: inline rename shortcut is Ctrl+Shift+U, not F2.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");
const assert = (value, label) => { if (!value) throw new Error(label); };
const tree = read("src/ui/TreeView.tsx");
const renameHelper = read("src/ui/treeWorkbenchRename.ts");
const { runTreeWorkbenchRenameCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchRenameCheck.ts")).href,
);
runTreeWorkbenchRenameCheck();
assert(renameHelper.includes("isWorkbenchRenameShortcut"), "shortcut helper exists");
assert(renameHelper.includes("isWorkbenchRenameTypingTarget"), "typing targets keep their keys");
assert(tree.includes("isWorkbenchRenameShortcut"), "tree uses the rename shortcut helper");
assert(tree.includes("isWorkbenchRenameTypingTarget"), "tree skips rename while typing");
assert(tree.includes("beginFileRename"), "shortcut still starts inline rename");
assert(!tree.includes('event.key === "F2"'), "F2 is not wired in the tree");
assert(!/\bF2\b/.test(tree), "F2 is not shown or handled in the tree");
assert(tree.includes("onRenameCommit"), "Enter still commits the rename");
assert(tree.includes("onRenameCancel"), "Esc still cancels the rename");
assert(tree.includes("fileNameEditSelection"), "stem without extension stays selected");
assert(tree.includes("event.stopPropagation()"), "search and filter still keep their own keys");
console.log("virtual plan p2l7a checks passed");
