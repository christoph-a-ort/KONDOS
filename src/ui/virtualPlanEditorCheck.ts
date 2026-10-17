/** P2-K.4b/c virtual plan editor checks — synthetic only, no filesystem actions. */

import type { DirectoryNode, FileNode, ScanConfig, ScanResult } from "../model";
import { makeSnapshotBinding } from "./virtualPlan";
import {
  assignFileToVirtualFolder,
  createVirtualPlanFromProposal,
  excludeFileFromVirtualPlan,
  prepareVirtualPlanForSave,
  projectVirtualPlan,
  renameVirtualPlanFolder,
  resetVirtualPlanToSelection,
  undoLastVirtualPlanEdit,
  validateVirtualPlan,
} from "./virtualPlanEditor";
import { buildVirtualReorgProposals } from "./virtualPlanSuggestions";
import {
  assessVirtualPlanApproval,
  prepareVirtualPlanApproval,
} from "./virtualPlanApproval";
import { revalidateVirtualPlan } from "./virtualPlanRevalidation";
import {
  addSelectedPreferenceCandidates,
  deriveVirtualPlanPreferenceCandidates,
  parseVirtualPlanPreferenceStore,
  updateVirtualPlanPreference,
} from "./virtualPlanPreferences";

function assert(value: boolean, label: string): void {
  if (!value) throw new Error(label);
}

const config: ScanConfig = {
  rootPath: "C:\\Fixture",
  maxDepth: 10,
  excludeHidden: true,
  extensions: [],
  includeSize: true,
  includeCreatedAt: false,
  includeModifiedAt: true,
};

function file(id: string, name: string, depth: number): FileNode {
  return { id, path: id, name, depth, kind: "file", sizeBytes: 1 };
}

function fixture(): ScanResult {
  const root: DirectoryNode = {
    id: "C:\\Fixture",
    path: "C:\\Fixture",
    name: "Fixture",
    depth: 0,
    kind: "directory",
    listing: "read",
    children: [
      {
        id: "C:\\Fixture\\Docs",
        path: "C:\\Fixture\\Docs",
        name: "Docs",
        depth: 1,
        kind: "directory",
        listing: "read",
        children: [
          file("C:\\Fixture\\Docs\\Bericht_01.pdf", "Bericht_01.pdf", 2),
          file("C:\\Fixture\\Docs\\Bericht_02.pdf", "Bericht_02.pdf", 2),
          file("C:\\Fixture\\Docs\\Bericht_03.pdf", "Bericht_03.pdf", 2),
          file("C:\\Fixture\\Docs\\Notiz.txt", "Notiz.txt", 2),
        ],
      },
    ],
  };
  return {
    root,
    warnings: [],
    stats: { directoryCount: 2, fileCount: 4, skippedCount: 0, durationMs: 1 },
  };
}

