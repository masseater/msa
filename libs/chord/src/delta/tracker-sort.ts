import { dual } from "effect/Function";

import { entryValueAt, replacePieceRange } from "./tracker-array-pieces.ts";
import { insertPiece } from "./tracker-array.ts";
import { clonePlacementStored } from "./tracker-clone.ts";
import { nodeBase, storedValue } from "./tracker-context.ts";
import { arrayOverlay, markDirty } from "./tracker-object.ts";
import { arrayLength, piecesOf, replaceAllPieces } from "./tracker-pieces.ts";
import { publicSortValue, restoreSortOverride, sameSortTokenAt } from "./tracker-sort-order.ts";
import type {
  ArrayOverlay,
  InsertPiece,
  InsertSource,
  JsonValue,
  OverlayNode,
  Piece,
  Stored,
} from "./tracker-types.ts";

function deduplicateArrayEntries(node: OverlayNode): void {
  const overlay = arrayOverlay(node);
  const seenBase = new Set<number>();
  const seenInsert = new Map<InsertSource, Set<number>>();
  const next: Piece[] = [];
  let duplicated = false;
  for (const piece of piecesOf(overlay)) {
    for (let offset = 0; offset < piece.length; offset++) {
      const sourceIndex = piece.start + piece.step * offset;
      let seen: boolean;
      if (piece.kind === "base") {
        seen = seenBase.has(sourceIndex);
        seenBase.add(sourceIndex);
      } else {
        let indices = seenInsert.get(piece.source);
        if (indices === undefined) {
          indices = new Set();
          seenInsert.set(piece.source, indices);
        }
        seen = indices.has(sourceIndex);
        indices.add(sourceIndex);
      }
      if (seen) {
        duplicated = true;
        appendMergedPiece(
          next,
          insertPiece(node, [
            clonePlacementStored(entryValueAt(node, piece, sourceIndex), node.context),
          ])[0]!,
        );
      } else appendMergedPiece(next, singletonPiece(piece, sourceIndex));
    }
  }
  if (!duplicated) return;
  replaceAllPieces(overlay, next);
  overlay.structural = true;
  overlay.generation += 1;
  overlay.plan = undefined;
  markDirty(node);
}

function piecesFromSortOrder(
  order: readonly number[],
  sources: readonly InsertSource[],
  indices: readonly number[],
): Piece[] {
  const pieces: Piece[] = [];
  for (const token of order) {
    const source = token < 0 ? sources[-token - 1] : undefined;
    const sourceIndex = token < 0 ? indices[-token - 1]! : token;
    const previous = pieces.at(-1);
    const sameSource =
      previous !== undefined &&
      ((source === undefined && previous.kind === "base") ||
        (source !== undefined && previous.kind === "insert" && previous.source === source));
    if (previous !== undefined && sameSource) {
      if (previous.length === 1) {
        const step = sourceIndex - previous.start;
        if (step === 1 || step === -1) {
          previous.step = step;
          previous.length = 2;
          continue;
        }
      } else if (previous.start + previous.step * previous.length === sourceIndex) {
        previous.length += 1;
        continue;
      }
    }
    pieces.push(
      source === undefined
        ? { kind: "base", start: sourceIndex, length: 1, step: 1 }
        : { kind: "insert", source, start: sourceIndex, length: 1, step: 1 },
    );
  }
  return pieces;
}

function appendMergedPiece(pieces: Piece[], piece: Piece): void {
  const previous = pieces.at(-1);
  const sameSource =
    previous !== undefined &&
    previous.kind === piece.kind &&
    (previous.kind === "base" || previous.source === (piece as InsertPiece).source);
  if (previous !== undefined && sameSource && previous.length === 1 && piece.length === 1) {
    const step = piece.start - previous.start;
    if (step === 1 || step === -1) {
      previous.step = step;
      previous.length = 2;
      return;
    }
  }
  if (
    previous !== undefined &&
    sameSource &&
    previous.step === piece.step &&
    previous.start + previous.step * previous.length === piece.start
  ) {
    previous.length += piece.length;
  } else pieces.push(piece);
}

function singletonPiece(piece: Piece, sourceIndex: number): Piece {
  return piece.kind === "base"
    ? { kind: "base", start: sourceIndex, length: 1, step: 1 }
    : { kind: "insert", source: piece.source, start: sourceIndex, length: 1, step: 1 };
}

