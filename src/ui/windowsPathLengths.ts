/** FV2-02b – Conservative Windows target-path length rules. No filesystem access. */

export const MAX_ABSOLUTE_TARGET_UTF16 = 259;
export const NUL_INCLUDED_MAX = 260;
export const CONSERVATIVE_COMPONENT_UTF16 = 255;

export function utf16Length(value: string): number {
  return value.length;
}

export function windowsTargetPath(scanRoot: string, relative: string): string {
  if (relative === "." || relative === "") return scanRoot;
  const slash = scanRoot.includes("\\") ? "\\" : "/";
  return `${scanRoot.replace(/[\\/]+$/, "")}${slash}${relative.replace(/[\\/]/g, slash)}`;
}

export function relativeTargetComponents(relativeTarget: string): string[] {
  if (relativeTarget === "." || relativeTarget === "") return [];
  return relativeTarget.replace(/\\/g, "/").split("/").filter((part) => part.length > 0);
}

export function lastTargetComponent(relativeTarget: string): string | null {
  const parts = relativeTargetComponents(relativeTarget);
  return parts.length > 0 ? parts[parts.length - 1]! : null;
}

/** Existing inventory prefixes are skipped. Null means the planner cannot tell. */
export function newComponentsRelativeToExisting(
  relativeTarget: string,
  existingRelativeDirectory: (relativePath: string) => boolean | null,
): string[] | null {
  const parts = relativeTargetComponents(relativeTarget);
  if (parts.length === 0) return null;
  const created: string[] = [];
  let acc = "";
  for (const part of parts) {
    acc = acc === "" ? part : `${acc}/${part}`;
    const existing = existingRelativeDirectory(acc);
    if (existing === null) return null;
    if (existing) continue;
    created.push(part);
  }
  return created;
}

export function isAllowedAbsoluteTargetTotalLength(absoluteTarget: string): boolean {
  return utf16Length(absoluteTarget) + 1 <= NUL_INCLUDED_MAX;
}

export function effectiveComponentLimit(filesystemComponentLimit: number): number {
  return Math.min(CONSERVATIVE_COMPONENT_UTF16, Math.floor(filesystemComponentLimit));
}

export function isAllowedNewComponentLength(name: string, filesystemComponentLimit: number): boolean {
  return utf16Length(name) <= effectiveComponentLimit(filesystemComponentLimit);
}

export function exceedsConservativeComponentCap(name: string): boolean {
  return utf16Length(name) > CONSERVATIVE_COMPONENT_UTF16;
}

export type TargetLengthKind = "total" | "component" | "unknownLimit" | "unknownComponents";

export interface TargetLengthVerdict {
  ok: boolean;
  kind?: TargetLengthKind;
  reason?: string;
}

export function evaluateNewTargetPathLength(
  absoluteTarget: string,
  newComponents: readonly string[],
  options: { filesystemComponentLimit: number | null; requireKnownVolumeLimit: boolean },
): TargetLengthVerdict {
  if (!isAllowedAbsoluteTargetTotalLength(absoluteTarget)) {
    return {
      ok: false,
      kind: "total",
      reason: "Der Zielpfad überschreitet die zulässige Windows-Pfadlänge.",
    };
  }
  if (newComponents.length === 0) {
    return {
      ok: false,
      kind: "unknownComponents",
      reason: "Neue Zielkomponenten sind nicht sicher bestimmbar.",
    };
  }
  if (newComponents.some((name) => exceedsConservativeComponentCap(name))) {
    return {
      ok: false,
      kind: "component",
      reason: "Eine neue Zielkomponente überschreitet die konservative Namenslänge.",
    };
  }
  if (options.requireKnownVolumeLimit) {
    const limit = options.filesystemComponentLimit;
    if (limit === null || !Number.isFinite(limit) || limit <= 0) {
      return {
        ok: false,
        kind: "unknownLimit",
        reason: "Die Dateisystem-Komponentengrenze ist nicht sicher bestimmbar.",
      };
    }
    if (newComponents.some((name) => !isAllowedNewComponentLength(name, limit))) {
      return {
        ok: false,
        kind: "component",
        reason: "Eine neue Zielkomponente überschreitet die Dateisystemgrenze.",
      };
    }
  }
  return { ok: true };
}

export function fillAsciiComponent(size: number, fill = "A"): string {
  return fill.repeat(size);
}

export function buildAbsoluteFromSizes(root: string, sizes: readonly number[], fill = "A"): string {
  const slash = root.includes("\\") ? "\\" : "/";
  const trimmed = root.replace(/[\\/]+$/, "");
  return [trimmed, ...sizes.map((size) => fillAsciiComponent(size, fill))].join(slash);
}

export interface WindowsPathLengthRecipe {
  id: string;
  root: string;
  sizes: number[];
  fill?: string;
  totalAllowed: boolean;
  componentAllowed: boolean;
}

