/**
 * P2-K.3b – Justifiable virtual reorganization proposals.
 * READ-ONLY. Does not mutate ScanResult, drafts, or the filesystem.
 * Proposals are never auto-applied to the SOLL projection.
 * Every structural preview must cover the full affected source scope.
 */

import type { DirectoryNode, FileNode, FsNode, ScanResult } from "../model";
import { isDirectory, isFile } from "../model";
import type { StructureInsightViewModel } from "./structureInsightViewModel";
import {
  PRINCIPLE_PARALLEL_FILE_NAME_FORM_SET,
  PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET,
  PRINCIPLE_RECURRING_CHILD_FOLDER_NAME,
  PRINCIPLE_RECURRING_CHILD_FOLDER_SET,
  PRINCIPLE_RECURRING_FILE_NAME_FORM,
  PRINCIPLE_RECURRING_YEAR,
} from "./structureRuleCandidate";
import { normalizeVirtualPlanPath, type SnapshotBinding } from "./virtualPlan";

function relativeVirtualPath(rootPath: string, nodePath: string): string {
  const root = normalizeVirtualPlanPath(rootPath);
  const path = normalizeVirtualPlanPath(nodePath);
  if (path === root) {
    return ".";
  }
  const prefix = `${root}/`;
  if (path.startsWith(prefix)) {
    return path.slice(prefix.length);
  }
  return path;
}

export const VIRTUAL_PLAN_PROPOSALS_BUILDER_VERSION = 2 as const;

/**
 * Mutually exclusive virtual actions — never mix e.g. subfolder creation with parent rename.
 */
export type VirtualProposalActionKind =
  | "createVirtualSubfolder"
  | "renameVirtualFolder"
  | "groupFilesByYear"
  | "reviewableStructureVariant";

export type VirtualProposalCategory =
  | "virtualFolderGroup"
  | "virtualYearGroup"
  | "reviewableStructureVariant";

export type VirtualPreviewRole =
  | "sourceFolder"
  | "virtualGroup"
  | "regrouped"
  | "unchanged"
  | "existingChildFolder";

export interface VirtualPreviewEntry {
  /** Scan node id, or synthetic id for virtual groups. */
  entryId: string;
  name: string;
  kind: "file" | "directory" | "virtualDirectory";
  role: VirtualPreviewRole;
  children?: VirtualPreviewEntry[];
}

export interface ProposalCompleteness {
  sourceObjectCount: number;
  regroupedObjectCount: number;
  unchangedObjectCount: number;
  previewLeafCount: number;
  complete: boolean;
  hasDuplicates: boolean;
  lossDetected: boolean;
}

export interface VirtualTargetPreview {
  /** Compact textual preview of the suggested virtual structure. */
  lines: string[];
  /** Structured tree for UI (preferred over flat name lists). */
  tree: VirtualPreviewEntry;
}

export interface VirtualReorgProposal {
  id: string;
  category: VirtualProposalCategory;
  categoryLabel: string;
  actionKind: VirtualProposalActionKind;
  actionLabel: string;
  title: string;
  sourceFolderNodeId: string;
  sourceFolderDisplayPath: string;
  /** Objects that would be virtually regrouped (not the full inventory). */
  affectedFileNodeIds: string[];
  affectedFileNames: string[];
  /** Objects that stay at the source folder (files + direct child dirs). */
  unchangedObjectIds: string[];
  unchangedObjectNames: string[];
  completeness: ProposalCompleteness;
  virtualTarget: VirtualTargetPreview;
  observedFeatures: string[];
  rationale: string;
  uncertainties: string[];
  /** K.3b: always false — not adopted into SOLL. */
  adopted: false;
  sourceInsightIds: string[];
  /** Stable key for overlap clustering (folder + category family). */
  overlapGroupKey: string;
  overlapsWithProposalIds: string[];
}

