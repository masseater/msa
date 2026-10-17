import { dual } from "effect/Function";

import { entryValueAt } from "./tracker-array-pieces.ts";
import { cloneStored } from "./tracker-clone.ts";
import { nodeBase, storedValue } from "./tracker-context.ts";
import { regionContaining } from "./tracker-emit-dense.ts";
import { emitChangedValue } from "./tracker-emit.ts";
import { arrayOverlay } from "./tracker-object.ts";
import { findEntryIndex } from "./tracker-paths.ts";
import { locatePiece, piecesOf } from "./tracker-pieces.ts";
import {
  type ArrayPlan,
  type DenseRegion,
  type InsertPiece,
  type JsonValue,
  MAX_DELTA_OPERATIONS,
  type NonEmptyPath,
  type Op,
  type OverlayNode,
  type Path,
  type Piece,
} from "./tracker-types.ts";

function buildArrayPlan(node: OverlayNode): ArrayPlan {
  const overlay = arrayOverlay(node);
  if (overlay.plan !== undefined) return overlay.plan;
  const base = nodeBase(node) as JsonValue[];
  const pieces = piecesOf(overlay);
  overlay.plan = orderedArrayPlan(base.length, pieces) ?? elementArrayPlan(base.length, pieces);
  return overlay.plan;
}

function orderedArrayPlan(baseLength: number, pieces: readonly Piece[]): ArrayPlan | undefined {
  const ranges: number[] = [];
  for (const piece of pieces) {
    if (piece.kind !== "base" || piece.length === 0) continue;
    if (piece.step !== 1 && piece.length > 1) return undefined;
    if (ranges.length > 0 && piece.start <= ranges[ranges.length - 1]!) return undefined;
    ranges.push(piece.start, piece.start + piece.length - 1);
  }
  const removeRuns: number[] = [];
  let end = baseLength;
  for (let index = ranges.length - 2; index >= -2; index -= 2) {
    const start = index >= 0 ? ranges[index + 1]! + 1 : 0;
    if (end > start) removeRuns.push(start, end - start);
    if (index >= 0) end = ranges[index]!;
  }
  return { removeRuns, permutation: undefined, insertRuns: insertRunsOf(pieces) };
}

function elementArrayPlan(baseLength: number, pieces: readonly Piece[]): ArrayPlan {
  const retained = new Uint8Array(baseLength);
  const targetBase: number[] = [];
  for (const piece of pieces) {
    if (piece.kind !== "base") continue;
    for (let offset = 0; offset < piece.length; offset++) {
      const index = piece.start + piece.step * offset;
      retained[index] = 1;
      targetBase.push(index);
    }
  }
  const removeRuns: number[] = [];
  for (let end = baseLength; end > 0;) {
    if (retained[end - 1] !== 0) {
      end -= 1;
      continue;
    }
    let start = end - 1;
    while (start > 0 && retained[start - 1] === 0) start -= 1;
    removeRuns.push(start, end - start);
    end = start;
  }
  const retainedBase: number[] = [];
  for (let index = 0; index < retained.length; index++)
    if (retained[index] !== 0) retainedBase.push(index);
  let permutation: number[] | undefined;
  if (targetBase.some((value, index) => value !== retainedBase[index])) {
    const positions = new Map(retainedBase.map((value, index) => [value, index]));
    permutation = targetBase.map((value) => positions.get(value)!);
  }
  return { removeRuns, permutation, insertRuns: insertRunsOf(pieces) };
}

function insertRunsOf(pieces: readonly Piece[]): number[] {
  const insertRuns: number[] = [];
  let logicalIndex = 0;
  for (let pieceIndex = 0; pieceIndex < pieces.length;) {
    const piece = pieces[pieceIndex]!;
    if (piece.kind === "base") {
      logicalIndex += piece.length;
      pieceIndex += 1;
      continue;
    }
    const startPiece = pieceIndex;
    while (pieceIndex < pieces.length && pieces[pieceIndex]!.kind === "insert") {
      logicalIndex += pieces[pieceIndex]!.length;
      pieceIndex += 1;
    }
    insertRuns.push(
      logicalIndex - rangeLength(pieces, startPiece, pieceIndex),
      startPiece,
      pieceIndex,
    );
  }
  return insertRuns;
}

