import { dual } from "effect/Function";

import { entryValueAt, hasEntryOverrideAt } from "./tracker-array-pieces.ts";
import { arrayIndex, setArrayIndex, setArrayLength, toArrayLength } from "./tracker-array.ts";
import { clonePlacement } from "./tracker-clone.ts";
import { assertReadable, assertWritable, createNode, nodeBase } from "./tracker-context.ts";
import { arrayMutators } from "./tracker-mutators.ts";
import {
  arrayOverlay,
  deleteObjectDeletion,
  deleteObjectWrite,
  hasObjectWrite,
  isObjectDeleted,
  markDirty,
  objectHas,
  objectValue,
  setObjectDeletion,
  setObjectWrite,
} from "./tracker-object.ts";
import { isContainer } from "./tracker-paths.ts";
import { arrayLength, locatePiece } from "./tracker-pieces.ts";
import { ARRAY_MUTATORS, type OverlayNode } from "./tracker-types.ts";

function getPropertyImpl(node: OverlayNode, property: PropertyKey): unknown {
  assertReadable(node.context);
  if (Array.isArray(nodeBase(node))) {
    const overlay = arrayOverlay(node);
    if (property === "length") return arrayLength(overlay);
    if (ARRAY_MUTATORS.has(property)) return arrayMutators[property as keyof typeof arrayMutators];
    const index = arrayIndex(property);
    if (index !== undefined) return getArrayIndexImpl(node, index);
    return Reflect.get(Array.prototype, property, node.proxy);
  }
  if (typeof property === "symbol") return Reflect.get(nodeBase(node), property, node.proxy);
  const key = String(property);
  if (!objectHas(node, key)) {
    if (isObjectDeleted(node, key) || Object.hasOwn(nodeBase(node), key)) return undefined;
    return Reflect.get(nodeBase(node), property, node.proxy);
  }
  const value = objectValue(node, key);
  if (!isContainer(value)) return value;
  return createNode(node.context, value, node, 0, key, undefined, hasObjectWrite(node, key)).proxy;
}

function getArrayIndexImpl(node: OverlayNode, index: number): unknown {
  const overlay = arrayOverlay(node);
  if (index >= arrayLength(overlay)) return undefined;
  const piece = locatePiece(overlay, index);
  const sourceIndex = piece.start + piece.step * overlay.locatedOffset;
  const value = entryValueAt(node, piece, sourceIndex);
  if (!isContainer(value)) return value;
  return createNode(
    node.context,
    value,
    node,
    piece.kind === "base" ? 1 : 2,
    sourceIndex,
    piece.kind === "insert" ? piece.source : undefined,
    piece.kind === "insert" || hasEntryOverrideAt(overlay, piece, sourceIndex),
  ).proxy;
}

function setPropertyImpl(node: OverlayNode, property: PropertyKey, supplied: unknown): boolean {
  assertWritable(node.context);
  if (typeof property === "symbol") throw new TypeError("Symbol writes are not supported");
  if (Array.isArray(nodeBase(node))) {
    if (property === "length") {
      setArrayLength(node, toArrayLength(supplied));
      return true;
    }
    const index = arrayIndex(property);
    if (index === undefined) throw new TypeError("Only array indices and length can be written");
    if (index > arrayLength(arrayOverlay(node)))
      throw new TypeError("Overlay arrays cannot contain holes");
    setArrayIndex(node, index, clonePlacement(supplied));
    return true;
  }
  const key = String(property);
  if (supplied === undefined) return deletePropertyImpl(node, key);
  const stored = clonePlacement(supplied);
  const current = objectValue(node, key);
  const wasDeleted = isObjectDeleted(node, key);
  if (!wasDeleted && !isContainer(stored) && current === stored) return true;
  setObjectWrite(node, key, stored);
  if (wasDeleted && Object.hasOwn(nodeBase(node), key)) {
    if (node.readded === undefined) node.readded = new Set();
    node.readded.add(key);
  }
  deleteObjectDeletion(node, key);
  markDirty(node);
  return true;
}

function deletePropertyImpl(node: OverlayNode, property: PropertyKey): boolean {
  assertWritable(node.context);
  if (typeof property === "symbol") throw new TypeError("Symbol writes are not supported");
  if (Array.isArray(nodeBase(node))) throw new TypeError("Overlay arrays cannot contain holes");
  const key = String(property);
  if (!objectHas(node, key)) return true;
  deleteObjectWrite(node, key);
  node.readded?.delete(key);
  setObjectDeletion(node, key);
  markDirty(node);
  return true;
}