const YEAR_MIN = 1980;
const YEAR_MAX = 2035;
const MIN_PREFIX_FILES = 3;
const MIN_PREFIX_LENGTH = 3;
const MIN_YEAR_FILES = 3;
const MIN_YEAR_BUCKETS = 2;
const PREVIEW_COLLAPSE_THRESHOLD = 24;

const WEAK_PREFIXES = new Set([
  "doc",
  "docs",
  "file",
  "files",
  "img",
  "image",
  "images",
  "new",
  "old",
  "tmp",
  "temp",
  "copy",
  "scan",
  "foto",
  "fotos",
  "photo",
  "photos",
]);

function compareUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function fileStem(name: string): string {
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0) {
    return name;
  }
  return name.slice(0, lastDot);
}

function isWeakPrefix(prefix: string): boolean {
  const normalized = prefix.trim().toLowerCase();
  if (normalized.length < MIN_PREFIX_LENGTH) {
    return true;
  }
  if (/^\d+$/.test(normalized)) {
    return true;
  }
  if (/^[a-z]$/i.test(normalized)) {
    return true;
  }
  if (WEAK_PREFIXES.has(normalized)) {
    return true;
  }
  if (/^[a-z0-9]{1,4}$/i.test(normalized) && !/[aeiouäöü]/i.test(normalized)) {
    return true;
  }
  return false;
}

/**
 * Candidate prefixes from a file stem: token prefixes joined by the original separator.
 * Example: Rechnung_2024_01 → Rechnung, Rechnung_2024
 */
export function candidatePrefixesFromStem(stem: string): string[] {
  const parts: string[] = [];
  const separators: string[] = [];
  let buffer = "";
  for (let index = 0; index < stem.length; index += 1) {
    const ch = stem[index]!;
    if (ch === "_" || ch === "-" || ch === " ") {
      if (buffer.length > 0) {
        parts.push(buffer);
        separators.push(ch);
        buffer = "";
      }
    } else {
      buffer += ch;
    }
  }
  if (buffer.length > 0) {
    parts.push(buffer);
  }
  if (parts.length < 2) {
    return [];
  }
  const prefixes: string[] = [];
  for (let take = 1; take < parts.length; take += 1) {
    let prefix = parts[0]!;
    for (let i = 1; i < take; i += 1) {
      prefix += `${separators[i - 1] ?? "_"}${parts[i]!}`;
    }
    prefixes.push(prefix);
  }
  return prefixes;
}

export function extractPlausibleYearsFromName(name: string): number[] {
  const years: number[] = [];
  const re = /(19|20)\d{2}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(name)) !== null) {
    const year = Number(match[0]);
    if (year >= YEAR_MIN && year <= YEAR_MAX) {
      years.push(year);
    }
  }
  return years;
}

function directFiles(dir: DirectoryNode): FileNode[] {
  return dir.children.filter(isFile);
}

function directChildDirectories(dir: DirectoryNode): DirectoryNode[] {
  return dir.children.filter(isDirectory);
}

function walkDirectories(root: FsNode, visit: (dir: DirectoryNode) => void): void {
  if (isDirectory(root)) {
    visit(root);
    for (const child of root.children) {
      walkDirectories(child, visit);
    }
  }
}

function categoryLabel(category: VirtualProposalCategory): string {
  switch (category) {
    case "virtualFolderGroup":
      return "Neuer virtueller Unterordner";
    case "virtualYearGroup":
      return "Virtuelle Jahresgruppierung";
    case "reviewableStructureVariant":
      return "Prüfbare Strukturvariante";
    default:
      return "Vorschlag";
  }
}

function actionLabel(kind: VirtualProposalActionKind): string {
  switch (kind) {
    case "createVirtualSubfolder":
      return "Neuen virtuellen Unterordner anlegen";
    case "renameVirtualFolder":
      return "Bestehenden Ordner virtuell umbenennen";
    case "groupFilesByYear":
      return "Dateien virtuell nach Jahren gruppieren";
    case "reviewableStructureVariant":
      return "Unverbindliche Strukturvariante zur Prüfung";
    default:
      return "Virtueller Vorschlag";
  }
}

