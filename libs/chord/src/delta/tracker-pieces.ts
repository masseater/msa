import { dual } from "effect/Function";

import { mergePieces } from "./tracker-array-pieces.ts";
import { nextPiecePriority } from "./tracker-object.ts";
import {
  type ArrayOverlay,
  type InsertPiece,
  type Piece,
  type PieceNode,
} from "./tracker-types.ts";

function treeElements(node: PieceNode | undefined): number {
  return node?.elements ?? 0;
}

export function updatePieceNode(node: PieceNode): void {
  node.elements = treeElements(node.left) + node.piece.length + treeElements(node.right);
}

function createPieceNodeImpl(overlay: ArrayOverlay, piece: Piece): PieceNode {
  return {
    piece,
    left: undefined,
    right: undefined,
    priority: nextPiecePriority(overlay),
    elements: piece.length,
  };
}

function mergePieceTrees(
  left: PieceNode | undefined,
  right: PieceNode | undefined,
): PieceNode | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  if (left.priority >= right.priority) {
    left.right = mergePieceTrees(left.right, right);
    updatePieceNode(left);
    return left;
  }
  right.left = mergePieceTrees(left, right.left);
  updatePieceNode(right);
  return right;
}

function splitPieceTreeImpl(
  overlay: ArrayOverlay,
  root: PieceNode | undefined,
  index: number,
): [PieceNode | undefined, PieceNode | undefined] {
  if (root === undefined) return [undefined, undefined];
  const leftLength = treeElements(root.left);
  if (index < leftLength) {
    const [left, right] = splitPieceTreeImpl(overlay, root.left, index);
    root.left = right;
    updatePieceNode(root);
    return [left, root];
  }
  const pieceEnd = leftLength + root.piece.length;
  if (index > pieceEnd) {
    const [left, right] = splitPieceTreeImpl(overlay, root.right, index - pieceEnd);
    root.right = left;
    updatePieceNode(root);
    return [root, right];
  }
  if (index === leftLength) {
    const left = root.left;
    root.left = undefined;
    updatePieceNode(root);
    return [left, root];
  }
  if (index === pieceEnd) {
    const right = root.right;
    root.right = undefined;
    updatePieceNode(root);
    return [root, right];
  }
  const offset = index - leftLength;
  const first = { ...root.piece, length: offset };
  const second = {
    ...root.piece,
    start: root.piece.start + root.piece.step * offset,
    length: root.piece.length - offset,
  };
  return [
    mergePieceTrees(root.left, createPieceNodeImpl(overlay, first)),
    mergePieceTrees(createPieceNodeImpl(overlay, second), root.right),
  ];
}

function leftmostPieceNode(node: PieceNode): PieceNode {
  while (node.left !== undefined) node = node.left;
  return node;
}

export function rightmostPieceNode(node: PieceNode): PieceNode {
  while (node.right !== undefined) node = node.right;
  return node;
}

function mergeablePieces(left: Piece, right: Piece): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "insert" && left.source !== (right as InsertPiece).source) return false;
  if (left.length === 1 && right.length === 1) return Math.abs(right.start - left.start) === 1;
  return left.step === right.step && left.start + left.step * left.length === right.start;
}

function joinNormalizedImpl(
  overlay: ArrayOverlay,
  left: PieceNode | undefined,
  right: PieceNode | undefined,
): PieceNode | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  const leftPiece = rightmostPieceNode(left).piece;
  const rightPiece = leftmostPieceNode(right).piece;
  if (!mergeablePieces(leftPiece, rightPiece)) return mergePieceTrees(left, right);
  const [leftRest] = splitPieceTreeImpl(overlay, left, treeElements(left) - leftPiece.length);
  const [, rightRest] = splitPieceTreeImpl(overlay, right, rightPiece.length);
  const step =
    leftPiece.length === 1 ? ((rightPiece.start - leftPiece.start) as 1 | -1) : leftPiece.step;
  const combined: Piece =
    leftPiece.kind === "base"
      ? { kind: "base", start: leftPiece.start, length: leftPiece.length + rightPiece.length, step }
      : {
          kind: "insert",
          source: leftPiece.source,
          start: leftPiece.start,
          length: leftPiece.length + rightPiece.length,
          step,
        };
  return joinNormalizedImpl(
    overlay,
    joinNormalizedImpl(overlay, leftRest, createPieceNodeImpl(overlay, combined)),
    rightRest,
  );
}

