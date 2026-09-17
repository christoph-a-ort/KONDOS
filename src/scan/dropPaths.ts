export const DROP_MULTIPLE_MESSAGE = "Bitte legen Sie genau einen Ordner auf KONDOS.";
export const DROP_FILE_MESSAGE =
  "Bitte legen Sie einen Ordner auf KONDOS. Einzelne Dateien werden derzeit nicht unterstützt.";

export type DroppedPathsDecision =
  | { action: "accept"; path: string }
  | { action: "reject-count" };

export function decideDroppedPaths(paths: string[]): DroppedPathsDecision {
  if (paths.length !== 1) {
    return { action: "reject-count" };
  }

  const path = paths[0];
  if (typeof path !== "string" || path.length === 0) {
    return { action: "reject-count" };
  }

  return { action: "accept", path };
}
