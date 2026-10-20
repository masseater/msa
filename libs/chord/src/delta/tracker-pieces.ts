import { dual } from "effect/Function";

import trackerArrayPieces from "./tracker-array-pieces.ts";
import trackerObject from "./tracker-object.ts";
import type trackerTypesModule from "./tracker-types.types.ts";

function treeElements(node: trackerTypesModule.PieceNode | undefined): number {
  return node?.elements ?? 0;
}

function updatePieceNode(node: trackerTypesModule.PieceNode): void {
  node.elements = treeElements(node.left) + node.piece.length + treeElements(node.right);
}

function createPieceNodeImpl(
  overlay: trackerTypesModule.ArrayOverlay,
  piece: trackerTypesModule.Piece,
): trackerTypesModule.PieceNode {
  return {
    elements: piece.length,
    left: undefined,
    piece,
    priority: trackerObject.nextPiecePriority(overlay),
    right: undefined,
  };
}

function mergePieceTrees(
  left: trackerTypesModule.PieceNode | undefined,
  right: trackerTypesModule.PieceNode | undefined,
): trackerTypesModule.PieceNode | undefined {
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
  overlay: trackerTypesModule.ArrayOverlay,
  root: trackerTypesModule.PieceNode | undefined,
  index: number,
): [trackerTypesModule.PieceNode | undefined, trackerTypesModule.PieceNode | undefined] {
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
    length: root.piece.length - offset,
    start: root.piece.start + root.piece.step * offset,
  };
  return [
    mergePieceTrees(root.left, createPieceNodeImpl(overlay, first)),
    mergePieceTrees(createPieceNodeImpl(overlay, second), root.right),
  ];
}

function leftmostPieceNode(node: trackerTypesModule.PieceNode): trackerTypesModule.PieceNode {
  while (node.left !== undefined) node = node.left;
  return node;
}

function rightmostPieceNode(node: trackerTypesModule.PieceNode): trackerTypesModule.PieceNode {
  while (node.right !== undefined) node = node.right;
  return node;
}

function mergeablePieces(left: trackerTypesModule.Piece, right: trackerTypesModule.Piece): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "insert" && left.source !== (right as trackerTypesModule.InsertPiece).source)
    return false;
  if (left.length === 1 && right.length === 1) return Math.abs(right.start - left.start) === 1;
  return left.step === right.step && left.start + left.step * left.length === right.start;
}

function joinNormalizedImpl(
  overlay: trackerTypesModule.ArrayOverlay,
  left: trackerTypesModule.PieceNode | undefined,
  right: trackerTypesModule.PieceNode | undefined,
): trackerTypesModule.PieceNode | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  const leftPiece = rightmostPieceNode(left).piece;
  const rightPiece = leftmostPieceNode(right).piece;
  if (!mergeablePieces(leftPiece, rightPiece)) return mergePieceTrees(left, right);
  const [leftRest] = splitPieceTreeImpl(overlay, left, treeElements(left) - leftPiece.length);
  const [, rightRest] = splitPieceTreeImpl(overlay, right, rightPiece.length);
  const step =
    leftPiece.length === 1 ? ((rightPiece.start - leftPiece.start) as 1 | -1) : leftPiece.step;
  const combined: trackerTypesModule.Piece =
    leftPiece.kind === "base"
      ? { kind: "base", length: leftPiece.length + rightPiece.length, start: leftPiece.start, step }
      : {
          kind: "insert",
          length: leftPiece.length + rightPiece.length,
          source: leftPiece.source,
          start: leftPiece.start,
          step,
        };
  return joinNormalizedImpl(
    overlay,
    joinNormalizedImpl(overlay, leftRest, createPieceNodeImpl(overlay, combined)),
    rightRest,
  );
}

function flattenPieceTree(
  node: trackerTypesModule.PieceNode | undefined,
  output: trackerTypesModule.Piece[],
): void {
  if (node === undefined) return;
  flattenPieceTree(node.left, output);
  output.push(node.piece);
  flattenPieceTree(node.right, output);
}

