/** P2-L.12a: read-only batch analysis. Reuses inspect, date, naming, and folder planners. */
import { isDirectory, isFile, type DirectoryNode, type FsNode } from "../model";
import {
  BATCH_PAGE_RANGE_UNSUPPORTED,
  createDocumentId,
  createLogicalDocument,
  documentSourceIsSupported,
  fingerprintChanged,
  isSupportedBatchFileName,
  normalizeBatchPathKey,
  physicalFileRefFromNode,
  type LogicalDocument,
} from "./batchDocument";
import { emptyLearnedSenderStore, type LearnedSenderStore } from "./learnedSenders";
import {
  hasLocalAiNameFields,
  nameSuggestSourceLabel,
  planAiNameSuggestion,
  type LocalAiNameFields,
} from "./localAi";
import {
  NAMING_PLACEHOLDER_LABELS,
  planNameSuggestion,
  type NamingRule,
  type NameSuggestOutcome,
} from "./namingRules";
import {
  FOLDER_SUGGEST_ALREADY_HERE,
  FOLDER_SUGGEST_YEAR_UNKNOWN,
  planFolderSuggestions,
  type FolderSuggestOutcome,
} from "./treeWorkbenchFolderSuggest";
import {
  uniqueDocumentDateChoices,
  type DocumentDateHit,
  type DocumentTextView,
} from "./treeWorkbenchNameSuggest";

export type BatchTechnicalStatus =
  | "waiting"
  | "analyzing"
  | "done"
  | "failed"
  | "cancelled"
  | "skipped";

export type BatchOutcomeKind =
  | "completeProposal"
  | "needsDecision"
  | "noProposal"
  | "alreadyFitting"
  | "failed"
  | "skipped"
  | "cancelled";

export type BatchDecisionKind =
  | "confirmDate"
  | "chooseDate"
  | "addSender"
  | "correctFileName"
  | "chooseFolder"
  | "unsupportedSource";

export interface BatchDecision {
  kind: BatchDecisionKind;
  message: string;
}

export interface BatchSkip {
  name: string;
  path: string;
  reason: string;
}

export interface BatchCapture {
  runId: number;
  documents: LogicalDocument[];
  skipped: BatchSkip[];
}

export interface BatchDocumentResult {
  runId: number;
  document: LogicalDocument;
  technicalStatus: BatchTechnicalStatus;
  outcomeKind: BatchOutcomeKind;
  originalName: string;
  proposedFileName: string | null;
  namingSource: string | null;
  namingRuleName: string | null;
  missingNameFields: string[];
  alreadyNamed: boolean;
  folderPath: string | null;
  folderName: string | null;
  newFolder: boolean;
  alreadyPlaced: boolean;
  documentType: string | null;
  sender: string | null;
  subject: string | null;
  documentDate: string | null;
  documentDateStatus: "confident" | "ask" | "unknown";
  dateCandidates: DocumentDateHit[];
  textSource: string | null;
  ocrAttempted: boolean;
  usedLocalAi: boolean;
  decisions: BatchDecision[];
  reasons: string[];
  error: string | null;
}

export interface BatchProgress {
  runId: number;
  total: number;
  processed: number;
  currentName: string | null;
  step: string;
  cancelling: boolean;
}

export interface BatchSummary {
  selected: number;
  completeProposal: number;
  needsDecision: number;
  noProposal: number;
  alreadyFitting: number;
  failed: number;
  skipped: number;
  cancelled: number;
}

export const BATCH_STEP_READ = "Dokumentinhalt wird gelesen …";
export const BATCH_STEP_DATE = "Dokumentdatum wird erkannt …";
export const BATCH_STEP_NAME = "Namensvorschlag wird ermittelt …";
export const BATCH_STEP_FOLDER = "Ordnerzuordnung wird ermittelt …";
export const BATCH_STEP_CANCELLING = "Abbruch angefordert …";
export const BATCH_PROGRESS_TITLE = "Stapelanalyse läuft";
export const BATCH_CANCEL_LABEL = "Analyse abbrechen";
export const BATCH_ACTION_LABEL = "Ausgewählte Dokumente analysieren";
export const BATCH_CANCELLED_HINT = "Stapelanalyse durch Anwender abgebrochen.";
export const BATCH_NOT_ANALYZED_LABEL = "Nicht analysiert";