export interface WindowsPathLengthLiteral {
  id: string;
  absolute: string;
  expectedUtf16: number;
  totalAllowed: boolean;
  grantsRealExecution?: boolean;
}

export interface WindowsPathLengthUnknownLimit {
  id: string;
  absolute: string;
  newComponents: string[];
  expectedOk: boolean;
}

export interface WindowsPathLengthFixture {
  version: number;
  limits: {
    maxAbsoluteUtf16: number;
    nulIncludedMax: number;
    conservativeComponentUtf16: number;
  };
  recipes: WindowsPathLengthRecipe[];
  literals: WindowsPathLengthLiteral[];
  unknownLimit?: WindowsPathLengthUnknownLimit[];
}

export function assertWindowsPathLengthFixture(
  fixture: WindowsPathLengthFixture,
  assert: (value: boolean, label: string) => void,
): void {
  assert(fixture.version === 1, "windows path length fixture version");
  assert(fixture.limits.maxAbsoluteUtf16 === MAX_ABSOLUTE_TARGET_UTF16, "shared max absolute utf16");
  assert(fixture.limits.nulIncludedMax === NUL_INCLUDED_MAX, "shared nul-included max");
  assert(fixture.limits.conservativeComponentUtf16 === CONSERVATIVE_COMPONENT_UTF16, "shared conservative component");
  for (const recipe of fixture.recipes) {
    const fill = recipe.fill ?? "A";
    const absolute = buildAbsoluteFromSizes(recipe.root, recipe.sizes, fill);
    const total = utf16Length(absolute);
    const expectedTotal = recipe.sizes.reduce(
      (sum, size, index) => sum + size + (index === 0 ? utf16Length(recipe.root.replace(/[\\/]+$/, "")) + 1 : 1),
      0,
    );
    assert(total === expectedTotal, `${recipe.id} utf16 length is computed, not assumed: ${total} === ${expectedTotal}`);
    assert(isAllowedAbsoluteTargetTotalLength(absolute) === recipe.totalAllowed, `${recipe.id} total length`);
    const names = recipe.sizes.map((size) => fillAsciiComponent(size, fill));
    const componentOk = names.every((name) => !exceedsConservativeComponentCap(name));
    assert(componentOk === recipe.componentAllowed, `${recipe.id} conservative component cap`);
    const known = evaluateNewTargetPathLength(absolute, names, {
      filesystemComponentLimit: CONSERVATIVE_COMPONENT_UTF16,
      requireKnownVolumeLimit: true,
    });
    assert(known.ok === (recipe.totalAllowed && recipe.componentAllowed), `${recipe.id} combined known-volume verdict`);
  }
  for (const literal of fixture.literals) {
    assert(utf16Length(literal.absolute) === literal.expectedUtf16, `${literal.id} literal utf16`);
    assert(isAllowedAbsoluteTargetTotalLength(literal.absolute) === literal.totalAllowed, `${literal.id} literal total`);
    if (literal.grantsRealExecution === false) {
      const last = lastTargetComponent(literal.absolute);
      if (last === null) throw new Error(`${literal.id} has a determinable last component`);
      const verdict = evaluateNewTargetPathLength(literal.absolute, [last], {
        filesystemComponentLimit: CONSERVATIVE_COMPONENT_UTF16,
        requireKnownVolumeLimit: true,
      });
      assert(verdict.ok === literal.totalAllowed, `${literal.id} length verdict follows totalAllowed, not execute metadata`);
      assert(
        !("status" in verdict) && !("canConfirm" in verdict) && !("grantsRealExecution" in verdict),
        `${literal.id} length verdict has no execution-grant fields`,
      );
    }
  }
  for (const row of fixture.unknownLimit ?? []) {
    const verdict = evaluateNewTargetPathLength(row.absolute, row.newComponents, {
      filesystemComponentLimit: null,
      requireKnownVolumeLimit: true,
    });
    assert(verdict.ok === row.expectedOk, `${row.id} unknown volume limit`);
    assert(verdict.kind === "unknownLimit", `${row.id} unknownLimit kind`);
  }
  const emoji = "📁";
  assert(utf16Length(emoji) === 2, "BMP-outside emoji is two UTF-16 units");
  assert(utf16Length("C:\\📁") === 5, "C:\\📁 is five UTF-16 units");
  const multi = newComponentsRelativeToExisting("Projekte/2026/Rechnungen", (path) => path === "Projekte" ? false : false);
  assert(multi !== null && multi.join("/") === "Projekte/2026/Rechnungen", "all newly created components are collected");
  const skipExisting = newComponentsRelativeToExisting("Projekte/2026/Rechnungen", (path) => (path === "Projekte" ? true : false));
  assert(skipExisting !== null && skipExisting.join("/") === "2026/Rechnungen", "existing inventory prefixes are not treated as new");
}
