// FV2-02d.2: network storage lock in dry-run/preflight/journal create. No real filesystem mutation.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");
const assert = (value, label) => { if (!value) throw new Error(label); };

const storage = read("src/ui/windowsStorage.ts");
const api = read("src/ui/windowsStorageApi.ts");
const dryRun = read("src/ui/virtualPlanDryRun.ts");
const dryRunPanel = read("src/ui/VirtualPlanDryRunPanel.tsx");
const journal = read("src/ui/virtualPlanJournal.ts");
const journalPanel = read("src/ui/VirtualPlanJournalPanel.tsx");
const executionPanel = read("src/ui/VirtualPlanExecutionPanel.tsx");
const preflight = read("src/ui/virtualPlanPreflight.ts");
const rustInspect = read("src-tauri/src/commands/execution_storage.rs");
const rustPreflight = read("src-tauri/src/commands/execution_preflight.rs");
const rustBinding = read("src-tauri/src/commands/execution_binding.rs");
const rustStorage = read("src-tauri/src/paths/windows_storage.rs");

assert(storage.includes("parseStorageKind") && storage.includes("applyStorageClassification"), "pure TS storage gate");
assert(!/invoke\(|fs\.|writeFile|mkdir|rename/.test(storage), "TS storage helper stays read-only");
assert(api.includes("inspect_storage_kind") && api.includes("inspect_storage_kinds"), "TS reuses the Rust inspect commands");
assert(api.includes("classifyDryRunReportStorage"), "dry-run classify wrapper");
assert(dryRun.includes('"unverifiable"') && dryRun.includes("storageClassification"), "dry-run report carries storage classification");
assert(dryRunPanel.includes("classifyDryRunReportStorage") && dryRunPanel.includes("dryRunStatusLabel"), "dry-run panel classifies before display");
assert(dryRunPanel.includes("report.operations.map"), "blocked dry-run still lists operations");
assert(journal.includes('storageClassification !== "local"'), "journal create requires local storage");
assert(journalPanel.includes("classifyDryRunReportStorage") && journalPanel.includes("storageAllowsJournal"), "journal panel classifies before create");
assert(executionPanel.includes("classifyDryRunReportStorage") && executionPanel.includes("storageAllowsJournal"), "execution panel classifies before bound journal");
assert(preflight.includes("storageKindDecision") && preflight.includes("parseStorageKind"), "preflight consumes Rust storageKind");
assert(rustInspect.includes("classify_opened_path") && rustInspect.includes("inspect_storage_kind"), "Rust inspect reuses 02d.1 classification");
assert(!rustInspect.includes("CreateFileW") && !rustInspect.includes("FILE_CREATE"), "inspect command does not create files");
assert(rustPreflight.includes("worst_existing_storage_kind") && rustPreflight.includes("storage_kind"), "preflight facts include storage kind");
assert(rustBinding.includes("require_local_storage_for_journal_payload"), "new bound journals re-check storage");
assert(rustBinding.includes("progress_bound_run_locked") && (rustBinding.split("require_local_storage_for_journal_payload").length - 1) >= 4, "all bound journal writes re-check storage");
assert(rustStorage.includes("classify_opened_path") && rustStorage.includes("GetDriveTypeW"), "02d.1 classifier remains the source of truth");
assert(!read("src/ui/windowsStorage.ts").includes("GetDriveType"), "TypeScript does not invent a second classifier");

const { runWindowsStorageCheck } = await import(
  pathToFileURL(join(root, "src/ui/windowsStorageCheck.ts")).href,
);
await runWindowsStorageCheck();
const { runVirtualPlanDryRunCheck } = await import(
  pathToFileURL(join(root, "src/ui/virtualPlanDryRunCheck.ts")).href,
);
const { runVirtualPlanPreflightCheck } = await import(
  pathToFileURL(join(root, "src/ui/virtualPlanPreflightCheck.ts")).href,
);
const { runVirtualPlanJournalCheck } = await import(
  pathToFileURL(join(root, "src/ui/virtualPlanJournalCheck.ts")).href,
);
const { runWindowsInventoryNamesCheck } = await import(
  pathToFileURL(join(root, "src/ui/windowsInventoryNamesCheck.ts")).href,
);
runVirtualPlanDryRunCheck();
runVirtualPlanPreflightCheck();
runVirtualPlanJournalCheck();
runWindowsInventoryNamesCheck();
console.log("windows storage fv202d2 checks passed");
