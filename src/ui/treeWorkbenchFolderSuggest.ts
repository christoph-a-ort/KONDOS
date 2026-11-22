/** P2-L.11a–11c: rule-based target-folder suggestions. No extra KI, no MOVE, no folder creation. */
import { isDirectory, isFile, type DirectoryNode, type FsNode } from "../model";
import {
  applyLearnedSender,
  emptyLearnedSenderStore,
  type LearnedSenderStore,
} from "./learnedSenders";
import { enrichLocalAiFields, resolveDocumentType, type LocalAiNameFields } from "./localAi";
import { stemFromFilename } from "./inventoryFileNameSyntax";
import { joinScanPath, parentDirectoryPath, sameDirectoryPath } from "./treeWorkbenchMove";
import {
  canSuggestWorkbenchFileName,
  foldDocumentLabel,
  parseUserDocumentDate,
  resolveDocumentDateFromView,
  sanitizeSuggestedFileNamePart,
  stripLeadingDatePrefix,
  type DocumentDateResolution,
  type DocumentTextView,
} from "./treeWorkbenchNameSuggest";
import { isAllowedWindowsComponent } from "./windowsPathRules";

export const FOLDER_SUGGEST_UNCLEAR = "Kein eindeutiger Zielordner";
export const FOLDER_SUGGEST_NO_MOVE = "In dieser Stufe wird die Datei nicht verschoben.";
export const FOLDER_SUGGEST_ALREADY_HERE =
  "Datei liegt bereits im passenden Ordner. Keine Verschiebung erforderlich.";
export const FOLDER_SUGGEST_NEW = "Neuen Ordner vorschlagen";
export const FOLDER_SUGGEST_NEW_UNCLEAR = "Kein eindeutiger Vorschlag für einen neuen Ordner.";
export const FOLDER_SUGGEST_YEAR_UNKNOWN = "Jahresablage erkannt. Dokumentjahr nicht sicher bestimmt.";
export const FOLDER_SUGGEST_DATE_HINT = "Bitte das Dokumentdatum bestätigen oder korrigieren.";
export const FOLDER_SUGGEST_NO_CREATE = "In dieser Stufe wird der Ordner nicht angelegt.";
export const FOLDER_SUGGEST_MAX = 3;

const EMPTY_FIELDS: LocalAiNameFields = {
  dokumenttyp: null,
  absender: null,
  betreff: null,
  thema: null,
};

const MIN_SCORE = 40;
const SCORE_TYPE_FOLDER = 58;
const SCORE_TYPE_PARENT = 22;
const SCORE_SENDER_FOLDER = 42;
const SCORE_SENDER_PARENT = 20;
const SCORE_BETREFF_FOLDER = 16;
const SCORE_SIBLING = 12;
const SCORE_SIBLING_CAP = 30;
const SCORE_YEAR_MATCH = 40;
const SCORE_PATTERN = 16;

const LEGAL_FORM_ACRONYMS = new Set(["ag", "gmbh", "ug", "se", "kg", "ohg", "ev", "gbr", "ltd", "inc", "co", "mbh"]);

const PLACEMENT_STOP = new Set([
  "der",
  "die",
  "das",
  "und",
  "oder",
  "ein",
  "eine",
  "mit",
  "von",
  "vom",
  "fuer",
  "fur",
  "the",
  "pdf",
  "docx",
  "xlsx",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "scan",
  "scans",
  "foto",
  "fotos",
  "bild",
  "bilder",
  "image",
  "images",
  "img",
  "notiz",
  "notizen",
  "urlaub",
  "datei",
  "dateien",
  "file",
  "files",
  "dokument",
  "dokumente",
  "documents",
  "docs",
  "ablage",
  "archiv",
  "ordner",
  "folder",
  "inbox",
  "eingang",
  "download",
  "downloads",
  "tmp",
  "temp",
  "misc",
  "sonstiges",
  "allgemein",
  "neu",
  "new",
  "kopie",
  "copy",
  "seite",
  "page",
  "anlage",
  "zum",
  "zur",
  "beim",
  "sich",
  "ist",
  "sind",
  "wird",
  "werden",
  "eine",
  "einem",
  "einen",
  "einer",
]);

export interface FolderSuggestCue {
  dokumenttyp: string | null;
  absender: string | null;
  betreff: string | null;
  documentYear: string | null;
  documentDateStatus: "confident" | "confirmed" | "ask" | "none";
  dateResolution: DocumentDateResolution | null;
  confirmedIso: string | null;
  learnedAbsender: boolean;
  tokens: string[];
}

export interface FolderCandidate {
  id: string;
  name: string;
  path: string;
  parentNames: string[];
  relativeNames: string[];
  fileNames: string[];
  childFolderNames: string[];
  siblingFolderNames: string[];
  isScanRoot: boolean;
}

export interface FolderSuggestion {
  path: string;
  name: string;
  score: number;
  alreadyHere: boolean;
  summary: string;
  reasons: string[];
}

