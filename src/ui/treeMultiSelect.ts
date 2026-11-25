/** P2-L.12a: Windows-typical Ctrl/Shift multi-select for visible tree rows. */
export interface TreeSelectionState {
  selectedIds: string[];
  anchorId: string | null;
}

export function emptyTreeSelection(): TreeSelectionState {
  return { selectedIds: [], anchorId: null };
}

export function singleTreeSelection(id: string): TreeSelectionState {
  return { selectedIds: [id], anchorId: id };
}

export function idsBetween(rowIds: readonly string[], fromId: string, toId: string): string[] {
  const from = rowIds.indexOf(fromId);
  const to = rowIds.indexOf(toId);
  if (from < 0 && to < 0) {
    return [toId];
  }
  if (from < 0) {
    return [toId];
  }
  if (to < 0) {
    return [fromId];
  }
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  return rowIds.slice(start, end + 1);
}

export function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function toggleTreeId(selectedIds: readonly string[], id: string): string[] {
  if (selectedIds.includes(id)) {
    return selectedIds.filter((item) => item !== id);
  }
  return [...selectedIds, id];
}

export function nextTreeSelection(options: {
  rowIds: readonly string[];
  selectedIds: readonly string[];
  anchorId: string | null;
  clickedId: string;
  ctrlKey: boolean;
  shiftKey: boolean;
}): TreeSelectionState {
  const { rowIds, selectedIds, clickedId, ctrlKey, shiftKey } = options;
  if (shiftKey) {
    const anchor = options.anchorId ?? clickedId;
    const range = idsBetween(rowIds, anchor, clickedId);
    return {
      selectedIds: ctrlKey ? uniqueIds([...selectedIds, ...range]) : range,
      anchorId: anchor,
    };
  }
  if (ctrlKey) {
    return { selectedIds: toggleTreeId(selectedIds, clickedId), anchorId: clickedId };
  }
  return singleTreeSelection(clickedId);
}

export function treeSelectionHasId(selection: TreeSelectionState, id: string): boolean {
  return selection.selectedIds.includes(id);
}