function piecesOf(overlay: trackerTypesModule.ArrayOverlay): readonly trackerTypesModule.Piece[] {
  if (overlay.pieces === undefined) {
    overlay.pieces = [];
    flattenPieceTree(overlay.root, overlay.pieces);
  }
  return overlay.pieces;
}

function treeFromPiecesImpl(
  overlay: trackerTypesModule.ArrayOverlay,
  pieces: trackerTypesModule.Piece[],
): trackerTypesModule.PieceNode | undefined {
  trackerArrayPieces.mergePieces(pieces);
  let root: trackerTypesModule.PieceNode | undefined;
  for (const piece of pieces) root = mergePieceTrees(root, createPieceNodeImpl(overlay, piece));
  return root;
}

function replaceAllPiecesImpl(
  overlay: trackerTypesModule.ArrayOverlay,
  pieces: trackerTypesModule.Piece[],
): void {
  overlay.root = treeFromPiecesImpl(overlay, pieces);
  overlay.pieces = undefined;
  overlay.baseLocations = undefined;
  overlay.insertLocations = undefined;
}

function arrayLength(overlay: trackerTypesModule.ArrayOverlay): number {
  return treeElements(overlay.root);
}

function locatePieceImpl(
  overlay: trackerTypesModule.ArrayOverlay,
  index: number,
): trackerTypesModule.Piece {
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

const createPieceNode: {
  (
    piece: trackerTypesModule.Piece,
  ): (overlay: trackerTypesModule.ArrayOverlay) => trackerTypesModule.PieceNode;
  (
    overlay: trackerTypesModule.ArrayOverlay,
    piece: trackerTypesModule.Piece,
  ): trackerTypesModule.PieceNode;
} = dual(2, createPieceNodeImpl);

const replaceAllPieces: {
  (pieces: trackerTypesModule.Piece[]): (overlay: trackerTypesModule.ArrayOverlay) => void;
  (overlay: trackerTypesModule.ArrayOverlay, pieces: trackerTypesModule.Piece[]): void;
} = dual(2, replaceAllPiecesImpl);

const splitPieceTree: {
  (
    root: trackerTypesModule.PieceNode | undefined,
    index: number,
  ): (
    overlay: trackerTypesModule.ArrayOverlay,
  ) => [trackerTypesModule.PieceNode | undefined, trackerTypesModule.PieceNode | undefined];
  (
    overlay: trackerTypesModule.ArrayOverlay,
    root: trackerTypesModule.PieceNode | undefined,
    index: number,
  ): [trackerTypesModule.PieceNode | undefined, trackerTypesModule.PieceNode | undefined];
} = dual(3, splitPieceTreeImpl);

const locatePiece: {
  (index: number): (overlay: trackerTypesModule.ArrayOverlay) => trackerTypesModule.Piece;
  (overlay: trackerTypesModule.ArrayOverlay, index: number): trackerTypesModule.Piece;
} = dual(2, locatePieceImpl);

const treeFromPieces: {
  (
    pieces: trackerTypesModule.Piece[],
  ): (overlay: trackerTypesModule.ArrayOverlay) => trackerTypesModule.PieceNode | undefined;
  (
    overlay: trackerTypesModule.ArrayOverlay,
    pieces: trackerTypesModule.Piece[],
  ): trackerTypesModule.PieceNode | undefined;
} = dual(2, treeFromPiecesImpl);

const joinNormalized: {
  (
    left: trackerTypesModule.PieceNode | undefined,
    right: trackerTypesModule.PieceNode | undefined,
  ): (overlay: trackerTypesModule.ArrayOverlay) => trackerTypesModule.PieceNode | undefined;
  (
    overlay: trackerTypesModule.ArrayOverlay,
    left: trackerTypesModule.PieceNode | undefined,
    right: trackerTypesModule.PieceNode | undefined,
  ): trackerTypesModule.PieceNode | undefined;
} = dual(3, joinNormalizedImpl);

const trackerPieces = {
  arrayLength,
  createPieceNode,
  joinNormalized,
  locatePiece,
  piecesOf,
  replaceAllPieces,
  rightmostPieceNode,
  splitPieceTree,
  treeFromPieces,
  updatePieceNode,
};

export default trackerPieces;