export type NewFolderPattern = "year" | "vendor" | "documentType";

export interface NewFolderProposal {
  parentPath: string;
  parentName: string;
  folderName: string;
  path: string;
  pattern: NewFolderPattern;
  reasons: string[];
  summary: string;
}

export type FolderSuggestOutcome =
  | { status: "blocked"; reason: string; cues: FolderSuggestCue; suggestions: FolderSuggestion[] }
  | { status: "unclear"; reason: string; cues: FolderSuggestCue; suggestions: FolderSuggestion[] }
  | { status: "alreadyHere"; reason: string; cues: FolderSuggestCue; suggestions: FolderSuggestion[] }
  | { status: "suggestions"; reason: null; cues: FolderSuggestCue; suggestions: FolderSuggestion[] }
  | {
      status: "newFolder";
      reason: string;
      cues: FolderSuggestCue;
      suggestions: FolderSuggestion[];
      newFolder: NewFolderProposal;
    }
  | { status: "yearUnknown"; reason: string; cues: FolderSuggestCue; suggestions: FolderSuggestion[] };

export function isAcceptableNewFolderName(name: string): boolean {
  return isAllowedWindowsComponent(name);
}

export function canSuggestWorkbenchFolder(node: FsNode, occupancyIdle: boolean): boolean {
  return canSuggestWorkbenchFileName(node, occupancyIdle);
}

export function folderIsInsideScanRoot(scanRoot: string, folderPath: string): boolean {
  const root = normalizeFolderPath(scanRoot);
  const folder = normalizeFolderPath(folderPath);
  return folder === root || folder.startsWith(`${root}/`);
}

export function collectFolderCandidates(root: DirectoryNode, excludeFilePath?: string): FolderCandidate[] {
  const excluded = excludeFilePath === undefined ? null : normalizeFolderPath(excludeFilePath);
  const out: FolderCandidate[] = [];
  walkFolders(root, [], [], [], true, excluded, out);
  return out;
}

export function folderSuggestCues(
  fileName: string,
  view: DocumentTextView | null,
  learnedStore: LearnedSenderStore = emptyLearnedSenderStore(),
  confirmedIso: string | null = null,
): FolderSuggestCue {
  const text = view?.text ?? "";
  const fromText = enrichLocalAiFields(text, EMPTY_FIELDS);
  const fromName = resolveDocumentType(fileName, null);
  const dokumenttyp = firstFilled(fromText.dokumenttyp, fromName);
  const learned = applyLearnedSender(fromText.absender, text, learnedStore);
  const absender = firstFilled(
    learned.absender,
    fromText.absender,
    senderFromFileName(fileName),
    placementSenderFromText(text),
  );
  const betreff = firstFilled(extractLabeledBetreff(text), subjectFromFileName(fileName, dokumenttyp, absender));
  const dated = documentDateFromView(view, confirmedIso);
  const tokens = uniqueTokens([
    ...placementTokens(dokumenttyp ?? ""),
    ...placementTokens(absender ?? ""),
    ...placementTokens(betreff ?? ""),
    ...fileNameCueTokens(fileName),
  ]);
  return {
    dokumenttyp,
    absender,
    betreff,
    documentYear: dated.year,
    documentDateStatus: dated.status,
    dateResolution: dated.resolution,
    confirmedIso: dated.confirmedIso,
    learnedAbsender: learned.learned,
    tokens,
  };
}

export function folderSuggestShowsDateField(outcome: FolderSuggestOutcome): boolean {
  return outcome.status === "yearUnknown" || outcome.cues.confirmedIso !== null;
}

