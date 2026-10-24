/** FV2-02b – Shared Windows path-length checks. Synthetic only, no filesystem actions. */
import type { DirectoryNode, FileNode, ScanConfig, ScanResult } from "../model";
import { makeSnapshotBinding, type VirtualPlan, type VirtualPlanItem } from "./virtualPlan";
import { assignFileToVirtualFolder, renameVirtualPlanFolder, validateVirtualPlan } from "./virtualPlanEditor";
import { buildVirtualPlanDryRun } from "./virtualPlanDryRun";
import { bindRealFileMoveConfirm, canSubmitRealFileMove, isReadyForRealExecution } from "./virtualPlanExecution";
import { evaluatePreflight, type PlannedOperationFacts } from "./virtualPlanPreflight";
import {
  assertWindowsPathLengthFixture,
  buildAbsoluteFromSizes,
  CONSERVATIVE_COMPONENT_UTF16,
  evaluateNewTargetPathLength,
  fillAsciiComponent,
  isAllowedAbsoluteTargetTotalLength,
  newComponentsRelativeToExisting,
  utf16Length,
  windowsTargetPath,
  type WindowsPathLengthFixture,
} from "./windowsPathLengths";
import { isAllowedAbsoluteWindowsPath, isAllowedWindowsComponent } from "./windowsPathRules";

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

function file(id: string, name: string): FileNode {
  return { id, path: id, name, depth: 1, kind: "file", sizeBytes: 1, modifiedAtMs: 100 };
}

function inventory(extraFiles: FileNode[] = []): ScanResult {
  const root: DirectoryNode = {
    id: "C:\\Fixture",
    path: "C:\\Fixture",
    name: "Fixture",
    depth: 0,
    kind: "directory",
    listing: "read",
    children: [file("C:\\Fixture\\Rechnung.pdf", "Rechnung.pdf"), ...extraFiles],
  };
  return {
    root,
    warnings: [],
    stats: { directoryCount: 1, fileCount: 1 + extraFiles.length, skippedCount: 0, durationMs: 1 },
  };
}

function item(nodeId: string, relative: string, kind: "file" | "directory", target: string): VirtualPlanItem {
  return {
    id: `vpi_${relative}`,
    observed: {
      nodeId,
      relativePath: relative,
      kind,
      identityStatus: "scanLocalOnly",
      metadata: { sizeBytes: 1, modifiedAtMs: 100 },
    },
    virtualTargetPath: target,
    originalVirtualTargetPath: target,
    status: "proposed",
    sourceInsightIds: [],
    alternatives: [],
  };
}

function draftPlan(result: ScanResult, folders: Array<{ name: string; parent?: string }>, extras: VirtualPlanItem[] = []): {
  plan: VirtualPlan;
  binding: ReturnType<typeof makeSnapshotBinding>;
} {
  const binding = makeSnapshotBinding(result, config, 1);
  const plan: VirtualPlan = {
    schemaVersion: 1,
    planId: "vp_lengths",
    builderVersion: 1,
    revision: 1,
    status: "draft",
    scope: { kind: "scanRoot", rootNodeId: result.root.id },
    binding,
    items: [
      item(result.root.id, ".", "directory", "."),
      item("C:\\Fixture\\Rechnung.pdf", "Rechnung.pdf", "file", "."),
      ...extras,
    ],
    virtualFolders: folders.map((folder, index) => ({
      id: `vpf_${index}_${folder.name.slice(0, 12)}`,
      sourceProposalId: "prop",
      parentVirtualPath: folder.parent ?? ".",
      name: folder.name,
      originalName: folder.name,
    })),
    openCases: [],
    decisions: [],
    preferences: [],
  };
  return { plan, binding };
}

function facts(overrides: Partial<PlannedOperationFacts> = {}): PlannedOperationFacts {
  return {
    kind: "moveFile",
    bindingStatus: "unbound",
    bindingMessage: "",
    source: { exists: true, isFile: true, isDir: false, isReparse: false, readable: true, withinRoot: true, sizeBytes: 1, modifiedAtMs: 100 },
    target: { exists: false, isFile: false, isDir: false, isReparse: false, readable: true, withinRoot: true, sizeBytes: null, modifiedAtMs: null },
    targetParentExists: true,
    targetParentIsDir: true,
    targetParentIsReparse: false,
    maximumComponentLength: 255,
    reminder: "erneut",
    ...overrides,
  };
}