function roleSuffix(role: VirtualPreviewRole): string {
  if (role === "unchanged") {
    return "  ← Bleibt unverändert";
  }
  if (role === "virtualGroup") {
    return "  ← virtuelle Gruppe";
  }
  if (role === "existingChildFolder") {
    return "  ← Bleibt unverändert (Unterordner)";
  }
  return "";
}

export function renderPreviewLines(
  entry: VirtualPreviewEntry,
  indent = "",
  options: { collapseThreshold: number } = { collapseThreshold: PREVIEW_COLLAPSE_THRESHOLD },
): string[] {
  const lines: string[] = [];
  const marker =
    entry.kind === "virtualDirectory" || entry.kind === "directory" ? "/" : "";
  lines.push(`${indent}${entry.name}${marker}${roleSuffix(entry.role)}`);
  const children = entry.children ?? [];
  if (children.length === 0) {
    return lines;
  }
  if (children.length > options.collapseThreshold && entry.role === "virtualGroup") {
    const shown = children.slice(0, 6);
    for (const child of shown) {
      lines.push(...renderPreviewLines(child, `${indent}  `, options));
    }
    lines.push(`${indent}  … (+${children.length - shown.length} weitere)`);
    return lines;
  }
  for (const child of children) {
    lines.push(...renderPreviewLines(child, `${indent}  `, options));
  }
  return lines;
}

/**
 * Completeness over direct children of the source folder (files + subfolders).
 * Recursively counts nested content of preserved subfolders for inventory honesty,
 * but loss/duplicate checks are against the mapping of every source direct child id.
 */
export function assessProposalCompleteness(options: {
  sourceFolder: DirectoryNode;
  regroupedIds: ReadonlySet<string>;
  unchangedIds: ReadonlySet<string>;
  previewRoot: VirtualPreviewEntry;
  listingComplete: boolean;
}): ProposalCompleteness {
  const sourceChildren = options.sourceFolder.children;
  const sourceIds = sourceChildren.map((child) => child.id);
  const sourceSet = new Set(sourceIds);

  const covered = new Set<string>([...options.regroupedIds, ...options.unchangedIds]);
  const hasDuplicates =
    options.regroupedIds.size + options.unchangedIds.size !== covered.size ||
    [...options.regroupedIds].some((id) => options.unchangedIds.has(id));

  let lossDetected = false;
  for (const id of sourceIds) {
    if (!covered.has(id)) {
      lossDetected = true;
      break;
    }
  }
  for (const id of covered) {
    if (!sourceSet.has(id)) {
      // Virtual group ids are synthetic — only flag if a real child id is unknown.
      if (!id.startsWith("virtual:")) {
        lossDetected = true;
        break;
      }
    }
  }

  const previewIds: string[] = [];
  const walkPreview = (entry: VirtualPreviewEntry): void => {
    if (entry.role === "regrouped" || entry.role === "unchanged" || entry.role === "existingChildFolder") {
      previewIds.push(entry.entryId);
    }
    for (const child of entry.children ?? []) {
      walkPreview(child);
    }
  };
  walkPreview(options.previewRoot);

  const previewSet = new Set(previewIds);
  const previewHasDup = previewIds.length !== previewSet.size;
  for (const id of sourceIds) {
    if (!previewSet.has(id)) {
      lossDetected = true;
      break;
    }
  }

  const complete =
    options.listingComplete &&
    !lossDetected &&
    !hasDuplicates &&
    !previewHasDup &&
    covered.size === sourceIds.length &&
    previewSet.size === sourceIds.length;

  return {
    sourceObjectCount: sourceIds.length,
    regroupedObjectCount: options.regroupedIds.size,
    unchangedObjectCount: options.unchangedIds.size,
    previewLeafCount: previewSet.size,
    complete,
    hasDuplicates: hasDuplicates || previewHasDup,
    lossDetected,
  };
}

function buildFolderDisplayPath(scanRoot: FsNode, folder: DirectoryNode): string {
  const relative = relativeVirtualPath(scanRoot.path, folder.path);
  return relative === "." ? folder.name : relative;
}

