// P2-L.10b: optional local Ollama filename fallback after naming rules.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");
const assert = (value, label) => { if (!value) throw new Error(label); };
const helper = read("src/ui/localAi.ts");
const dialog = read("src/ui/NameSuggestDialog.tsx");
const config = read("src/ui/ConfigPanel.tsx");
const panel = read("src/ui/LocalAiPanel.tsx");
const rust = read("src-tauri/src/commands/local_ai.rs");
const ocrRs = read("src-tauri/src/content/ocr.rs");
const moveRs = read("src-tauri/src/commands/execution_move.rs");
const tree = read("src/ui/TreeView.tsx");
const naming = read("src/ui/namingRules.ts");
const { runLocalAiCheck } = await import(pathToFileURL(join(root, "src/ui/localAiCheck.ts")).href);
const { runNamingRulesCheck } = await import(pathToFileURL(join(root, "src/ui/namingRulesCheck.ts")).href);
const { runTreeWorkbenchNameSuggestCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchNameSuggestCheck.ts")).href,
);
const { runTreeWorkbenchMoveCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchMoveCheck.ts")).href,
);
await runLocalAiCheck();
await runNamingRulesCheck();
runTreeWorkbenchNameSuggestCheck();
runTreeWorkbenchMoveCheck();
assert(rust.includes("127.0.0.1") || rust.includes("LOCALHOST"), "Ollama is loopback-only");
assert(rust.includes("/api/tags") && rust.includes("/api/generate"), "Ollama tags and generate are used");
assert(!rust.includes("openai") && !helper.includes("openai"), "no cloud AI");
assert(!rust.includes("api.openai") && !helper.includes("https://"), "no remote HTTP hosts in KI code");
assert(helper.includes("shouldUseLocalAiFallback"), "KI runs only after rules miss");
assert(helper.includes("groundedAiValue"), "KI values must appear in the document text");
assert(panel.includes("Lokale KI") && panel.includes("Verbindung testen"), "config exposes local KI");
assert(config.includes("LocalAiPanel"), "KI settings sit in configuration");
assert(dialog.includes("nameSuggestSourceLabel") && dialog.includes("Lokale KI erzeugt"), "suggestion source and KI status are shown");
const applyHelper = read("src/ui/nameSuggestApply.ts");
assert(
  dialog.includes("applySuggestedFileName") || applyHelper.includes("applySuggestedFileName"),
  "manual names remain applicable",
);
assert(naming.includes('source: "rule" | "default" | "ai"'), "AI is a third suggestion source");
assert(ocrRs.includes("Media::Ocr") || ocrRs.includes("Windows.Media.Ocr"), "OCR unchanged");
assert(moveRs.includes("fn execute_workbench_move_file_locked"), "rename engine unchanged");
assert(tree.includes("onPointerDown") && tree.includes("isWorkbenchRenameShortcut"), "DnD and Ctrl+Shift+U remain");
console.log("virtual plan p2l10b checks passed");