function hasPropertyImpl(node: OverlayNode, property: PropertyKey): boolean {
  assertReadable(node.context);
  if (Array.isArray(nodeBase(node))) {
    if (property === "length") return true;
    const index = arrayIndex(property);
    if (index !== undefined) return index < arrayLength(arrayOverlay(node));
    return property in Array.prototype;
  }
  return typeof property === "symbol"
    ? property in nodeBase(node)
    : objectHas(node, String(property));
}

export function ownKeys(node: OverlayNode): ArrayLike<string | symbol> {
  assertReadable(node.context);
  if (Array.isArray(nodeBase(node))) {
    const length = arrayLength(arrayOverlay(node));
    const keys = new Array<string>(length + 1);
    for (let index = 0; index < length; index++) keys[index] = String(index);
    keys[length] = "length";
    return keys;
  }
  let existingKeysOnly =
    node.deleteKey === undefined &&
    node.deletes === undefined &&
    node.readded === undefined &&
    (node.writeKey === undefined || Object.hasOwn(nodeBase(node), node.writeKey));
  if (existingKeysOnly && node.writes !== undefined) {
    for (const key of node.writes.keys()) {
      if (!Object.hasOwn(nodeBase(node), key)) {
        existingKeysOnly = false;
        break;
      }
    }
  }
  if (existingKeysOnly) return Object.keys(nodeBase(node));
  const keys = Object.keys(nodeBase(node)).filter(
    (key) => !isObjectDeleted(node, key) && node.readded?.has(key) !== true,
  );
  const seen = new Set(keys);
  if (node.writeKey !== undefined && !seen.has(node.writeKey)) {
    keys.push(node.writeKey);
    seen.add(node.writeKey);
  }
  if (node.writes !== undefined) {
    for (const key of node.writes.keys()) {
      if (seen.has(key)) continue;
      keys.push(key);
      seen.add(key);
    }
  }
  const indices: number[] = [];
  const strings: string[] = [];
  for (const key of keys) {
    const index = arrayIndex(key);
    if (index === undefined) strings.push(key);
    else indices.push(index);
  }
  indices.sort((left, right) => left - right);
  return [...indices.map(String), ...strings];
}

function getDescriptorImpl(
  node: OverlayNode,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  assertReadable(node.context);
  if (Array.isArray(nodeBase(node))) {
    if (property === "length") {
      const length = arrayLength(arrayOverlay(node));
      (node.target as unknown[]).length = length;
      return Reflect.getOwnPropertyDescriptor(node.target, "length");
    }
    const index = arrayIndex(property);
    if (index === undefined || index >= arrayLength(arrayOverlay(node))) return undefined;
  } else if (typeof property === "symbol" || !objectHas(node, String(property))) return undefined;
  return {
    configurable: true,
    enumerable: true,
    writable: node.context.status.value === "open",
    value: getPropertyImpl(node, property),
  };
}

export const getDescriptor: {
  (property: PropertyKey): (node: OverlayNode) => PropertyDescriptor | undefined;
  (node: OverlayNode, property: PropertyKey): PropertyDescriptor | undefined;
} = dual(2, getDescriptorImpl);

export const getProperty: {
  (property: PropertyKey): (node: OverlayNode) => unknown;
  (node: OverlayNode, property: PropertyKey): unknown;
} = dual(2, getPropertyImpl);

export const getArrayIndex: {
  (index: number): (node: OverlayNode) => unknown;
  (node: OverlayNode, index: number): unknown;
} = dual(2, getArrayIndexImpl);

export const setProperty: {
  (property: PropertyKey, supplied: unknown): (node: OverlayNode) => boolean;
  (node: OverlayNode, property: PropertyKey, supplied: unknown): boolean;
} = dual(3, setPropertyImpl);

export const deleteProperty: {
  (property: PropertyKey): (node: OverlayNode) => boolean;
  (node: OverlayNode, property: PropertyKey): boolean;
} = dual(2, deletePropertyImpl);

export const hasProperty: {
  (property: PropertyKey): (node: OverlayNode) => boolean;
  (node: OverlayNode, property: PropertyKey): boolean;
} = dual(2, hasPropertyImpl);
