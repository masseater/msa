import { dual } from "effect/Function";

import trackerArrayPieces from "./tracker-array-pieces.ts";
import trackerClone from "./tracker-clone.ts";
import trackerContext from "./tracker-context.ts";
import trackerObject from "./tracker-object.ts";
import trackerPaths from "./tracker-paths.ts";
import trackerPieces from "./tracker-pieces.ts";
import trackerTypes from "./tracker-types.ts";
import type trackerTypesModule from "./tracker-types.types.ts";
const { NODE } = trackerTypes;

function arrayIndex(property: PropertyKey): number | undefined {
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

function insertPieceImpl(
  node: trackerTypesModule.OverlayNode,
  items: trackerTypesModule.Stored[],
  start = 0,
): trackerTypesModule.InsertPiece[] {
  if (items.length === start) return [];
  const refs: trackerTypesModule.StoredRef[] = [];
  for (let index = start; index < items.length; index++)
    refs.push(trackerContext.storeValue(node.context, items[index]!));
  return [{ kind: "insert", length: refs.length, source: { refs }, start: 0, step: 1 }];
}

function insertPlacementPieceImpl(
  node: trackerTypesModule.OverlayNode,
  values: unknown[],
  start = 0,
): trackerTypesModule.InsertPiece[] {
  if (values.length === start) return [];
  const storedLength = node.context.stored!.length;
  try {
    for (let index = start; index < values.length; index++)
      values[index] = trackerContext.storeValue(
        node.context,
        trackerClone.clonePlacement(values[index]),
      );
  } catch (error) {
    node.context.stored!.length = storedLength;
    throw error;
  }
  return [
    {
      kind: "insert",
      length: values.length - start,
      source: { refs: values as trackerTypesModule.StoredRef[] },
      start,
      step: 1,
    },
  ];
}

type ArrayOverlay = ReturnType<typeof trackerObject.arrayOverlay>;
type LocatedPiece = ReturnType<typeof trackerPieces.locatePiece>;

function writeBaseIndex(
  node: trackerTypesModule.OverlayNode,
  overlay: ArrayOverlay,
  sourceIndex: number,
  stored: trackerTypesModule.Stored,
): void {
  const existingIndex = overlay.baseOverrides?.get(sourceIndex);
  if (
    !trackerPaths.isContainer(stored) &&
    stored === (trackerContext.nodeBase(node) as trackerTypesModule.JsonValue[])[sourceIndex]
  ) {
    if (existingIndex !== undefined) trackerContext.releaseStoredValue(node.context, existingIndex);
    overlay.baseOverrides?.delete(sourceIndex);
  } else if (existingIndex === undefined) {
    trackerObject
      .baseOverridesForWrite(overlay)
      .set(sourceIndex, trackerContext.storeValue(node.context, stored));
  } else
    overlay.baseOverrides!.set(
      sourceIndex,
      trackerContext.replaceStoredValue(node.context, existingIndex, stored),
    );
}

function writeInsertIndex(
  node: trackerTypesModule.OverlayNode,
  overlay: ArrayOverlay,
  piece: LocatedPiece & { readonly kind: "insert" },
  sourceIndex: number,
  stored: trackerTypesModule.Stored,
): void {
  let overrides = overlay.insertOverrides?.get(piece.source);
  const existingIndex = overrides?.get(sourceIndex);
  if (
    !trackerPaths.isContainer(stored) &&
    stored === trackerContext.storedValue(node.context, piece.source.refs[sourceIndex]!)
  ) {
    if (existingIndex !== undefined) trackerContext.releaseStoredValue(node.context, existingIndex);
    overrides?.delete(sourceIndex);
    if (overrides?.size === 0) overlay.insertOverrides?.delete(piece.source);
  } else {
    if (overrides === undefined) {
      overrides = new Map();
      trackerObject.insertOverridesForWrite(overlay).set(piece.source, overrides);
    }
    if (existingIndex === undefined)
      overrides.set(sourceIndex, trackerContext.storeValue(node.context, stored));
    else
      overrides.set(
        sourceIndex,
        trackerContext.replaceStoredValue(node.context, existingIndex, stored),
      );
  }
}

function setArrayIndexImpl(
  node: trackerTypesModule.OverlayNode,
  index: number,
  stored: trackerTypesModule.Stored,
): void {
  const overlay = trackerObject.arrayOverlay(node);
  const length = trackerPieces.arrayLength(overlay);
  if (index === length) {
    trackerArrayPieces.replacePieceRange(node, length, 0, insertPieceImpl(node, [stored]));
    return;
  }
  const piece = trackerPieces.locatePiece(overlay, index);
  const sourceIndex = piece.start + piece.step * overlay.locatedOffset;
  const current = trackerArrayPieces.entryValueAt(node, piece, sourceIndex);
  if (!trackerPaths.isContainer(stored) && current === stored) return;
  if (piece.kind === "base") writeBaseIndex(node, overlay, sourceIndex, stored);
  else writeInsertIndex(node, overlay, piece, sourceIndex, stored);
  trackerObject.markDirty(node);
}

function setArrayLengthImpl(node: trackerTypesModule.OverlayNode, next: number): void {
  const current = trackerPieces.arrayLength(trackerObject.arrayOverlay(node));
  if (next === current) return;
  if (next < current) trackerArrayPieces.replacePieceRange(node, next, current - next, []);
  else
    trackerArrayPieces.replacePieceRange(
      node,
      current,
      0,
      insertPieceImpl(
        node,
        Array.from({ length: next - current }, () => null),
      ),
    );
}

function toArrayLength(value: unknown): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number >= 4_294_967_296)
    throw new RangeError("Invalid array length");
  return number;
}

