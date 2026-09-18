export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const maxFractionDigits = unitIndex >= 2 ? 2 : 1;
  return `${formatDeNumber(value, maxFractionDigits)} ${units[unitIndex]}`;
}

export function formatDateTime(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function createdColumnText(createdAtMs: number | undefined, directory: boolean): string {
  if (directory) {
    return "—";
  }
  return createdAtMs === undefined ? "—" : formatDateTime(createdAtMs);
}

export function formatExtensionFilter(extensions: string[]): string {
  return extensions
    .map((value) => value.replace(/^\./, "").toUpperCase())
    .filter((value) => value.length > 0)
    .join(", ");
}

export function formatTreeStatsLine(input: {
  directoryCount: number;
  fileCount: number;
  skippedCount: number;
  warningCount: number;
  durationMs: number;
}): string {
  const parts = [`${input.directoryCount} Ordner`, `${input.fileCount} Dateien`];
  if (input.skippedCount > 0) {
    parts.push(`${input.skippedCount} übersprungen`);
  }
  if (input.warningCount > 0) {
    parts.push(`${input.warningCount} Warnungen`);
  }
  parts.push(`${input.durationMs} ms`);
  return parts.join(" · ");
}

function formatDeNumber(value: number, maxFractionDigits: number): string {
  return value.toLocaleString("de-DE", {
    maximumFractionDigits: maxFractionDigits,
    minimumFractionDigits: 0,
  });
}
