// P2-L.4b.2: skip existing folders, handle-based move, UI for a single confirmed moveFile.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");
const assert = (value, label) => { if (!value) throw new Error(label); };
const model = read("src/ui/virtualPlanDryRun.ts");
const execution = read("src/ui/virtualPlanExecution.ts");
const panel = read("src/ui/VirtualPlanExecutionPanel.tsx");
const api = read("src/ui/virtualPlanExecutionApi.ts");
const mkdir = read("src-tauri/src/commands/execution_mkdir.rs");
const moveRs = read("src-tauri/src/commands/execution_move.rs");
const occupancy = read("src-tauri/src/state.rs");
assert(model.includes("existingDirectoryInSnapshot"), "snapshot directory identity helper");
assert(model.includes("relativeFromRoot"), "full relative path, not folder name");
assert(model.includes('listing !== "read"'), "unread listings are not treated as known directories");
assert(model.includes("createVirtualFolder"), "new folders still use createVirtualFolder");
assert(!/invoke\(|execute_move|execute_rename|MoveFile/.test(model), "dry-run still has no real file execution");
assert(mkdir.includes("execute_create_folder") && mkdir.includes("FILE_CREATE"), "p2-l.4b.1 mkdir command unchanged");
assert(moveRs.includes("execute_move_file") && moveRs.includes("NtSetInformationFile"), "handle-based move");
assert(moveRs.includes("FILE_RENAME_INFORMATION") && moveRs.includes("replace_if_exists"), "no overwrite rename info");
assert(moveRs.includes("confirmed_kind != \"moveFile\"") && moveRs.includes("renameFile"), "renameFile not enabled");
assert(!/MOVEFILE_COPY_ALLOWED|MOVEFILE_REPLACE_EXISTING/.test(moveRs), "no copy+delete and no replace-existing");
assert(moveRs.includes("try_begin_execution") && moveRs.includes("acquire_at"), "occupancy and coordination");
assert(execution.includes("shouldAutoExecuteNext") && execution.includes("return false"), "no auto execute");
assert(execution.includes("isRealFileMoveKind") && execution.includes("canSubmitRealFileMove"), "single move confirmation helpers");
assert(execution.includes("realFileMoveDisableReason") && execution.includes("hasCompleteFileFingerprint"), "disable reason and complete fingerprint");
assert(execution.includes("readySimulated") === false || execution.includes("isReadyForRealExecution"), "simulated ready is not a real grant");
assert(execution.includes("journalBoundToApprovedPlan") && execution.includes("realExecutionUiOpen"), "bound journal continuation after rescan");
assert(execution.includes("realExecutionOperationsFrom") && execution.includes("journalBoundToPlan"), "journal ops and submit gate for bound continuation");
assert(panel.includes("canPrepare") && panel.includes("journalBound"), "prepare stays current-gated; continuation uses bound journal");
assert(panel.includes("Fortsetzung nur für dieses gebundene Journal"), "rescan continuation notice");
assert(api.includes("execute_move_file") && api.includes('confirmedKind: "moveFile"'), "move command API");
assert(!api.includes("execute_rename_file"), "no rename command");
assert(panel.includes("Diese Datei jetzt verschieben") && panel.includes("moveBlockReason"), "dedicated move button with disable reason");
assert(panel.includes("Ich bestätige ausdrücklich genau diese eine Dateiverschiebung."), "dedicated move checkbox");
assert(panel.includes("Vollständiger Quellpfad") && panel.includes("Vollständiger Zielpfad"), "full source and target paths");
assert(panel.includes("Echte Ordneranlage jetzt ausführen"), "existing folder create UI remains");
assert(panel.includes("journalStatusLabel"), "FV2-01 execution panel shows journal status label");
assert(!panel.includes("Diese Datei jetzt umbenennen"), "rename UI remains absent");
assert(panel.includes("simulatedFolderTargets: []") || panel.includes("simulatedFolderTargets:[]"), "real inspect does not treat virtual parents as existing");
assert(occupancy.includes("echte Dateioperation") && !occupancy.includes("echte Ordneranlage"), "occupancy copy is generic");
const preflight = read("src/ui/virtualPlanPreflight.ts");
assert(preflight.includes("hasCompleteFileFingerprint") && preflight.includes("incompleteFileFingerprintReason"), "preflight requires size and mtime");
const { runVirtualPlanDryRunCheck } = await import(
  pathToFileURL(join(root, "src/ui/virtualPlanDryRunCheck.ts")).href,
);
const { runVirtualPlanExecutionCheck } = await import(
  pathToFileURL(join(root, "src/ui/virtualPlanExecutionCheck.ts")).href,
);
const { runVirtualPlanPreflightCheck } = await import(
  pathToFileURL(join(root, "src/ui/virtualPlanPreflightCheck.ts")).href,
);
const { runScanIdentityMetadataCheck, assertScanIdentitySourceGuards } = await import(
  pathToFileURL(join(root, "src/ui/scanIdentityMetadataCheck.ts")).href,
);
const { runVirtualPlanReservationAdminCheck, assertReservationAdminSourceGuards } = await import(
  pathToFileURL(join(root, "src/ui/virtualPlanReservationAdminCheck.ts")).href,
);
runVirtualPlanDryRunCheck();
runVirtualPlanExecutionCheck();
runVirtualPlanPreflightCheck();
runScanIdentityMetadataCheck();
assertScanIdentitySourceGuards(read("src/ui/ConfigPanel.tsx"));
runVirtualPlanReservationAdminCheck();
assertReservationAdminSourceGuards({
  preview: read("src/ui/VirtualPlanPreviewView.tsx"),
  panel: read("src/ui/VirtualPlanReservationAdminPanel.tsx"),
  journalPanel: read("src/ui/VirtualPlanJournalPanel.tsx"),
  executionPanel: panel,
});
console.log("virtual plan p2l4b2 checks passed");
