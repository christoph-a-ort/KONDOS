import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");
const assert = (value, label) => { if (!value) throw new Error(label); };
const model = read("src/ui/virtualPlanPreflight.ts");
const panel = read("src/ui/VirtualPlanPreflightPanel.tsx");
const api = read("src/ui/virtualPlanPreflightApi.ts");
const rust = read("src-tauri/src/commands/execution_preflight.rs");
assert(model.includes("evaluatePreflight") && model.includes("confirmSimulatedOperation"), "preflight model");
assert(model.includes("shouldAutoConfirmNext") && model.includes("shouldAutoResumePreflight"), "no auto execute");
assert(!/invoke\(|fs\.|rename\(|copyFile|unlink|mkdir/.test(model), "pure model has no filesystem mutation");
assert(api.includes("inspect_planned_operation") && !api.includes("save_execution_journal"), "read-only inspect command");
assert(panel.includes("nur Simulation") && panel.includes("Einzeloperation bestätigen"), "confirmation UI");
assert(model.includes("Bereit (nur Simulation)") && panel.includes("preflightStatusLabel"), "German readySimulated label");
assert(!panel.includes("Prüfung: {decision.status}"), "raw readySimulated is not shown");
assert(panel.includes("Abbrechen") && panel.includes("keine Dateien verschoben"), "abort and no-real-ops copy");
assert(!panel.includes(">Ausführen<"), "no execute UI");
assert(rust.includes("symlink_metadata") && rust.includes("Never mutates"), "read-only rust inspect");
assert(!/\bfs::(write|rename|remove_file|copy)\(/.test(rust.split("#[cfg(test)]")[0]), "product rust path does not mutate scan files");
assert(rust.includes("valid_file_move_is_observed_without_mutation"), "no-mutation rust test");
const { runVirtualPlanPreflightCheck } = await import(
  pathToFileURL(join(root, "src/ui/virtualPlanPreflightCheck.ts")).href,
);
runVirtualPlanPreflightCheck();
console.log("virtual plan p2l4a checks passed");
