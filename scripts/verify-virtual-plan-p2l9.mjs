// P2-L.9: on-demand local OCR feeds the existing document-date name suggestion.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");
const assert = (value, label) => { if (!value) throw new Error(label); };
const helper = read("src/ui/treeWorkbenchNameSuggest.ts");
const dialog = read("src/ui/NameSuggestDialog.tsx");
const inspectRs = read("src-tauri/src/content/inspect.rs");
const ocrRs = read("src-tauri/src/content/ocr.rs");
const formatRs = read("src-tauri/src/content/format.rs");
const extractRs = read("src-tauri/src/content/extract.rs");
const cargo = read("src-tauri/Cargo.toml");
const tree = read("src/ui/TreeView.tsx");
const { runTreeWorkbenchNameSuggestCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchNameSuggestCheck.ts")).href,
);
const { runTreeWorkbenchMoveCheck } = await import(
  pathToFileURL(join(root, "src/ui/treeWorkbenchMoveCheck.ts")).href,
);
runTreeWorkbenchNameSuggestCheck();
runTreeWorkbenchMoveCheck();
assert(ocrRs.includes("Windows.Media.Ocr") || ocrRs.includes("Media::Ocr"), "Windows OCR is used");
assert(ocrRs.includes("Data::Pdf") || ocrRs.includes("PdfDocument"), "Windows PDF rendering is used");
assert(!ocrRs.includes("tesseract") && !ocrRs.includes("ollama") && !helper.includes("openai"), "no Tesseract, Ollama or cloud AI");
assert(cargo.includes("windows") && cargo.includes("Media_Ocr"), "windows crate provides OCR");
assert(inspectRs.includes("should_try_ocr"), "OCR runs only when the text layer is missing or unusable");
assert(inspectRs.includes("text_layer_is_usable"), "usable PDF text skips OCR");
assert(extractRs.includes("extract_docx_text") && extractRs.includes("extract_xlsx_text"), "DOCX/XLSX extractors stay unchanged");
assert(formatRs.includes('"png"') && formatRs.includes('"jpg"'), "PNG and JPEG are recognized");
assert(formatRs.includes("is_supported_content_document") && formatRs.includes("ContentFormat::Png"), "images stay out of bulk prepare");
assert(helper.includes("isOcrTextSource"), "OCR results stay uncertain");
assert(helper.includes(String.raw`(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})`), "German OCR dates may have spaces around dots");
assert(dialog.includes("Texterkennung"), "OCR status is shown");
assert(dialog.includes("subscribeOcrProgress"), "OCR does not block without status");
const applyHelper = read("src/ui/nameSuggestApply.ts");
assert(
  dialog.includes("workbenchNameSuggestRequest") || applyHelper.includes("workbenchNameSuggestRequest"),
  "apply still uses the rename helper",
);
assert(tree.includes("onPointerDown"), "drag-and-drop remains");
assert(tree.includes("isWorkbenchRenameShortcut"), "Ctrl+Shift+U remains");
console.log("virtual plan p2l9 checks passed");
