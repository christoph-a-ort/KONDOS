// P2-K.3b: justifiable virtual reorganization proposals (not auto-applied to SOLL).
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

const suggestions = read("src/ui/virtualPlanSuggestions.ts");
const suggestionsCheck = read("src/ui/virtualPlanSuggestionsCheck.ts");
const preview = read("src/ui/virtualPlanPreview.ts");
const previewCheck = read("src/ui/virtualPlanPreviewCheck.ts");
const view = read("src/ui/VirtualPlanPreviewView.tsx");
const app = read("src/App.tsx");
const css = read("src/App.css");
const workbench = read("src/ui/treeWorkbenchCheck.ts");

assert(suggestions.includes("buildVirtualReorgProposals"), "suggestions builder");
assert(suggestions.includes("createVirtualSubfolder"), "subfolder action");
assert(suggestions.includes("groupFilesByYear"), "year action");
assert(suggestions.includes("renameVirtualFolder"), "rename action kind reserved");
assert(suggestions.includes("reviewableStructureVariant"), "variant category");
assert(suggestions.includes("assessProposalCompleteness"), "completeness");
assert(suggestions.includes("Bleibt unverändert"), "unchanged marker");
assert(suggestions.includes("adopted: false"), "never adopted");
assert(suggestions.includes("overlapsWithProposalIds"), "overlap linking");
assert(suggestions.includes("PRINCIPLE_RECURRING_FILE_NAME_FORM"), "name form gated");
assert(!suggestions.includes("invoke("), "suggestions no invoke");
assert(!suggestions.includes("startScan"), "suggestions no scan");
assert(!/fs\.write|fs\.rename|fs\.unlink|saveVirtualPlanDraft/.test(suggestions), "no FS/draft write");

assert(suggestionsCheck.includes("runVirtualPlanSuggestionsCheck"), "check export");
assert(suggestionsCheck.includes("prefix group found"), "check prefix");
assert(suggestionsCheck.includes("no weak prefix proposal"), "check weak evidence");
assert(suggestionsCheck.includes("year proposal"), "check year");
assert(suggestionsCheck.includes("ambiguous excluded"), "check ambiguous year");
assert(suggestionsCheck.includes("no structure variant from name pattern alone"), "check no partial variant");
assert(suggestionsCheck.includes("gasag 10 source"), "check gasag 9+1");
assert(suggestionsCheck.includes("gasag 9 grouped"), "check gasag grouped");
assert(suggestionsCheck.includes("gasag 1 unchanged"), "check gasag unchanged");
assert(suggestionsCheck.includes("subfolder preserved"), "check subfolders");
assert(suggestionsCheck.includes("large complete"), "check large");
assert(suggestionsCheck.includes("deterministic proposals"), "check determinism");
assert(suggestionsCheck.includes("soll nodes unchanged"), "check soll intact");
assert(suggestionsCheck.includes("overlapping proposals linked"), "check overlap");
assert(suggestionsCheck.includes("no proposal from incomplete listing"), "check incomplete");
assert(!suggestionsCheck.includes("Off.Dokumente"), "check no private path");

assert(preview.includes("buildVirtualReorgProposals"), "preview wires proposals");
assert(preview.includes("proposals:"), "preview carries proposals");
assert(preview.includes("changeKind: \"unchanged\""), "soll nodes stay unchanged");
assert(!preview.includes("saveVirtualPlanDraft"), "preview no draft save");

assert(previewCheck.includes("proposals array present"), "preview check proposals");
assert(previewCheck.includes("proposals never adopted"), "preview check not adopted");

assert(view.includes("Virtuelle Vorschläge"), "view proposals section");
assert(view.includes("Noch nicht übernommen"), "view not-adopted label");
assert(view.includes("Vollständige Zielvorschau"), "view full preview");
assert(view.includes("bleibt unverändert"), "view unchanged counts");
assert(view.includes("actionLabel"), "view action label");
assert(!view.includes("Übernehmen"), "view no adopt button");
assert(!view.includes("Bestätigen"), "view no confirm button");
assert(!view.includes("saveVirtualPlanDraft"), "view no draft write");
assert(!view.includes("invoke("), "view no invoke");

assert(app.includes("VirtualPlanPreviewView"), "App still wires planning");
assert(
  !app.includes("saveVirtualPlanDraft(") || app.includes("saveEditableVirtualPlan"),
  "App persistence is explicit, not silent",
);

assert(css.includes("P2-K.3b"), "css marker");
assert(css.includes(".plan-proposals"), "css proposals");
assert(css.includes(".plan-proposal-preview"), "css proposal preview");
assert(css.includes(".plan-proposal-counts"), "css counts");
assert(!/purple|violet|magenta|pink/i.test(css.slice(css.indexOf("P2-K.3b"))), "no purple/pink in K.3b css");

assert(workbench.includes("runVirtualPlanSuggestionsCheck"), "workbench wires K.3b");
assert(workbench.includes("runVirtualPlanPreviewCheck"), "workbench keeps K.3a");

const { runVirtualPlanSuggestionsCheck } = await import(
  pathToFileURL(join(root, "src/ui/virtualPlanSuggestionsCheck.ts")).href,
);
runVirtualPlanSuggestionsCheck();

const { runVirtualPlanPreviewCheck } = await import(
  pathToFileURL(join(root, "src/ui/virtualPlanPreviewCheck.ts")).href,
);
runVirtualPlanPreviewCheck();

console.log("virtual plan p2k3b checks passed");