export function planFolderSuggestions(options: {
  scanRoot: string;
  root: DirectoryNode;
  source: FsNode;
  view: DocumentTextView | null;
  learnedStore?: LearnedSenderStore;
  confirmedIso?: string | null;
}): FolderSuggestOutcome {
  const cues = folderSuggestCues(
    options.source.name,
    options.view,
    options.learnedStore ?? emptyLearnedSenderStore(),
    options.confirmedIso ?? null,
  );
  if (!isFile(options.source)) {
    return {
      status: "blocked",
      reason: "Nur einzelne Dateien können einem Zielordner zugeordnet werden.",
      cues,
      suggestions: [],
    };
  }
  if (!folderIsInsideScanRoot(options.scanRoot, options.source.path)) {
    return {
      status: "blocked",
      reason: "Die Datei liegt außerhalb der aktuellen Scanwurzel.",
      cues,
      suggestions: [],
    };
  }
  const currentFolder = parentDirectoryPath(options.source.path);
  const candidates = collectFolderCandidates(options.root, options.source.path).filter((candidate) =>
    folderIsInsideScanRoot(options.scanRoot, candidate.path),
  );
  const ranked = rankFolderSuggestions(candidates, cues, currentFolder);
  const suitable = ranked.filter((item) => isSuitableExistingTarget(item, candidates, cues));
  const suggestions = suitable.slice(0, FOLDER_SUGGEST_MAX).map((item) => ({
    ...item,
    summary: suggestionSummary(item),
  }));
  const currentYearParent = yearPatternParentAt(candidates, currentFolder);
  const incompleteYearHome =
    suggestions[0]?.alreadyHere === true
    && currentYearParent !== undefined
    && sameDirectoryPath(suggestions[0].path, currentYearParent.path);
  if (suggestions.length > 0 && !incompleteYearHome) {
    const best = suggestions[0]!;
    if (best.alreadyHere) {
      return {
        status: "alreadyHere",
        reason: FOLDER_SUGGEST_ALREADY_HERE,
        cues,
        suggestions: [{ ...best, summary: FOLDER_SUGGEST_ALREADY_HERE }],
      };
    }
    return { status: "suggestions", reason: null, cues, suggestions };
  }
  const created = proposeNewFolder(candidates, cues, options.scanRoot);
  if (created === "ambiguous") {
    return {
      status: "unclear",
      reason: FOLDER_SUGGEST_NEW_UNCLEAR,
      cues,
      suggestions: [],
    };
  }
  if (created !== null) {
    return {
      status: "newFolder",
      reason: FOLDER_SUGGEST_NEW,
      cues,
      suggestions: [],
      newFolder: created,
    };
  }
  if (currentYearParent !== undefined && cues.documentYear === null) {
    return {
      status: "yearUnknown",
      reason: FOLDER_SUGGEST_YEAR_UNKNOWN,
      cues,
      suggestions: [],
    };
  }
  return {
    status: "unclear",
    reason: FOLDER_SUGGEST_UNCLEAR,
    cues,
    suggestions: [],
  };
}

function walkFolders(
  node: DirectoryNode,
  parentNames: string[],
  relativeNames: string[],
  siblingFolderNames: string[],
  isScanRoot: boolean,
  excludeFilePath: string | null,
  into: FolderCandidate[],
): void {
  const childFolders = node.children.filter(isDirectory);
  const childFolderNames = childFolders.map((child) => child.name);
  const fileNames = node.children
    .filter(isFile)
    .filter((child) => excludeFilePath === null || normalizeFolderPath(child.path) !== excludeFilePath)
    .map((child) => child.name);
  const pathNames = isScanRoot ? [node.name] : relativeNames;
  into.push({
    id: node.id,
    name: node.name,
    path: node.path,
    parentNames,
    relativeNames: pathNames,
    fileNames,
    childFolderNames,
    siblingFolderNames,
    isScanRoot,
  });
  for (const child of childFolders) {
    walkFolders(
      child,
      [...parentNames, node.name],
      [...pathNames, child.name],
      childFolderNames,
      false,
      excludeFilePath,
      into,
    );
  }
}

interface RankedFolder {
  suggestion: FolderSuggestion;
  senderPath: boolean;
  yearWrong: boolean;
  yearGuess: boolean;
  competingTokens: string[];
}

function rankFolderSuggestions(
  candidates: FolderCandidate[],
  cues: FolderSuggestCue,
  currentFolder: string,
): FolderSuggestion[] {
  const ranked = applyRecurringYearPattern(
    candidates.map((candidate) => scoreFolderCandidate(cues, candidate, currentFolder)),
    candidates,
    cues,
  )
    .filter((item) => !item.yearWrong)
    .filter((item) => !(item.yearGuess && !item.suggestion.alreadyHere));
  const withSender = ranked.filter((item) => item.senderPath);
  const withoutRivalVendors =
    withSender.length > 0
      ? ranked.filter((item) => item.senderPath || item.competingTokens.length === 0)
      : ranked;
  const eligible = withoutRivalVendors
    .map((item) => item.suggestion)
    .filter((suggestion) => suggestion.score >= MIN_SCORE && suggestion.reasons.length > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path, "de"));
  return dropAncestorSuggestions(eligible);
}

function dropAncestorSuggestions(suggestions: FolderSuggestion[]): FolderSuggestion[] {
  return suggestions.filter(
    (candidate, index) =>
      !suggestions.some(
        (other, otherIndex) => otherIndex !== index && isAncestorPath(candidate.path, other.path),
      ),
  );
}

function isYearPatternParent(candidate: FolderCandidate): boolean {
  return hasYearPattern(candidate.childFolderNames) && !isYearFolderName(candidate.name);
}

function yearPatternParentAt(candidates: FolderCandidate[], folderPath: string): FolderCandidate | undefined {
  return candidates.find(
    (candidate) => sameDirectoryPath(candidate.path, folderPath) && isYearPatternParent(candidate),
  );
}

