import { dual } from "effect/Function";

import {
  nodeBase,
  nodeParent,
  releaseStoredValue,
  replaceStoredValue,
  storedValue,
  storeValue,
} from "./tracker-context.ts";
import { createPieceNode } from "./tracker-pieces.ts";
import {
  type ArrayOverlay,
  type InsertSource,
  type JsonValue,
  type OverlayNode,
  type Stored,
  type StoredRef,
} from "./tracker-types.ts";

function hasObjectWriteImpl(node: OverlayNode, key: string): boolean {
  return node.writeKey === key || (node.writes?.has(key) ?? false);
}

function setObjectWriteImpl(node: OverlayNode, key: string, value: Stored): void {
  if (node.writes !== undefined) {
    const reference = node.writes.get(key);
    node.writes.set(
      key,
      reference === undefined
        ? storeValue(node.context, value)
        : replaceStoredValue(node.context, reference, value),
    );
    return;
  }
  if (node.writeKey === undefined || node.writeKey === key) {
    node.writeKey = key;
    node.writeValue =
      node.writeValue === undefined
        ? storeValue(node.context, value)
        : replaceStoredValue(node.context, node.writeValue, value);
    return;
  }
  node.writes = new Map();
  node.writes.set(node.writeKey, node.writeValue!);
  node.writes.set(key, storeValue(node.context, value));
  node.writeKey = undefined;
  node.writeValue = undefined;
}

function deleteObjectWriteImpl(node: OverlayNode, key: string): void {
  if (node.writeKey === key) {
    node.writeKey = undefined;
    releaseStoredValue(node.context, node.writeValue!);
    node.writeValue = undefined;
  } else {
    const reference = node.writes?.get(key);
    if (reference !== undefined) releaseStoredValue(node.context, reference);
    node.writes?.delete(key);
  }
}

function isObjectDeletedImpl(node: OverlayNode, key: string): boolean {
  return node.deleteKey === key || (node.deletes?.has(key) ?? false);
}

function setObjectDeletionImpl(node: OverlayNode, key: string): void {
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

function deleteObjectDeletionImpl(node: OverlayNode, key: string): void {
  if (node.deleteKey === key) node.deleteKey = undefined;
  else node.deletes?.delete(key);
}

function objectHasImpl(node: OverlayNode, key: string): boolean {
  if (isObjectDeletedImpl(node, key)) return false;
  return hasObjectWriteImpl(node, key) || Object.hasOwn(nodeBase(node), key);
}

function objectValueImpl(node: OverlayNode, key: string): Stored {
  if (node.writeKey === key) return storedValue(node.context, node.writeValue!);
  const reference = node.writes?.get(key);
  if (reference !== undefined) return storedValue(node.context, reference);
  return (nodeBase(node) as Record<string, JsonValue>)[key]!;
}

export function markDirty(node: OverlayNode): void {
  if (node.dirty === true) return;
  node.dirty = true;
  node.context.dirty.push(node);
  for (let parent = nodeParent(node); parent !== undefined; parent = nodeParent(parent))
    parent.subtreeDirty = true;
}

export function arrayOverlay(node: OverlayNode): ArrayOverlay {
  if (node.array !== undefined) return node.array;
  const base = nodeBase(node) as JsonValue[];
  const overlay: ArrayOverlay = {
    root: undefined,
    pieces: undefined,
    baseOverrides: undefined,
    insertOverrides: undefined,
    structural: false,
    generation: 0,
    plan: undefined,
    seed: 0x9e3779b9,
    locatedOffset: 0,
    baseLocations: undefined,
    insertLocations: undefined,
  };
  if (base.length > 0)
    overlay.root = createPieceNode(overlay, {
      kind: "base",
      start: 0,
      length: base.length,
      step: 1,
    });
  node.array = overlay;
  return overlay;
}

export function baseOverridesForWrite(overlay: ArrayOverlay): Map<number, StoredRef> {
  if (overlay.baseOverrides === undefined) overlay.baseOverrides = new Map();
  return overlay.baseOverrides;
}

export function insertOverridesForWrite(
  overlay: ArrayOverlay,
): Map<InsertSource, Map<number, StoredRef>> {
  if (overlay.insertOverrides === undefined) overlay.insertOverrides = new Map();
  return overlay.insertOverrides;
}

export function nextPiecePriority(overlay: ArrayOverlay): number {
  let value = overlay.seed;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  overlay.seed = value >>> 0;
  return overlay.seed;
}

export const hasObjectWrite: {
  (key: string): (node: OverlayNode) => boolean;
  (node: OverlayNode, key: string): boolean;
} = dual(2, hasObjectWriteImpl);

export const deleteObjectWrite: {
  (key: string): (node: OverlayNode) => void;
  (node: OverlayNode, key: string): void;
} = dual(2, deleteObjectWriteImpl);

export const objectHas: {
  (key: string): (node: OverlayNode) => boolean;
  (node: OverlayNode, key: string): boolean;
} = dual(2, objectHasImpl);

export const setObjectWrite: {
  (key: string, value: Stored): (node: OverlayNode) => void;
  (node: OverlayNode, key: string, value: Stored): void;
} = dual(3, setObjectWriteImpl);

export const isObjectDeleted: {
  (key: string): (node: OverlayNode) => boolean;
  (node: OverlayNode, key: string): boolean;
} = dual(2, isObjectDeletedImpl);

export const setObjectDeletion: {
  (key: string): (node: OverlayNode) => void;
  (node: OverlayNode, key: string): void;
} = dual(2, setObjectDeletionImpl);

export const deleteObjectDeletion: {
  (key: string): (node: OverlayNode) => void;
  (node: OverlayNode, key: string): void;
} = dual(2, deleteObjectDeletionImpl);

export const objectValue: {
  (key: string): (node: OverlayNode) => Stored;
  (node: OverlayNode, key: string): Stored;
} = dual(2, objectValueImpl);
