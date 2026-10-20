import { invoke } from "@tauri-apps/api/core";

export interface TestRootApprovalView {
  approved: boolean;
  scanRoot: string;
  message: string;
}

export interface CreateFolderResult {
  outcome: "created" | "blocked" | "failed" | "unverified";
  targetPath: string;
  message: string;
  created: boolean;
  halted: boolean;
  bindingStatus: string;
  journalJson: string | null;
  reminder: string;
}

export function inspectTestScanRoot(scanRoot: string): Promise<TestRootApprovalView> {
  return invoke<TestRootApprovalView>("inspect_test_scan_root", { scanRoot });
}

export function approveTestScanRoot(scanRoot: string, explicitConfirm: boolean): Promise<TestRootApprovalView> {
  return invoke<TestRootApprovalView>("approve_test_scan_root", { scanRoot, explicitConfirm });
}

export function executeCreateFolder(options: {
  scanRoot: string;
  ownerRunId: string;
  journalId: string;
  expectedRevision: number;
  operationId: string;
  confirmedKind: "createFolder";
  confirmedTargetPath: string;
  explicitConfirm: boolean;
}): Promise<CreateFolderResult> {
  return invoke<CreateFolderResult>("execute_create_folder", options);
}
