import { dual } from "effect/Function";

import { entryValueAt } from "./tracker-array-pieces.ts";
import { assertReadable, nodeBase, nodeParent } from "./tracker-context.ts";
import { forgetDenseArray } from "./tracker-emit-dense.ts";
import { emitOperations } from "./tracker-emit.ts";
import { arrayOverlay, objectHas, objectValue } from "./tracker-object.ts";
import { locatePiece, piecesOf } from "./tracker-pieces.ts";
import {
  type ArrayOverlay,
  type Container,
  type InsertSource,
  type JsonValue,
  NODE,
  type Op,
  type OverlayContext,
  type OverlayNode,
  type ParentKind,
  type Path,
  type PieceLocation,
  RELEASED,
} from "./tracker-types.ts";

export function resolvePath(node: OverlayNode): Path | undefined {
  if (node.preparedPath !== undefined) return node.preparedPath;
  const parent = nodeParent(node);
  if (parent === undefined) {
    node.preparedPath = [];
    return node.preparedPath;
  }
  const parentPath = resolvePath(parent);
  if (parentPath === undefined) return undefined;
  if (node.parentKind === 0) {
    const key = node.parentKey as string;
    if (!objectHas(parent, key) || objectValue(parent, key) !== nodeBase(node)) return undefined;
    node.preparedPath = [...parentPath, key];
    return node.preparedPath;
  }
  const overlay = arrayOverlay(parent);
  const index = findEntryIndexImpl(
    overlay,
    node.parentKind,
    node.parentKey as number,
    node.parentSource,
  );
  if (index === undefined) return undefined;
  const piece = locatePiece(overlay, index);
  if (entryValueAt(parent, piece, node.parentKey as number) !== nodeBase(node)) return undefined;
  node.preparedPath = [...parentPath, index];
  return node.preparedPath;
}

function ensurePieceLocations(overlay: ArrayOverlay): void {
  if (overlay.baseLocations !== undefined) return;
  overlay.baseLocations = [];
  overlay.insertLocations = new Map();
  let logicalStart = 0;
  for (const piece of piecesOf(overlay)) {
    const last = piece.start + piece.step * (piece.length - 1);
    const location = {
      piece,
      logicalStart,
      minimum: Math.min(piece.start, last),
      maximum: Math.max(piece.start, last),
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
  const byMinimum = (left: PieceLocation, right: PieceLocation): number =>
    left.minimum - right.minimum;
  overlay.baseLocations.sort(byMinimum);
  for (const locations of overlay.insertLocations.values()) locations.sort(byMinimum);
}

function findEntryIndexImpl(
  overlay: ArrayOverlay,
  kind: ParentKind,
  sourceIndex: number,
  source: InsertSource | undefined,
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

export function ensureOperations(context: OverlayContext): Op[] {
  if (context.ops !== undefined) return context.ops;
  assertReadable(context);
  if (context.replacement) {
    const base = context.tracker.deref()?.replacementBase(context);
    context.replacementNoop =
      base !== undefined &&
      equalTrustedJsonImpl(base as unknown as JsonValue, nodeBase(context.root!) as JsonValue);
    context.ops = context.replacementNoop ? [] : [["r", nodeBase(context.root!)]];
  } else context.ops = emitOperations(context);
  return context.ops;
}

function equalTrustedJsonImpl(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (!isContainer(left) || !isContainer(right) || Array.isArray(left) !== Array.isArray(right))
    return false;
  if (Array.isArray(left)) {
    const other = right as JsonValue[];
    if (left.length !== other.length) return false;
    for (let index = 0; index < left.length; index++)
      if (!equalTrustedJsonImpl(left[index]!, other[index]!)) return false;
    return true;
  }
  const other = right as Record<string, JsonValue>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(other).length) return false;
  for (const key of keys)
    if (!Object.hasOwn(other, key) || !equalTrustedJsonImpl(left[key]!, other[key]!)) return false;
  return true;
}

export function abortContext(context: OverlayContext): void {
  if (
    context.status.value === "aborted" ||
    context.status.value === "consumed" ||
    context.status.value === "stale"
  )
    return;
  context.status.value = "aborted";
  clearContext(context);
}

export function releaseOverlayReferences(context: OverlayContext): void {
  context.tracker.deref()?.releaseContext(context);
  forgetDenseArray(context);
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

export function clearContext(context: OverlayContext): void {
  context.tracker.deref()?.releaseContext(context);
  forgetDenseArray(context);
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

export function isContainer(value: unknown): value is Container {
  return value !== null && typeof value === "object";
}

export const findEntryIndex: {
  (
    kind: ParentKind,
    sourceIndex: number,
    source: InsertSource | undefined,
  ): (overlay: ArrayOverlay) => number | undefined;
  (
    overlay: ArrayOverlay,
    kind: ParentKind,
    sourceIndex: number,
    source: InsertSource | undefined,
  ): number | undefined;
} = dual(4, findEntryIndexImpl);

export const equalTrustedJson: {
  (right: JsonValue): (left: JsonValue) => boolean;
  (left: JsonValue, right: JsonValue): boolean;
} = dual(2, equalTrustedJsonImpl);
