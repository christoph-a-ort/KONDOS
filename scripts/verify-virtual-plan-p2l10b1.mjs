// P2-L.10b.1: deterministic AI filenames from structured fields.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");
const assert = (value, label) => { if (!value) throw new Error(label); };
const helper = read("src/ui/localAi.ts");
const check = read("src/ui/localAiCheck.ts");
const dialog = read("src/ui/NameSuggestDialog.tsx");
assert(helper.includes("composeAiNameStem"), "Dotty composes the filename");
assert(helper.includes("bestimmst nicht den Dateinamen"), "the model is not asked for a filename");
assert(helper.includes("normalizeCompanyName"), "company names are normalized");
assert(helper.includes("resolveDocumentType") && helper.includes("Stromrechnung"), "document types are unified from evidence");
assert(!helper.toLowerCase().includes("vattenfall"), "no Vattenfall special case in product code");
assert(helper.includes("joinNameParts([fields.absender, fields.dokumenttyp])"), "schema is sender then document type");
assert(check.includes("assertUniformElectricityInvoices"), "four comparable electricity invoices are tested");
assert(check.includes("manual names remain applicable"), "manual names remain covered");
assert(dialog.includes("nameTouched"), "typed names are not overwritten by later AI results");
const applyHelper = read("src/ui/nameSuggestApply.ts");
assert(
  dialog.includes("applySuggestedFileName") || applyHelper.includes("applySuggestedFileName"),
  "apply remains independent of the AI schema",
);
const { runLocalAiCheck } = await import(pathToFileURL(join(root, "src/ui/localAiCheck.ts")).href);
await runLocalAiCheck();
console.log("virtual plan p2l10b1 checks passed");