function buildPrefixTargetTree(options: {
  folder: DirectoryNode;
  folderDisplayPath: string;
  prefix: string;
  regrouped: FileNode[];
}): {
  tree: VirtualPreviewEntry;
  unchangedIds: string[];
  unchangedNames: string[];
} {
  const regroupedIds = new Set(options.regrouped.map((file) => file.id));
  const unchangedFiles = directFiles(options.folder)
    .filter((file) => !regroupedIds.has(file.id))
    .sort((a, b) => compareUtf16(a.name, b.name));
  const childDirs = directChildDirectories(options.folder).sort((a, b) =>
    compareUtf16(a.name, b.name),
  );

  const virtualChildren: VirtualPreviewEntry[] = options.regrouped
    .slice()
    .sort((a, b) => compareUtf16(a.name, b.name))
    .map((file) => ({
      entryId: file.id,
      name: file.name,
      kind: "file" as const,
      role: "regrouped" as const,
    }));

  const children: VirtualPreviewEntry[] = [
    {
      entryId: `virtual:${options.folder.id}:${options.prefix}`,
      name: options.prefix,
      kind: "virtualDirectory",
      role: "virtualGroup",
      children: virtualChildren,
    },
    ...childDirs.map((child) => ({
      entryId: child.id,
      name: child.name,
      kind: "directory" as const,
      role: "existingChildFolder" as const,
    })),
    ...unchangedFiles.map((file) => ({
      entryId: file.id,
      name: file.name,
      kind: "file" as const,
      role: "unchanged" as const,
    })),
  ];

  return {
    tree: {
      entryId: options.folder.id,
      name: options.folderDisplayPath,
      kind: "directory",
      role: "sourceFolder",
      children,
    },
    unchangedIds: [...childDirs.map((d) => d.id), ...unchangedFiles.map((f) => f.id)],
    unchangedNames: [...childDirs.map((d) => d.name), ...unchangedFiles.map((f) => f.name)],
  };
}

function buildYearTargetTree(options: {
  folder: DirectoryNode;
  folderDisplayPath: string;
  byYear: Map<number, FileNode[]>;
  unchangedFiles: FileNode[];
}): {
  tree: VirtualPreviewEntry;
  unchangedIds: string[];
  unchangedNames: string[];
} {
  const years = [...options.byYear.keys()].sort((a, b) => a - b);
  const childDirs = directChildDirectories(options.folder).sort((a, b) =>
    compareUtf16(a.name, b.name),
  );
  const yearEntries: VirtualPreviewEntry[] = years.map((year) => ({
    entryId: `virtual:${options.folder.id}:year:${year}`,
    name: String(year),
    kind: "virtualDirectory" as const,
    role: "virtualGroup" as const,
    children: (options.byYear.get(year) ?? [])
      .slice()
      .sort((a, b) => compareUtf16(a.name, b.name))
      .map((file) => ({
        entryId: file.id,
        name: file.name,
        kind: "file" as const,
        role: "regrouped" as const,
      })),
  }));

  const unchangedSorted = options.unchangedFiles
    .slice()
    .sort((a, b) => compareUtf16(a.name, b.name));

  const children: VirtualPreviewEntry[] = [
    ...yearEntries,
    ...childDirs.map((child) => ({
      entryId: child.id,
      name: child.name,
      kind: "directory" as const,
      role: "existingChildFolder" as const,
    })),
    ...unchangedSorted.map((file) => ({
      entryId: file.id,
      name: file.name,
      kind: "file" as const,
      role: "unchanged" as const,
    })),
  ];

  return {
    tree: {
      entryId: options.folder.id,
      name: options.folderDisplayPath,
      kind: "directory",
      role: "sourceFolder",
      children,
    },
    unchangedIds: [...childDirs.map((d) => d.id), ...unchangedSorted.map((f) => f.id)],
    unchangedNames: [...childDirs.map((d) => d.name), ...unchangedSorted.map((f) => f.name)],
  };
}