function isSuitableExistingTarget(
  suggestion: FolderSuggestion,
  candidates: FolderCandidate[],
  cues: FolderSuggestCue,
): boolean {
  const candidate = candidates.find((item) => sameDirectoryPath(item.path, suggestion.path));
  if (candidate === undefined) {
    return false;
  }
  if (
    cues.documentYear !== null
    && hasYearPattern(candidate.childFolderNames)
    && !candidate.childFolderNames.includes(cues.documentYear)
  ) {
    return false;
  }
  const typeTokens = expandedTypeTokens(cues.dokumenttyp ?? "");
  if (cues.absender !== null && !pathHasSender(candidate, cues) && vendorIdentityOnPath(candidate, typeTokens)) {
    return false;
  }
  if (cues.absender !== null && !pathHasSender(candidate, cues) && hasVendorFolderPattern(candidate, typeTokens)) {
    return false;
  }
  return true;
}

type NewFolderPlan = NewFolderProposal | "ambiguous" | null;

function proposeNewFolder(
  candidates: FolderCandidate[],
  cues: FolderSuggestCue,
  scanRoot: string,
): NewFolderPlan {
  const year = proposeYearFolder(candidates, cues, scanRoot);
  if (year === "ambiguous") {
    return "ambiguous";
  }
  if (year !== null) {
    return year;
  }
  const vendor = proposeVendorFolder(candidates, cues, scanRoot);
  const type = proposeTypeFolder(candidates, cues, scanRoot);
  if (vendor === "ambiguous" || type === "ambiguous") {
    return "ambiguous";
  }
  if (vendor !== null && type !== null) {
    return "ambiguous";
  }
  return vendor ?? type;
}

function proposeYearFolder(
  candidates: FolderCandidate[],
  cues: FolderSuggestCue,
  scanRoot: string,
): NewFolderPlan {
  if (cues.documentYear === null) {
    return null;
  }
  const year = cues.documentYear;
  const parents = uniqueDeepestFolders(
    candidates.filter((candidate) => isMissingYearParent(candidate, cues)),
  );
  if (parents.length === 0) {
    return null;
  }
  if (parents.length > 1) {
    return "ambiguous";
  }
  const parent = parents[0]!;
  return buildNewFolderProposal({
    parent,
    folderName: year,
    scanRoot,
    candidates,
    pattern: "year",
    reasons: [
      `Die Ablage in „${parent.name}“ erfolgt nach Jahren.`,
      `Der Jahresordner ${year} fehlt.`,
    ],
  });
}

function proposeVendorFolder(
  candidates: FolderCandidate[],
  cues: FolderSuggestCue,
  scanRoot: string,
): NewFolderPlan {
  if (cues.absender === null) {
    return null;
  }
  if (candidates.some((candidate) => pathHasSender(candidate, cues))) {
    return null;
  }
  const typeTokens = expandedTypeTokens(cues.dokumenttyp ?? "");
  const parents = uniqueDeepestFolders(
    candidates.filter(
      (candidate) =>
        hasVendorFolderPattern(candidate, typeTokens)
        && (pathHasType(candidate, cues) || candidate.isScanRoot),
    ),
  );
  if (parents.length === 0) {
    return null;
  }
  if (parents.length > 1) {
    return "ambiguous";
  }
  const parent = parents[0]!;
  const vendorKids = vendorSiblingNames(parent.childFolderNames, typeTokens);
  const folderName = vendorFolderNameFromSender(cues.absender, vendorKids);
  if (folderName === null) {
    return null;
  }
  if (parent.childFolderNames.some((name) => stripFolderStatusSuffix(name).toLowerCase() === folderName.toLowerCase())) {
    return null;
  }
  return buildNewFolderProposal({
    parent,
    folderName,
    scanRoot,
    candidates,
    pattern: "vendor",
    reasons: [
      `Unter „${parent.name}“ werden Anbieter in eigenen Ordnern abgelegt.`,
      `Ein Ordner für „${cues.absender}“ fehlt.`,
    ],
  });
}

function proposeTypeFolder(
  candidates: FolderCandidate[],
  cues: FolderSuggestCue,
  scanRoot: string,
): NewFolderPlan {
  if (cues.dokumenttyp === null) {
    return null;
  }
  if (candidates.some((candidate) => folderMatchesDocumentType(candidate, cues.dokumenttyp!))) {
    return null;
  }
  const parents = uniqueDeepestFolders(
    candidates.filter((candidate) => candidate.childFolderNames.filter((name) => isTypeFolderName(name)).length >= 2),
  );
  if (parents.length === 0) {
    return null;
  }
  if (parents.length > 1) {
    return "ambiguous";
  }
  const parent = parents[0]!;
  const folderName = sanitizeSuggestedFileNamePart(cues.dokumenttyp).trim();
  if (folderName.length < 2) {
    return null;
  }
  return buildNewFolderProposal({
    parent,
    folderName,
    scanRoot,
    candidates,
    pattern: "documentType",
    reasons: [
      `Unter „${parent.name}“ werden Dokumentarten in eigenen Ordnern abgelegt.`,
      `Ein Ordner für „${cues.dokumenttyp}“ fehlt.`,
    ],
  });
}

