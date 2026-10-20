import { dual } from "effect/Function";

import trackerClone from "./tracker-clone.ts";
import trackerContextKit from "./tracker-context-kit.ts";
import trackerHandler from "./tracker-handler.ts";
import TrackerImpl from "./tracker-impl.ts";
import type trackerImplTypes from "./tracker-impl.types.ts";
import trackerPaths from "./tracker-paths.ts";
import PreparedImpl from "./tracker-prepared.ts";
import type trackerPreparedTypes from "./tracker-prepared.types.ts";
import type trackerTypesModule from "./tracker-types.types.ts";

const {
  apply: applyModule,
  applyImmutableTrusted: applyImmutableTrustedModule,
  trackerGuards,
  trackerTypes,
} = trackerContextKit;
const { applyImmutable } = applyModule;
const { applyImmutableTrusted } = applyImmutableTrustedModule;
const { NODE, RELEASED } = trackerTypes;
const { assertReadable, assertWritable, nodeBase, nodeParent } = trackerGuards;

function track<T extends object>(initial: T): trackerTypesModule.Tracker<T> {
  return new TrackerImpl(initial);
}

function materializePrepared<T extends object>(
  context: trackerTypesModule.OverlayContext,
): trackerPreparedTypes.PreparedImpl<T> {
  const operations = trackerPaths.ensureOperations(context);
  const base = context.baseValue as T;
  const value =
    operations.length === 0
      ? base
      : context.simpleObjectMaterialization
        ? (trackerClone.cloneNode(context.root!) as T)
        : materializeOperations(base, operations);
  const prepared = new PreparedImpl(context, value, operations);
  if (context.nodes.length > 4_096) trackerPaths.releaseOverlayReferences(context);
  else trackerPaths.clearContext(context);
  return prepared;
}

function materializeOperations<T extends object>(
  base: T,
  operations: readonly trackerTypesModule.Op[],
): T {
  for (const operation of operations) {
    if (operation[0] === "p" || operation[0] === "m") return applyImmutable(base, operations);
  }
  return applyImmutableTrusted(base, operations);
}

function createContextImpl<T extends object>(
  tracker: WeakRef<trackerImplTypes.TrackerImpl<object>>,
  owner: object,
  baseRevision: number,
  root: T,
  replacement: boolean,
  base: T,
): trackerTypesModule.OverlayContext {
  const context: trackerTypesModule.OverlayContext = {
    baseRevision,
    baseValue: base,
    bases: [],
    dirty: [],
    nodes: [],
    ops: undefined,
    overlayReleased: false,
    owner,
    rawNodes: new WeakMap(),
    registryRef: undefined,
    replacement,
    replacementNoop: false,
    root: undefined,
    simpleObjectMaterialization: false,
    status: { value: "open" },
    stored: [],
    tracker,
  };
  context.root = createNodeImpl(context, root as trackerTypesModule.Container, undefined);
  return context;
}

function createNodeImpl(
  context: trackerTypesModule.OverlayContext,
  base: trackerTypesModule.Container,
  parent: trackerTypesModule.OverlayNode | undefined,
  parentKind: trackerTypesModule.ParentKind = 0,
  parentKey: string | number = "",
  parentSource: trackerTypesModule.InsertSource | undefined = undefined,
  parentPlacement = false,
): trackerTypesModule.OverlayNode {
  const existing = context.rawNodes!.get(base);
  if (existing !== undefined) return existing;
  const target: object = Array.isArray(base) ? [] : {};
  const baseIndex = context.bases!.length;
  const parentIndex = parent?.baseIndex ?? -1;
  context.bases!.push(base);
  const node: trackerTypesModule.OverlayNode = {
    baseIndex,
    context,
    parentIndex,
    parentKey,
    parentKind,
    parentPlacement,
    proxy: target,
    target,
  };
  if (parentSource !== undefined) node.parentSource = parentSource;
  (target as Record<PropertyKey, unknown>)[NODE] = node;
  node.proxy = new Proxy(
    target,
    Array.isArray(base) ? trackerHandler.sharedArrayHandler : trackerHandler.sharedObjectHandler,
  );
  context.rawNodes!.set(base, node);
  context.nodes.push(node);
  return node;
}

function storeValueImpl(
  context: trackerTypesModule.OverlayContext,
  value: trackerTypesModule.Stored,
): trackerTypesModule.StoredRef {
  if (!trackerPaths.isContainer(value)) return value;
  const index = context.stored!.length;
  context.stored!.push(value);
  return { index };
}

