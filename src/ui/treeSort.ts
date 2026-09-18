import { isDirectory, isFile, type FsNode } from "../model";

export type SortColumn = "name" | "size" | "modified" | "created";
export type SortDirection = "asc" | "desc";

export interface TreeSort {
  column: SortColumn;
  direction: SortDirection;
}

export const DEFAULT_TREE_SORT: TreeSort = {
  column: "name",
  direction: "asc",
};

export function compareSiblings(left: FsNode, right: FsNode, sort: TreeSort): number {
  const leftDir = isDirectory(left);
  const rightDir = isDirectory(right);
  if (leftDir !== rightDir) {
    return leftDir ? -1 : 1;
  }

  if (leftDir && rightDir) {
    if (sort.column === "name") {
      return compareName(left, right) * directionFactor(sort.direction);
    }
    return compareName(left, right);
  }

  const directed = compareFileValues(left, right, sort);
  if (directed !== 0) {
    return directed;
  }
  return compareName(left, right);
}

export function sortedChildren(children: readonly FsNode[], sort: TreeSort): FsNode[] {
  const next = children.slice();
  next.sort((left, right) => compareSiblings(left, right, sort));
  return next;
}

export function sortAfterHidingColumn(sort: TreeSort, hidden: SortColumn): TreeSort {
  if (hidden !== "name" && sort.column === hidden) {
    return DEFAULT_TREE_SORT;
  }
  return sort;
}

function compareFileValues(left: FsNode, right: FsNode, sort: TreeSort): number {
  if (sort.column === "name") {
    return compareName(left, right) * directionFactor(sort.direction);
  }

  const leftValue = sortValue(left, sort.column);
  const rightValue = sortValue(right, sort.column);
  if (leftValue === undefined && rightValue === undefined) {
    return 0;
  }
  if (leftValue === undefined) {
    return 1;
  }
  if (rightValue === undefined) {
    return -1;
  }
  if (leftValue === rightValue) {
    return 0;
  }
  const ordering = leftValue < rightValue ? -1 : 1;
  return ordering * directionFactor(sort.direction);
}

function sortValue(node: FsNode, column: SortColumn): number | undefined {
  if (!isFile(node)) {
    return undefined;
  }
  if (column === "size") {
    return node.sizeBytes;
  }
  if (column === "modified") {
    return node.modifiedAtMs;
  }
  if (column === "created") {
    return node.createdAtMs;
  }
  return undefined;
}

function directionFactor(direction: SortDirection): number {
  return direction === "asc" ? 1 : -1;
}

function compareName(left: FsNode, right: FsNode): number {
  const nameOrder = naturalCmp(left.name, right.name);
  if (nameOrder !== 0) {
    return nameOrder;
  }
  if (left.name === right.name) {
    return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
  }
  return left.name < right.name ? -1 : 1;
}

function naturalCmp(left: string, right: string): number {
  const leftFold = left.toLocaleLowerCase();
  const rightFold = right.toLocaleLowerCase();
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < leftFold.length && rightIndex < rightFold.length) {
    const leftChar = leftFold[leftIndex];
    const rightChar = rightFold[rightIndex];
    const leftDigit = isAsciiDigit(leftChar);
    const rightDigit = isAsciiDigit(rightChar);

    if (leftDigit && rightDigit) {
      const leftDigits = takeDigits(leftFold, leftIndex);
      const rightDigits = takeDigits(rightFold, rightIndex);
      const digitOrder = compareDigitRuns(leftDigits.value, rightDigits.value);
      if (digitOrder !== 0) {
        return digitOrder;
      }
      leftIndex = leftDigits.next;
      rightIndex = rightDigits.next;
      continue;
    }

    if (leftChar !== rightChar) {
      return leftChar < rightChar ? -1 : 1;
    }
    leftIndex += 1;
    rightIndex += 1;
  }

  return leftFold.length - rightFold.length;
}

function isAsciiDigit(value: string): boolean {
  return value >= "0" && value <= "9";
}

function takeDigits(value: string, start: number): { value: string; next: number } {
  let end = start;
  while (end < value.length && isAsciiDigit(value[end])) {
    end += 1;
  }
  return { value: value.slice(start, end), next: end };
}

function compareDigitRuns(left: string, right: string): number {
  const leftSig = significantDigits(left);
  const rightSig = significantDigits(right);
  if (leftSig.length !== rightSig.length) {
    return leftSig.length < rightSig.length ? -1 : 1;
  }
  if (leftSig !== rightSig) {
    return leftSig < rightSig ? -1 : 1;
  }
  return left.length - right.length;
}

function significantDigits(digits: string): string {
  const trimmed = digits.replace(/^0+/, "");
  return trimmed.length === 0 ? "0" : trimmed;
}