function flattenPieceTree(node: PieceNode | undefined, output: Piece[]): void {
  if (node === undefined) return;
  flattenPieceTree(node.left, output);
  output.push(node.piece);
  flattenPieceTree(node.right, output);
}

export function piecesOf(overlay: ArrayOverlay): readonly Piece[] {
  if (overlay.pieces === undefined) {
    overlay.pieces = [];
    flattenPieceTree(overlay.root, overlay.pieces);
  }
  return overlay.pieces;
}

function treeFromPiecesImpl(overlay: ArrayOverlay, pieces: Piece[]): PieceNode | undefined {
  mergePieces(pieces);
  let root: PieceNode | undefined;
  for (const piece of pieces) root = mergePieceTrees(root, createPieceNodeImpl(overlay, piece));
  return root;
}

function replaceAllPiecesImpl(overlay: ArrayOverlay, pieces: Piece[]): void {
  overlay.root = treeFromPiecesImpl(overlay, pieces);
  overlay.pieces = undefined;
  overlay.baseLocations = undefined;
  overlay.insertLocations = undefined;
}

export function arrayLength(overlay: ArrayOverlay): number {
  return treeElements(overlay.root);
}

function locatePieceImpl(overlay: ArrayOverlay, index: number): Piece {
  let node = overlay.root;
  while (node !== undefined) {
    const leftLength = treeElements(node.left);
    if (index < leftLength) node = node.left;
    else if (index >= leftLength + node.piece.length) {
      index -= leftLength + node.piece.length;
      node = node.right;
    } else {
      overlay.locatedOffset = index - leftLength;
      return node.piece;
    }
  }
  throw new RangeError("Array overlay index is out of range");
}

export const createPieceNode: {
  (piece: Piece): (overlay: ArrayOverlay) => PieceNode;
  (overlay: ArrayOverlay, piece: Piece): PieceNode;
} = dual(2, createPieceNodeImpl);

export const replaceAllPieces: {
  (pieces: Piece[]): (overlay: ArrayOverlay) => void;
  (overlay: ArrayOverlay, pieces: Piece[]): void;
} = dual(2, replaceAllPiecesImpl);

export const splitPieceTree: {
  (
    root: PieceNode | undefined,
    index: number,
  ): (overlay: ArrayOverlay) => [PieceNode | undefined, PieceNode | undefined];
  (
    overlay: ArrayOverlay,
    root: PieceNode | undefined,
    index: number,
  ): [PieceNode | undefined, PieceNode | undefined];
} = dual(3, splitPieceTreeImpl);

export const locatePiece: {
  (index: number): (overlay: ArrayOverlay) => Piece;
  (overlay: ArrayOverlay, index: number): Piece;
} = dual(2, locatePieceImpl);

export const treeFromPieces: {
  (pieces: Piece[]): (overlay: ArrayOverlay) => PieceNode | undefined;
  (overlay: ArrayOverlay, pieces: Piece[]): PieceNode | undefined;
} = dual(2, treeFromPiecesImpl);

export const joinNormalized: {
  (
    left: PieceNode | undefined,
    right: PieceNode | undefined,
  ): (overlay: ArrayOverlay) => PieceNode | undefined;
  (
    overlay: ArrayOverlay,
    left: PieceNode | undefined,
    right: PieceNode | undefined,
  ): PieceNode | undefined;
} = dual(3, joinNormalizedImpl);