function buildNewFolderProposal(options: {
  parent: FolderCandidate;
  folderName: string;
  scanRoot: string;
  candidates: FolderCandidate[];
  pattern: NewFolderPattern;
  reasons: string[];
}): NewFolderProposal | null {
  if (!isAcceptableNewFolderName(options.folderName)) {
    return null;
  }
  const path = joinScanPath(options.parent.path, options.folderName);
  if (!folderIsInsideScanRoot(options.scanRoot, path)) {
    return null;
  }
  if (options.candidates.some((candidate) => sameDirectoryPath(candidate.path, path))) {
    return null;
  }
  if (options.parent.childFolderNames.some((name) => name.toLowerCase() === options.folderName.toLowerCase())) {
    return null;
  }
  return {
    parentPath: options.parent.path,
    parentName: options.parent.name,
    folderName: options.folderName,
    path,
    pattern: options.pattern,
    reasons: options.reasons,
    summary: FOLDER_SUGGEST_NEW,
  };
}

function isMissingYearParent(candidate: FolderCandidate, cues: FolderSuggestCue): boolean {
  if (cues.documentYear === null || !hasYearPattern(candidate.childFolderNames)) {
    return false;
  }
  if (candidate.childFolderNames.includes(cues.documentYear)) {
    return false;
  }
  const typeTokens = expandedTypeTokens(cues.dokumenttyp ?? "");
  if (isVendorLikeFolder(candidate.name, typeTokens)) {
    return pathHasSender(candidate, cues);
  }
  return candidate.isScanRoot || pathHasType(candidate, cues);
}

function pathHasSender(candidate: FolderCandidate, cues: FolderSuggestCue): boolean {
  if (cues.absender === null) {
    return false;
  }
  const senderTokens = placementTokens(cues.absender);
  if (senderTokens.length === 0) {
    return false;
  }
  return candidate.relativeNames.some((segment) => {
    if (isYearFolderName(segment)) {
      return false;
    }
    return overlappingTokens(placementTokens(segment), senderTokens).length > 0;
  });
}

function pathHasType(candidate: FolderCandidate, cues: FolderSuggestCue): boolean {
  if (cues.dokumenttyp === null) {
    return false;
  }
  const typeTokens = expandedTypeTokens(cues.dokumenttyp);
  if (typeTokens.length === 0) {
    return false;
  }
  const folderType = resolveDocumentType(candidate.name, null);
  if (folderType !== null && folderType === cues.dokumenttyp) {
    return true;
  }
  return candidate.relativeNames.some((segment) => {
    if (isYearFolderName(segment)) {
      return false;
    }
    return overlappingTokens(placementTokens(segment), typeTokens).length > 0;
  });
}

function folderMatchesDocumentType(candidate: FolderCandidate, dokumenttyp: string): boolean {
  const folderType = resolveDocumentType(candidate.name, null);
  if (folderType !== null && folderType === dokumenttyp) {
    return true;
  }
  const typeTokens = expandedTypeTokens(dokumenttyp);
  const nameTokens = placementTokens(candidate.name);
  return isTypeFolderName(candidate.name) && overlappingTokens(nameTokens, typeTokens).length > 0;
}

function vendorIdentityOnPath(candidate: FolderCandidate, typeTokens: readonly string[]): boolean {
  if (isVendorLikeFolder(candidate.name, typeTokens)) {
    return true;
  }
  for (let index = candidate.relativeNames.length - 1; index >= 0; index -= 1) {
    const segment = candidate.relativeNames[index]!;
    if (isYearFolderName(segment)) {
      continue;
    }
    if (isVendorLikeFolder(segment, typeTokens)) {
      return true;
    }
  }
  return false;
}

function hasVendorFolderPattern(candidate: FolderCandidate, typeTokens: readonly string[]): boolean {
  return vendorSiblingNames(candidate.childFolderNames, typeTokens).length >= 2;
}

function vendorSiblingNames(childNames: readonly string[], typeTokens: readonly string[]): string[] {
  return childNames.filter((name) => isVendorLikeFolder(name, typeTokens));
}

function isVendorLikeFolder(name: string, typeTokens: readonly string[]): boolean {
  if (isYearFolderName(name)) {
    return false;
  }
  const stripped = stripFolderStatusSuffix(name);
  const identity = competingIdentityFromName(stripped, typeTokens);
  if (identity.length === 0) {
    return false;
  }
  const nameTokens = placementTokens(stripped);
  return (
    overlappingTokens(nameTokens, typeTokens).length > 0
    || TYPE_STEMS.some((stem) => nameTokens.some((token) => token === stem || token.includes(stem)))
  );
}

function isTypeFolderName(name: string): boolean {
  if (isYearFolderName(name)) {
    return false;
  }
  if (resolveDocumentType(name, null) !== null) {
    return competingIdentityFromName(name, expandedTypeTokens(name)).length === 0;
  }
  const tokens = placementTokens(name);
  if (tokens.length === 0) {
    return false;
  }
  const typeLike = TYPE_STEMS.some((stem) =>
    tokens.some((token) => token === stem || token.includes(stem) || stem.startsWith(token)),
  );
  if (!typeLike) {
    return false;
  }
  return competingIdentityFromName(name, expandedTypeTokens(name)).length === 0;
}