function toIntegerOrInfinity(value: unknown): number {
  const number = Number(value);
  if (Number.isNaN(number) || number === 0) return 0;
  return Number.isFinite(number) ? Math.trunc(number) : number;
}

function clampIndexImpl(value: number, length: number): number {
  if (value === Number.NEGATIVE_INFINITY) return 0;
  if (value < 0) return Math.max(length + value, 0);
  return Math.min(value, length);
}

function mutatorNode(receiver: unknown): trackerTypesModule.OverlayNode | undefined {
  if (!trackerPaths.isContainer(receiver)) return undefined;
  const node = Reflect.get(receiver, NODE) as trackerTypesModule.OverlayNode | undefined;
  if (node === undefined) return undefined;
  if (!Array.isArray(trackerContext.nodeBase(node)))
    throw new TypeError("Array mutator called on incompatible receiver");
  trackerContext.assertWritable(node.context);
  return node;
}

const insertPiece: {
  (
    items: trackerTypesModule.Stored[],
    start?: number,
  ): (node: trackerTypesModule.OverlayNode) => trackerTypesModule.InsertPiece[];
  (
    node: trackerTypesModule.OverlayNode,
    items: trackerTypesModule.Stored[],
    start?: number,
  ): trackerTypesModule.InsertPiece[];
} = dual((args) => args.length >= 2, insertPieceImpl);

const clampIndex: {
  (length: number): (value: number) => number;
  (value: number, length: number): number;
} = dual(2, clampIndexImpl);

const setArrayIndex: {
  (
    index: number,
    stored: trackerTypesModule.Stored,
  ): (node: trackerTypesModule.OverlayNode) => void;
  (node: trackerTypesModule.OverlayNode, index: number, stored: trackerTypesModule.Stored): void;
} = dual(3, setArrayIndexImpl);

const setArrayLength: {
  (next: number): (node: trackerTypesModule.OverlayNode) => void;
  (node: trackerTypesModule.OverlayNode, next: number): void;
} = dual(2, setArrayLengthImpl);

const insertPlacementPiece: {
  (
    values: unknown[],
    start?: number,
  ): (node: trackerTypesModule.OverlayNode) => trackerTypesModule.InsertPiece[];
  (
    node: trackerTypesModule.OverlayNode,
    values: unknown[],
    start?: number,
  ): trackerTypesModule.InsertPiece[];
} = dual((args) => args.length >= 2, insertPlacementPieceImpl);

const trackerArray = {
  arrayIndex,
  clampIndex,
  insertPiece,
  insertPlacementPiece,
  mutatorNode,
  setArrayIndex,
  setArrayLength,
  toArrayLength,
  toIntegerOrInfinity,
};

export default trackerArray;
