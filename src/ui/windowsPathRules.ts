/** FV2-02a – Pure Windows name and device-path rules. No filesystem access. */

const SUPERSCRIPT_DIGITS: Record<string, string> = {
  "\u2070": "0",
  "\u00B9": "1",
  "\u00B2": "2",
  "\u00B3": "3",
  "\u2074": "4",
  "\u2075": "5",
  "\u2076": "6",
  "\u2077": "7",
  "\u2078": "8",
  "\u2079": "9",
};

const RESERVED_DEVICE_STEM = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;
const FORBIDDEN_NAME_CHARS = '<>:"/\\|?*';

function foldSuperscriptDigits(value: string): string {
  return [...value].map((character) => SUPERSCRIPT_DIGITS[character] ?? character).join("");
}

function deviceStem(name: string): string {
  const folded = foldSuperscriptDigits(name);
  const beforeDot = folded.split(".")[0] ?? folded;
  return beforeDot.trim().toLowerCase();
}

function hasForbiddenChar(name: string): boolean {
  for (const character of name) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32) return true;
    if (FORBIDDEN_NAME_CHARS.includes(character)) return true;
  }
  return false;
}

export function isReservedDeviceStem(name: string): boolean {
  return RESERVED_DEVICE_STEM.test(deviceStem(name));
}

export function isWindowsDevicePath(path: string): boolean {
  const normalized = path.trim().replace(/\//g, "\\").toUpperCase();
  return normalized.startsWith("\\\\.\\") || normalized.startsWith("\\\\?\\") || normalized.startsWith("\\??\\");
}

function looksAbsoluteWindowsPath(path: string): boolean {
  const trimmed = path.trim();
  if (isWindowsDevicePath(trimmed)) return true;
  if (/^[A-Za-z]:[\\/]/.test(trimmed) || /^[A-Za-z]:$/.test(trimmed)) return true;
  const slashes = trimmed.replace(/\//g, "\\");
  return slashes.startsWith("\\\\");
}

function componentsAfterStructuralPrefix(path: string, leadingEmptyCount: number): string[] | null {
  const parts = path.split(/[\\/]/);
  let index = 0;
  let skipped = 0;
  while (index < parts.length && parts[index] === "" && skipped < leadingEmptyCount) {
    index += 1;
    skipped += 1;
  }
  if (skipped !== leadingEmptyCount) return null;
  const rest = parts.slice(index);
  if (rest.length === 0 || rest.some((part) => part.length === 0)) return null;
  return rest;
}

export function isAllowedWindowsComponent(name: string): boolean {
  if (name.length === 0 || name === "." || name === "..") return false;
  if (hasForbiddenChar(name)) return false;
  if (name.endsWith(".") || name.endsWith(" ")) return false;
  if (name.toLowerCase() === "globalroot") return false;
  return !isReservedDeviceStem(name);
}

export function isAllowedRelativePlanPath(path: string): boolean {
  if (path.includes("\0")) return false;
  if (isWindowsDevicePath(path)) return false;
  if (path.length === 0) return false;
  if (looksAbsoluteWindowsPath(path)) return false;
  if (path === ".") return true;
  if (path.includes(":")) return false;
  const unified = path.replace(/\\/g, "/");
  if (unified.startsWith("/")) return false;
  const parts = unified.split("/");
  return parts.length > 0 && parts.every((part) => isAllowedWindowsComponent(part));
}

export function isAllowedAbsoluteWindowsPath(path: string): boolean {
  if (path.includes("\0")) return false;
  if (isWindowsDevicePath(path)) return false;
  if (path.length === 0) return false;
  if (/^[A-Za-z]:$/.test(path)) return false;
  if (/^[A-Za-z]:[\\/]/.test(path)) {
    const parts = componentsAfterStructuralPrefix(path.slice(2), 1);
    return parts !== null && parts.length > 0 && parts.every((part) => isAllowedWindowsComponent(part));
  }
  const slashes = path.replace(/\//g, "\\");
  if (slashes.startsWith("\\\\")) {
    const parts = componentsAfterStructuralPrefix(slashes, 2);
    return parts !== null && parts.length >= 2 && parts.every((part) => isAllowedWindowsComponent(part));
  }
  return false;
}

export function executionPathLooksUnsafe(path: string): boolean {
  if (path.includes("\0")) return true;
  if (isWindowsDevicePath(path)) return true;
  if (looksAbsoluteWindowsPath(path)) return !isAllowedAbsoluteWindowsPath(path);
  return !isAllowedRelativePlanPath(path);
}

export interface WindowsPathRuleCaseSet {
  allowed: string[];
  rejected: string[];
}

export interface WindowsPathRuleFixture {
  version: number;
  components: WindowsPathRuleCaseSet;
  relativePaths: WindowsPathRuleCaseSet;
  absolutePaths: WindowsPathRuleCaseSet;
}

export function assertWindowsPathRuleFixture(fixture: WindowsPathRuleFixture, assert: (value: boolean, label: string) => void): void {
  assert(fixture.version === 1, "windows path rule fixture version");
  for (const name of fixture.components.allowed) {
    assert(isAllowedWindowsComponent(name), `allowed component: ${JSON.stringify(name)}`);
  }
  for (const name of fixture.components.rejected) {
    assert(!isAllowedWindowsComponent(name), `rejected component: ${JSON.stringify(name)}`);
  }
  for (const path of fixture.relativePaths.allowed) {
    assert(isAllowedRelativePlanPath(path), `allowed relative path: ${JSON.stringify(path)}`);
  }
  for (const path of fixture.relativePaths.rejected) {
    assert(!isAllowedRelativePlanPath(path), `rejected relative path: ${JSON.stringify(path)}`);
  }
  for (const path of fixture.absolutePaths.allowed) {
    assert(isAllowedAbsoluteWindowsPath(path), `allowed absolute path: ${JSON.stringify(path)}`);
  }
  for (const path of fixture.absolutePaths.rejected) {
    assert(!isAllowedAbsoluteWindowsPath(path), `rejected absolute path: ${JSON.stringify(path)}`);
  }
  assert(isAllowedAbsoluteWindowsPath("C:\\Ordner\\Datei.txt"), "drive prefix is not ADS");
  assert(!isAllowedWindowsComponent("Datei.txt:Stream"), "ADS component remains forbidden");
  assert(executionPathLooksUnsafe("CON.txt"), "execution rejects reserved relative source");
  assert(!executionPathLooksUnsafe("C:\\Ordner\\Datei.txt"), "execution accepts ordinary drive path");
}
