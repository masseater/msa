import { dual } from "effect/Function";

import trackerArrayPieces from "./tracker-array-pieces.ts";
import trackerContext from "./tracker-context.ts";
import trackerEmitDense from "./tracker-emit-dense.ts";
import trackerEmit from "./tracker-emit.ts";
import trackerObject from "./tracker-object.ts";
import trackerPieces from "./tracker-pieces.ts";
import trackerTypes from "./tracker-types.ts";
import type trackerTypesModule from "./tracker-types.types.ts";
const { NODE, RELEASED } = trackerTypes;

function resolvePath(node: trackerTypesModule.OverlayNode): trackerTypesModule.Path | undefined {
  if (node.preparedPath !== undefined) return node.preparedPath;
  const parent = trackerContext.nodeParent(node);
  if (parent === undefined) {
    node.preparedPath = [];
    return node.preparedPath;
  }
  const parentPath = resolvePath(parent);
  if (parentPath === undefined) return undefined;
  if (node.parentKind === 0) {
    const key = node.parentKey as string;
    if (
      !trackerObject.objectHas(parent, key) ||
      trackerObject.objectValue(parent, key) !== trackerContext.nodeBase(node)
    )
      return undefined;
    node.preparedPath = [...parentPath, key];
    return node.preparedPath;
  }
  const overlay = trackerObject.arrayOverlay(parent);
  const index = findEntryIndexImpl(
    overlay,
    node.parentKind,
    node.parentKey as number,
    node.parentSource,
  );
  if (index === undefined) return undefined;
  const piece = trackerPieces.locatePiece(overlay, index);
  if (
    trackerArrayPieces.entryValueAt(parent, piece, node.parentKey as number) !==
    trackerContext.nodeBase(node)
  )
    return undefined;
  node.preparedPath = [...parentPath, index];
  return node.preparedPath;
}

function ensurePieceLocations(overlay: trackerTypesModule.ArrayOverlay): void {
  if (overlay.baseLocations !== undefined) return;
  overlay.baseLocations = [];
  overlay.insertLocations = new Map();
  let logicalStart = 0;
  for (const piece of trackerPieces.piecesOf(overlay)) {
    const last = piece.start + piece.step * (piece.length - 1);
    const location = {
      logicalStart,
      maximum: Math.max(piece.start, last),
      minimum: Math.min(piece.start, last),
      piece,
    };
    if (piece.kind === "base") overlay.baseLocations.push(location);
    else {
      let locations = overlay.insertLocations.get(piece.source);
      if (locations === undefined) {
        locations = [];
        overlay.insertLocations.set(piece.source, locations);
      }
      locations.push(location);
    }
    logicalStart += piece.length;
  }
  const byMinimum = (
    left: trackerTypesModule.PieceLocation,
    right: trackerTypesModule.PieceLocation,
  ): number => left.minimum - right.minimum;
  overlay.baseLocations.sort(byMinimum);
  for (const locations of overlay.insertLocations.values()) locations.sort(byMinimum);
}

function findEntryIndexImpl(
  overlay: trackerTypesModule.ArrayOverlay,
  kind: trackerTypesModule.ParentKind,
  sourceIndex: number,
  source: trackerTypesModule.InsertSource | undefined,
): number | undefined {
  if (kind === 1 && !overlay.structural) return sourceIndex;
  ensurePieceLocations(overlay);
  const locations = kind === 1 ? overlay.baseLocations! : overlay.insertLocations!.get(source!);
  if (locations === undefined) return undefined;
  let low = 0;
  let high = locations.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (locations[middle]!.minimum <= sourceIndex) low = middle + 1;
    else high = middle;
  }
  const location = locations[low - 1];
  if (location === undefined || sourceIndex > location.maximum) return undefined;
  const offset = (sourceIndex - location.piece.start) / location.piece.step;
  return offset >= 0 && offset < location.piece.length ? location.logicalStart + offset : undefined;
}

function ensureOperations(context: trackerTypesModule.OverlayContext): trackerTypesModule.Op[] {
  if (context.ops !== undefined) return context.ops;
  trackerContext.assertReadable(context);
  if (context.replacement) {
    const base = context.tracker.deref()?.replacementBase(context);
    context.replacementNoop =
      base !== undefined &&
      equalTrustedJsonImpl(
        base as unknown as trackerTypesModule.JsonValue,
        trackerContext.nodeBase(context.root!) as trackerTypesModule.JsonValue,
      );
    context.ops = context.replacementNoop ? [] : [["r", trackerContext.nodeBase(context.root!)]];
  } else context.ops = trackerEmit.emitOperations(context);
  return context.ops;
}

