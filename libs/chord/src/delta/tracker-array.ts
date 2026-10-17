import { dual } from "effect/Function";

import { entryValueAt, replacePieceRange } from "./tracker-array-pieces.ts";
import { clonePlacement } from "./tracker-clone.ts";
import {
  assertWritable,
  nodeBase,
  releaseStoredValue,
  replaceStoredValue,
  storedValue,
  storeValue,
} from "./tracker-context.ts";
import {
  arrayOverlay,
  baseOverridesForWrite,
  insertOverridesForWrite,
  markDirty,
} from "./tracker-object.ts";
import { isContainer } from "./tracker-paths.ts";
import { arrayLength, locatePiece } from "./tracker-pieces.ts";
import {
  type InsertPiece,
  type JsonValue,
  NODE,
  type OverlayNode,
  type Stored,
  type StoredRef,
} from "./tracker-types.ts";

export function arrayIndex(property: PropertyKey): number | undefined {
  if (typeof property !== "string" || property.length === 0 || property.length > 10)
    return undefined;
  if (property === "0") return 0;
  const first = property.charCodeAt(0);
  if (first < 49 || first > 57) return undefined;
  let index = first - 48;
  for (let offset = 1; offset < property.length; offset++) {
    const digit = property.charCodeAt(offset) - 48;
    if (digit < 0 || digit > 9) return undefined;
    index = index * 10 + digit;
    if (index >= 4_294_967_295) return undefined;
  }
  return index;
}

function insertPieceImpl(node: OverlayNode, items: Stored[], start = 0): InsertPiece[] {
  if (items.length === start) return [];
  const refs: StoredRef[] = [];
  for (let index = start; index < items.length; index++)
    refs.push(storeValue(node.context, items[index]!));
  return [{ kind: "insert", source: { refs }, start: 0, length: refs.length, step: 1 }];
}

function insertPlacementPieceImpl(node: OverlayNode, values: unknown[], start = 0): InsertPiece[] {
  if (values.length === start) return [];
  const storedLength = node.context.stored!.length;
  try {
    for (let index = start; index < values.length; index++)
      values[index] = storeValue(node.context, clonePlacement(values[index]));
  } catch (error) {
    node.context.stored!.length = storedLength;
    throw error;
  }
  return [
    {
      kind: "insert",
      source: { refs: values as StoredRef[] },
      start,
      length: values.length - start,
      step: 1,
    },
  ];
}

function setArrayIndexImpl(node: OverlayNode, index: number, stored: Stored): void {
  const overlay = arrayOverlay(node);
  const length = arrayLength(overlay);
  if (index === length) {
    replacePieceRange(node, length, 0, insertPieceImpl(node, [stored]));
    return;
  }
  const piece = locatePiece(overlay, index);
  const sourceIndex = piece.start + piece.step * overlay.locatedOffset;
  const current = entryValueAt(node, piece, sourceIndex);
  if (!isContainer(stored) && current === stored) return;
  if (piece.kind === "base") {
    const existingIndex = overlay.baseOverrides?.get(sourceIndex);
    if (!isContainer(stored) && stored === (nodeBase(node) as JsonValue[])[sourceIndex]) {
      if (existingIndex !== undefined) releaseStoredValue(node.context, existingIndex);
      overlay.baseOverrides?.delete(sourceIndex);
    } else if (existingIndex === undefined) {
      baseOverridesForWrite(overlay).set(sourceIndex, storeValue(node.context, stored));
    } else
      overlay.baseOverrides!.set(
        sourceIndex,
        replaceStoredValue(node.context, existingIndex, stored),
      );
  } else {
    let overrides = overlay.insertOverrides?.get(piece.source);
    const existingIndex = overrides?.get(sourceIndex);
    if (
      !isContainer(stored) &&
      stored === storedValue(node.context, piece.source.refs[sourceIndex]!)
    ) {
      if (existingIndex !== undefined) releaseStoredValue(node.context, existingIndex);
      overrides?.delete(sourceIndex);
      if (overrides?.size === 0) overlay.insertOverrides?.delete(piece.source);
    } else {
      if (overrides === undefined) {
        overrides = new Map();
        insertOverridesForWrite(overlay).set(piece.source, overrides);
      }
      if (existingIndex === undefined) overrides.set(sourceIndex, storeValue(node.context, stored));
      else overrides.set(sourceIndex, replaceStoredValue(node.context, existingIndex, stored));
    }
  }
  markDirty(node);
}

function setArrayLengthImpl(node: OverlayNode, next: number): void {
  const current = arrayLength(arrayOverlay(node));
  if (next === current) return;
  if (next < current) replacePieceRange(node, next, current - next, []);
  else
    replacePieceRange(
      node,
      current,
      0,
      insertPieceImpl(
        node,
        Array.from({ length: next - current }, () => null),
      ),
    );
}

export function toArrayLength(value: unknown): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number >= 4_294_967_296)
    throw new RangeError("Invalid array length");
  return number;
}

export function toIntegerOrInfinity(value: unknown): number {
  const number = Number(value);
  if (Number.isNaN(number) || number === 0) return 0;
  return Number.isFinite(number) ? Math.trunc(number) : number;
}

function clampIndexImpl(value: number, length: number): number {
  if (value === Number.NEGATIVE_INFINITY) return 0;
  if (value < 0) return Math.max(length + value, 0);
  return Math.min(value, length);
}

export function mutatorNode(receiver: unknown): OverlayNode | undefined {
  if (!isContainer(receiver)) return undefined;
  const node = Reflect.get(receiver, NODE) as OverlayNode | undefined;
  if (node === undefined) return undefined;
  if (!Array.isArray(nodeBase(node)))
    throw new TypeError("Array mutator called on incompatible receiver");
  assertWritable(node.context);
  return node;
}

export const insertPiece: {
  (items: Stored[], start?: number): (node: OverlayNode) => InsertPiece[];
  (node: OverlayNode, items: Stored[], start?: number): InsertPiece[];
} = dual((args) => args.length >= 2, insertPieceImpl);

export const clampIndex: {
  (length: number): (value: number) => number;
  (value: number, length: number): number;
} = dual(2, clampIndexImpl);

export const setArrayIndex: {
  (index: number, stored: Stored): (node: OverlayNode) => void;
  (node: OverlayNode, index: number, stored: Stored): void;
} = dual(3, setArrayIndexImpl);

export const setArrayLength: {
  (next: number): (node: OverlayNode) => void;
  (node: OverlayNode, next: number): void;
} = dual(2, setArrayLengthImpl);

export const insertPlacementPiece: {
  (values: unknown[], start?: number): (node: OverlayNode) => InsertPiece[];
  (node: OverlayNode, values: unknown[], start?: number): InsertPiece[];
} = dual((args) => args.length >= 2, insertPlacementPieceImpl);