function rangeLength(pieces: readonly Piece[], start: number, end: number): number {
  let length = 0;
  for (let index = start; index < end; index++) length += pieces[index]!.length;
  return length;
}

function emitArrayOperationsImpl(
  node: OverlayNode,
  path: Path,
  operations: Op[],
  denseRegions: readonly DenseRegion[] | undefined,
): void {
  const overlay = arrayOverlay(node);
  const base = nodeBase(node) as JsonValue[];
  if (denseRegions !== undefined) {
    for (const region of denseRegions) {
      if (operations.length > MAX_DELTA_OPERATIONS) return;
      operations.push(["p", path, region.start, region.length, cloneArrayRegion(node, region)]);
    }
  }
  if (overlay.structural) emitStructuralArrayOperations(node, path, operations);
  for (const [baseIndex, valueIndex] of overlay.baseOverrides ?? []) {
    if (operations.length > MAX_DELTA_OPERATIONS) return;
    const index = findEntryIndex(overlay, 1, baseIndex, undefined);
    if (
      index === undefined ||
      (denseRegions !== undefined && regionContaining(denseRegions, index))
    )
      continue;
    emitChangedValue(
      operations,
      [...path, index] as unknown as NonEmptyPath,
      base[baseIndex],
      cloneStored(storedValue(node.context, valueIndex), node.context),
    );
  }
}

function emitStructuralArrayOperations(node: OverlayNode, path: Path, operations: Op[]): void {
  const overlay = arrayOverlay(node);
  const plan = buildArrayPlan(node);
  for (let index = 0; index < plan.removeRuns.length; index += 2) {
    if (operations.length > MAX_DELTA_OPERATIONS) return;
    operations.push(["p", path, plan.removeRuns[index]!, plan.removeRuns[index + 1]!, []]);
  }
  if (plan.permutation !== undefined) operations.push(["m", path, plan.permutation]);
  const pieces = piecesOf(overlay);
  for (let run = 0; run < plan.insertRuns.length; run += 3) {
    if (operations.length > MAX_DELTA_OPERATIONS) return;
    const logicalIndex = plan.insertRuns[run]!;
    const items: JsonValue[] = [];
    for (
      let pieceIndex = plan.insertRuns[run + 1]!;
      pieceIndex < plan.insertRuns[run + 2]!;
      pieceIndex++
    ) {
      const piece = pieces[pieceIndex]! as InsertPiece;
      for (let offset = 0; offset < piece.length; offset++) {
        const sourceIndex = piece.start + piece.step * offset;
        items.push(cloneStored(entryValueAt(node, piece, sourceIndex), node.context));
      }
    }
    operations.push(["p", path, logicalIndex, 0, items]);
  }
}

function cloneArrayRegion(node: OverlayNode, region: DenseRegion): JsonValue[] {
  const overlay = arrayOverlay(node);
  const result: JsonValue[] = [];
  for (let index = region.start; index < region.start + region.length; index++) {
    const piece = locatePiece(overlay, index);
    const sourceIndex = piece.start + piece.step * overlay.locatedOffset;
    result.push(cloneStored(entryValueAt(node, piece, sourceIndex), node.context));
  }
  return result;
}

export const emitArrayOperations: {
  (
    path: Path,
    operations: Op[],
    denseRegions: readonly DenseRegion[] | undefined,
  ): (node: OverlayNode) => void;
  (
    node: OverlayNode,
    path: Path,
    operations: Op[],
    denseRegions: readonly DenseRegion[] | undefined,
  ): void;
} = dual(4, emitArrayOperationsImpl);
