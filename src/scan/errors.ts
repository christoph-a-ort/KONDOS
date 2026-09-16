import type { AppError } from "../model";

export function toUserError(error: unknown): string {
  if (isAppError(error)) {
    return error.message;
  }

  if (typeof error === "string" && error.trim() !== "") {
    return error;
  }

  return "Die Aktion ist fehlgeschlagen.";
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
