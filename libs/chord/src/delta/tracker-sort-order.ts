import { dual } from "effect/Function";

import {
  createNode,
  nodeBase,
  releaseStoredValue,
  replaceStoredValue,
  storedValue,
  storeValue,
} from "./tracker-context.ts";
import { arrayOverlay, baseOverridesForWrite, insertOverridesForWrite } from "./tracker-object.ts";
import { isContainer } from "./tracker-paths.ts";
import { locatePiece } from "./tracker-pieces.ts";
import {
  type ArrayOverlay,
  type InsertSource,
  type JsonValue,
  type OverlayNode,
  type Stored,
} from "./tracker-types.ts";

function sortTokenSource(
  token: number,
  sources: readonly InsertSource[],
): InsertSource | undefined {
  return token < 0 ? sources[-token - 1] : undefined;
}

function sortTokenIndex(token: number, indices: readonly number[]): number {
  return token < 0 ? indices[-token - 1]! : token;
}

function publicSortValueImpl(
  node: OverlayNode,
  token: number,
  sources: readonly InsertSource[],
  indices: readonly number[],
): unknown {
  const overlay = arrayOverlay(node);
  const source = sortTokenSource(token, sources);
  const sourceIndex = sortTokenIndex(token, indices);
  const overrideIndex =
    source === undefined
      ? overlay.baseOverrides?.get(sourceIndex)
      : overlay.insertOverrides?.get(source)?.get(sourceIndex);
  const value =
    overrideIndex === undefined
      ? source === undefined
        ? (nodeBase(node) as JsonValue[])[sourceIndex]!
        : storedValue(node.context, source.refs[sourceIndex]!)
      : storedValue(node.context, overrideIndex);
  if (!isContainer(value)) return value;
  return createNode(
    node.context,
    value,
    node,
    source === undefined ? 1 : 2,
    sourceIndex,
    source,
    source !== undefined || (overlay.baseOverrides?.has(sourceIndex) ?? false),
  ).proxy;
}

function restoreSortOverrideImpl(
  node: OverlayNode,
  token: number,
  sources: readonly InsertSource[],
  indices: readonly number[],
  baseSnapshot: ReadonlyMap<number, Stored>,
  insertSnapshots: ReadonlyMap<InsertSource, ReadonlyMap<number, Stored>>,
): void {
  const overlay = arrayOverlay(node);
  const source = sortTokenSource(token, sources);
  const sourceIndex = sortTokenIndex(token, indices);
  if (source === undefined) {
    const existingIndex = overlay.baseOverrides?.get(sourceIndex);
    const snapshotValue = baseSnapshot.get(sourceIndex);
    if (snapshotValue === undefined) {
      if (existingIndex !== undefined) releaseStoredValue(node.context, existingIndex);
      overlay.baseOverrides?.delete(sourceIndex);
    } else if (existingIndex === undefined)
      baseOverridesForWrite(overlay).set(sourceIndex, storeValue(node.context, snapshotValue));
    else
      overlay.baseOverrides!.set(
        sourceIndex,
        replaceStoredValue(node.context, existingIndex, snapshotValue),
      );
    return;
  }
  let overrides = overlay.insertOverrides?.get(source);
  const existingIndex = overrides?.get(sourceIndex);
  const snapshotValue = insertSnapshots.get(source)?.get(sourceIndex);
  if (snapshotValue === undefined) {
    if (existingIndex !== undefined) releaseStoredValue(node.context, existingIndex);
    overrides?.delete(sourceIndex);
    if (overrides?.size === 0) overlay.insertOverrides?.delete(source);
    return;
  }
  if (overrides === undefined) {
    overrides = new Map();
    insertOverridesForWrite(overlay).set(source, overrides);
  }
  if (existingIndex === undefined)
    overrides.set(sourceIndex, storeValue(node.context, snapshotValue));
  else overrides.set(sourceIndex, replaceStoredValue(node.context, existingIndex, snapshotValue));
}

function sameSortTokenAtImpl(
  overlay: ArrayOverlay,
  logicalIndex: number,
  token: number,
  sources: readonly InsertSource[],
  indices: readonly number[],
): boolean {
  const piece = locatePiece(overlay, logicalIndex);
  const sourceIndex = piece.start + piece.step * overlay.locatedOffset;
  const tokenSource = sortTokenSource(token, sources);
  return (
    sourceIndex === sortTokenIndex(token, indices) &&
    ((piece.kind === "base" && tokenSource === undefined) ||
      (piece.kind === "insert" && piece.source === tokenSource))
  );
}

export const publicSortValue: {
  (
    token: number,
    sources: readonly InsertSource[],
    indices: readonly number[],
  ): (node: OverlayNode) => unknown;
  (
    node: OverlayNode,
    token: number,
    sources: readonly InsertSource[],
    indices: readonly number[],
  ): unknown;
} = dual(4, publicSortValueImpl);

export const restoreSortOverride: {
  (
    token: number,
    sources: readonly InsertSource[],
    indices: readonly number[],
    baseSnapshot: ReadonlyMap<number, Stored>,
    insertSnapshots: ReadonlyMap<InsertSource, ReadonlyMap<number, Stored>>,
  ): (node: OverlayNode) => void;
  (
    node: OverlayNode,
    token: number,
    sources: readonly InsertSource[],
    indices: readonly number[],
    baseSnapshot: ReadonlyMap<number, Stored>,
    insertSnapshots: ReadonlyMap<InsertSource, ReadonlyMap<number, Stored>>,
  ): void;
} = dual(6, restoreSortOverrideImpl);

export const sameSortTokenAt: {
  (
    logicalIndex: number,
    token: number,
    sources: readonly InsertSource[],
    indices: readonly number[],
  ): (overlay: ArrayOverlay) => boolean;
  (
    overlay: ArrayOverlay,
    logicalIndex: number,
    token: number,
    sources: readonly InsertSource[],
    indices: readonly number[],
  ): boolean;
} = dual(5, sameSortTokenAtImpl);
