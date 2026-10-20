import { dual } from "effect/Function";

import trackerArrayPieces from "./tracker-array-pieces.ts";
import trackerClone from "./tracker-clone.ts";
import trackerContext from "./tracker-context.ts";
import trackerEmitArrayKit from "./tracker-emit-array-kit.ts";
import trackerObject from "./tracker-object.ts";
import trackerPaths from "./tracker-paths.ts";
import trackerPieces from "./tracker-pieces.ts";
import trackerTypes from "./tracker-types.ts";
import type trackerTypesModule from "./tracker-types.types.ts";
const { MAX_DELTA_OPERATIONS } = trackerTypes;

function buildArrayPlan(node: trackerTypesModule.OverlayNode): trackerTypesModule.ArrayPlan {
  const overlay = trackerObject.arrayOverlay(node);
  if (overlay.plan !== undefined) return overlay.plan;
  const base = trackerContext.nodeBase(node) as trackerTypesModule.JsonValue[];
  const pieces = trackerPieces.piecesOf(overlay);
  overlay.plan = orderedArrayPlan(base.length, pieces) ?? elementArrayPlan(base.length, pieces);
  return overlay.plan;
}

function orderedArrayPlan(
  baseLength: number,
  pieces: readonly trackerTypesModule.Piece[],
): trackerTypesModule.ArrayPlan | undefined {
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
  return { insertRuns: insertRunsOf(pieces), permutation: undefined, removeRuns };
}

function elementArrayPlan(
  baseLength: number,
  pieces: readonly trackerTypesModule.Piece[],
): trackerTypesModule.ArrayPlan {
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
  return { insertRuns: insertRunsOf(pieces), permutation, removeRuns };
}

function insertRunsOf(pieces: readonly trackerTypesModule.Piece[]): number[] {
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

function rangeLength(
  pieces: readonly trackerTypesModule.Piece[],
  start: number,
  end: number,
): number {
  let length = 0;
  for (let index = start; index < end; index++) length += pieces[index]!.length;
  return length;
}

function emitArrayOperationsImpl(
  node: trackerTypesModule.OverlayNode,
  path: trackerTypesModule.Path,
  operations: trackerTypesModule.Op[],
  denseRegions: readonly trackerTypesModule.DenseRegion[] | undefined,
): void {
  const overlay = trackerObject.arrayOverlay(node);
  const base = trackerContext.nodeBase(node) as trackerTypesModule.JsonValue[];
  if (denseRegions !== undefined) {
    for (const region of denseRegions) {
      if (operations.length > MAX_DELTA_OPERATIONS) return;
      operations.push(["p", path, region.start, region.length, cloneArrayRegion(node, region)]);
    }
  }
  if (overlay.structural) emitStructuralArrayOperations(node, path, operations);
  for (const [baseIndex, valueIndex] of overlay.baseOverrides ?? []) {
    if (operations.length > MAX_DELTA_OPERATIONS) return;
    const index = trackerPaths.findEntryIndex(overlay, 1, baseIndex, undefined);
    if (
      index === undefined ||
      (denseRegions !== undefined &&
        trackerEmitArrayKit.trackerEmitDense.regionContaining(denseRegions, index))
    )
      continue;
    trackerEmitArrayKit.trackerEmit.emitChangedValue(
      operations,
      [...path, index] as unknown as trackerTypesModule.NonEmptyPath,
      base[baseIndex],
      trackerClone.cloneStored(trackerContext.storedValue(node.context, valueIndex), node.context),
    );
  }
}

function emitStructuralArrayOperations(
  node: trackerTypesModule.OverlayNode,
  path: trackerTypesModule.Path,
  operations: trackerTypesModule.Op[],
): void {
  const overlay = trackerObject.arrayOverlay(node);
  const plan = buildArrayPlan(node);
  for (let index = 0; index < plan.removeRuns.length; index += 2) {
    if (operations.length > MAX_DELTA_OPERATIONS) return;
    operations.push(["p", path, plan.removeRuns[index]!, plan.removeRuns[index + 1]!, []]);
  }
  if (plan.permutation !== undefined) operations.push(["m", path, plan.permutation]);
  const pieces = trackerPieces.piecesOf(overlay);
  for (let run = 0; run < plan.insertRuns.length; run += 3) {
    if (operations.length > MAX_DELTA_OPERATIONS) return;
    const logicalIndex = plan.insertRuns[run]!;
    const items: trackerTypesModule.JsonValue[] = [];
    for (
      let pieceIndex = plan.insertRuns[run + 1]!;
      pieceIndex < plan.insertRuns[run + 2]!;
      pieceIndex++
    ) {
      const piece = pieces[pieceIndex]! as trackerTypesModule.InsertPiece;
      for (let offset = 0; offset < piece.length; offset++) {
        const sourceIndex = piece.start + piece.step * offset;
        items.push(
          trackerClone.cloneStored(
            trackerArrayPieces.entryValueAt(node, piece, sourceIndex),
            node.context,
          ),
        );
      }
    }
    operations.push(["p", path, logicalIndex, 0, items]);
  }
}

function cloneArrayRegion(
  node: trackerTypesModule.OverlayNode,
  region: trackerTypesModule.DenseRegion,
): trackerTypesModule.JsonValue[] {
  const overlay = trackerObject.arrayOverlay(node);
  const result: trackerTypesModule.JsonValue[] = [];
  for (let index = region.start; index < region.start + region.length; index++) {
    const piece = trackerPieces.locatePiece(overlay, index);
    const sourceIndex = piece.start + piece.step * overlay.locatedOffset;
    result.push(
      trackerClone.cloneStored(
        trackerArrayPieces.entryValueAt(node, piece, sourceIndex),
        node.context,
      ),
    );
  }
  return result;
}

const emitArrayOperations: {
  (
    path: trackerTypesModule.Path,
    operations: trackerTypesModule.Op[],
    denseRegions: readonly trackerTypesModule.DenseRegion[] | undefined,
  ): (node: trackerTypesModule.OverlayNode) => void;
  (
    node: trackerTypesModule.OverlayNode,
    path: trackerTypesModule.Path,
    operations: trackerTypesModule.Op[],
    denseRegions: readonly trackerTypesModule.DenseRegion[] | undefined,
  ): void;
} = dual(4, emitArrayOperationsImpl);

const trackerEmitArray = {
  emitArrayOperations,
};

export default trackerEmitArray;