export function captureBatchSelection(runId: number, nodes: readonly FsNode[]): BatchCapture {
  const documents: LogicalDocument[] = [];
  const skipped: BatchSkip[] = [];
  const seen = new Set<string>();
  let index = 0;
  for (const node of nodes) {
    if (isDirectory(node)) {
      skipped.push({
        name: node.name,
        path: node.path,
        reason: "Ordner werden in diesem Schritt nicht analysiert.",
      });
      continue;
    }
    const key = normalizeBatchPathKey(node.path);
    if (seen.has(key)) {
      skipped.push({
        name: node.name,
        path: node.path,
        reason: "Dieselbe Datei war bereits in der Auswahl.",
      });
      continue;
    }
    if (!isSupportedBatchFileName(node.name)) {
      skipped.push({
        name: node.name,
        path: node.path,
        reason: "Dieser Dateityp wird für die Stapelanalyse nicht unterstützt.",
      });
      continue;
    }
    seen.add(key);
    documents.push(
      createLogicalDocument({
        documentId: createDocumentId(runId, index),
        sourceKind: "wholeFile",
        file: physicalFileRefFromNode(node),
      }),
    );
    index += 1;
  }
  return { runId, documents, skipped };
}

export function waitingResult(runId: number, document: LogicalDocument): BatchDocumentResult {
  return emptyResult(runId, document, "waiting", "cancelled", null);
}

export function cancelledWaitingResult(runId: number, document: LogicalDocument): BatchDocumentResult {
  return {
    ...emptyResult(runId, document, "cancelled", "cancelled", BATCH_CANCELLED_HINT),
    reasons: [BATCH_CANCELLED_HINT],
  };
}

export function batchResultHintExtras(item: BatchDocumentResult): string {
  const seen = new Set<string>();
  if (item.error !== null && item.error.length > 0) {
    seen.add(item.error);
  }
  const extras: string[] = [];
  const parts =
    item.decisions.length > 0
      ? item.decisions.map((decision) => decision.message)
      : item.reasons;
  for (const part of parts) {
    if (part.length === 0 || seen.has(part)) {
      continue;
    }
    seen.add(part);
    extras.push(part);
  }
  return extras.join(" ");
}

export function skippedUnsupportedSource(runId: number, document: LogicalDocument): BatchDocumentResult {
  return {
    ...emptyResult(runId, document, "skipped", "skipped", BATCH_PAGE_RANGE_UNSUPPORTED),
    decisions: [{ kind: "unsupportedSource", message: BATCH_PAGE_RANGE_UNSUPPORTED }],
    reasons: [BATCH_PAGE_RANGE_UNSUPPORTED],
  };
}

export interface BatchAnalyzeInput {
  runId: number;
  document: LogicalDocument;
  currentNode: FsNode | null;
  view: DocumentTextView | null;
  inspectError: string | null;
  scanRoot: string;
  root: DirectoryNode;
  rules: readonly NamingRule[];
  learned: LearnedSenderStore;
  aiFields: LocalAiNameFields | null;
  usedLocalAi: boolean;
}