function storedValueImpl(
  context: trackerTypesModule.OverlayContext,
  reference: trackerTypesModule.StoredRef,
): trackerTypesModule.Stored {
  return typeof reference === "object" && reference !== null
    ? context.stored![reference.index]!
    : reference;
}

function replaceStoredValueImpl(
  context: trackerTypesModule.OverlayContext,
  reference: trackerTypesModule.StoredRef,
  value: trackerTypesModule.Stored,
): trackerTypesModule.StoredRef {
  if (trackerPaths.isContainer(value)) {
    if (typeof reference === "object" && reference !== null) {
      context.stored![reference.index] = value;
      return reference;
    }
    return storeValueImpl(context, value);
  }
  if (typeof reference === "object" && reference !== null)
    context.stored![reference.index] = RELEASED;
  return value;
}

function releaseStoredValueImpl(
  context: trackerTypesModule.OverlayContext,
  reference: trackerTypesModule.StoredRef,
): void {
  if (typeof reference === "object" && reference !== null)
    context.stored![reference.index] = RELEASED;
}

const replaceStoredValue: {
  (
    reference: trackerTypesModule.StoredRef,
    value: trackerTypesModule.Stored,
  ): (context: trackerTypesModule.OverlayContext) => trackerTypesModule.StoredRef;
  (
    context: trackerTypesModule.OverlayContext,
    reference: trackerTypesModule.StoredRef,
    value: trackerTypesModule.Stored,
  ): trackerTypesModule.StoredRef;
} = dual(3, replaceStoredValueImpl);

const releaseStoredValue: {
  (reference: trackerTypesModule.StoredRef): (context: trackerTypesModule.OverlayContext) => void;
  (context: trackerTypesModule.OverlayContext, reference: trackerTypesModule.StoredRef): void;
} = dual(2, releaseStoredValueImpl);

const storeValue: {
  (
    value: trackerTypesModule.Stored,
  ): (context: trackerTypesModule.OverlayContext) => trackerTypesModule.StoredRef;
  (
    context: trackerTypesModule.OverlayContext,
    value: trackerTypesModule.Stored,
  ): trackerTypesModule.StoredRef;
} = dual(2, storeValueImpl);

const createNode: {
  (
    base: trackerTypesModule.Container,
    parent: trackerTypesModule.OverlayNode | undefined,
    parentKind?: trackerTypesModule.ParentKind,
    parentKey?: string | number,
    parentSource?: trackerTypesModule.InsertSource | undefined,
    parentPlacement?: boolean,
  ): (context: trackerTypesModule.OverlayContext) => trackerTypesModule.OverlayNode;
  (
    context: trackerTypesModule.OverlayContext,
    base: trackerTypesModule.Container,
    parent: trackerTypesModule.OverlayNode | undefined,
    parentKind?: trackerTypesModule.ParentKind,
    parentKey?: string | number,
    parentSource?: trackerTypesModule.InsertSource | undefined,
    parentPlacement?: boolean,
  ): trackerTypesModule.OverlayNode;
} = dual((args) => args.length >= 3, createNodeImpl);

const storedValue: {
  (
    reference: trackerTypesModule.StoredRef,
  ): (context: trackerTypesModule.OverlayContext) => trackerTypesModule.Stored;
  (
    context: trackerTypesModule.OverlayContext,
    reference: trackerTypesModule.StoredRef,
  ): trackerTypesModule.Stored;
} = dual(2, storedValueImpl);

const createContext: {
  <T extends object>(
    owner: object,
    baseRevision: number,
    root: T,
    replacement: boolean,
    base: T,
  ): (tracker: WeakRef<trackerImplTypes.TrackerImpl<object>>) => trackerTypesModule.OverlayContext;
  <T extends object>(
    tracker: WeakRef<trackerImplTypes.TrackerImpl<object>>,
    owner: object,
    baseRevision: number,
    root: T,
    replacement: boolean,
    base: T,
  ): trackerTypesModule.OverlayContext;
} = dual(6, createContextImpl);

const trackerContext = {
  assertReadable,
  assertWritable,
  createContext,
  createNode,
  materializePrepared,
  nodeBase,
  nodeParent,
  releaseStoredValue,
  replaceStoredValue,
  storeValue,
  storedValue,
  track,
};

export default trackerContext;