function competingIdentityFromName(name: string, typeTokens: readonly string[]): string[] {
  return placementTokens(name).filter((token) => overlappingTokens([token], typeTokens).length === 0);
}

function vendorFolderNameFromSender(absender: string, siblingNames: readonly string[]): string | null {
  const base = vendorBaseFromSender(absender);
  if (base.length < 2) {
    return null;
  }
  const suffix = sharedVendorSuffix(siblingNames);
  const folderName =
    suffix.length > 0 && !base.toLowerCase().endsWith(suffix.toLowerCase()) ? `${base}${suffix}` : base;
  return isAcceptableNewFolderName(folderName) ? folderName : null;
}

function vendorBaseFromSender(absender: string): string {
  const withoutLegal = absender
    .replace(/\b(?:AG|GmbH|UG|SE|KG|OHG|e\.V\.|GbR|Ltd|Inc|Co|mbH)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const source = withoutLegal.length >= 2 ? withoutLegal : absender;
  return sanitizeSuggestedFileNamePart(source).trim();
}

function sharedVendorSuffix(names: readonly string[]): string {
  const stripped = names.map((name) => stripFolderStatusSuffix(name)).filter((name) => name.length > 0);
  if (stripped.length < 2) {
    return "";
  }
  const tails = stripped.map((name) => {
    const index = name.lastIndexOf("_");
    return index > 0 ? name.slice(index) : "";
  });
  const first = tails[0] ?? "";
  if (first.length >= 2 && tails.every((tail) => tail === first)) {
    return first;
  }
  return "";
}

export function stripFolderStatusSuffix(name: string): string {
  return name.replace(/\s+[-–—]\s+.+$/u, "").trim();
}

function uniqueDeepestFolders(candidates: FolderCandidate[]): FolderCandidate[] {
  return candidates.filter(
    (candidate) => !candidates.some((other) => other !== candidate && isAncestorPath(candidate.path, other.path)),
  );
}

function scoreFolderCandidate(
  cues: FolderSuggestCue,
  candidate: FolderCandidate,
  currentFolder: string,
): RankedFolder {
  const typeTokens = expandedTypeTokens(cues.dokumenttyp ?? "");
  const senderTokens = placementTokens(cues.absender ?? "");
  const subjectTokens = placementTokens(cues.betreff ?? "");
  const yearPattern = hasYearPattern(candidate.siblingFolderNames) || hasYearPattern(candidate.childFolderNames);
  const reasons: string[] = [];
  let score = 0;
  let yearWrong = false;
  let yearGuess = false;
  let yearMatch = false;
  const typeSegments: string[] = [];
  const senderSegments: string[] = [];
  const subjectSegments: string[] = [];

  for (const segment of candidate.relativeNames) {
    if (isYearFolderName(segment)) {
      if (yearPattern && cues.documentYear !== null) {
        if (segment === cues.documentYear) {
          yearMatch = true;
        } else {
          yearWrong = true;
        }
      } else if (yearPattern && cues.documentYear === null) {
        yearGuess = true;
      }
      continue;
    }
    const segmentTokens = placementTokens(segment);
    if (cues.dokumenttyp !== null && overlappingTokens(segmentTokens, typeTokens).length > 0) {
      typeSegments.push(segment);
    }
    if (cues.absender !== null && overlappingTokens(segmentTokens, senderTokens).length > 0) {
      senderSegments.push(segment);
    }
    if (cues.betreff !== null && overlappingTokens(segmentTokens, subjectTokens).length > 0) {
      subjectSegments.push(segment);
    }
  }

  if (typeSegments.length > 0 && cues.dokumenttyp !== null) {
    const deepest = typeSegments[typeSegments.length - 1]!;
    score += SCORE_TYPE_FOLDER;
    reasons.push(`Ordner „${deepest}“ passt zur Dokumentart „${cues.dokumenttyp}“.`);
    if (typeSegments.length > 1) {
      score += SCORE_TYPE_PARENT;
      reasons.push(`Themenbereich „${typeSegments[0]}“ passt zur Dokumentart.`);
    }
  }
  if (senderSegments.length > 0 && cues.absender !== null) {
    const deepest = senderSegments[senderSegments.length - 1]!;
    score += SCORE_SENDER_FOLDER;
    reasons.push(`Anbieterordner „${deepest}“ passt zum Absender „${cues.absender}“.`);
    if (senderSegments.length > 1) {
      score += SCORE_SENDER_PARENT;
    }
  }
  if (subjectSegments.length > 0 && cues.betreff !== null) {
    score += SCORE_BETREFF_FOLDER;
    reasons.push("Ein Ordner im Pfad passt zum Betreff bzw. Dokumentinhalt.");
  }
  if (yearMatch && cues.documentYear !== null) {
    score += SCORE_YEAR_MATCH;
    reasons.push(`Jahresordner „${cues.documentYear}“ passt zum erkannten Dokumentjahr.`);
  }
  if (yearPattern && isYearFolderName(candidate.name) && candidate.relativeNames.length === 2) {
    const scanRootName = candidate.relativeNames[0]!;
    reasons.push(`Die Scanwurzel „${scanRootName}“ enthält eine nach Jahren gegliederte Ablagestruktur.`);
  }

  if (!candidate.isScanRoot) {
    const siblingHits = candidate.fileNames.filter((name) => {
      const tokens = fileNameCueTokens(name);
      return overlappingTokens(tokens, typeTokens).length > 0 || overlappingTokens(tokens, senderTokens).length > 0;
    });
    if (siblingHits.length > 0) {
      score += Math.min(SCORE_SIBLING_CAP, SCORE_SIBLING * siblingHits.length);
      reasons.push("Bereits enthaltene Dateien passen zu Dokumentart oder Absender.");
    }
  }

  const alreadyHere = sameDirectoryPath(candidate.path, currentFolder);
  if (alreadyHere && reasons.length > 0) {
    reasons.push("Die Datei liegt bereits in diesem Ordner.");
  }

  return {
    suggestion: {
      path: candidate.path,
      name: candidate.name,
      score,
      alreadyHere,
      summary: "",
      reasons,
    },
    senderPath: senderSegments.length > 0,
    yearWrong,
    yearGuess,
    competingTokens: competingIdentityTokens(candidate, typeTokens, senderTokens),
  };
}

function applyRecurringYearPattern(
  ranked: RankedFolder[],
  candidates: FolderCandidate[],
  cues: FolderSuggestCue,
): RankedFolder[] {
  const typeTokens = expandedTypeTokens(cues.dokumenttyp ?? "");
  const senderTokens = placementTokens(cues.absender ?? "");
  const byPath = new Map(candidates.map((candidate) => [normalizeFolderPath(candidate.path), candidate]));
  return ranked.map((item) => {
    const candidate = byPath.get(normalizeFolderPath(item.suggestion.path));
    if (candidate === undefined || !hasYearPattern(candidate.siblingFolderNames)) {
      return item;
    }
    const parent = parentDirectoryPath(candidate.path);
    const siblingHits = candidates.filter(
      (other) =>
        isYearFolderName(other.name)
        && sameDirectoryPath(parentDirectoryPath(other.path), parent)
        && !sameDirectoryPath(other.path, candidate.path),
    ).flatMap((other) => other.fileNames);
    const patterned = siblingHits.filter((name) => {
      const tokens = fileNameCueTokens(name);
      return overlappingTokens(tokens, typeTokens).length > 0 || overlappingTokens(tokens, senderTokens).length > 0;
    });
    if (patterned.length === 0) {
      return item;
    }
    return {
      ...item,
      suggestion: {
        ...item.suggestion,
        score: item.suggestion.score + SCORE_PATTERN,
        reasons: [...item.suggestion.reasons, "Vorhandene Dateinamen in den Jahresordnern folgen demselben Ablagemuster."],
      },
    };
  });
}

function competingIdentityTokens(
  candidate: FolderCandidate,
  typeTokens: readonly string[],
  senderTokens: readonly string[],
): string[] {
  const identityName = isYearFolderName(candidate.name)
    ? [...candidate.relativeNames].reverse().find((name) => !isYearFolderName(name)) ?? candidate.name
    : candidate.name;
  return placementTokens(identityName).filter(
    (token) => overlappingTokens([token], typeTokens).length === 0 && overlappingTokens([token], senderTokens).length === 0,
  );
}

function suggestionSummary(item: FolderSuggestion): string {
  if (item.alreadyHere) {
    return FOLDER_SUGGEST_ALREADY_HERE;
  }
  return item.reasons[0] ?? "Der Ordner erscheint nach Ordnernamen und Dokumentmerkmalen passend.";
}

function documentDateFromView(
  view: DocumentTextView | null,
  confirmedIso: string | null = null,
): {
  year: string | null;
  status: FolderSuggestCue["documentDateStatus"];
  resolution: DocumentDateResolution | null;
  confirmedIso: string | null;
} {
  const confirmed = parseUserDocumentDate(confirmedIso ?? "");
  const resolution = view === null ? null : resolveDocumentDateFromView(view);
  if (confirmed !== null) {
    return { year: confirmed.slice(0, 4), status: "confirmed", resolution, confirmedIso: confirmed };
  }
  if (view === null || resolution === null) {
    return { year: null, status: "none", resolution: null, confirmedIso: null };
  }
  if (resolution.status !== "confident") {
    return { year: null, status: "ask", resolution, confirmedIso: null };
  }
  return { year: resolution.iso.slice(0, 4), status: "confident", resolution, confirmedIso: null };
}

export function documentYearFromView(view: DocumentTextView | null): string | null {
  return documentDateFromView(view).year;
}

export function isYearFolderName(name: string): boolean {
  return isYearToken(name.trim());
}

function hasYearPattern(names: readonly string[]): boolean {
  return names.filter((name) => isYearFolderName(name)).length >= 2;
}

function isAncestorPath(ancestor: string, descendant: string): boolean {
  const parent = normalizeFolderPath(ancestor);
  const child = normalizeFolderPath(descendant);
  return child.startsWith(`${parent}/`);
}

function extractLabeledBetreff(text: string): string | null {
  const match = /(?:betreff|subject)\s*[:\-]\s*(.+)/i.exec(text);
  if (match === null) {
    return null;
  }
  const line = (match[1] ?? "").split(/\r?\n/)[0]?.trim() ?? "";
  const cleaned = sanitizeSuggestedFileNamePart(line).slice(0, 80);
  return cleaned.length >= 3 ? cleaned : null;
}

function placementSenderFromText(text: string): string | null {
  const heading = text.slice(0, Math.min(240, text.length));
  for (const line of heading.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length < 3 || trimmed.length > 120) {
      continue;
    }
    const acronyms = trimmed.match(/\b[A-ZÄÖÜ]{2,8}\b/g) ?? [];
    const distinctive = acronyms.filter((token) => {
      const folded = foldDocumentLabel(token);
      return (
        folded.length >= 2
        && !PLACEMENT_STOP.has(folded)
        && !LEGAL_FORM_ACRONYMS.has(folded)
        && resolveDocumentType(token, null) === null
      );
    });
    if (distinctive.length === 1) {
      return distinctive[0]!;
    }
  }
  return null;
}