export function analyzePreparedDocument(input: BatchAnalyzeInput): BatchDocumentResult {
  const { document, runId } = input;
  if (!documentSourceIsSupported(document.sourceKind) || document.pageRange !== null) {
    return skippedUnsupportedSource(runId, document);
  }
  if (input.currentNode === null) {
    return {
      ...emptyResult(runId, document, "failed", "failed", "Die Datei ist nicht mehr vorhanden."),
      reasons: ["Die Datei ist nicht mehr vorhanden."],
    };
  }
  if (!isFile(input.currentNode)) {
    return {
      ...emptyResult(runId, document, "skipped", "skipped", "Ordner werden in diesem Schritt nicht analysiert."),
      reasons: ["Ordner werden in diesem Schritt nicht analysiert."],
    };
  }
  if (fingerprintChanged(document.file, input.currentNode)) {
    return {
      ...emptyResult(
        runId,
        document,
        "failed",
        "failed",
        "Die Datei wurde zwischenzeitlich verändert. Ein älterer Cache-Stand wird nicht verwendet.",
      ),
      reasons: ["Die Datei wurde zwischenzeitlich verändert."],
    };
  }
  if (input.view === null) {
    const message = input.inspectError ?? "Der Dokumentinhalt konnte nicht gelesen werden.";
    return {
      ...emptyResult(runId, document, "failed", "failed", message),
      reasons: [message],
    };
  }

  const namePlan = planDocumentName(document.file.name, input.view, input.rules, input.aiFields);
  const folderPlan = planFolderSuggestions({
    scanRoot: input.scanRoot,
    root: input.root,
    source: input.currentNode,
    view: input.view,
    learnedStore: input.learned ?? emptyLearnedSenderStore(),
    confirmedIso: null,
  });
  return assembleResult({
    runId,
    document,
    view: input.view,
    namePlan,
    folderPlan,
    usedLocalAi: input.usedLocalAi && namePlan.source === "ai",
  });
}

export function planDocumentName(
  fileName: string,
  view: DocumentTextView,
  rules: readonly NamingRule[],
  aiFields: LocalAiNameFields | null,
): NameSuggestOutcome {
  const base = planNameSuggestion(fileName, view, rules);
  if (base.source === "rule") {
    return base;
  }
  if (aiFields !== null && hasLocalAiNameFields(aiFields)) {
    return planAiNameSuggestion(fileName, view, aiFields);
  }
  return base;
}

