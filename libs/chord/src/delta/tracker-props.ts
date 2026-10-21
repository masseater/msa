import { dual } from "effect/Function";

import trackerClone from "./tracker-clone.ts";
import trackerContext from "./tracker-context.ts";
import trackerMutators from "./tracker-mutators.ts";
import trackerObject from "./tracker-object.ts";
import trackerPaths from "./tracker-paths.ts";
import trackerPieces from "./tracker-pieces.ts";
import trackerPropsKit from "./tracker-props-kit.ts";
import trackerTypes from "./tracker-types.ts";
import type trackerTypesModule from "./tracker-types.types.ts";
const { ARRAY_MUTATORS } = trackerTypes;

function getPropertyImpl(node: trackerTypesModule.OverlayNode, property: PropertyKey): unknown {
  trackerContext.assertReadable(node.context);
  if (Array.isArray(trackerContext.nodeBase(node))) {
    const overlay = trackerObject.arrayOverlay(node);
    if (property === "length") return trackerPieces.arrayLength(overlay);
    if (ARRAY_MUTATORS.has(property))
      return trackerMutators.arrayMutators[property as keyof typeof trackerMutators.arrayMutators];
    const index = trackerPropsKit.trackerArray.arrayIndex(property);
    if (index !== undefined) return getArrayIndexImpl(node, index);
    return Reflect.get(Array.prototype, property, node.proxy);
  }
  if (typeof property === "symbol")
    return Reflect.get(trackerContext.nodeBase(node), property, node.proxy);
  const key = String(property);
  if (!trackerObject.objectHas(node, key)) {
    if (
      trackerObject.isObjectDeleted(node, key) ||
      Object.hasOwn(trackerContext.nodeBase(node), key)
    )
      return undefined;
    return Reflect.get(trackerContext.nodeBase(node), property, node.proxy);
  }
  const value = trackerObject.objectValue(node, key);
  if (!trackerPaths.isContainer(value)) return value;
  return trackerContext.createNode(
    node.context,
    value,
    node,
    0,
    key,
    undefined,
    trackerObject.hasObjectWrite(node, key),
  ).proxy;
}

function getArrayIndexImpl(node: trackerTypesModule.OverlayNode, index: number): unknown {
  const overlay = trackerObject.arrayOverlay(node);
  if (index >= trackerPieces.arrayLength(overlay)) return undefined;
  const piece = trackerPieces.locatePiece(overlay, index);
  const sourceIndex = piece.start + piece.step * overlay.locatedOffset;
  const value = trackerPropsKit.trackerArrayPieces.entryValueAt(node, piece, sourceIndex);
  if (!trackerPaths.isContainer(value)) return value;
  return trackerContext.createNode(
    node.context,
    value,
    node,
    piece.kind === "base" ? 1 : 2,
    sourceIndex,
    piece.kind === "insert" ? piece.source : undefined,
    piece.kind === "insert" ||
      trackerPropsKit.trackerArrayPieces.hasEntryOverrideAt(overlay, piece, sourceIndex),
  ).proxy;
}

function setPropertyImpl(
  node: trackerTypesModule.OverlayNode,
  property: PropertyKey,
  supplied: unknown,
): boolean {
  trackerContext.assertWritable(node.context);
  if (typeof property === "symbol") throw new TypeError("Symbol writes are not supported");
  if (Array.isArray(trackerContext.nodeBase(node))) {
    if (property === "length") {
      trackerPropsKit.trackerArray.setArrayLength(
        node,
        trackerPropsKit.trackerArray.toArrayLength(supplied),
      );
      return true;
    }
    const index = trackerPropsKit.trackerArray.arrayIndex(property);
    if (index === undefined) throw new TypeError("Only array indices and length can be written");
    if (index > trackerPieces.arrayLength(trackerObject.arrayOverlay(node)))
      throw new TypeError("Overlay arrays cannot contain holes");
    trackerPropsKit.trackerArray.setArrayIndex(node, index, trackerClone.clonePlacement(supplied));
    return true;
  }
  const key = String(property);
  if (supplied === undefined) return deletePropertyImpl(node, key);
  const stored = trackerClone.clonePlacement(supplied);
  const current = trackerObject.objectValue(node, key);
  const wasDeleted = trackerObject.isObjectDeleted(node, key);
  if (!wasDeleted && !trackerPaths.isContainer(stored) && current === stored) return true;
  trackerObject.setObjectWrite(node, key, stored);
  if (wasDeleted && Object.hasOwn(trackerContext.nodeBase(node), key)) {
    if (node.readded === undefined) node.readded = new Set();
    node.readded.add(key);
  }
  trackerObject.deleteObjectDeletion(node, key);
  trackerObject.markDirty(node);
  return true;
}

