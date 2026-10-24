/** P2-L.4b.2: size/modified always captured; UI capture toggles removed. */
import {
  createDefaultScanConfig,
  withRequiredScanIdentityMetadata,
} from "../model";
import { DEFAULT_COLUMN_VISIBILITY, visibleColumns } from "./treeColumns";
import {
  defaultWorkbenchPrefs,
  prefsToScanConfig,
  sanitizeWorkbenchPrefs,
} from "./workbenchPrefs";
import type { VirtualDryRunOperation } from "./virtualPlanDryRun";
import type { VirtualPlan } from "./virtualPlan";
import {
  evaluatePreflight,
  expectedMetadata,
  missingRealMoveFingerprintReason,
  type PlannedOperationFacts,
} from "./virtualPlanPreflight";

function assert(value: boolean, label: string): void {
  if (!value) throw new Error(label);
}

function moveOp(): VirtualDryRunOperation {
  return {
    id: "op-file",
    kind: "moveFile",
    objectId: "n1",
    sourcePath: "rechnung_a.txt",
    targetPath: "Rechnung/rechnung_a.txt",
    expectedSource: "s",
    preconditions: [],
    expectedTarget: "t",
    collisionStatus: "mustCheckAtExecution",
    checkStatus: "mustCheckAtExecution",
    rationale: "r",
    recovery: "later",
  };
}

function planWithMeta(size?: number, modified?: number): VirtualPlan {
  return {
    schemaVersion: 1,
    planId: "p",
    builderVersion: 1,
    revision: 1,
    status: "virtuallyApproved",
    scope: { kind: "scanRoot", rootNodeId: "root" },
    binding: {
      sourceScanId: 1,
      normalizedRootPath: "c:/dotty-test",
      scanConfig: {
        maxDepth: 8,
        excludeHidden: true,
        extensions: [],
        includeSize: true,
        includeCreatedAt: false,
        includeModifiedAt: true,
      },
      snapshotFingerprint: "vp1",
      incomplete: false,
    },
    items: [
      {
        id: "item-1",
        observed: {
          nodeId: "n1",
          relativePath: "rechnung_a.txt",
          kind: "file",
          identityStatus: "scanLocalOnly",
          metadata: { sizeBytes: size, modifiedAtMs: modified },
        },
        virtualTargetPath: "Rechnung",
        status: "virtuallyApproved",
        sourceInsightIds: [],
        alternatives: [],
      },
    ],
    openCases: [],
    decisions: [],
    preferences: [],
    virtualFolders: [],
  };
}

export function runScanIdentityMetadataCheck(): void {
  // C: legacy false prefs cannot disable required identity metadata
  const legacy = sanitizeWorkbenchPrefs({
    includeSize: false,
    includeModifiedAt: false,
    includeCreatedAt: false,
  });
  assert(legacy.includeSize === true && legacy.includeModifiedAt === true, "C: sanitize forces identity flags on");
  const fromPrefs = prefsToScanConfig(legacy);
  assert(fromPrefs.includeSize === true && fromPrefs.includeModifiedAt === true, "C: prefsToScanConfig forces capture flags");
  assert(
    withRequiredScanIdentityMetadata({
      ...createDefaultScanConfig(),
      includeSize: false,
      includeModifiedAt: false,
    }).includeSize === true,
    "C: withRequiredScanIdentityMetadata forces size",
  );

  // D: planning expectedMetadata reads captured values unchanged
  const planned = planWithMeta(42, 1000);
  const meta = expectedMetadata(planned, moveOp());
  assert(meta.expectedSizeBytes === 42 && meta.expectedModifiedAtMs === 1000, "D: plan keeps scan metadata");
  assert(missingRealMoveFingerprintReason(planned, [moveOp()]) === null, "D: complete fingerprint allows reservation gate");

  // E: missing metadata still blocks real operations
  const incomplete = planWithMeta(undefined, undefined);
  const gap = missingRealMoveFingerprintReason(incomplete, [moveOp()]);
  assert(gap !== null && gap.includes("Dateigröße") && gap.includes("Änderungszeit"), "E: reservation gap names both fields");
  const facts: PlannedOperationFacts = {
    kind: "moveFile",
    bindingStatus: "reserved",
    bindingMessage: "",
    source: {
      exists: true,
      isFile: true,
      isDir: false,
      isReparse: false,
      readable: true,
      withinRoot: true,
      sizeBytes: 42,
      modifiedAtMs: 1000,
    },
    target: {
      exists: false,
      isFile: false,
      isDir: false,
      isReparse: false,
      readable: true,
      withinRoot: true,
      sizeBytes: null,
      modifiedAtMs: null,
    },
    targetParentExists: true,
    targetParentIsDir: true,
    targetParentIsReparse: false,
    reminder: "erneut",
  };
  const blocked = evaluatePreflight({
    operation: moveOp(),
    facts,
    simulatedFolderTargets: [],
  });
  assert(blocked.status === "unverifiable" && !blocked.canConfirm, "E: live facts do not invent plan fingerprint");

  // G: default structure list does not show size/modified columns
  assert(visibleColumns(DEFAULT_COLUMN_VISIBILITY).join(",") === "name", "G: default columns are name only");
  assert(defaultWorkbenchPrefs().columnVisibility.size === false, "G: prefs default size column off");
  assert(defaultWorkbenchPrefs().columnVisibility.modified === false, "G: prefs default modified column off");

  // H: outside-root / test-scope style preflight still fails closed
  const outside = evaluatePreflight({
    operation: moveOp(),
    facts: {
      ...facts,
      source: { ...facts.source, withinRoot: false },
    },
    expectedSizeBytes: 42,
    expectedModifiedAtMs: 1000,
    simulatedFolderTargets: [],
  });
  assert(outside.status === "blocked" && outside.reason.includes("außerhalb"), "H: outside scan root still blocked");
}

export function assertScanIdentitySourceGuards(configPanel: string): void {
  assert(!configPanel.includes("<span>Dateigröße</span>"), "F: size checkbox label removed");
  assert(!configPanel.includes("<span>Änderungsdatum</span>"), "F: modified checkbox label removed");
  assert(configPanel.includes("<span>Erstellungsdatum</span>"), "F: created checkbox remains");
  assert(configPanel.includes("Dateigröße und Änderungsdatum werden bei jedem Scan erfasst"), "F: capture notice present");
}