function buildPrefixProposals(options: {
  scanResult: ScanResult;
  incompleteScan: boolean;
}): VirtualReorgProposal[] {
  const proposals: VirtualReorgProposal[] = [];
  walkDirectories(options.scanResult.root, (dir) => {
    if (dir.listing !== "read") {
      return;
    }
    const files = directFiles(dir).slice().sort((a, b) => compareUtf16(a.name, b.name));
    if (files.length < MIN_PREFIX_FILES) {
      return;
    }

    type Bucket = { prefix: string; files: FileNode[] };
    const buckets = new Map<string, Bucket>();

    for (const file of files) {
      const stem = fileStem(file.name);
      const candidates = candidatePrefixesFromStem(stem);
      for (const prefix of candidates) {
        if (isWeakPrefix(prefix)) {
          continue;
        }
        const remainder = stem.slice(prefix.length);
        if (remainder.length === 0) {
          continue;
        }
        const boundary = remainder[0]!;
        if (boundary !== "_" && boundary !== "-" && boundary !== " ") {
          continue;
        }
        const key = prefix.toLowerCase();
        const bucket = buckets.get(key) ?? { prefix, files: [] };
        if (!bucket.files.some((entry) => entry.id === file.id)) {
          bucket.files.push(file);
        }
        buckets.set(key, bucket);
      }
    }

    const qualified = [...buckets.values()]
      .filter((bucket) => bucket.files.length >= MIN_PREFIX_FILES)
      .sort((left, right) => {
        if (right.prefix.length !== left.prefix.length) {
          return right.prefix.length - left.prefix.length;
        }
        return compareUtf16(left.prefix.toLowerCase(), right.prefix.toLowerCase());
      });

    const accepted: Bucket[] = [];
    for (const bucket of qualified) {
      const ids = new Set(bucket.files.map((file) => file.id));
      const dominated = accepted.some((stronger) => {
        if (stronger.prefix.length <= bucket.prefix.length) {
          return false;
        }
        return bucket.files.every((file) =>
          stronger.files.some((entry) => entry.id === file.id),
        );
      });
      if (dominated) {
        continue;
      }
      const conflict = files.some((file) => {
        if (ids.has(file.id)) {
          return false;
        }
        const stem = fileStem(file.name).toLowerCase();
        const prefix = bucket.prefix.toLowerCase();
        return stem.startsWith(prefix) && stem.length > prefix.length;
      });
      if (conflict) {
        continue;
      }
      accepted.push(bucket);
    }

    const folderPath = buildFolderDisplayPath(options.scanResult.root, dir);
    for (const bucket of accepted) {
      const sortedFiles = bucket.files
        .slice()
        .sort((a, b) => compareUtf16(a.name, b.name));
      const { tree, unchangedIds, unchangedNames } = buildPrefixTargetTree({
        folder: dir,
        folderDisplayPath: folderPath,
        prefix: bucket.prefix,
        regrouped: sortedFiles,
      });
      const regroupedIds = new Set(sortedFiles.map((file) => file.id));
      const completeness = assessProposalCompleteness({
        sourceFolder: dir,
        regroupedIds,
        unchangedIds: new Set(unchangedIds),
        previewRoot: tree,
        listingComplete: dir.listing === "read",
      });

      const uncertainties = [
        "Die vorgeschlagene Untergruppe ist virtuell und nicht übernommen.",
        "Es wird nicht behauptet, dass die Gruppierung tatsächlich sinnvoller ist.",
        "Dies ist kein Umbenennen des Ausgangsordners — nur ein möglicher virtueller Unterordner.",
      ];
      if (!completeness.complete) {
        uncertainties.push(
          "Die Zielvorschau ist wegen eingeschränkter Datengrundlage nicht als vollständig darstellbar.",
        );
      }
      if (options.incompleteScan) {
        uncertainties.push(
          "Der Scan ist insgesamt eingeschränkt; außerhalb des beobachteten Bestands können weitere Objekte fehlen.",
        );
      }

      const id = `prop_prefix_${normalizeVirtualPlanPath(dir.id)}_${bucket.prefix.toLowerCase()}`
        .replace(/[^a-z0-9_./-]+/gi, "_")
        .slice(0, 160);

      proposals.push({
        id,
        category: "virtualFolderGroup",
        categoryLabel: categoryLabel("virtualFolderGroup"),
        actionKind: "createVirtualSubfolder",
        actionLabel: actionLabel("createVirtualSubfolder"),
        title: `Virtuellen Unterordner „${bucket.prefix}“ anlegen`,
        sourceFolderNodeId: dir.id,
        sourceFolderDisplayPath: folderPath,
        affectedFileNodeIds: sortedFiles.map((file) => file.id),
        affectedFileNames: sortedFiles.map((file) => file.name),
        unchangedObjectIds: unchangedIds,
        unchangedObjectNames: unchangedNames,
        completeness,
        virtualTarget: {
          tree,
          lines: completeness.complete
            ? renderPreviewLines(tree)
            : [
                folderPath,
                "  (Zielstruktur wegen unvollständiger Datengrundlage nicht vollständig darstellbar)",
              ],
        },
        observedFeatures: [
          `${sortedFiles.length} Dateien mit gemeinsamem Namenspräfix „${bucket.prefix}“`,
          `${unchangedNames.length} Objekt(e) bleiben unverändert im Ausgangsordner`,
          `Bestand im Ausgangsordner: ${completeness.sourceObjectCount} direkte Objekte`,
          "Präfix aus Dateinamen abgeleitet (nicht aus Inhalten)",
        ],
        rationale: `Im Ordner „${folderPath}“ teilen ${sortedFiles.length} Dateien das abgrenzbare Namenspräfix „${bucket.prefix}“. Vorschlag: neuen virtuellen Unterordner anlegen — ohne den Ausgangsordner umzubenennen, ohne Freigabe und ohne reale Änderung. Nicht betroffene Objekte bleiben sichtbar als „Bleibt unverändert“.`,
        uncertainties,
        adopted: false,
        sourceInsightIds: [],
        overlapGroupKey: `folder:${dir.id}:prefix`,
        overlapsWithProposalIds: [],
      });
    }
  });
  return proposals;
}

