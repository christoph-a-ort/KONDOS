import { nextTreeSelection, idsBetween, toggleTreeId, uniqueIds } from "./treeMultiSelect";

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(label);
  }
}

export function runTreeMultiSelectCheck(): void {
  const rows = ["a", "b", "c", "d", "e"];
  const click = nextTreeSelection({
    rowIds: rows,
    selectedIds: [],
    anchorId: null,
    clickedId: "c",
    ctrlKey: false,
    shiftKey: false,
  });
  assert(click.selectedIds.join(",") === "c" && click.anchorId === "c", "plain click selects one row");

  const added = nextTreeSelection({
    rowIds: rows,
    selectedIds: click.selectedIds,
    anchorId: click.anchorId,
    clickedId: "e",
    ctrlKey: true,
    shiftKey: false,
  });
  assert(added.selectedIds.join(",") === "c,e", "Ctrl+click adds another file");

  const removed = nextTreeSelection({
    rowIds: rows,
    selectedIds: added.selectedIds,
    anchorId: added.anchorId,
    clickedId: "c",
    ctrlKey: true,
    shiftKey: false,
  });
  assert(removed.selectedIds.join(",") === "e", "Ctrl+click removes a selected file");

  const range = nextTreeSelection({
    rowIds: rows,
    selectedIds: ["b"],
    anchorId: "b",
    clickedId: "d",
    ctrlKey: false,
    shiftKey: true,
  });
  assert(range.selectedIds.join(",") === "b,c,d", "Shift+click selects a contiguous range");
  assert(range.anchorId === "b", "Shift+click keeps the anchor");

  const replaced = nextTreeSelection({
    rowIds: rows,
    selectedIds: range.selectedIds,
    anchorId: range.anchorId,
    clickedId: "a",
    ctrlKey: false,
    shiftKey: false,
  });
  assert(replaced.selectedIds.join(",") === "a", "plain click after a range returns to a single selection");

  assert(idsBetween(rows, "e", "c").join(",") === "c,d,e", "range works in both directions");
  assert(uniqueIds(["a", "a", "b"]).join(",") === "a,b", "duplicate ids collapse");
  assert(toggleTreeId(["a"], "a").length === 0, "toggle off");
}
