import { dual } from "effect/Function";

import trackerContext from "./tracker-context.ts";
import trackerObject from "./tracker-object.ts";
import trackerPieces from "./tracker-pieces.ts";
import type trackerTypesModule from "./tracker-types.types.ts";

function entryValueAtImpl(
  node: trackerTypesModule.OverlayNode,
  piece: trackerTypesModule.Piece,
  sourceIndex: number,
): trackerTypesModule.Stored {
  const overlay = trackerObject.arrayOverlay(node);
  if (piece.kind === "base") {
    const valueIndex = overlay.baseOverrides?.get(sourceIndex);
    return valueIndex === undefined
      ? (trackerContext.nodeBase(node) as trackerTypesModule.JsonValue[])[sourceIndex]!
      : trackerContext.storedValue(node.context, valueIndex);
  }
  const overrides = overlay.insertOverrides?.get(piece.source);
  const reference =
    overrides?.has(sourceIndex) === true
      ? overrides.get(sourceIndex)!
      : piece.source.refs[sourceIndex]!;
  return trackerContext.storedValue(node.context, reference);
}

function hasEntryOverrideAtImpl(
  overlay: trackerTypesModule.ArrayOverlay,
  piece: trackerTypesModule.Piece,
  sourceIndex: number,
): boolean {
  return piece.kind === "base"
    ? (overlay.baseOverrides?.has(sourceIndex) ?? false)
    : (overlay.insertOverrides?.get(piece.source)?.has(sourceIndex) ?? false);
}

function extendRightmostPiece(node: trackerTypesModule.PieceNode, amount: number): void {
  if (node.right === undefined) node.piece.length += amount;
  else extendRightmostPiece(node.right, amount);
  trackerPieces.updatePieceNode(node);
}

function invalidatePieceCaches(overlay: trackerTypesModule.ArrayOverlay): void {
  overlay.pieces = undefined;
  overlay.baseLocations = undefined;
  overlay.insertLocations = undefined;
  overlay.plan = undefined;
}

function replacePieceRangeImpl(
  node: trackerTypesModule.OverlayNode,
  index: number,
  remove: number,
  inserted: trackerTypesModule.Piece[],
): void {
  if (remove === 0 && inserted.length === 0) return;
  const overlay = trackerObject.arrayOverlay(node);
  if (
    remove === 0 &&
    index === trackerPieces.arrayLength(overlay) &&
    inserted.length === 1 &&
    overlay.root !== undefined
  ) {
    const addition = inserted[0]!;
    const tail = trackerPieces.rightmostPieceNode(overlay.root).piece;
    if (
      addition.kind === "insert" &&
      tail.kind === "insert" &&
      tail.step === 1 &&
      tail.start + tail.length === tail.source.refs.length
    ) {
      for (let offset = 0; offset < addition.length; offset++) {
        tail.source.refs.push(addition.source.refs[addition.start + offset]!);
      }
      extendRightmostPiece(overlay.root, addition.length);
      invalidatePieceCaches(overlay);
      overlay.structural = true;
      overlay.generation += 1;
      trackerObject.markDirty(node);
      return;
    }
  }
  const [left, rest] = trackerPieces.splitPieceTree(overlay, overlay.root, index);
  const [, right] = trackerPieces.splitPieceTree(overlay, rest, remove);
  const middle = trackerPieces.treeFromPieces(overlay, inserted);
  overlay.root = trackerPieces.joinNormalized(
    overlay,
    trackerPieces.joinNormalized(overlay, left, middle),
    right,
  );
  invalidatePieceCaches(overlay);
  overlay.structural = true;
  overlay.generation += 1;
  trackerObject.markDirty(node);
}

function mergePieces(pieces: trackerTypesModule.Piece[]): void {
  for (let index = 1; index < pieces.length;) {
    const left = pieces[index - 1]!;
    const right = pieces[index]!;
    const sameSource =
      left.kind === right.kind &&
      (left.kind === "base" || left.source === (right as trackerTypesModule.InsertPiece).source);
    if (
      sameSource &&
      left.length === 1 &&
      right.length === 1 &&
      Math.abs(right.start - left.start) === 1
    ) {
      left.step = (right.start - left.start) as 1 | -1;
      left.length = 2;
      pieces.splice(index, 1);
    } else if (
      sameSource &&
      left.step === right.step &&
      left.start + left.step * left.length === right.start
    ) {
      left.length += right.length;
      pieces.splice(index, 1);
    } else index += 1;
  }
}

const hasEntryOverrideAt: {
  (
    piece: trackerTypesModule.Piece,
    sourceIndex: number,
  ): (overlay: trackerTypesModule.ArrayOverlay) => boolean;
  (
    overlay: trackerTypesModule.ArrayOverlay,
    piece: trackerTypesModule.Piece,
    sourceIndex: number,
  ): boolean;
} = dual(3, hasEntryOverrideAtImpl);

const replacePieceRange: {
  (
    index: number,
    remove: number,
    inserted: trackerTypesModule.Piece[],
  ): (node: trackerTypesModule.OverlayNode) => void;
  (
    node: trackerTypesModule.OverlayNode,
    index: number,
    remove: number,
    inserted: trackerTypesModule.Piece[],
  ): void;
} = dual(4, replacePieceRangeImpl);

const entryValueAt: {
  (
    piece: trackerTypesModule.Piece,
    sourceIndex: number,
  ): (node: trackerTypesModule.OverlayNode) => trackerTypesModule.Stored;
  (
    node: trackerTypesModule.OverlayNode,
    piece: trackerTypesModule.Piece,
    sourceIndex: number,
  ): trackerTypesModule.Stored;
} = dual(3, entryValueAtImpl);

const trackerArrayPieces = {
  entryValueAt,
  hasEntryOverrideAt,
  mergePieces,
  replacePieceRange,
};

export default trackerArrayPieces;
