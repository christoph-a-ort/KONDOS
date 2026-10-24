/** FV2-02c – Derived inventory mark for existing Windows name problems. Display only. */

import { isAllowedWindowsComponent, isWindowsDevicePath } from "./windowsPathRules";

export const EXISTING_WINDOWS_NAME_MARK = "nicht ausführbar";
export const EXISTING_WINDOWS_NAME_TITLE =
  "Problematischer Windows-Name – echte Dateioperationen nicht zulässig";

export interface ExistingWindowsNameIssue {
  hasProblematicExistingName: true;
  problematicComponents: string[];
}

function inventoryNameComponents(path: string): string[] {
  if (path.length === 0) return [];
  if (/^[A-Za-z]:$/.test(path)) return [];
  if (/^[A-Za-z]:[\\/]/.test(path)) {
    const parts = path.slice(2).split(/[\\/]/);
    return parts.filter((part, index) => !(index === 0 && part === ""));
  }
  const slashes = path.replace(/\//g, "\\");
  if (slashes.startsWith("\\\\")) {
    const parts = slashes.split("\\");
    let index = 0;
    let skipped = 0;
    while (index < parts.length && parts[index] === "" && skipped < 2) {
      index += 1;
      skipped += 1;
    }
    return skipped === 2 ? parts.slice(index) : parts.filter((part) => part.length > 0);
  }
  return path
    .replace(/\\/g, "/")
    .split("/")
    .filter((part, index) => !(index === 0 && part === "") && part !== ".");
}

export function existingWindowsNameIssue(path: string): ExistingWindowsNameIssue | null {
  if (path.includes("\0") || isWindowsDevicePath(path)) {
    return { hasProblematicExistingName: true, problematicComponents: [path] };
  }
  const problematicComponents = inventoryNameComponents(path).filter(
    (part) => !isAllowedWindowsComponent(part),
  );
  if (problematicComponents.length === 0) return null;
  return { hasProblematicExistingName: true, problematicComponents };
}

export function hasProblematicExistingWindowsName(path: string): boolean {
  return existingWindowsNameIssue(path) !== null;
}

export function existingWindowsNameIssueForNode(node: {
  name: string;
  path: string;
}): ExistingWindowsNameIssue | null {
  return existingWindowsNameIssue(node.path) ?? existingWindowsNameIssue(node.name);
}