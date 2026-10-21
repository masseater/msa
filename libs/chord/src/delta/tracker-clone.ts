import { dual } from "effect/Function";

import json from "../json.ts";
import trackerArrayPieces from "./tracker-array-pieces.ts";
import trackerContext from "./tracker-context.ts";
import trackerObject from "./tracker-object.ts";
import trackerPaths from "./tracker-paths.ts";
import trackerPieces from "./tracker-pieces.ts";
import trackerProps from "./tracker-props.ts";
import trackerTypes from "./tracker-types.ts";
import type trackerTypesModule from "./tracker-types.types.ts";
const { DATA_DESCRIPTOR, NODE } = trackerTypes;
const { copyJson } = json;

function clonePlacement(value: unknown): trackerTypesModule.Stored {
  const proxyNode = trackerPaths.isContainer(value)
    ? (Reflect.get(value, NODE) as trackerTypesModule.OverlayNode | undefined)
    : undefined;
  return proxyNode === undefined ? copyJson(value) : clonePlacementNode(proxyNode);
}

function cloneNode(node: trackerTypesModule.OverlayNode): trackerTypesModule.Container {
  trackerContext.assertReadable(node.context);
  if (Array.isArray(trackerContext.nodeBase(node))) {
    const overlay = trackerObject.arrayOverlay(node);
    const result: trackerTypesModule.JsonValue[] = [];
    for (const piece of trackerPieces.piecesOf(overlay)) {
      for (let offset = 0; offset < piece.length; offset++) {
        const sourceIndex = piece.start + piece.step * offset;
        result.push(
          cloneStoredImpl(trackerArrayPieces.entryValueAt(node, piece, sourceIndex), node.context),
        );
      }
    }
    return result;
  }
  const result = Object.create(Object.getPrototypeOf(trackerContext.nodeBase(node))) as Record<
    string,
    trackerTypesModule.JsonValue
  >;
  for (const key of trackerProps.ownKeys(node) as string[])
    defineDataImpl(
      result,
      key,
      cloneStoredImpl(trackerObject.objectValue(node, key), node.context),
    );
  return result;
}

function cloneStoredImpl(
  value: trackerTypesModule.Stored,
  context: trackerTypesModule.OverlayContext,
): trackerTypesModule.Stored {
  if (!trackerPaths.isContainer(value)) return value;
  const node = context.rawNodes!.get(value);
  return node === undefined || (node.dirty !== true && node.subtreeDirty !== true)
    ? value
    : cloneNode(node);
}

function clonePlacementNode(node: trackerTypesModule.OverlayNode): trackerTypesModule.Container {
  trackerContext.assertReadable(node.context);
  if (Array.isArray(trackerContext.nodeBase(node))) {
    const overlay = trackerObject.arrayOverlay(node);
    const result: trackerTypesModule.JsonValue[] = [];
    for (const piece of trackerPieces.piecesOf(overlay)) {
      for (let offset = 0; offset < piece.length; offset++) {
        const sourceIndex = piece.start + piece.step * offset;
        result.push(
          clonePlacementStoredImpl(
            trackerArrayPieces.entryValueAt(node, piece, sourceIndex),
            node.context,
          ),
        );
      }
    }
    return result;
  }
  const result = Object.create(Object.getPrototypeOf(trackerContext.nodeBase(node))) as Record<
    string,
    trackerTypesModule.JsonValue
  >;
  for (const key of trackerProps.ownKeys(node) as string[])
    defineDataImpl(
      result,
      key,
      clonePlacementStoredImpl(trackerObject.objectValue(node, key), node.context),
    );
  return result;
}

function clonePlacementStoredImpl(
  value: trackerTypesModule.Stored,
  context: trackerTypesModule.OverlayContext,
): trackerTypesModule.Stored {
  if (!trackerPaths.isContainer(value)) return copyJson(value);
  const node = context.rawNodes!.get(value);
  return node === undefined ? copyJson(value) : clonePlacementNode(node);
}

function defineDataImpl(
  target: object,
  key: PropertyKey,
  value: trackerTypesModule.JsonValue,
): void {
  DATA_DESCRIPTOR.value = value;
  Object.defineProperty(target, key, DATA_DESCRIPTOR);
  DATA_DESCRIPTOR.value = undefined;
}

const cloneStored: {
  (
    context: trackerTypesModule.OverlayContext,
  ): (value: trackerTypesModule.Stored) => trackerTypesModule.Stored;
  (
    value: trackerTypesModule.Stored,
    context: trackerTypesModule.OverlayContext,
  ): trackerTypesModule.Stored;
} = dual(2, cloneStoredImpl);

const clonePlacementStored: {
  (
    context: trackerTypesModule.OverlayContext,
  ): (value: trackerTypesModule.Stored) => trackerTypesModule.Stored;
  (
    value: trackerTypesModule.Stored,
    context: trackerTypesModule.OverlayContext,
  ): trackerTypesModule.Stored;
} = dual(2, clonePlacementStoredImpl);

const defineData: {
  (key: PropertyKey, value: trackerTypesModule.JsonValue): (target: object) => void;
  (target: object, key: PropertyKey, value: trackerTypesModule.JsonValue): void;
} = dual(3, defineDataImpl);

const trackerClone = {
  cloneNode,
  clonePlacement,
  clonePlacementStored,
  cloneStored,
  defineData,
};

export default trackerClone;