function buildYearProposals(options: {
  scanResult: ScanResult;
  incompleteScan: boolean;
}): VirtualReorgProposal[] {
  const proposals: VirtualReorgProposal[] = [];
  walkDirectories(options.scanResult.root, (dir) => {
    if (dir.listing !== "read") {
      return;
    }
    const files = directFiles(dir).slice().sort((a, b) => compareUtf16(a.name, b.name));
    if (files.length < MIN_YEAR_FILES) {
      return;
    }

    const byYear = new Map<number, FileNode[]>();
    const ambiguous: FileNode[] = [];
    const withoutYear: FileNode[] = [];

    for (const file of files) {
      const years = [...new Set(extractPlausibleYearsFromName(file.name))];
      if (years.length === 0) {
        withoutYear.push(file);
        continue;
      }
      if (years.length > 1) {
        ambiguous.push(file);
        continue;
      }
      const year = years[0]!;
      const list = byYear.get(year) ?? [];
      list.push(file);
      byYear.set(year, list);
    }

    if (byYear.size < MIN_YEAR_BUCKETS) {
      return;
    }
    let assignedCount = 0;
    for (const list of byYear.values()) {
      assignedCount += list.length;
    }
    if (assignedCount < MIN_YEAR_FILES) {
      return;
    }

    const years = [...byYear.keys()].sort((a, b) => a - b);
    const affected = years.flatMap((year) =>
      (byYear.get(year) ?? []).slice().sort((a, b) => compareUtf16(a.name, b.name)),
    );
    const unchangedFiles = [...withoutYear, ...ambiguous];
    const folderPath = buildFolderDisplayPath(options.scanResult.root, dir);
    const { tree, unchangedIds, unchangedNames } = buildYearTargetTree({
      folder: dir,
      folderDisplayPath: folderPath,
      byYear,
      unchangedFiles,
    });
    const completeness = assessProposalCompleteness({
      sourceFolder: dir,
      regroupedIds: new Set(affected.map((file) => file.id)),
      unchangedIds: new Set(unchangedIds),
      previewRoot: tree,
      listingComplete: dir.listing === "read",
    });

    const uncertainties = [
      "Jahreszahlen stammen ausschließlich aus Dateinamen, nicht aus Zeitstempeln oder Inhalten.",
      "Dateien ohne eindeutiges Jahr bleiben am bisherigen Ort.",
      "Die virtuelle Gliederung ist nicht übernommen.",
      "Dies ist keine Umbenennung des Ausgangsordners.",
    ];
    if (ambiguous.length > 0) {
      uncertainties.push(
        `${ambiguous.length} Datei(en) mit mehrdeutiger Jahresangabe bleiben unverändert.`,
      );
    }
    if (!completeness.complete) {
      uncertainties.push(
        "Die Zielvorschau ist wegen eingeschränkter Datengrundlage nicht als vollständig darstellbar.",
      );
    }
    if (options.incompleteScan) {
      uncertainties.push(
        "Der Scan ist insgesamt eingeschränkt; außerhalb des beobachteten Bestands können weitere Objekte fehlen.",
      );
    }

    const id = `prop_year_${normalizeVirtualPlanPath(dir.id)}`
      .replace(/[^a-z0-9_./-]+/gi, "_")
      .slice(0, 160);

    proposals.push({
      id,
      category: "virtualYearGroup",
      categoryLabel: categoryLabel("virtualYearGroup"),
      actionKind: "groupFilesByYear",
      actionLabel: actionLabel("groupFilesByYear"),
      title: "Dateien virtuell nach Jahreszahlen gruppieren",
      sourceFolderNodeId: dir.id,
      sourceFolderDisplayPath: folderPath,
      affectedFileNodeIds: affected.map((file) => file.id),
      affectedFileNames: affected.map((file) => file.name),
      unchangedObjectIds: unchangedIds,
      unchangedObjectNames: unchangedNames,
      completeness,
      virtualTarget: {
        tree,
        lines: completeness.complete
          ? renderPreviewLines(tree)
          : [
              folderPath,
              "  (Zielstruktur wegen unvollständiger Datengrundlage nicht als vollständig darstellbar)",
            ],
      },
      observedFeatures: [
        ...years.map(
          (year) =>
            `${(byYear.get(year) ?? []).length} Datei(en) mit eindeutigem Jahr ${year}`,
        ),
        `${unchangedNames.length} Objekt(e) bleiben unverändert im Ausgangsordner`,
        `Bestand im Ausgangsordner: ${completeness.sourceObjectCount} direkte Objekte`,
      ],
      rationale: `Im Ordner „${folderPath}“ wurden ${assignedCount} Dateien mit eindeutigen Jahreszahlen (${years.join(", ")}) erkannt. Vorschlag: virtuelle Jahresgruppierung — ohne Freigabe und ohne reale Änderung. Nicht zuordenbare Dateien und vorhandene Unterordner bleiben als „Bleibt unverändert“ sichtbar.`,
      uncertainties,
      adopted: false,
      sourceInsightIds: [],
      overlapGroupKey: `folder:${dir.id}:year`,
      overlapsWithProposalIds: [],
    });
  });
  return proposals;
}

