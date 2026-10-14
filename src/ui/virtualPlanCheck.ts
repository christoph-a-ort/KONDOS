import type { DirectoryNode, FileNode, ScanConfig, ScanResult } from "../model";
import { canWriteVirtualDraft, makeSnapshotBinding, parseVirtualPlan, snapshotFingerprint, type VirtualPlan } from "./virtualPlan";

function assert(value: boolean, label: string): void { if (!value) throw new Error(label); }
const config: ScanConfig = { rootPath: "C:\\Fixture", maxDepth: 10, excludeHidden: true, extensions: [], includeSize: true, includeCreatedAt: false, includeModifiedAt: true };
function fixture(): ScanResult {
  const file: FileNode = { id: "C:\\Fixture\\a.txt", path: "C:\\Fixture\\a.txt", name: "a.txt", depth: 1, kind: "file", sizeBytes: 1, modifiedAtMs: 4 };
  const root: DirectoryNode = { id: "C:\\Fixture", path: "C:\\Fixture", name: "Fixture", depth: 0, kind: "directory", listing: "read", children: [file] };
  return { root, warnings: [], stats: { directoryCount: 1, fileCount: 1, skippedCount: 0, durationMs: 1 } };
}
export function runVirtualPlanCheck(): void {
  const result = fixture(); const binding = makeSnapshotBinding(result, config, 7);
  assert(binding.snapshotFingerprint === snapshotFingerprint(result, config), "deterministic fingerprint");
  assert(binding.incomplete === false, "complete snapshot");
  assert(makeSnapshotBinding(result, { ...config, extensions: [".pdf"] }, 7).incomplete, "filtered snapshot incomplete");
  const plan: VirtualPlan = { schemaVersion: 1, planId: "plan_1", builderVersion: 1, revision: 1, status: "draft", scope: { kind: "scanRoot", rootNodeId: result.root.id }, binding, items: [], openCases: [{ id: "case", reason: "identityUnavailable" }], decisions: [], preferences: [] };
  const loaded = parseVirtualPlan(JSON.stringify(plan));
  assert(loaded.kind === "valid", "roundtrip");
  assert(canWriteVirtualDraft(loaded, 1, { ...plan, revision: 2 }), "revision write");
  assert(!canWriteVirtualDraft(loaded, 0, { ...plan, revision: 1 }), "stale revision");
  assert(parseVirtualPlan("{bad").kind === "blocked", "corrupt blocked");
  assert(parseVirtualPlan(JSON.stringify({ ...plan, schemaVersion: 99 })).kind === "blocked", "unknown version blocked");
}