interface SortLayout {
  readonly insertedSources: InsertSource[];
  readonly insertedIndices: number[];
  readonly insertedValues: unknown[];
  readonly baseValues: unknown[];
  readonly order: number[];
}

function sortLayout(node: OverlayNode, overlay: ArrayOverlay): SortLayout {
  const layout: SortLayout = {
    insertedSources: [],
    insertedIndices: [],
    insertedValues: [],
    baseValues: new Array((nodeBase(node) as JsonValue[]).length),
    order: [],
  };
  for (const piece of piecesOf(overlay)) {
    for (let offset = 0; offset < piece.length; offset++) {
      const sourceIndex = piece.start + piece.step * offset;
      if (piece.kind === "base") {
        layout.order.push(sourceIndex);
        layout.baseValues[sourceIndex] = publicSortValue(
          node,
          sourceIndex,
          layout.insertedSources,
          layout.insertedIndices,
        );
      } else {
        layout.insertedSources.push(piece.source);
        layout.insertedIndices.push(sourceIndex);
        const token = -layout.insertedSources.length;
        layout.order.push(token);
        layout.insertedValues.push(
          publicSortValue(node, token, layout.insertedSources, layout.insertedIndices),
        );
      }
    }
  }
  return layout;
}

function sortSnapshots(
  node: OverlayNode,
  overlay: ArrayOverlay,
): {
  readonly baseSnapshot: Map<number, Stored>;
  readonly insertSnapshots: Map<InsertSource, Map<number, Stored>>;
} {
  const baseSnapshot = new Map<number, Stored>();
  for (const [index, valueIndex] of overlay.baseOverrides ?? [])
    baseSnapshot.set(index, storedValue(node.context, valueIndex));
  const insertSnapshots = new Map<InsertSource, Map<number, Stored>>();
  for (const [source, overrides] of overlay.insertOverrides ?? []) {
    const snapshot = new Map<number, Stored>();
    for (const [index, valueIndex] of overrides)
      snapshot.set(index, storedValue(node.context, valueIndex));
    insertSnapshots.set(source, snapshot);
  }
  return { baseSnapshot, insertSnapshots };
}

function sortOrderInPlace(layout: SortLayout, comparator: unknown): void {
  layout.order.sort((left, right) => {
    const leftValue = left < 0 ? layout.insertedValues[-left - 1] : layout.baseValues[left];
    const rightValue = right < 0 ? layout.insertedValues[-right - 1] : layout.baseValues[right];
    if (typeof comparator === "function") return Number(comparator(leftValue, rightValue));
    const a = String(leftValue);
    const b = String(rightValue);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function sortOverlayImpl(node: OverlayNode, comparator: unknown): unknown {
  const overlay = arrayOverlay(node);
  const layout = sortLayout(node, overlay);
  const { baseSnapshot, insertSnapshots } = sortSnapshots(node, overlay);
  const generation = overlay.generation;
  sortOrderInPlace(layout, comparator);
  if (
    baseSnapshot.size > 0 ||
    insertSnapshots.size > 0 ||
    (overlay.baseOverrides?.size ?? 0) > 0 ||
    (overlay.insertOverrides?.size ?? 0) > 0
  ) {
    for (const token of layout.order) {
      restoreSortOverride(
        node,
        token,
        layout.insertedSources,
        layout.insertedIndices,
        baseSnapshot,
        insertSnapshots,
      );
    }
  }
  const comparatorWasStructural = overlay.generation !== generation;
  const currentLength = arrayLength(overlay);
  const samePrefix =
    currentLength >= layout.order.length &&
    layout.order.every((token, index) =>
      sameSortTokenAt(overlay, index, token, layout.insertedSources, layout.insertedIndices),
    );
  if (!samePrefix) {
    replacePieceRange(
      node,
      0,
      Math.min(layout.order.length, currentLength),
      piecesFromSortOrder(layout.order, layout.insertedSources, layout.insertedIndices),
    );
  }
  if (comparatorWasStructural) deduplicateArrayEntries(node);
  return node.proxy;
}

export const sortOverlay: {
  (comparator: unknown): (node: OverlayNode) => unknown;
  (node: OverlayNode, comparator: unknown): unknown;
} = dual(2, sortOverlayImpl);