/**
 * Name-form insights alone are not a concrete alternative structure — only hints.
 * Concrete variants require a justifiable complete regrouping of the whole folder.
 * Currently no insight principle invents a complete alternative beyond prefix/year;
 * this keeps the category available without incomplete partial listings.
 */
function buildInsightVariantProposals(options: {
  scanResult: ScanResult;
  viewModel: StructureInsightViewModel | null;
  incompleteScan: boolean;
}): VirtualReorgProposal[] {
  void options.scanResult;
  void options.incompleteScan;
  if (options.viewModel === null) {
    return [];
  }
  const proposals: VirtualReorgProposal[] = [];
  for (const insight of options.viewModel.insights) {
    // Recurring file-name form: pattern evidence only → no structure variant proposal.
    if (insight.principle === PRINCIPLE_RECURRING_FILE_NAME_FORM) {
      continue;
    }
    // Parallel / folder-name patterns without a derived complete target structure:
    // do not invent groupings or omit siblings.
    if (
      insight.principle === PRINCIPLE_PARALLEL_FILE_NAME_FORM_SET ||
      insight.principle === PRINCIPLE_PARALLEL_FILE_TYPE_BUCKET ||
      insight.principle === PRINCIPLE_RECURRING_CHILD_FOLDER_NAME ||
      insight.principle === PRINCIPLE_RECURRING_CHILD_FOLDER_SET ||
      insight.principle === PRINCIPLE_RECURRING_YEAR
    ) {
      continue;
    }
    void insight;
  }
  return proposals;
}

