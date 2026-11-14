import { invoke } from "@tauri-apps/api/core";

import type { DocumentTextView } from "./treeWorkbenchNameSuggest";

export function inspectDocumentText(scanId: number, nodeId: string): Promise<DocumentTextView> {
  return invoke<DocumentTextView>("inspect_document_text", { scanId, nodeId });
}