function moveOp(targetPath: string, sourcePath = "Rechnung.pdf") {
  return {
    id: "op1",
    kind: "moveFile" as const,
    objectId: "n1",
    sourcePath,
    targetPath,
    expectedSource: "src",
    preconditions: [],
    expectedTarget: "dst",
    collisionStatus: "mustCheckAtExecution" as const,
    checkStatus: "mustCheckAtExecution" as const,
    rationale: "t",
    recovery: "r",
  };
}

export function runWindowsPathLengthsCheck(fixture: WindowsPathLengthFixture): void {
  assertWindowsPathLengthFixture(fixture, assert);

  const total258 = buildAbsoluteFromSizes("C:\\", [127, 127]);
  const total259 = buildAbsoluteFromSizes("C:\\", [127, 128]);
  const total260 = buildAbsoluteFromSizes("C:\\", [127, 129]);
  const total261 = buildAbsoluteFromSizes("C:\\", [128, 129]);
  assert(utf16Length(total258) === 258 && isAllowedAbsoluteTargetTotalLength(total258), "total 258 allowed");
  assert(utf16Length(total259) === 259 && isAllowedAbsoluteTargetTotalLength(total259), "total 259 allowed");
  assert(utf16Length(total260) === 260 && !isAllowedAbsoluteTargetTotalLength(total260), "total 260 blocked");
  assert(utf16Length(total261) === 261 && !isAllowedAbsoluteTargetTotalLength(total261), "total 261 blocked");

  const longTotalOkComponents = evaluateNewTargetPathLength(total260, [fillAsciiComponent(127), fillAsciiComponent(129)], {
    filesystemComponentLimit: CONSERVATIVE_COMPONENT_UTF16,
    requireKnownVolumeLimit: true,
  });
  assert(!longTotalOkComponents.ok && longTotalOkComponents.kind === "total", "valid components still fail a too-long total path");

  const longComponent = evaluateNewTargetPathLength(buildAbsoluteFromSizes("C:\\", [256]), [fillAsciiComponent(256)], {
    filesystemComponentLimit: CONSERVATIVE_COMPONENT_UTF16,
    requireKnownVolumeLimit: true,
  });
  assert(!longComponent.ok && longComponent.kind === "component", "too-long component fails while total stays under the cap");
  assert(isAllowedWindowsComponent(fillAsciiComponent(246)), "positive folder names stay within the conservative 255 cap");

  assert(utf16Length("Änderung") === 8, "BMP umlaut uses one UTF-16 unit per character");
  assert(utf16Length("📁") === 2 && utf16Length("C:\\📁") === 5, "emoji uses a UTF-16 surrogate pair");

  const longRoot = buildAbsoluteFromSizes(
    "C:\\AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    [8],
  );
  assert(isAllowedAbsoluteTargetTotalLength(longRoot), "long scan root with a short new name remains allowed");

  const nested = newComponentsRelativeToExisting("Projekte/2026/Rechnungen", () => false);
  assert(nested !== null && nested.length === 3, "multiple new target folders are all checked");

  const short = evaluateNewTargetPathLength("C:\\Ordner\\Datei.txt", ["Datei.txt"], {
    filesystemComponentLimit: 255,
    requireKnownVolumeLimit: true,
  });
  assert(short.ok, "ordinary short target remains allowed");

  const reserved = evaluateNewTargetPathLength("C:\\Ordner\\CON.txt", ["CON.txt"], {
    filesystemComponentLimit: 255,
    requireKnownVolumeLimit: true,
  });
  assert(reserved.ok, "length check does not replace FV2-02a reserved-name blocks");

  const result = inventory();
  const { plan, binding } = draftPlan(result, [{ name: "Berichte" }, { name: "2026", parent: "Berichte" }]);
  assert(validateVirtualPlan(plan, result, binding).valid, "nested short folders stay editor-valid");
  const nestedFolderId = plan.virtualFolders?.[1]?.id;
  if (nestedFolderId === undefined) throw new Error("nested folder id exists");
  const assigned = assignFileToVirtualFolder(plan, "vpi_Rechnung.pdf", nestedFolderId);
  assert(assigned.ok, "ordinary file stays assignable");

  const longName = fillAsciiComponent(180);
  const longFile = file(`C:\\Fixture\\${longName}.txt`, `${longName}.txt`);
  const longResult = inventory([longFile]);
  const longDraft = draftPlan(
    longResult,
    [{ name: "Berichte" }],
    [item(longFile.id, `${longName}.txt`, "file", ".")],
  );
  assert(validateVirtualPlan(longDraft.plan, longResult, longDraft.binding).valid, "N: long existing source stays in a valid draft");
  const longAssigned = assignFileToVirtualFolder(longDraft.plan, `vpi_${longName}.txt`, "vpf_0_Berichte");
  assert(longAssigned.ok, "N: long existing source remains virtually assignable");
  if (longAssigned.ok) {
    const approved = { ...longAssigned.plan, status: "virtuallyApproved" as const };
    const dryRun = buildVirtualPlanDryRun({ plan: approved, scanResult: longResult, binding: longDraft.binding, current: true });
    assert(approved.items.some((entry) => entry.observed.relativePath === `${longName}.txt`), "N: long source remains visible in the virtual plan");
    assert(dryRun.status === "restricted", "N: long existing source stays virtually plannable");
    assert(dryRun.operations.some((operation) => operation.sourcePath === `${longName}.txt`), "N: long source is present in the dry-run");
  }

  const tooLongFolder = fillAsciiComponent(250);
  assert(isAllowedWindowsComponent(tooLongFolder), "O: editor still accepts a conservative-cap name");
  const tooLongDraft = draftPlan(result, [{ name: tooLongFolder }]);
  const tooLongFolderId = tooLongDraft.plan.virtualFolders?.[0]?.id;
  if (tooLongFolderId === undefined) throw new Error("too-long folder id exists");
  const renamed = renameVirtualPlanFolder(tooLongDraft.plan, tooLongFolderId, tooLongFolder);
  assert(renamed.ok || validateVirtualPlan(tooLongDraft.plan, result, tooLongDraft.binding).valid, "O: virtual name is not rejected only because the absolute target length is unknown");
  const tooLongApproved = { ...tooLongDraft.plan, status: "virtuallyApproved" as const };
  const tooLongDry = buildVirtualPlanDryRun({ plan: tooLongApproved, scanResult: result, binding: tooLongDraft.binding, current: true });
  const tooLongAbs = windowsTargetPath("C:\\Fixture", tooLongFolder);
  assert(utf16Length(tooLongAbs) === 10 + 1 + 250, "O: absolute target UTF-16 length is computed");
  assert(utf16Length(tooLongAbs) === 261 && !isAllowedAbsoluteTargetTotalLength(tooLongAbs), "O: 261-unit new target is too long");
  assert(tooLongDry.status === "blocked", "O: too-long new target is not executable");

  const unknownLimit = evaluatePreflight({
    operation: moveOp("Berichte/Rechnung.pdf"),
    facts: facts({ maximumComponentLength: null }),
    scanRoot: "C:\\Fixture",
    expectedSizeBytes: 1,
    expectedModifiedAtMs: 100,
    simulatedFolderTargets: [],
  });
  assert(unknownLimit.status === "blocked" && !unknownLimit.canConfirm, "P: unknown volume limit is not a real-operation grant");
  assert(unknownLimit.reason.includes("Dateisystem-Komponentengrenze"), "P: unknown volume limit is explained");

  const rLiteral = fixture.literals.find((row) => row.id === "R-unc-length-ok-not-execute-grant");
  if (rLiteral === undefined) throw new Error("R fixture literal is present");
  assert(rLiteral.grantsRealExecution === false, "R fixture metadata is not an execution grant");
  const unc = rLiteral.absolute;
  assert(utf16Length(unc) === rLiteral.expectedUtf16, "R utf16 length is computed against the fixture");
  assert(isAllowedAbsoluteWindowsPath(unc) === true, "R-A: UNC may satisfy name rules");
  assert(isAllowedAbsoluteTargetTotalLength(unc) === rLiteral.totalAllowed, "R-B: UNC may satisfy length rules");
  const uncLength = evaluateNewTargetPathLength(unc, ["Datei.txt"], {
    filesystemComponentLimit: CONSERVATIVE_COMPONENT_UTF16,
    requireKnownVolumeLimit: true,
  });
  assert(uncLength.ok === rLiteral.totalAllowed, "R-B: length helper follows totalAllowed");
  assert(!("status" in uncLength) && !("canConfirm" in uncLength), "R-B: length verdict is not a preflight grant");

  const uncOp = moveOp("Datei.txt");
  const uncConfirm = bindRealFileMoveConfirm(uncOp, "j-unc");
  const uncSubmit = (overrides: Partial<Parameters<typeof canSubmitRealFileMove>[0]> = {}) => canSubmitRealFileMove({
    approvedTestRoot: true,
    explicitConfirm: true,
    halt: false,
    snapshotCurrent: true,
    journalBoundToPlan: true,
    operation: uncOp,
    journalId: "j-unc",
    confirm: uncConfirm,
    decisionStatus: null,
    expectedSizeBytes: 1,
    expectedModifiedAtMs: 100,
    ...overrides,
  });
  assert(!isReadyForRealExecution(null), "R-C: a missing decision is not a real grant");
  assert(!isReadyForRealExecution("readySimulated"), "R-C: simulated ready is not a real grant");
  assert(!uncSubmit(), "R-C: length-ok UNC without a ready decision cannot submit");
  assert(!uncSubmit({ approvedTestRoot: false, decisionStatus: "ready" }), "R-C: UNC plus ready still requires test-root approval");
  assert(!uncSubmit({ explicitConfirm: false, decisionStatus: "ready" }), "R-C: UNC plus ready still requires Einzelbestätigung");

  const uncIncomplete = evaluatePreflight({
    operation: uncOp,
    facts: facts(),
    scanRoot: "\\\\server\\share\\Ordner",
    simulatedFolderTargets: [],
  });
  assert(uncIncomplete.status === "unverifiable" && uncIncomplete.canConfirm === false, "R: UNC length-ok without fingerprint is not confirmable");
  assert(!isReadyForRealExecution(uncIncomplete.status), "R-C: unverifiable UNC preflight is not a real grant");
  assert(!uncSubmit({ decisionStatus: uncIncomplete.status, expectedSizeBytes: undefined, expectedModifiedAtMs: undefined }), "R-C: incomplete UNC fingerprint cannot submit");

  const uncReserved = evaluatePreflight({
    operation: moveOp("CON.txt"),
    facts: facts(),
    scanRoot: "\\\\server\\share\\Ordner",
    expectedSizeBytes: 1,
    expectedModifiedAtMs: 100,
    simulatedFolderTargets: [],
  });
  assert(uncReserved.status === "blocked" && uncReserved.canConfirm === false, "R: UNC length-ok does not override FV2-02a");
  assert(!isReadyForRealExecution(uncReserved.status), "R-C: reserved UNC target is not a real grant");

  // Complete UNC facts may still evaluate to ready. That gap is FV2-02d, not asserted as blocked here.
  const uncComplete = evaluatePreflight({
    operation: uncOp,
    facts: facts(),
    scanRoot: "\\\\server\\share\\Ordner",
    expectedSizeBytes: 1,
    expectedModifiedAtMs: 100,
    simulatedFolderTargets: [],
  });
  assert(!uncSubmit({ explicitConfirm: false, decisionStatus: uncComplete.status }), "R-C: even a complete UNC preflight cannot submit without Einzelbestätigung");

  const reservedPreflight = evaluatePreflight({
    operation: moveOp("CON.txt"),
    facts: facts(),
    scanRoot: "C:\\Fixture",
    expectedSizeBytes: 1,
    expectedModifiedAtMs: 100,
    simulatedFolderTargets: [],
  });
  assert(reservedPreflight.status === "blocked" && !reservedPreflight.canConfirm, "FV2-02a reserved target remains blocked");

  const readyShort = evaluatePreflight({
    operation: moveOp("Berichte/Rechnung.pdf"),
    facts: facts(),
    scanRoot: "C:\\Fixture",
    expectedSizeBytes: 1,
    expectedModifiedAtMs: 100,
    simulatedFolderTargets: [],
  });
  assert(readyShort.status === "ready" && readyShort.canConfirm, "ordinary short target stays preflight-ready");

  const missingScanRoot = evaluatePreflight({
    operation: moveOp("Berichte/Rechnung.pdf"),
    facts: facts(),
    expectedSizeBytes: 1,
    expectedModifiedAtMs: 100,
    simulatedFolderTargets: [],
  });
  assert(missingScanRoot.status === "blocked" && !missingScanRoot.canConfirm, "missing scan root is not an execution grant");
}