function linkOverlaps(proposals: VirtualReorgProposal[]): void {
  for (let i = 0; i < proposals.length; i += 1) {
    const left = proposals[i]!;
    const leftIds = new Set(left.affectedFileNodeIds);
    for (let j = i + 1; j < proposals.length; j += 1) {
      const right = proposals[j]!;
      const sharesFile = right.affectedFileNodeIds.some((id) => leftIds.has(id));
      const sameFolder =
        left.sourceFolderNodeId === right.sourceFolderNodeId && left.category !== right.category;
      if (sharesFile || sameFolder) {
        if (!left.overlapsWithProposalIds.includes(right.id)) {
          left.overlapsWithProposalIds.push(right.id);
        }
        if (!right.overlapsWithProposalIds.includes(left.id)) {
          right.overlapsWithProposalIds.push(left.id);
        }
      }
    }
  }
  for (const proposal of proposals) {
    proposal.overlapsWithProposalIds.sort(compareUtf16);
    if (proposal.overlapsWithProposalIds.length > 0) {
      proposal.uncertainties.push(
        "Überlappt mit anderen Vorschlägen und ist nicht unabhängig kombinierbar.",
      );
    }
  }
}

export function buildVirtualReorgProposals(options: {
  scanResult: ScanResult;
  binding: SnapshotBinding;
  insightViewModel?: StructureInsightViewModel | null;
}): VirtualReorgProposal[] {
  const incompleteScan = options.binding.incomplete;
  const viewModel = options.insightViewModel ?? null;
  const proposals = [
    ...buildPrefixProposals({ scanResult: options.scanResult, incompleteScan }),
    ...buildYearProposals({ scanResult: options.scanResult, incompleteScan }),
    ...buildInsightVariantProposals({
      scanResult: options.scanResult,
      viewModel,
      incompleteScan,
    }),
  ].filter((proposal) => {
    // Never present an incomplete target as a complete structural proposal.
    if (!proposal.completeness.complete && proposal.category === "reviewableStructureVariant") {
      return false;
    }
    return true;
  });
  proposals.sort((left, right) => compareUtf16(left.id, right.id));
  linkOverlaps(proposals);
  proposals.sort((left, right) => compareUtf16(left.id, right.id));
  return proposals;
}

export function proposalsHaveAdoptedChanges(proposals: VirtualReorgProposal[]): boolean {
  return proposals.some((proposal) => proposal.adopted !== false);
}

/** Exported for checks: count source-folder objects referenced in a preview tree. */
export function countPreviewCoveredSourceIds(tree: VirtualPreviewEntry): number {
  const ids = new Set<string>();
  const walk = (entry: VirtualPreviewEntry): void => {
    if (
      entry.role === "regrouped" ||
      entry.role === "unchanged" ||
      entry.role === "existingChildFolder"
    ) {
      ids.add(entry.entryId);
    }
    for (const child of entry.children ?? []) {
      walk(child);
    }
  };
  walk(tree);
  return ids.size;
}
