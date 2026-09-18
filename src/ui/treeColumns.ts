export type OptionalColumn = "size" | "modified" | "created";
export type ColumnId = "name" | OptionalColumn;

export interface ColumnVisibility {
  size: boolean;
  modified: boolean;
  created: boolean;
}

export interface ColumnWidths {
  name: number;
  size: number;
  modified: number;
  created: number;
}

export const DEFAULT_COLUMN_VISIBILITY: ColumnVisibility = {
  size: true,
  modified: true,
  created: false,
};

export const COLUMN_MIN_WIDTH: ColumnWidths = {
  name: 180,
  size: 88,
  modified: 140,
  created: 140,
};

export const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
  name: 280,
  size: 100,
  modified: 156,
  created: 156,
};

export function visibleColumns(visibility: ColumnVisibility): ColumnId[] {
  const columns: ColumnId[] = ["name"];
  if (visibility.size) {
    columns.push("size");
  }
  if (visibility.modified) {
    columns.push("modified");
  }
  if (visibility.created) {
    columns.push("created");
  }
  return columns;
}

export interface TxtExportColumns {
  size: boolean;
  modified: boolean;
  created: boolean;
}

export function txtExportColumns(visibility: ColumnVisibility): TxtExportColumns {
  return {
    size: visibility.size,
    modified: visibility.modified,
    created: visibility.created,
  };
}

export function columnLabel(column: ColumnId): string {
  switch (column) {
    case "name":
      return "Name";
    case "size":
      return "Größe";
    case "modified":
      return "Geändert";
    case "created":
      return "Erstellt";
  }
}

export function clampColumnWidth(column: ColumnId, width: number): number {
  return Math.max(COLUMN_MIN_WIDTH[column], Math.round(width));
}

function clampedStoredWidths(stored: ColumnWidths): ColumnWidths {
  return {
    name: Math.max(COLUMN_MIN_WIDTH.name, stored.name),
    size: Math.max(COLUMN_MIN_WIDTH.size, stored.size),
    modified: Math.max(COLUMN_MIN_WIDTH.modified, stored.modified),
    created: Math.max(COLUMN_MIN_WIDTH.created, stored.created),
  };
}

/** Sichtbare Trackbreiten. Restplatz geht an Name, solange `nameAutoFill` aktiv ist. */
export function effectiveColumnWidths(
  columns: readonly ColumnId[],
  stored: ColumnWidths,
  viewportWidth: number,
  nameAutoFill: boolean,
): ColumnWidths {
  const clamped = clampedStoredWidths(stored);
  const otherWidth = columns
    .filter((column) => column !== "name")
    .reduce((sum, column) => sum + clamped[column], 0);
  if (!nameAutoFill || viewportWidth <= 0) {
    return clamped;
  }
  return {
    ...clamped,
    name: Math.max(clamped.name, viewportWidth - otherWidth),
  };
}

export function resizeStartWidth(column: ColumnId, effective: ColumnWidths): number {
  return effective[column];
}

/** Erster Drag: Restplatz in die gespeicherte Namensbreite übernehmen und Auto-Fill beenden. */
export function beginColumnResize(
  column: ColumnId,
  stored: ColumnWidths,
  effective: ColumnWidths,
): { widths: ColumnWidths; nameAutoFill: false } {
  return {
    nameAutoFill: false,
    widths: {
      ...stored,
      name: effective.name,
      [column]: effective[column],
    },
  };
}

export function applyColumnResizeDelta(
  stored: ColumnWidths,
  column: ColumnId,
  startWidth: number,
  delta: number,
): ColumnWidths {
  return {
    ...stored,
    [column]: clampColumnWidth(column, startWidth + delta),
  };
}

/** Resize-Griff am rechten Rand von `columns[index]` verändert genau diese Spalte. Letzte sichtbare Spalte: kein Griff. */
export function resizeTargetForBoundary(
  columns: readonly ColumnId[],
  index: number,
): ColumnId | null {
  if (index < 0 || index >= columns.length - 1) {
    return null;
  }
  return columns[index];
}
