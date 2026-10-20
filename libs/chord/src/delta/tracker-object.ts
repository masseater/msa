import { dual } from "effect/Function";

import trackerContext from "./tracker-context.ts";
import trackerPieces from "./tracker-pieces.ts";
import type trackerTypesModule from "./tracker-types.types.ts";

function hasObjectWriteImpl(node: trackerTypesModule.OverlayNode, key: string): boolean {
  return node.writeKey === key || (node.writes?.has(key) ?? false);
}

function setObjectWriteImpl(
  node: trackerTypesModule.OverlayNode,
  key: string,
  value: trackerTypesModule.Stored,
): void {
  if (node.writes !== undefined) {
    const reference = node.writes.get(key);
    node.writes.set(
      key,
      reference === undefined
        ? trackerContext.storeValue(node.context, value)
        : trackerContext.replaceStoredValue(node.context, reference, value),
    );
    return;
  }
  if (node.writeKey === undefined || node.writeKey === key) {
    node.writeKey = key;
    node.writeValue =
      node.writeValue === undefined
        ? trackerContext.storeValue(node.context, value)
        : trackerContext.replaceStoredValue(node.context, node.writeValue, value);
    return;
  }
  node.writes = new Map();
  node.writes.set(node.writeKey, node.writeValue!);
  node.writes.set(key, trackerContext.storeValue(node.context, value));
  node.writeKey = undefined;
  node.writeValue = undefined;
}

function deleteObjectWriteImpl(node: trackerTypesModule.OverlayNode, key: string): void {
  if (node.writeKey === key) {
    node.writeKey = undefined;
    trackerContext.releaseStoredValue(node.context, node.writeValue!);
    node.writeValue = undefined;
  } else {
    const reference = node.writes?.get(key);
    if (reference !== undefined) trackerContext.releaseStoredValue(node.context, reference);
    node.writes?.delete(key);
  }
}

function isObjectDeletedImpl(node: trackerTypesModule.OverlayNode, key: string): boolean {
  return node.deleteKey === key || (node.deletes?.has(key) ?? false);
}

function setObjectDeletionImpl(node: trackerTypesModule.OverlayNode, key: string): void {
  if (node.deletes !== undefined) {
    node.deletes.add(key);
    return;
  }
  if (node.deleteKey === undefined || node.deleteKey === key) {
    node.deleteKey = key;
    return;
  }
  node.deletes = new Set();
  node.deletes.add(node.deleteKey);
  node.deletes.add(key);
  node.deleteKey = undefined;
}

function deleteObjectDeletionImpl(node: trackerTypesModule.OverlayNode, key: string): void {
  if (node.deleteKey === key) node.deleteKey = undefined;
  else node.deletes?.delete(key);
}

function objectHasImpl(node: trackerTypesModule.OverlayNode, key: string): boolean {
  if (isObjectDeletedImpl(node, key)) return false;
  return hasObjectWriteImpl(node, key) || Object.hasOwn(trackerContext.nodeBase(node), key);
}

function objectValueImpl(
  node: trackerTypesModule.OverlayNode,
  key: string,
): trackerTypesModule.Stored {
  if (node.writeKey === key) return trackerContext.storedValue(node.context, node.writeValue!);
  const reference = node.writes?.get(key);
  if (reference !== undefined) return trackerContext.storedValue(node.context, reference);
  return (trackerContext.nodeBase(node) as Record<string, trackerTypesModule.JsonValue>)[key]!;
}

function markDirty(node: trackerTypesModule.OverlayNode): void {
  if (node.dirty === true) return;
  node.dirty = true;
  node.context.dirty.push(node);
  for (
    let parent = trackerContext.nodeParent(node);
    parent !== undefined;
    parent = trackerContext.nodeParent(parent)
  )
    parent.subtreeDirty = true;
}