function senderFromFileName(fileName: string): string | null {
  const parts = fileNameCueParts(fileName);
  if (parts.length === 0) {
    return null;
  }
  const first = parts[0]!;
  if (placementTokens(first).length === 0 || resolveDocumentType(first, null) !== null) {
    return null;
  }
  const folded = foldDocumentLabel(first);
  const acronym = /^[A-ZÄÖÜ]{2,8}$/.test(first) || (/^[a-z0-9]{2,8}$/.test(folded) && first === first.toUpperCase());
  if (acronym) {
    return first;
  }
  if (parts.length >= 2 && first.length >= 3 && first.length <= 40) {
    return first;
  }
  return null;
}

function subjectFromFileName(fileName: string, dokumenttyp: string | null, absender: string | null): string | null {
  const skip = new Set([
    ...placementTokens(dokumenttyp ?? ""),
    ...placementTokens(absender ?? ""),
  ]);
  const rest = fileNameCueParts(fileName).filter((part) => overlappingTokens(placementTokens(part), [...skip]).length === 0);
  if (rest.length === 0) {
    return null;
  }
  const joined = sanitizeSuggestedFileNamePart(rest.join(" "));
  return joined.length >= 3 ? joined : null;
}

function fileNameCueParts(fileName: string): string[] {
  const stripped = stripLeadingDatePrefix(stemFromFilename(fileName).stem).remainder;
  return stripped
    .split(/[_\-.]+/g)
    .map((part) => sanitizeSuggestedFileNamePart(part))
    .filter((part) => {
      const folded = foldDocumentLabel(part);
      return part.length >= 2 && !isYearToken(folded) && !PLACEMENT_STOP.has(folded);
    });
}

