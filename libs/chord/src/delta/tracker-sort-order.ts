import { dual } from "effect/Function";

import trackerContext from "./tracker-context.ts";
import trackerObject from "./tracker-object.ts";
import trackerPaths from "./tracker-paths.ts";
import trackerPieces from "./tracker-pieces.ts";
import type trackerTypesModule from "./tracker-types.types.ts";

function sortTokenSource(
  token: number,
  sources: readonly trackerTypesModule.InsertSource[],
): trackerTypesModule.InsertSource | undefined {
  return token < 0 ? sources[-token - 1] : undefined;
}

function sortTokenIndex(token: number, indices: readonly number[]): number {
  return token < 0 ? indices[-token - 1]! : token;
}

function publicSortValueImpl(
  node: trackerTypesModule.OverlayNode,
  token: number,
  sources: readonly trackerTypesModule.InsertSource[],
  indices: readonly number[],
): unknown {
  const overlay = trackerObject.arrayOverlay(node);
  const source = sortTokenSource(token, sources);
  const sourceIndex = sortTokenIndex(token, indices);
  const overrideIndex =
    source === undefined
      ? overlay.baseOverrides?.get(sourceIndex)
      : overlay.insertOverrides?.get(source)?.get(sourceIndex);
  const value =
    overrideIndex === undefined
      ? source === undefined
        ? (trackerContext.nodeBase(node) as trackerTypesModule.JsonValue[])[sourceIndex]!
        : trackerContext.storedValue(node.context, source.refs[sourceIndex]!)
      : trackerContext.storedValue(node.context, overrideIndex);
  if (!trackerPaths.isContainer(value)) return value;
  return trackerContext.createNode(
    node.context,
    value,
    node,
    source === undefined ? 1 : 2,
    sourceIndex,
    source,
    source !== undefined || (overlay.baseOverrides?.has(sourceIndex) ?? false),
  ).proxy;
}

function restoreBaseOverride(
  node: trackerTypesModule.OverlayNode,
  overlay: trackerTypesModule.ArrayOverlay,
  sourceIndex: number,
  baseSnapshot: ReadonlyMap<number, trackerTypesModule.Stored>,
): void {
  const existingIndex = overlay.baseOverrides?.get(sourceIndex);
  const snapshotValue = baseSnapshot.get(sourceIndex);
  if (snapshotValue === undefined) {
    if (existingIndex !== undefined) trackerContext.releaseStoredValue(node.context, existingIndex);
    overlay.baseOverrides?.delete(sourceIndex);
  } else if (existingIndex === undefined)
    trackerObject
      .baseOverridesForWrite(overlay)
      .set(sourceIndex, trackerContext.storeValue(node.context, snapshotValue));
  else
    overlay.baseOverrides!.set(
      sourceIndex,
      trackerContext.replaceStoredValue(node.context, existingIndex, snapshotValue),
    );
}

function restoreSortOverrideImpl(
  node: trackerTypesModule.OverlayNode,
  token: number,
  sources: readonly trackerTypesModule.InsertSource[],
  indices: readonly number[],
  baseSnapshot: ReadonlyMap<number, trackerTypesModule.Stored>,
  insertSnapshots: ReadonlyMap<
    trackerTypesModule.InsertSource,
    ReadonlyMap<number, trackerTypesModule.Stored>
  >,
): void {
  const overlay = trackerObject.arrayOverlay(node);
  const source = sortTokenSource(token, sources);
  const sourceIndex = sortTokenIndex(token, indices);
  if (source === undefined) {
    restoreBaseOverride(node, overlay, sourceIndex, baseSnapshot);
    return;
  }
  let overrides = overlay.insertOverrides?.get(source);
  const existingIndex = overrides?.get(sourceIndex);
  const snapshotValue = insertSnapshots.get(source)?.get(sourceIndex);
  if (snapshotValue === undefined) {
    if (existingIndex !== undefined) trackerContext.releaseStoredValue(node.context, existingIndex);
    overrides?.delete(sourceIndex);
    if (overrides?.size === 0) overlay.insertOverrides?.delete(source);
    return;
  }
  if (overrides === undefined) {
    overrides = new Map();
    trackerObject.insertOverridesForWrite(overlay).set(source, overrides);
  }
  if (existingIndex === undefined)
    overrides.set(sourceIndex, trackerContext.storeValue(node.context, snapshotValue));
  else
    overrides.set(
      sourceIndex,
      trackerContext.replaceStoredValue(node.context, existingIndex, snapshotValue),
    );
}

function sameSortTokenAtImpl(
  overlay: trackerTypesModule.ArrayOverlay,
  logicalIndex: number,
  token: number,
  sources: readonly trackerTypesModule.InsertSource[],
  indices: readonly number[],
): boolean {
  const piece = trackerPieces.locatePiece(overlay, logicalIndex);
  const sourceIndex = piece.start + piece.step * overlay.locatedOffset;
  const tokenSource = sortTokenSource(token, sources);
  return (
    sourceIndex === sortTokenIndex(token, indices) &&
    ((piece.kind === "base" && tokenSource === undefined) ||
      (piece.kind === "insert" && piece.source === tokenSource))
  );
}

const publicSortValue: {
  (
    token: number,
    sources: readonly trackerTypesModule.InsertSource[],
    indices: readonly number[],
  ): (node: trackerTypesModule.OverlayNode) => unknown;
  (
    node: trackerTypesModule.OverlayNode,
    token: number,
    sources: readonly trackerTypesModule.InsertSource[],
    indices: readonly number[],
  ): unknown;
} = dual(4, publicSortValueImpl);

const restoreSortOverride: {
  (
    token: number,
    sources: readonly trackerTypesModule.InsertSource[],
    indices: readonly number[],
    baseSnapshot: ReadonlyMap<number, trackerTypesModule.Stored>,
    insertSnapshots: ReadonlyMap<
      trackerTypesModule.InsertSource,
      ReadonlyMap<number, trackerTypesModule.Stored>
    >,
  ): (node: trackerTypesModule.OverlayNode) => void;
  (
    node: trackerTypesModule.OverlayNode,
    token: number,
    sources: readonly trackerTypesModule.InsertSource[],
    indices: readonly number[],
    baseSnapshot: ReadonlyMap<number, trackerTypesModule.Stored>,
    insertSnapshots: ReadonlyMap<
      trackerTypesModule.InsertSource,
      ReadonlyMap<number, trackerTypesModule.Stored>
    >,
  ): void;
} = dual(6, restoreSortOverrideImpl);

const sameSortTokenAt: {
  (
    logicalIndex: number,
    token: number,
    sources: readonly trackerTypesModule.InsertSource[],
    indices: readonly number[],
  ): (overlay: trackerTypesModule.ArrayOverlay) => boolean;
  (
    overlay: trackerTypesModule.ArrayOverlay,
    logicalIndex: number,
    token: number,
    sources: readonly trackerTypesModule.InsertSource[],
    indices: readonly number[],
  ): boolean;
} = dual(5, sameSortTokenAtImpl);

const trackerSortOrder = {
  publicSortValue,
  restoreSortOverride,
  sameSortTokenAt,
};

export default trackerSortOrder;