function equalTrustedJsonImpl(
  left: trackerTypesModule.JsonValue,
  right: trackerTypesModule.JsonValue,
): boolean {
  if (left === right) return true;
  if (!isContainer(left) || !isContainer(right) || Array.isArray(left) !== Array.isArray(right))
    return false;
  if (Array.isArray(left)) {
    const other = right as trackerTypesModule.JsonValue[];
    if (left.length !== other.length) return false;
    for (let index = 0; index < left.length; index++)
      if (!equalTrustedJsonImpl(left[index]!, other[index]!)) return false;
    return true;
  }
  const other = right as Record<string, trackerTypesModule.JsonValue>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(other).length) return false;
  for (const key of keys)
    if (!Object.hasOwn(other, key) || !equalTrustedJsonImpl(left[key]!, other[key]!)) return false;
  return true;
}

function abortContext(context: trackerTypesModule.OverlayContext): void {
  if (
    context.status.value === "aborted" ||
    context.status.value === "consumed" ||
    context.status.value === "stale"
  )
    return;
  context.status.value = "aborted";
  clearContext(context);
}

function releaseOverlayReferences(context: trackerTypesModule.OverlayContext): void {
  context.tracker.deref()?.releaseContext(context);
  trackerEmitDense.forgetDenseArray(context);
  context.overlayReleased = true;
  context.dirty.length = 0;
  context.nodes.length = 0;
  context.rawNodes = undefined;
  context.ops = undefined;
  context.root = undefined;
  context.bases = undefined;
  context.stored = undefined;
  context.baseValue = undefined;
}

function clearContext(context: trackerTypesModule.OverlayContext): void {
  context.tracker.deref()?.releaseContext(context);
  trackerEmitDense.forgetDenseArray(context);
  for (const node of context.nodes) {
    if (Array.isArray(node.target)) node.target.length = 0;
    Reflect.deleteProperty(node.target, NODE);
    node.writes?.clear();
    node.deletes?.clear();
    node.readded?.clear();
    if (node.array?.pieces !== undefined) node.array.pieces.length = 0;
    if (node.array !== undefined) {
      node.array.root = undefined;
      node.array.baseLocations = undefined;
      node.array.insertLocations = undefined;
    }
    node.array?.baseOverrides?.clear();
    node.array?.insertOverrides?.clear();
    node.parentSource = undefined;
    node.target = RELEASED;
    node.proxy = RELEASED;
    node.writeKey = undefined;
    node.writeValue = undefined;
    node.writes = undefined;
    node.deleteKey = undefined;
    node.deletes = undefined;
    node.readded = undefined;
    node.array = undefined;
    node.subtreeDirty = undefined;
    node.preparedPath = undefined;
  }
  context.dirty.length = 0;
  context.nodes.length = 0;
  context.rawNodes = undefined;
  context.ops = undefined;
  context.root = undefined;
  context.bases = undefined;
  context.stored = undefined;
  context.baseValue = undefined;
  context.overlayReleased = true;
}

function isContainer(value: unknown): value is trackerTypesModule.Container {
  return value !== null && typeof value === "object";
}

const findEntryIndex: {
  (
    kind: trackerTypesModule.ParentKind,
    sourceIndex: number,
    source: trackerTypesModule.InsertSource | undefined,
  ): (overlay: trackerTypesModule.ArrayOverlay) => number | undefined;
  (
    overlay: trackerTypesModule.ArrayOverlay,
    kind: trackerTypesModule.ParentKind,
    sourceIndex: number,
    source: trackerTypesModule.InsertSource | undefined,
  ): number | undefined;
} = dual(4, findEntryIndexImpl);

const equalTrustedJson: {
  (right: trackerTypesModule.JsonValue): (left: trackerTypesModule.JsonValue) => boolean;
  (left: trackerTypesModule.JsonValue, right: trackerTypesModule.JsonValue): boolean;
} = dual(2, equalTrustedJsonImpl);

const trackerPaths = {
  abortContext,
  clearContext,
  ensureOperations,
  equalTrustedJson,
  findEntryIndex,
  isContainer,
  releaseOverlayReferences,
  resolvePath,
};

export default trackerPaths;
