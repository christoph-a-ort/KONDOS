/** Parst Benutzereingaben wie `.pdf, PNG; docx`. */
export function parseExtensionInput(input: string): string[] {
  const parts = input.split(/[,;\s]+/);
  const extensions: string[] = [];

  for (const part of parts) {
    const normalized = normalizeExtension(part);
    if (normalized !== null && !extensions.includes(normalized)) {
      extensions.push(normalized);
    }
  }

  return extensions;
}

export function normalizeExtension(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed === ".") {
    return null;
  }
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

export function formatExtensionInput(extensions: string[]): string {
  return extensions.join(", ");
}
