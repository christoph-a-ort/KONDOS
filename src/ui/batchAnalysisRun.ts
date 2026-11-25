/** P2-L.12a: sequential read-only batch runner. One inspect and one optional KI call per document. */
import { isFile, type DirectoryNode, type FsNode } from "../model";
import {
  analyzePreparedDocument,
  BATCH_STEP_CANCELLING,
  BATCH_STEP_DATE,
  BATCH_STEP_FOLDER,
  BATCH_STEP_NAME,
  BATCH_STEP_READ,
  belongsToRun,
  cancelledWaitingResult,
  completeBatchResults,
  type BatchDocumentResult,
  type BatchProgress,
  type BatchSkip,
} from "./batchAnalysis";
import { documentSourceIsSupported, type LogicalDocument } from "./batchDocument";
import { emptyLearnedSenderStore, type LearnedSenderStore } from "./learnedSenders";
import {
  hasLocalAiNameFields,
  requestLocalAiNameFields,
  shouldUseLocalAiFallback,
  type LocalAiClient,
  type LocalAiNameFields,
  type LocalAiPrefs,
} from "./localAi";
import { firstMatchingRule, type NamingRule } from "./namingRules";
import type { DocumentTextView } from "./treeWorkbenchNameSuggest";

export interface BatchRunDeps {
  inspect: (nodeId: string) => Promise<DocumentTextView>;
  findNode: (nodeId: string) => FsNode | undefined;
  rules: readonly NamingRule[];
  learned: LearnedSenderStore;
  aiPrefs: LocalAiPrefs | null;
  aiClient: LocalAiClient | null;
}

export interface BatchRunOptions {
  runId: number;
  documents: readonly LogicalDocument[];
  skipped: readonly BatchSkip[];
  scanRoot: string;
  root: DirectoryNode;
  deps: BatchRunDeps;
  shouldStop: () => boolean;
  isCurrentRun: (runId: number) => boolean;
  onProgress: (progress: BatchProgress) => void;
}

export async function runBatchAnalysis(options: BatchRunOptions): Promise<BatchDocumentResult[]> {
  const results: BatchDocumentResult[] = [];
  const total = options.documents.length;
  for (let index = 0; index < options.documents.length; index += 1) {
    if (!options.isCurrentRun(options.runId)) {
      return [];
    }
    if (options.shouldStop()) {
      options.onProgress({
        runId: options.runId,
        total,
        processed: results.length,
        currentName: null,
        step: BATCH_STEP_CANCELLING,
        cancelling: true,
      });
      return completeBatchResults(options.runId, options.documents, results);
    }
    const document = options.documents[index]!;
    options.onProgress({
      runId: options.runId,
      total,
      processed: index,
      currentName: document.file.name,
      step: BATCH_STEP_READ,
      cancelling: false,
    });
    const result = await analyzeOne(options, document);
    if (!options.isCurrentRun(options.runId)) {
      return [];
    }
    results.push(result);
    options.onProgress({
      runId: options.runId,
      total,
      processed: results.length,
      currentName: document.file.name,
      step: result.technicalStatus === "done" ? BATCH_STEP_FOLDER : result.error ?? "",
      cancelling: options.shouldStop(),
    });
    if (options.shouldStop()) {
      return completeBatchResults(options.runId, options.documents, results);
    }
  }
  return completeBatchResults(options.runId, options.documents, results);
}

async function analyzeOne(options: BatchRunOptions, document: LogicalDocument): Promise<BatchDocumentResult> {
  if (!documentSourceIsSupported(document.sourceKind) || document.pageRange !== null) {
    return analyzePreparedDocument({
      runId: options.runId,
      document,
      currentNode: options.deps.findNode(document.file.nodeId) ?? null,
      view: null,
      inspectError: null,
      scanRoot: options.scanRoot,
      root: options.root,
      rules: options.deps.rules,
      learned: options.deps.learned,
      aiFields: null,
      usedLocalAi: false,
    });
  }
  const currentNode = options.deps.findNode(document.file.nodeId) ?? null;
  if (currentNode === null || !isFile(currentNode)) {
    return analyzePreparedDocument({
      runId: options.runId,
      document,
      currentNode,
      view: null,
      inspectError: currentNode === null ? "Die Datei ist nicht mehr vorhanden." : "Ordner werden in diesem Schritt nicht analysiert.",
      scanRoot: options.scanRoot,
      root: options.root,
      rules: options.deps.rules,
      learned: options.deps.learned,
      aiFields: null,
      usedLocalAi: false,
    });
  }
  let view: DocumentTextView | null = null;
  let inspectError: string | null = null;
  try {
    view = await options.deps.inspect(currentNode.id);
  } catch (cause) {
    inspectError = cause instanceof Error ? cause.message : "Der Dokumentinhalt konnte nicht gelesen werden.";
  }
  if (options.shouldStop() && view === null) {
    return cancelledWaitingResult(options.runId, document);
  }
  let aiFields: LocalAiNameFields | null = null;
  let usedLocalAi = false;
  if (view !== null && options.deps.aiPrefs !== null && options.deps.aiClient !== null) {
    if (shouldUseLocalAiFallback(options.deps.rules, view, options.deps.aiPrefs) && firstMatchingRule(options.deps.rules, view) === null) {
      options.onProgress({
        runId: options.runId,
        total: options.documents.length,
        processed: options.documents.indexOf(document),
        currentName: document.file.name,
        step: BATCH_STEP_NAME,
        cancelling: options.shouldStop(),
      });
      try {
        const ai = await requestLocalAiNameFields(
          options.deps.aiClient,
          options.deps.aiPrefs,
          document.file.name,
          view,
          options.deps.rules,
        );
        if (ai.fields !== null && hasLocalAiNameFields(ai.fields)) {
          aiFields = ai.fields;
          usedLocalAi = ai.used;
        }
      } catch {
        usedLocalAi = false;
      }
    }
  }
  if (view !== null) {
    options.onProgress({
      runId: options.runId,
      total: options.documents.length,
      processed: options.documents.indexOf(document),
      currentName: document.file.name,
      step: BATCH_STEP_DATE,
      cancelling: options.shouldStop(),
    });
    options.onProgress({
      runId: options.runId,
      total: options.documents.length,
      processed: options.documents.indexOf(document),
      currentName: document.file.name,
      step: BATCH_STEP_FOLDER,
      cancelling: options.shouldStop(),
    });
  }
  return analyzePreparedDocument({
    runId: options.runId,
    document,
    currentNode,
    view,
    inspectError,
    scanRoot: options.scanRoot,
    root: options.root,
    rules: options.deps.rules,
    learned: options.deps.learned ?? emptyLearnedSenderStore(),
    aiFields,
    usedLocalAi,
  });
}

export function keepRunResults(
  currentRunId: number,
  results: readonly BatchDocumentResult[],
): BatchDocumentResult[] {
  return results.filter((item) => belongsToRun(currentRunId, item.runId));
}
