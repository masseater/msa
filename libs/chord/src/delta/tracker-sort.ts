import { dual } from "effect/Function";

import trackerArrayPieces from "./tracker-array-pieces.ts";
import trackerArray from "./tracker-array.ts";
import trackerClone from "./tracker-clone.ts";
import trackerContext from "./tracker-context.ts";
import trackerObject from "./tracker-object.ts";
import trackerPieces from "./tracker-pieces.ts";
import trackerSortOrder from "./tracker-sort-order.ts";
import type trackerTypesModule from "./tracker-types.types.ts";

function deduplicateArrayEntries(node: trackerTypesModule.OverlayNode): void {
  const overlay = trackerObject.arrayOverlay(node);
  const seenBase = new Set<number>();
  const seenInsert = new Map<trackerTypesModule.InsertSource, Set<number>>();
  const next: trackerTypesModule.Piece[] = [];
  let duplicated = false;
  for (const piece of trackerPieces.piecesOf(overlay)) {
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
          trackerArray.insertPiece(node, [
            trackerClone.clonePlacementStored(
              trackerArrayPieces.entryValueAt(node, piece, sourceIndex),
              node.context,
            ),
          ])[0]!,
        );
      } else appendMergedPiece(next, singletonPiece(piece, sourceIndex));
    }
  }
  if (!duplicated) return;
  trackerPieces.replaceAllPieces(overlay, next);
  overlay.structural = true;
  overlay.generation += 1;
  overlay.plan = undefined;
  trackerObject.markDirty(node);
}

function piecesFromSortOrder(
  order: readonly number[],
  sources: readonly trackerTypesModule.InsertSource[],
  indices: readonly number[],
): trackerTypesModule.Piece[] {
  const pieces: trackerTypesModule.Piece[] = [];
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
        ? { kind: "base", length: 1, start: sourceIndex, step: 1 }
        : { kind: "insert", length: 1, source, start: sourceIndex, step: 1 },
    );
  }
  return pieces;
}

function appendMergedPiece(
  pieces: trackerTypesModule.Piece[],
  piece: trackerTypesModule.Piece,
): void {
  const previous = pieces.at(-1);
  const sameSource =
    previous !== undefined &&
    previous.kind === piece.kind &&
    (previous.kind === "base" ||
      previous.source === (piece as trackerTypesModule.InsertPiece).source);
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

function singletonPiece(
  piece: trackerTypesModule.Piece,
  sourceIndex: number,
): trackerTypesModule.Piece {
  return piece.kind === "base"
    ? { kind: "base", length: 1, start: sourceIndex, step: 1 }
    : { kind: "insert", length: 1, source: piece.source, start: sourceIndex, step: 1 };
}

interface SortLayout {
  readonly insertedSources: trackerTypesModule.InsertSource[];
  readonly insertedIndices: number[];
  readonly insertedValues: unknown[];
  readonly baseValues: unknown[];
  readonly order: number[];
}

function sortLayout(
  node: trackerTypesModule.OverlayNode,
  overlay: trackerTypesModule.ArrayOverlay,
): SortLayout {
  const layout: SortLayout = {
    baseValues: new Array((trackerContext.nodeBase(node) as trackerTypesModule.JsonValue[]).length),
    insertedIndices: [],
    insertedSources: [],
    insertedValues: [],
    order: [],
  };
  for (const piece of trackerPieces.piecesOf(overlay)) {
    for (let offset = 0; offset < piece.length; offset++) {
      const sourceIndex = piece.start + piece.step * offset;
      if (piece.kind === "base") {
        layout.order.push(sourceIndex);
        layout.baseValues[sourceIndex] = trackerSortOrder.publicSortValue(
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
          trackerSortOrder.publicSortValue(
            node,
            token,
            layout.insertedSources,
            layout.insertedIndices,
          ),
        );
      }
    }
  }
  return layout;
}

function sortSnapshots(
  node: trackerTypesModule.OverlayNode,
  overlay: trackerTypesModule.ArrayOverlay,
): {
  readonly baseSnapshot: Map<number, trackerTypesModule.Stored>;
  readonly insertSnapshots: Map<
    trackerTypesModule.InsertSource,
    Map<number, trackerTypesModule.Stored>
  >;
} {
  const baseSnapshot = new Map<number, trackerTypesModule.Stored>();
  for (const [index, valueIndex] of overlay.baseOverrides ?? [])
    baseSnapshot.set(index, trackerContext.storedValue(node.context, valueIndex));
  const insertSnapshots = new Map<
    trackerTypesModule.InsertSource,
    Map<number, trackerTypesModule.Stored>
  >();
  for (const [source, overrides] of overlay.insertOverrides ?? []) {
    const snapshot = new Map<number, trackerTypesModule.Stored>();
    for (const [index, valueIndex] of overrides)
      snapshot.set(index, trackerContext.storedValue(node.context, valueIndex));
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

function sortOverlayImpl(node: trackerTypesModule.OverlayNode, comparator: unknown): unknown {
  const overlay = trackerObject.arrayOverlay(node);
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
      trackerSortOrder.restoreSortOverride(
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
  const currentLength = trackerPieces.arrayLength(overlay);
  const samePrefix =
    currentLength >= layout.order.length &&
    layout.order.every((token, index) =>
      trackerSortOrder.sameSortTokenAt(
        overlay,
        index,
        token,
        layout.insertedSources,
        layout.insertedIndices,
      ),
    );
  if (!samePrefix) {
    trackerArrayPieces.replacePieceRange(
      node,
      0,
      Math.min(layout.order.length, currentLength),
      piecesFromSortOrder(layout.order, layout.insertedSources, layout.insertedIndices),
    );
  }
  if (comparatorWasStructural) deduplicateArrayEntries(node);
  return node.proxy;
}

const sortOverlay: {
  (comparator: unknown): (node: trackerTypesModule.OverlayNode) => unknown;
  (node: trackerTypesModule.OverlayNode, comparator: unknown): unknown;
} = dual(2, sortOverlayImpl);

const trackerSort = {
  sortOverlay,
};

export default trackerSort;
