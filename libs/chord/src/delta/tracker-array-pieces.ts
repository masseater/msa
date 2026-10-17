import { dual } from "effect/Function";

import { nodeBase, storedValue } from "./tracker-context.ts";
import { arrayOverlay, markDirty } from "./tracker-object.ts";
import {
  arrayLength,
  joinNormalized,
  rightmostPieceNode,
  splitPieceTree,
  treeFromPieces,
  updatePieceNode,
} from "./tracker-pieces.ts";
import {
  type ArrayOverlay,
  type InsertPiece,
  type JsonValue,
  type OverlayNode,
  type Piece,
  type PieceNode,
  type Stored,
} from "./tracker-types.ts";

function entryValueAtImpl(node: OverlayNode, piece: Piece, sourceIndex: number): Stored {
  const overlay = arrayOverlay(node);
  if (piece.kind === "base") {
    const valueIndex = overlay.baseOverrides?.get(sourceIndex);
    return valueIndex === undefined
      ? (nodeBase(node) as JsonValue[])[sourceIndex]!
      : storedValue(node.context, valueIndex);
  }
  const overrides = overlay.insertOverrides?.get(piece.source);
  const reference =
    overrides?.has(sourceIndex) === true
      ? overrides.get(sourceIndex)!
      : piece.source.refs[sourceIndex]!;
  return storedValue(node.context, reference);
}

function hasEntryOverrideAtImpl(overlay: ArrayOverlay, piece: Piece, sourceIndex: number): boolean {
  return piece.kind === "base"
    ? (overlay.baseOverrides?.has(sourceIndex) ?? false)
    : (overlay.insertOverrides?.get(piece.source)?.has(sourceIndex) ?? false);
}

function extendRightmostPiece(node: PieceNode, amount: number): void {
  if (node.right === undefined) node.piece.length += amount;
  else extendRightmostPiece(node.right, amount);
  updatePieceNode(node);
}

function invalidatePieceCaches(overlay: ArrayOverlay): void {
  overlay.pieces = undefined;
  overlay.baseLocations = undefined;
  overlay.insertLocations = undefined;
  overlay.plan = undefined;
}

function replacePieceRangeImpl(
  node: OverlayNode,
  index: number,
  remove: number,
  inserted: Piece[],
): void {
  if (remove === 0 && inserted.length === 0) return;
  const overlay = arrayOverlay(node);
  if (
    remove === 0 &&
    index === arrayLength(overlay) &&
    inserted.length === 1 &&
    overlay.root !== undefined
  ) {
    const addition = inserted[0]!;
    const tail = rightmostPieceNode(overlay.root).piece;
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
      markDirty(node);
      return;
    }
  }
  const [left, rest] = splitPieceTree(overlay, overlay.root, index);
  const [, right] = splitPieceTree(overlay, rest, remove);
  const middle = treeFromPieces(overlay, inserted);
  overlay.root = joinNormalized(overlay, joinNormalized(overlay, left, middle), right);
  invalidatePieceCaches(overlay);
  overlay.structural = true;
  overlay.generation += 1;
  markDirty(node);
}

export function mergePieces(pieces: Piece[]): void {
  for (let index = 1; index < pieces.length;) {
    const left = pieces[index - 1]!;
    const right = pieces[index]!;
    const sameSource =
      left.kind === right.kind &&
      (left.kind === "base" || left.source === (right as InsertPiece).source);
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

export const hasEntryOverrideAt: {
  (piece: Piece, sourceIndex: number): (overlay: ArrayOverlay) => boolean;
  (overlay: ArrayOverlay, piece: Piece, sourceIndex: number): boolean;
} = dual(3, hasEntryOverrideAtImpl);

export const replacePieceRange: {
  (index: number, remove: number, inserted: Piece[]): (node: OverlayNode) => void;
  (node: OverlayNode, index: number, remove: number, inserted: Piece[]): void;
} = dual(4, replacePieceRangeImpl);

export const entryValueAt: {
  (piece: Piece, sourceIndex: number): (node: OverlayNode) => Stored;
  (node: OverlayNode, piece: Piece, sourceIndex: number): Stored;
} = dual(3, entryValueAtImpl);