function deletePropertyImpl(node: trackerTypesModule.OverlayNode, property: PropertyKey): boolean {
  trackerContext.assertWritable(node.context);
  if (typeof property === "symbol") throw new TypeError("Symbol writes are not supported");
  if (Array.isArray(trackerContext.nodeBase(node)))
    throw new TypeError("Overlay arrays cannot contain holes");
  const key = String(property);
  if (!trackerObject.objectHas(node, key)) return true;
  trackerObject.deleteObjectWrite(node, key);
  node.readded?.delete(key);
  trackerObject.setObjectDeletion(node, key);
  trackerObject.markDirty(node);
  return true;
}

function hasPropertyImpl(node: trackerTypesModule.OverlayNode, property: PropertyKey): boolean {
  trackerContext.assertReadable(node.context);
  if (Array.isArray(trackerContext.nodeBase(node))) {
    if (property === "length") return true;
    const index = trackerPropsKit.trackerArray.arrayIndex(property);
    if (index !== undefined)
      return index < trackerPieces.arrayLength(trackerObject.arrayOverlay(node));
    return property in Array.prototype;
  }
  return typeof property === "symbol"
    ? property in trackerContext.nodeBase(node)
    : trackerObject.objectHas(node, String(property));
}

function ownKeys(node: trackerTypesModule.OverlayNode): ArrayLike<string | symbol> {
  trackerContext.assertReadable(node.context);
  if (Array.isArray(trackerContext.nodeBase(node))) {
    const length = trackerPieces.arrayLength(trackerObject.arrayOverlay(node));
    const keys = new Array<string>(length + 1);
    for (let index = 0; index < length; index++) keys[index] = String(index);
    keys[length] = "length";
    return keys;
  }
  let existingKeysOnly =
    node.deleteKey === undefined &&
    node.deletes === undefined &&
    node.readded === undefined &&
    (node.writeKey === undefined || Object.hasOwn(trackerContext.nodeBase(node), node.writeKey));
  if (existingKeysOnly && node.writes !== undefined) {
    for (const key of node.writes.keys()) {
      if (!Object.hasOwn(trackerContext.nodeBase(node), key)) {
        existingKeysOnly = false;
        break;
      }
    }
  }
  if (existingKeysOnly) return Object.keys(trackerContext.nodeBase(node));
  const keys = Object.keys(trackerContext.nodeBase(node)).filter(
    (key) => !trackerObject.isObjectDeleted(node, key) && node.readded?.has(key) !== true,
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
    const index = trackerPropsKit.trackerArray.arrayIndex(key);
    if (index === undefined) strings.push(key);
    else indices.push(index);
  }
  indices.sort((left, right) => left - right);
  return [...indices.map(String), ...strings];
}

function getDescriptorImpl(
  node: trackerTypesModule.OverlayNode,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  trackerContext.assertReadable(node.context);
  if (Array.isArray(trackerContext.nodeBase(node))) {
    if (property === "length") {
      const length = trackerPieces.arrayLength(trackerObject.arrayOverlay(node));
      (node.target as unknown[]).length = length;
      return Reflect.getOwnPropertyDescriptor(node.target, "length");
    }
    const index = trackerPropsKit.trackerArray.arrayIndex(property);
    if (index === undefined || index >= trackerPieces.arrayLength(trackerObject.arrayOverlay(node)))
      return undefined;
  } else if (typeof property === "symbol" || !trackerObject.objectHas(node, String(property)))
    return undefined;
  return {
    configurable: true,
    enumerable: true,
    value: getPropertyImpl(node, property),
    writable: node.context.status.value === "open",
  };
}

const getDescriptor: {
  (property: PropertyKey): (node: trackerTypesModule.OverlayNode) => PropertyDescriptor | undefined;
  (node: trackerTypesModule.OverlayNode, property: PropertyKey): PropertyDescriptor | undefined;
} = dual(2, getDescriptorImpl);

const getProperty: {
  (property: PropertyKey): (node: trackerTypesModule.OverlayNode) => unknown;
  (node: trackerTypesModule.OverlayNode, property: PropertyKey): unknown;
} = dual(2, getPropertyImpl);

const getArrayIndex: {
  (index: number): (node: trackerTypesModule.OverlayNode) => unknown;
  (node: trackerTypesModule.OverlayNode, index: number): unknown;
} = dual(2, getArrayIndexImpl);

const setProperty: {
  (property: PropertyKey, supplied: unknown): (node: trackerTypesModule.OverlayNode) => boolean;
  (node: trackerTypesModule.OverlayNode, property: PropertyKey, supplied: unknown): boolean;
} = dual(3, setPropertyImpl);

const deleteProperty: {
  (property: PropertyKey): (node: trackerTypesModule.OverlayNode) => boolean;
  (node: trackerTypesModule.OverlayNode, property: PropertyKey): boolean;
} = dual(2, deletePropertyImpl);

const hasProperty: {
  (property: PropertyKey): (node: trackerTypesModule.OverlayNode) => boolean;
  (node: trackerTypesModule.OverlayNode, property: PropertyKey): boolean;
} = dual(2, hasPropertyImpl);

const trackerProps = {
  deleteProperty,
  getArrayIndex,
  getDescriptor,
  getProperty,
  hasProperty,
  ownKeys,
  setProperty,
};

export default trackerProps;