function fileNameCueTokens(fileName: string): string[] {
  return uniqueTokens(fileNameCueParts(fileName).flatMap((part) => placementTokens(part)));
}

export function placementTokens(value: string): string[] {
  return foldDocumentLabel(value)
    .replace(/§/g, "s")
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !PLACEMENT_STOP.has(token) && !isYearToken(token));
}

const TYPE_STEMS = [
  "rechnung",
  "schreiben",
  "meldung",
  "nachweis",
  "vertrag",
  "abrechnung",
  "strom",
  "gas",
];

function expandedTypeTokens(dokumenttyp: string): string[] {
  const base = placementTokens(dokumenttyp);
  const extras = base.flatMap((token) => TYPE_STEMS.filter((stem) => token.includes(stem)));
  return uniqueTokens([...base, ...extras]);
}

function overlappingTokens(left: readonly string[], right: readonly string[]): string[] {
  const hits: string[] = [];
  for (const a of left) {
    for (const b of right) {
      if (!tokensMatch(a, b)) {
        continue;
      }
      const keep = a.length <= b.length ? a : b;
      if (!hits.includes(keep)) {
        hits.push(keep);
      }
    }
  }
  return hits;
}

function tokensMatch(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }
  if (left.length < 4 || right.length < 4) {
    return false;
  }
  if (left.startsWith(right) || right.startsWith(left) || left.includes(right) || right.includes(left)) {
    return true;
  }
  return sharedPrefixLength(left, right) >= 8;
}

function sharedPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function uniqueTokens(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (value.length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}

function firstFilled(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function isYearToken(token: string): boolean {
  if (!/^\d{4}$/.test(token)) {
    return false;
  }
  const year = Number(token);
  return year >= 1900 && year <= 2100;
}

function normalizeFolderPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
