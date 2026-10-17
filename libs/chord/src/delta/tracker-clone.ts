import { dual } from "effect/Function";

import { copyJson } from "../json.ts";
import { entryValueAt } from "./tracker-array-pieces.ts";
import { assertReadable, nodeBase } from "./tracker-context.ts";
import { arrayOverlay, objectValue } from "./tracker-object.ts";
import { isContainer } from "./tracker-paths.ts";
import { piecesOf } from "./tracker-pieces.ts";
import { ownKeys } from "./tracker-props.ts";
import {
  type Container,
  DATA_DESCRIPTOR,
  type JsonValue,
  NODE,
  type OverlayContext,
  type OverlayNode,
  type Stored,
} from "./tracker-types.ts";

export function clonePlacement(value: unknown): Stored {
  const proxyNode = isContainer(value)
    ? (Reflect.get(value, NODE) as OverlayNode | undefined)
    : undefined;
  return proxyNode === undefined ? copyJson(value) : clonePlacementNode(proxyNode);
}

export function cloneNode(node: OverlayNode): Container {
  assertReadable(node.context);
  if (Array.isArray(nodeBase(node))) {
    const overlay = arrayOverlay(node);
    const result: JsonValue[] = [];
    for (const piece of piecesOf(overlay)) {
      for (let offset = 0; offset < piece.length; offset++) {
        const sourceIndex = piece.start + piece.step * offset;
        result.push(cloneStoredImpl(entryValueAt(node, piece, sourceIndex), node.context));
      }
    }
    return result;
  }
  const result = Object.create(Object.getPrototypeOf(nodeBase(node))) as Record<string, JsonValue>;
  for (const key of ownKeys(node) as string[])
    defineDataImpl(result, key, cloneStoredImpl(objectValue(node, key), node.context));
  return result;
}

function cloneStoredImpl(value: Stored, context: OverlayContext): Stored {
  if (!isContainer(value)) return value;
  const node = context.rawNodes!.get(value);
  return node === undefined || (node.dirty !== true && node.subtreeDirty !== true)
    ? value
    : cloneNode(node);
}

function clonePlacementNode(node: OverlayNode): Container {
  assertReadable(node.context);
  if (Array.isArray(nodeBase(node))) {
    const overlay = arrayOverlay(node);
    const result: JsonValue[] = [];
    for (const piece of piecesOf(overlay)) {
      for (let offset = 0; offset < piece.length; offset++) {
        const sourceIndex = piece.start + piece.step * offset;
        result.push(clonePlacementStoredImpl(entryValueAt(node, piece, sourceIndex), node.context));
      }
    }
    return result;
  }
  const result = Object.create(Object.getPrototypeOf(nodeBase(node))) as Record<string, JsonValue>;
  for (const key of ownKeys(node) as string[])
    defineDataImpl(result, key, clonePlacementStoredImpl(objectValue(node, key), node.context));
  return result;
}

function clonePlacementStoredImpl(value: Stored, context: OverlayContext): Stored {
  if (!isContainer(value)) return copyJson(value);
  const node = context.rawNodes!.get(value);
  return node === undefined ? copyJson(value) : clonePlacementNode(node);
}

function defineDataImpl(target: object, key: PropertyKey, value: JsonValue): void {
  DATA_DESCRIPTOR.value = value;
  Object.defineProperty(target, key, DATA_DESCRIPTOR);
  DATA_DESCRIPTOR.value = undefined;
}

export const cloneStored: {
  (context: OverlayContext): (value: Stored) => Stored;
  (value: Stored, context: OverlayContext): Stored;
} = dual(2, cloneStoredImpl);

export const clonePlacementStored: {
  (context: OverlayContext): (value: Stored) => Stored;
  (value: Stored, context: OverlayContext): Stored;
} = dual(2, clonePlacementStoredImpl);

export const defineData: {
  (key: PropertyKey, value: JsonValue): (target: object) => void;
  (target: object, key: PropertyKey, value: JsonValue): void;
} = dual(3, defineDataImpl);
