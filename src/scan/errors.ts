import type { AppError, ScanProgress } from "../model";

export function toUserError(error: unknown): string {
  if (isAppError(error)) {
    return error.message;
  }

  if (typeof error === "string" && error.trim() !== "") {
    return error;
  }

  return "Die Aktion ist fehlgeschlagen.";
}

export function isCancelledError(error: unknown): boolean {
  return findErrorKind(error) === "cancelled";
}

export function isProgressForScan(
  activeScanId: number | null,
  incoming: ScanProgress,
): boolean {
  return activeScanId !== null && incoming.scanId === activeScanId;
}

function isAppError(error: unknown): error is AppError {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  if (!("message" in error)) {
    return false;
  }

  return typeof error.message === "string" && error.message.trim() !== "";
}

function findErrorKind(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const record = error as Record<string, unknown>;
  if (typeof record.kind === "string") {
    return record.kind;
  }
  if ("error" in record) {
    return findErrorKind(record.error);
  }
  return null;
}