export function sameFileName(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

export function summarizeBatchResults(
  documents: readonly LogicalDocument[],
  results: readonly BatchDocumentResult[],
  skipped: readonly BatchSkip[],
): BatchSummary {
  const counts: BatchSummary = {
    selected: documents.length,
    completeProposal: 0,
    needsDecision: 0,
    noProposal: 0,
    alreadyFitting: 0,
    failed: 0,
    skipped: skipped.length,
    cancelled: 0,
  };
  for (const result of results) {
    if (result.outcomeKind === "completeProposal") counts.completeProposal += 1;
    else if (result.outcomeKind === "needsDecision") counts.needsDecision += 1;
    else if (result.outcomeKind === "noProposal") counts.noProposal += 1;
    else if (result.outcomeKind === "alreadyFitting") counts.alreadyFitting += 1;
    else if (result.outcomeKind === "failed") counts.failed += 1;
    else if (result.outcomeKind === "skipped") counts.skipped += 1;
    else if (result.outcomeKind === "cancelled") counts.cancelled += 1;
  }
  return counts;
}

export function batchFileOutcomeTotal(summary: BatchSummary): number {
  return (
    summary.completeProposal +
    summary.needsDecision +
    summary.noProposal +
    summary.alreadyFitting +
    summary.failed +
    summary.cancelled +
    Math.max(0, summary.skipped)
  );
}

export function completeBatchResults(
  runId: number,
  documents: readonly LogicalDocument[],
  results: readonly BatchDocumentResult[],
): BatchDocumentResult[] {
  const byId = new Map<string, BatchDocumentResult>();
  for (const item of results) {
    if (item.runId !== runId) {
      continue;
    }
    if (item.technicalStatus === "waiting") {
      continue;
    }
    byId.set(item.document.documentId, item);
  }
  return documents.map((document) => byId.get(document.documentId) ?? cancelledWaitingResult(runId, document));
}

export function markUnprocessedCancelled(
  runId: number,
  documents: readonly LogicalDocument[],
  results: readonly BatchDocumentResult[],
): BatchDocumentResult[] {
  return completeBatchResults(runId, documents, results);
}

export function batchAnalysisOverview(
  runId: number,
  documents: readonly LogicalDocument[],
  results: readonly BatchDocumentResult[],
  skipped: readonly BatchSkip[],
): { rows: BatchDocumentResult[]; summary: BatchSummary } {
  const rows = completeBatchResults(runId, documents, results);
  return { rows, summary: summarizeBatchResults(documents, rows, skipped) };
}

export function belongsToRun(currentRunId: number, resultRunId: number): boolean {
  return currentRunId === resultRunId;
}

export function batchProgressLine(progress: BatchProgress): string {
  if (progress.total === 0) {
    return "Keine Dokumente";
  }
  return `Dokument ${Math.min(progress.processed + (progress.currentName === null ? 0 : 1), progress.total)} von ${progress.total}`;
}

export function batchProcessedCountLine(progress: BatchProgress): string {
  return `${progress.processed} / ${progress.total}`;
}

function assembleResult(options: {
  runId: number;
  document: LogicalDocument;
  view: DocumentTextView;
  namePlan: NameSuggestOutcome;
  folderPlan: FolderSuggestOutcome;
  usedLocalAi: boolean;
}): BatchDocumentResult {
  const { document, namePlan, folderPlan, view } = options;
  const decisions: BatchDecision[] = [];
  const reasons: string[] = [];
  const originalName = document.file.name;
  const proposedFileName = namePlan.suggestedName;
  const alreadyNamed = proposedFileName !== null && sameFileName(proposedFileName, originalName);
  const missingNameFields = namePlan.missing.map((item) => NAMING_PLACEHOLDER_LABELS[item] ?? item);

  if (namePlan.resolution.status === "ask") {
    const unique = uniqueDocumentDateChoices(namePlan.resolution.hits);
    const dateReason = namePlan.resolution.reason;
    decisions.push({
      kind: unique.length > 1 ? "chooseDate" : "confirmDate",
      message: dateReason,
    });
    reasons.push(dateReason);
  }
  if (namePlan.missing.includes("absender")) {
    decisions.push({ kind: "addSender", message: "Absender ist unbekannt und muss ergänzt werden." });
  }
  if (namePlan.missing.some((item) => item !== "datum" && item !== "absender") || namePlan.unknownPlaceholders.length > 0) {
    decisions.push({
      kind: "correctFileName",
      message: "Für den Dateinamen fehlen Angaben oder die Benennungsregel ist unvollständig.",
    });
  }
  if (proposedFileName === null && !namePlan.missing.includes("datum")) {
    reasons.push("Es liegt kein geeigneter Dateinamensvorschlag vor.");
  }
  if (namePlan.source === "rule" && namePlan.rule !== null) {
    reasons.push(`Benennungsregel: ${namePlan.rule.name}`);
  }

  let folderPath: string | null = null;
  let folderName: string | null = null;
  let newFolder = false;
  let alreadyPlaced = false;
  if (folderPlan.status === "alreadyHere") {
    alreadyPlaced = true;
    folderPath = folderPlan.suggestions[0]?.path ?? null;
    folderName = folderPlan.suggestions[0]?.name ?? null;
    reasons.push(FOLDER_SUGGEST_ALREADY_HERE);
  } else if (folderPlan.status === "suggestions") {
    if (folderPlan.suggestions.length > 1) {
      decisions.push({
        kind: "chooseFolder",
        message: "Mehrere Zielordner kommen in Frage. Bitte einen konkreten Ordner wählen.",
      });
      reasons.push("Mehrere Zielordner kommen in Frage.");
    } else {
      folderPath = folderPlan.suggestions[0]?.path ?? null;
      folderName = folderPlan.suggestions[0]?.name ?? null;
      const summary = folderPlan.suggestions[0]?.summary;
      if (summary) {
        reasons.push(summary);
      }
    }
  } else if (folderPlan.status === "newFolder") {
    newFolder = true;
    folderPath = folderPlan.newFolder.path;
    folderName = folderPlan.newFolder.folderName;
    reasons.push(...folderPlan.newFolder.reasons);
  } else if (folderPlan.status === "yearUnknown") {
    decisions.push({ kind: "confirmDate", message: FOLDER_SUGGEST_YEAR_UNKNOWN });
    reasons.push(FOLDER_SUGGEST_YEAR_UNKNOWN);
  } else {
    reasons.push(folderPlan.reason);
  }

  const documentDate =
    namePlan.resolution.status === "confident"
      ? namePlan.resolution.iso
      : uniqueDocumentDateChoices(namePlan.resolution.hits).length === 1
        ? uniqueDocumentDateChoices(namePlan.resolution.hits)[0]!.iso
        : null;
  const documentDateStatus: BatchDocumentResult["documentDateStatus"] =
    namePlan.resolution.status === "confident"
      ? "confident"
      : namePlan.resolution.hits.length > 0
        ? "ask"
        : "unknown";

  let outcomeKind: BatchOutcomeKind;
  if (decisions.length > 0) {
    outcomeKind = "needsDecision";
  } else if (alreadyNamed && alreadyPlaced) {
    outcomeKind = "alreadyFitting";
  } else if (proposedFileName === null && folderPath === null) {
    outcomeKind = "noProposal";
  } else if (proposedFileName === null && !alreadyPlaced && folderPath === null) {
    outcomeKind = "noProposal";
  } else if (proposedFileName !== null || folderPath !== null) {
    outcomeKind = alreadyNamed && alreadyPlaced ? "alreadyFitting" : "completeProposal";
  } else {
    outcomeKind = "noProposal";
  }

  return {
    runId: options.runId,
    document,
    technicalStatus: "done",
    outcomeKind,
    originalName,
    proposedFileName,
    namingSource: nameSuggestSourceLabel(namePlan),
    namingRuleName: namePlan.rule?.name ?? null,
    missingNameFields,
    alreadyNamed,
    folderPath,
    folderName,
    newFolder,
    alreadyPlaced,
    documentType: namePlan.values.dokumenttyp ?? folderPlan.cues.dokumenttyp,
    sender: namePlan.values.absender ?? folderPlan.cues.absender,
    subject: namePlan.values.betreff ?? folderPlan.cues.betreff,
    documentDate,
    documentDateStatus,
    dateCandidates: uniqueDocumentDateChoices(namePlan.resolution.hits),
    textSource: view.source,
    ocrAttempted: view.ocrAttempted === true || view.source === "ocr",
    usedLocalAi: options.usedLocalAi,
    decisions,
    reasons,
    error: null,
  };
}

function emptyResult(
  runId: number,
  document: LogicalDocument,
  technicalStatus: BatchTechnicalStatus,
  outcomeKind: BatchOutcomeKind,
  error: string | null,
): BatchDocumentResult {
  return {
    runId,
    document,
    technicalStatus,
    outcomeKind,
    originalName: document.file.name,
    proposedFileName: null,
    namingSource: null,
    namingRuleName: null,
    missingNameFields: [],
    alreadyNamed: false,
    folderPath: null,
    folderName: null,
    newFolder: false,
    alreadyPlaced: false,
    documentType: null,
    sender: null,
    subject: null,
    documentDate: null,
    documentDateStatus: "unknown",
    dateCandidates: [],
    textSource: null,
    ocrAttempted: false,
    usedLocalAi: false,
    decisions: [],
    reasons: error === null ? [] : [error],
    error,
  };
}

export function outcomeKindLabel(kind: BatchOutcomeKind): string {
  switch (kind) {
    case "completeProposal":
      return "Vorschlag vollständig";
    case "needsDecision":
      return "Rückfrage erforderlich";
    case "noProposal":
      return "Kein geeigneter Vorschlag";
    case "alreadyFitting":
      return "Bereits passend benannt/abgelegt";
    case "failed":
      return "Fehlgeschlagen";
    case "skipped":
      return "Übersprungen";
    case "cancelled":
      return BATCH_NOT_ANALYZED_LABEL;
  }
}

export function technicalStatusLabel(status: BatchTechnicalStatus): string {
  switch (status) {
    case "waiting":
      return "wartend";
    case "analyzing":
      return "wird analysiert";
    case "done":
      return "abgeschlossen";
    case "failed":
      return "fehlgeschlagen";
    case "cancelled":
      return BATCH_NOT_ANALYZED_LABEL;
    case "skipped":
      return "übersprungen";
  }
}
