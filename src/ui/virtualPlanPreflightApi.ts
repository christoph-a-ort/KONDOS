import { invoke } from "@tauri-apps/api/core";
import type { PlannedOperationFacts } from "./virtualPlanPreflight";

export function inspectPlannedOperation(
  scanRoot: string,
  kind: string,
  sourcePath: string,
  targetPath: string,
): Promise<PlannedOperationFacts> {
  return invoke<PlannedOperationFacts>("inspect_planned_operation", {
    scanRoot, kind, sourcePath, targetPath,
  });
}
