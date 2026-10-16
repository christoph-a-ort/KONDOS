// P2-K.4b/c: explicit virtual-plan selection, editing and draft persistence.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");
const assert = (value, label) => {
  if (!value) throw new Error(label);
};

const editor = read("src/ui/virtualPlanEditor.ts");
const editorCheck = read("src/ui/virtualPlanEditorCheck.ts");
const plan = read("src/ui/virtualPlan.ts");
const app = read("src/App.tsx");
const view = read("src/ui/VirtualPlanPreviewView.tsx");
const panel = read("src/ui/VirtualPlanEditorPanel.tsx");
const css = read("src/App.css");
const cssRule = (selector, nextSelector) =>
  css.slice(css.indexOf(selector), css.indexOf(nextSelector, css.indexOf(selector)));

assert(editor.includes("createVirtualPlanFromProposal"), "explicit selection builder");
assert(editor.includes("renameVirtualPlanFolder"), "folder rename");
assert(editor.includes("assignFileToVirtualFolder"), "file assignment");
assert(editor.includes("excludeFileFromVirtualPlan"), "keep unchanged");
assert(editor.includes("undoLastVirtualPlanEdit"), "undo");
assert(editor.includes("resetVirtualPlanToSelection"), "reset");
assert(editor.includes("validateVirtualPlan"), "invariants");
assert(editor.includes("prepareVirtualPlanForSave"), "revision save preparation");
assert(editor.includes("bindingMatches"), "stale binding guard");
assert(!editor.includes("invoke("), "editor no invoke");
assert(!/fs\.write|fs\.rename|fs\.unlink|startScan/.test(editor), "editor no filesystem operation");

assert(editorCheck.includes("explicit proposal selection creates plan"), "selection test");
assert(editorCheck.includes("all observed nodes included"), "complete plan test");
assert(editorCheck.includes("rename virtual folder"), "rename test");
assert(editorCheck.includes("assign file to existing virtual folder"), "assignment test");
assert(editorCheck.includes("leave file unchanged"), "exclude test");
assert(editorCheck.includes("undo latest exclusion"), "undo test");
assert(editorCheck.includes("reset selection"), "reset test");
assert(editorCheck.includes("rename creates one undo step"), "rename undo-step test");
assert(editorCheck.includes("failed rename creates no undo step"), "failed edit no-undo test");
assert(editorCheck.includes("undo folder rename after assignment undo"), "multi-step undo test");
assert(editorCheck.includes("reset folder names"), "reset folder-name test");
assert(editorCheck.includes("saved draft remains unchanged by local reset"), "saved draft reset isolation test");
assert(editorCheck.includes("stale snapshot rejected"), "stale test");
assert(editorCheck.includes("incomplete snapshot rejected"), "incomplete test");
assert(editorCheck.includes("duplicate observed object rejected"), "duplicate test");

assert(plan.includes("VirtualPlanFolder"), "virtual folder type");
assert(plan.includes("originalVirtualTargetPath"), "reset baseline");
assert(app.includes("saveVirtualPlanDraft"), "existing draft API reused");
assert(app.includes("expectedRevision"), "optimistic revision");
assert(view.includes("Als bearbeitbaren Entwurf auswählen"), "selection UI");
assert(view.includes('type PlanningMainView = "editor" | "compare" | "review"'), "exclusive planning main views");
assert(view.includes("Vorschlag bearbeiten"), "editor main view");
assert(view.includes("IST / SOLL vergleichen"), "comparison main view");
assert(view.includes("Hinweise und Prüffälle"), "review main view");
assert(view.includes('mainView === "editor" && editablePlan === null'), "proposals shown before selection only");
assert(view.includes('mainView === "editor" && editablePlan !== null'), "editor shown after selection");
assert(view.includes("viewportContentHeight"), "tree height derives from visible rows");
assert(panel.includes("Vollständiger virtueller SOLL-Zustand"), "full virtual preview");
assert(panel.includes("Rückgängig"), "undo UI");
assert(panel.includes("Zurücksetzen"), "reset UI");
assert(panel.includes("Virtuelle Zielordner ({folders.length})"), "target folders rendered");
assert(panel.includes("Datei-Zuordnung ({editableFiles.length})"), "file editor rendered");
assert(panel.includes("plan-editor-folder-list"), "target folder scroll container");
assert(panel.includes("plan-editor-file-list"), "file scroll container");
assert(panel.includes("setRenameValues({})"), "editor name buffer synchronized after plan changes");
assert(panel.includes("plan-editor-secondary-actions"), "separate left editor actions");
assert(panel.includes("editingFolderId"), "targeted folder rename state");
assert(panel.includes("plan-editor-file-header"), "compact file assignment table header");
assert(panel.includes("plan-editor-summary"), "selected proposal summary");
assert(!panel.includes("Freigeben"), "no approval UI in K.4b/c");
assert(!panel.includes("invoke("), "panel no invoke");
assert(css.includes("P2-K.4b/c"), "P2-K.4 css");
assert(css.includes(".plan-editor-folder-list"), "target folder list css");
assert(css.includes(".plan-editor-file-list"), "file list css");
assert(css.includes(".plan-editor-actions") && css.includes("position: sticky"), "sticky editor action bar");
assert(css.includes(".plan-editor-secondary-actions"), "left action group css");
assert(css.includes("justify-content: space-between"), "save action aligned right");
assert(css.includes(".plan-editor-file-header"), "file assignment table css");
assert(css.includes("flex-wrap: wrap"), "compact virtual folder layout css");
assert(
  !/max-height|overflow/.test(cssRule(".plan-editor-folder-list", ".plan-editor-folder,")),
  "target folders have no inner scroll",
);
assert(
  !/max-height|overflow/.test(cssRule(".plan-editor-file-list", ".plan-editor-file {")),
  "files have no inner scroll",
);
assert(
  !/max-height|overflow/.test(cssRule(".plan-editor-projection-list", ".plan-editor-projection-row")),
  "projection has no inner scroll",
);

const { runVirtualPlanEditorCheck } = await import(
  pathToFileURL(join(root, "src/ui/virtualPlanEditorCheck.ts")).href,
);
runVirtualPlanEditorCheck();

console.log("virtual plan p2k4b/c checks passed");