function arrayOverlay(node: trackerTypesModule.OverlayNode): trackerTypesModule.ArrayOverlay {
  if (node.array !== undefined) return node.array;
  const base = trackerContext.nodeBase(node) as trackerTypesModule.JsonValue[];
  const overlay: trackerTypesModule.ArrayOverlay = {
    baseLocations: undefined,
    baseOverrides: undefined,
    generation: 0,
    insertLocations: undefined,
    insertOverrides: undefined,
    locatedOffset: 0,
    pieces: undefined,
    plan: undefined,
    root: undefined,
    seed: 0x9e3779b9,
    structural: false,
  };
  if (base.length > 0)
    overlay.root = trackerPieces.createPieceNode(overlay, {
      kind: "base",
      length: base.length,
      start: 0,
      step: 1,
    });
  node.array = overlay;
  return overlay;
}

function baseOverridesForWrite(
  overlay: trackerTypesModule.ArrayOverlay,
): Map<number, trackerTypesModule.StoredRef> {
  if (overlay.baseOverrides === undefined) overlay.baseOverrides = new Map();
  return overlay.baseOverrides;
}

function insertOverridesForWrite(
  overlay: trackerTypesModule.ArrayOverlay,
): Map<trackerTypesModule.InsertSource, Map<number, trackerTypesModule.StoredRef>> {
  if (overlay.insertOverrides === undefined) overlay.insertOverrides = new Map();
  return overlay.insertOverrides;
}

function nextPiecePriority(overlay: trackerTypesModule.ArrayOverlay): number {
  let value = overlay.seed;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  overlay.seed = value >>> 0;
  return overlay.seed;
}

const hasObjectWrite: {
  (key: string): (node: trackerTypesModule.OverlayNode) => boolean;
  (node: trackerTypesModule.OverlayNode, key: string): boolean;
} = dual(2, hasObjectWriteImpl);

const deleteObjectWrite: {
  (key: string): (node: trackerTypesModule.OverlayNode) => void;
  (node: trackerTypesModule.OverlayNode, key: string): void;
} = dual(2, deleteObjectWriteImpl);

const objectHas: {
  (key: string): (node: trackerTypesModule.OverlayNode) => boolean;
  (node: trackerTypesModule.OverlayNode, key: string): boolean;
} = dual(2, objectHasImpl);

const setObjectWrite: {
  (key: string, value: trackerTypesModule.Stored): (node: trackerTypesModule.OverlayNode) => void;
  (node: trackerTypesModule.OverlayNode, key: string, value: trackerTypesModule.Stored): void;
} = dual(3, setObjectWriteImpl);

const isObjectDeleted: {
  (key: string): (node: trackerTypesModule.OverlayNode) => boolean;
  (node: trackerTypesModule.OverlayNode, key: string): boolean;
} = dual(2, isObjectDeletedImpl);

const setObjectDeletion: {
  (key: string): (node: trackerTypesModule.OverlayNode) => void;
  (node: trackerTypesModule.OverlayNode, key: string): void;
} = dual(2, setObjectDeletionImpl);

const deleteObjectDeletion: {
  (key: string): (node: trackerTypesModule.OverlayNode) => void;
  (node: trackerTypesModule.OverlayNode, key: string): void;
} = dual(2, deleteObjectDeletionImpl);

const objectValue: {
  (key: string): (node: trackerTypesModule.OverlayNode) => trackerTypesModule.Stored;
  (node: trackerTypesModule.OverlayNode, key: string): trackerTypesModule.Stored;
} = dual(2, objectValueImpl);

const trackerObject = {
  arrayOverlay,
  baseOverridesForWrite,
  deleteObjectDeletion,
  deleteObjectWrite,
  hasObjectWrite,
  insertOverridesForWrite,
  isObjectDeleted,
  markDirty,
  nextPiecePriority,
  objectHas,
  objectValue,
  setObjectDeletion,
  setObjectWrite,
};

export default trackerObject;