export function runVirtualPlanEditorCheck(): void {
  const result = fixture();
  const binding = makeSnapshotBinding(result, config, 7);
  const proposal = buildVirtualReorgProposals({ scanResult: result, binding })[0]!;
  const created = createVirtualPlanFromProposal({ proposal, scanResult: result, binding });
  assert(created.ok, "explicit proposal selection creates plan");
  if (!created.ok) return;
  const original = created.plan;
  assert(original.items.length === 6, "all observed nodes included");
  assert(original.virtualFolders?.length === 1, "proposal folders included");
  assert(validateVirtualPlan(original, result, binding).valid, "complete initial plan");
  assert(projectVirtualPlan(original).length === 6, "complete virtual projection");

  const folder = original.virtualFolders![0]!;
  const renamed = renameVirtualPlanFolder(original, folder.id, "Berichte");
  assert(renamed.ok, "rename virtual folder");
  if (!renamed.ok) return;
  assert(renamed.plan.virtualFolders![0]!.name === "Berichte", "folder renamed");
  assert(
    renamed.plan.items.some((item) => item.virtualTargetPath.endsWith("/Berichte")),
    "renamed targets updated",
  );
  assert(renamed.plan.decisions.length === 1, "rename creates one undo step");
  assert(validateVirtualPlan(renamed.plan, result, binding).valid, "renamed plan remains complete");

  const invalidRename = renameVirtualPlanFolder(renamed.plan, folder.id, "CON");
  assert(!invalidRename.ok, "reserved windows name rejected");
  assert(renamed.plan.decisions.length === 1, "failed rename creates no undo step");

  const note = renamed.plan.items.find((item) =>
    item.observed.relativePath.toLowerCase().endsWith("notiz.txt"),
  )!;
  const assigned = assignFileToVirtualFolder(renamed.plan, note.id, folder.id);
  assert(assigned.ok, "assign file to existing virtual folder");
  if (!assigned.ok) return;
  assert(assigned.plan.items.find((item) => item.id === note.id)!.status === "edited", "file edited");
  assert(assigned.plan.decisions.length === 2, "assignment creates one further undo step");
  assert(validateVirtualPlan(assigned.plan, result, binding).valid, "assigned plan remains complete");

  const excluded = excludeFileFromVirtualPlan(assigned.plan, note.id);
  assert(excluded.ok, "leave file unchanged");
  if (!excluded.ok) return;
  assert(excluded.plan.items.find((item) => item.id === note.id)!.status === "excluded", "file excluded only virtually");
  assert(validateVirtualPlan(excluded.plan, result, binding).valid, "excluded file stays complete");

  const undoExclusion = undoLastVirtualPlanEdit(excluded.plan);
  assert(undoExclusion.ok, "undo latest exclusion");
  if (!undoExclusion.ok) return;
  assert(undoExclusion.plan.items.find((item) => item.id === note.id)!.status === "edited", "undo restored assignment");
  assert(validateVirtualPlan(undoExclusion.plan, result, binding).valid, "undo exclusion remains complete");

  const undoAssignment = undoLastVirtualPlanEdit(undoExclusion.plan);
  assert(undoAssignment.ok, "undo assignment after rename");
  if (!undoAssignment.ok) return;
  assert(
    undoAssignment.plan.items.find((item) => item.id === note.id)!.status === "excluded",
    "second undo restored pre-assignment status",
  );
  assert(undoAssignment.plan.virtualFolders![0]!.name === "Berichte", "second undo keeps earlier rename");
  assert(validateVirtualPlan(undoAssignment.plan, result, binding).valid, "undo assignment remains complete");

  const undoRename = undoLastVirtualPlanEdit(undoAssignment.plan);
  assert(undoRename.ok, "undo folder rename after assignment undo");
  if (!undoRename.ok) return;
  assert(undoRename.plan.virtualFolders![0]!.name === folder.name, "folder name restored by undo");
  assert(
    undoRename.plan.items.every((item, index) => item.virtualTargetPath === original.items[index]!.virtualTargetPath),
    "undo folder rename restores target paths",
  );
  assert(undoRename.plan.decisions.length === 0, "all undo steps consumed");
  assert(validateVirtualPlan(undoRename.plan, result, binding).valid, "undo rename remains complete");

  const secondRename = renameVirtualPlanFolder(renamed.plan, folder.id, "Archiv");
  assert(secondRename.ok, "second sequential folder rename");
  if (!secondRename.ok) return;
  const undoSecondRename = undoLastVirtualPlanEdit(secondRename.plan);
  assert(undoSecondRename.ok, "undo latest sequential rename");
  if (!undoSecondRename.ok) return;
  assert(undoSecondRename.plan.virtualFolders![0]!.name === "Berichte", "first rename restored after second undo");
  const undoFirstRename = undoLastVirtualPlanEdit(undoSecondRename.plan);
  assert(undoFirstRename.ok, "undo first sequential rename");
  if (!undoFirstRename.ok) return;
  assert(undoFirstRename.plan.virtualFolders![0]!.name === folder.name, "original name restored after sequential undos");

  const reset = resetVirtualPlanToSelection(assigned.plan);
  assert(reset.ok, "reset selection");
  if (!reset.ok) return;
  assert(reset.plan.items.every((item, index) => item.virtualTargetPath === original.items[index]!.virtualTargetPath), "reset selection paths");
  assert(reset.plan.virtualFolders!.every((entry, index) => entry.name === original.virtualFolders![index]!.name), "reset folder names");
  assert(reset.plan.decisions.length === 0, "reset clears undo history");
  assert(validateVirtualPlan(reset.plan, result, binding).valid, "reset remains complete");

  const persisted = prepareVirtualPlanForSave(reset.plan, 4);
  assert(persisted.revision === 5, "optimistic save revision");
  assert(validateVirtualPlan(persisted, result, binding).valid, "persist candidate valid");
  const localAfterSave = renameVirtualPlanFolder(persisted, folder.id, "Lokale Änderung");
  assert(localAfterSave.ok, "local edit after saved draft");
  if (!localAfterSave.ok) return;
  const resetAfterSave = resetVirtualPlanToSelection(localAfterSave.plan);
  assert(resetAfterSave.ok, "reset after saved draft");
  if (!resetAfterSave.ok) return;
  assert(persisted.virtualFolders![0]!.name === folder.name, "saved draft remains unchanged by local reset");
  assert(resetAfterSave.plan.virtualFolders![0]!.name === folder.name, "reset returns saved selection baseline");

  const stale = validateVirtualPlan(persisted, result, { ...binding, snapshotFingerprint: "vp1-stale" });
  assert(!stale.valid, "stale snapshot rejected");
  const incomplete = validateVirtualPlan(persisted, result, { ...binding, incomplete: true });
  assert(!incomplete.valid, "incomplete snapshot rejected");

  const collision = {
    ...persisted,
    items: [...persisted.items, { ...persisted.items[0]!, id: "duplicate" }],
  };
  assert(!validateVirtualPlan(collision, result, binding).valid, "duplicate observed object rejected");

  const approvable = assessVirtualPlanApproval({
    plan: persisted,
    scanResult: result,
    binding,
    draftLoad: { kind: "valid", plan: persisted },
  });
  assert(approvable.eligible, "saved complete plan is virtually approvable");
  const unsavedApproval = assessVirtualPlanApproval({
    plan: localAfterSave.plan,
    scanResult: result,
    binding,
    draftLoad: { kind: "valid", plan: persisted },
  });
  assert(!unsavedApproval.eligible, "unsaved local changes block approval");
  const revisionConflictApproval = assessVirtualPlanApproval({
    plan: persisted,
    scanResult: result,
    binding,
    draftLoad: { kind: "valid", plan: { ...persisted, revision: persisted.revision + 1 } },
  });
  assert(!revisionConflictApproval.eligible, "revision conflict blocks approval");
  const staleApproval = assessVirtualPlanApproval({
    plan: persisted,
    scanResult: result,
    binding: { ...binding, snapshotFingerprint: "vp1-stale" },
    draftLoad: { kind: "valid", plan: persisted },
  });
  assert(!staleApproval.eligible, "stale snapshot blocks approval");
  const incompleteApproval = assessVirtualPlanApproval({
    plan: persisted,
    scanResult: result,
    binding: { ...binding, incomplete: true },
    draftLoad: { kind: "valid", plan: persisted },
  });
  assert(!incompleteApproval.eligible, "incomplete scan blocks approval");
  const filteredApproval = assessVirtualPlanApproval({
    plan: persisted,
    scanResult: result,
    binding: {
      ...binding,
      scanConfig: { ...binding.scanConfig, extensions: [".pdf"] },
    },
    draftLoad: { kind: "valid", plan: persisted },
  });
  assert(!filteredApproval.eligible, "filtered scan blocks approval");
  const blockedApproval = assessVirtualPlanApproval({
    plan: persisted,
    scanResult: result,
    binding,
    draftLoad: { kind: "blocked", reason: "corrupt" },
  });
  assert(!blockedApproval.eligible, "blocked draft blocks approval");
  const invalidApproval = assessVirtualPlanApproval({
    plan: { ...persisted, items: [...persisted.items, { ...persisted.items[0]!, id: "duplicate-approval" }] },
    scanResult: result,
    binding,
    draftLoad: { kind: "valid", plan: persisted },
  });
  assert(!invalidApproval.eligible, "duplicate objects block approval");

  const approved = prepareVirtualPlanApproval(persisted, persisted.revision);
  assert(approved.status === "virtuallyApproved", "explicit approval marks plan virtually approved");
  assert(approved.revision === persisted.revision + 1, "approval increments revision");
  assert(
    approved.decisions[approved.decisions.length - 1]?.kind === "approveVirtual",
    "approval records user decision",
  );
  assert(!renameVirtualPlanFolder(approved, folder.id, "Nach Freigabe").ok, "approved plan is not silently editable");

  assert(
    revalidateVirtualPlan({ plan: persisted, blocked: false, scanResult: result, currentBinding: binding }).kind === "current",
    "unchanged snapshot revalidates current",
  );
  assert(
    revalidateVirtualPlan({
      plan: persisted,
      blocked: false,
      scanResult: result,
      currentBinding: { ...binding, sourceScanId: binding.sourceScanId + 1 },
    }).kind === "stale",
    "changed scan id revalidates stale",
  );
  assert(
    revalidateVirtualPlan({
      plan: persisted,
      blocked: false,
      scanResult: result,
      currentBinding: { ...binding, snapshotFingerprint: "vp1-changed" },
    }).kind === "stale",
    "changed fingerprint revalidates stale",
  );
  assert(
    revalidateVirtualPlan({
      plan: persisted,
      blocked: false,
      scanResult: result,
      currentBinding: { ...binding, scanConfig: { ...binding.scanConfig, maxDepth: binding.scanConfig.maxDepth + 1 } },
    }).kind === "stale",
    "changed scan config revalidates stale",
  );
  const addedObjectResult: ScanResult = {
    ...result,
    root: { ...result.root, children: [...result.root.children, file("C:\\Fixture\\zusatz.txt", "zusatz.txt", 1)] },
  };
  assert(
    revalidateVirtualPlan({ plan: persisted, blocked: false, scanResult: addedObjectResult, currentBinding: binding }).kind === "stale",
    "changed object set revalidates stale",
  );
  assert(
    revalidateVirtualPlan({ plan: approved, blocked: false, scanResult: result, currentBinding: binding }).kind === "current",
    "approved historical plan remains historically valid without rebinding",
  );
  assert(
    revalidateVirtualPlan({ plan: null, blocked: true, scanResult: result, currentBinding: binding }).kind === "blocked",
    "blocked draft remains blocked",
  );

  assert(deriveVirtualPlanPreferenceCandidates(original).length === 0, "unconfirmed plan creates no preference candidates");
  const approvedWithUserEdit = prepareVirtualPlanApproval(assigned.plan, assigned.plan.revision);
  const candidates = deriveVirtualPlanPreferenceCandidates(approvedWithUserEdit);
  assert(candidates.length === 2, "explicit user decisions create preference candidates");
  const preferenceStore = { schemaVersion: 1 as const, revision: 0, preferences: [] };
  const savedPreferences = addSelectedPreferenceCandidates(preferenceStore, candidates);
  assert(savedPreferences.preferences.length === 2 && savedPreferences.revision === 1, "selected preferences persist once");
  assert(addSelectedPreferenceCandidates(savedPreferences, candidates) === savedPreferences, "duplicate preference prevented");
  const deactivated = updateVirtualPlanPreference(savedPreferences, savedPreferences.preferences[0]!.id, {
    description: "Bearbeitete Präferenz",
    active: false,
  });
  assert(!deactivated.preferences[0]!.active, "preference can be revoked");
  assert(deactivated.preferences[0]!.sourceDecisionId === savedPreferences.preferences[0]!.sourceDecisionId, "source decision remains immutable");
  assert(parseVirtualPlanPreferenceStore("{bad") === null, "corrupt preference data is rejected");
}
