import { dual } from "effect/Function";

import { applyImmutableTrusted } from "./apply-immutable-trusted.ts";
import { applyImmutable } from "./apply.ts";
import { cloneNode } from "./tracker-clone.ts";
import { TrackerImpl } from "./tracker-impl.ts";
import {
  clearContext,
  ensureOperations,
  isContainer,
  releaseOverlayReferences,
} from "./tracker-paths.ts";
import { PreparedImpl } from "./tracker-prepared.ts";
import {
  deleteProperty,
  getDescriptor,
  getProperty,
  hasProperty,
  ownKeys,
  setProperty,
} from "./tracker-props.ts";
import {
  type Container,
  type InsertSource,
  NODE,
  type Op,
  type OverlayContext,
  type OverlayNode,
  type ParentKind,
  RELEASED,
  type Stored,
  type StoredRef,
  type Tracker,
} from "./tracker-types.ts";

export function track<T extends object>(initial: T): Tracker<T> {
  return new TrackerImpl(initial);
}

export function materializePrepared<T extends object>(context: OverlayContext): PreparedImpl<T> {
  const operations = ensureOperations(context);
  const base = context.baseValue as T;
  const value =
    operations.length === 0
      ? base
      : context.simpleObjectMaterialization
        ? (cloneNode(context.root!) as T)
        : materializeOperations(base, operations);
  const prepared = new PreparedImpl(context, value, operations);
  if (context.nodes.length > 4_096) releaseOverlayReferences(context);
  else clearContext(context);
  return prepared;
}

function materializeOperations<T extends object>(base: T, operations: readonly Op[]): T {
  for (const operation of operations) {
    if (operation[0] === "p" || operation[0] === "m") return applyImmutable(base, operations);
  }
  return applyImmutableTrusted(base, operations);
}

function createContextImpl<T extends object>(
  tracker: WeakRef<TrackerImpl<object>>,
  owner: object,
  baseRevision: number,
  root: T,
  replacement: boolean,
  base: T,
): OverlayContext {
  const context: OverlayContext = {
    owner,
    tracker,
    baseRevision,
    status: { value: "open" },
    root: undefined,
    bases: [],
    stored: [],
    dirty: [],
    nodes: [],
    rawNodes: new WeakMap(),
    ops: undefined,
    replacement,
    replacementNoop: false,
    baseValue: base,
    overlayReleased: false,
    simpleObjectMaterialization: false,
    registryRef: undefined,
  };
  context.root = createNodeImpl(context, root as Container, undefined);
  return context;
}

const sharedObjectHandler: ProxyHandler<object> = {
  deleteProperty(target, property) {
    return deleteProperty(nodeForTarget(target), property);
  },
  defineProperty(target) {
    assertWritable(nodeForTarget(target).context);
    throw new TypeError("Defining overlay properties is not supported");
  },
  get(target, property) {
    if (property === "then") {
      const node = (target as Record<PropertyKey, unknown>)[NODE] as OverlayNode | undefined;
      if (node === undefined || isSettledContext(node.context)) return undefined;
    }
    const node = nodeForTarget(target);
    if (property === NODE) return node;
    return getProperty(node, property);
  },
  getOwnPropertyDescriptor(target, property) {
    return getDescriptor(nodeForTarget(target), property);
  },
  getPrototypeOf(target) {
    const node = nodeForTarget(target);
    assertReadable(node.context);
    return Object.getPrototypeOf(nodeBase(node));
  },
  has(target, property) {
    return hasProperty(nodeForTarget(target), property);
  },
  isExtensible(target) {
    assertReadable(nodeForTarget(target).context);
    return true;
  },
  ownKeys(target) {
    return ownKeys(nodeForTarget(target));
  },
  preventExtensions(target) {
    assertWritable(nodeForTarget(target).context);
    throw new TypeError("Overlays cannot be made non-extensible");
  },
  set(target, property, value) {
    return setProperty(nodeForTarget(target), property, value);
  },
  setPrototypeOf(target) {
    assertWritable(nodeForTarget(target).context);
    throw new TypeError("Changing an overlay prototype is not supported");
  },
};

const sharedArrayHandler: ProxyHandler<object> = sharedObjectHandler;

function createNodeImpl(
  context: OverlayContext,
  base: Container,
  parent: OverlayNode | undefined,
  parentKind: ParentKind = 0,
  parentKey: string | number = "",
  parentSource: InsertSource | undefined = undefined,
  parentPlacement = false,
): OverlayNode {
  const existing = context.rawNodes!.get(base);
  if (existing !== undefined) return existing;
  const target: object = Array.isArray(base) ? [] : {};
  const baseIndex = context.bases!.length;
  const parentIndex = parent?.baseIndex ?? -1;
  context.bases!.push(base);
  const node: OverlayNode = {
    context,
    baseIndex,
    parentIndex,
    parentKind,
    parentKey,
    parentPlacement,
    target,
    proxy: target,
  };
  if (parentSource !== undefined) node.parentSource = parentSource;
  (target as Record<PropertyKey, unknown>)[NODE] = node;
  node.proxy = new Proxy(target, Array.isArray(base) ? sharedArrayHandler : sharedObjectHandler);
  context.rawNodes!.set(base, node);
  context.nodes.push(node);
  return node;
}

export function nodeBase(node: OverlayNode): Container {
  return node.context.bases![node.baseIndex]!;
}

export function nodeParent(node: OverlayNode): OverlayNode | undefined {
  return node.parentIndex < 0 ? undefined : node.context.nodes[node.parentIndex];
}

function storeValueImpl(context: OverlayContext, value: Stored): StoredRef {
  if (!isContainer(value)) return value;
  const index = context.stored!.length;
  context.stored!.push(value);
  return { index };
}

function storedValueImpl(context: OverlayContext, reference: StoredRef): Stored {
  return typeof reference === "object" && reference !== null
    ? context.stored![reference.index]!
    : reference;
}

function replaceStoredValueImpl(
  context: OverlayContext,
  reference: StoredRef,
  value: Stored,
): StoredRef {
  if (isContainer(value)) {
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

function releaseStoredValueImpl(context: OverlayContext, reference: StoredRef): void {
  if (typeof reference === "object" && reference !== null)
    context.stored![reference.index] = RELEASED;
}

function nodeForTarget(target: object): OverlayNode {
  const node = (target as Record<PropertyKey, unknown>)[NODE] as OverlayNode | undefined;
  if (node === undefined) throw new TypeError("Cannot use a settled overlay");
  return node;
}

function isSettledContext(context: OverlayContext): boolean {
  return (
    context.overlayReleased ||
    context.status.value === "consumed" ||
    context.status.value === "aborted" ||
    context.status.value === "stale"
  );
}

export function assertReadable(context: OverlayContext): void {
  if (isSettledContext(context)) throw new TypeError("Cannot use a settled overlay");
}

export function assertWritable(context: OverlayContext): void {
  assertReadable(context);
  if (context.status.value !== "open") throw new TypeError("Prepared overlays are read-only");
}

export const replaceStoredValue: {
  (reference: StoredRef, value: Stored): (context: OverlayContext) => StoredRef;
  (context: OverlayContext, reference: StoredRef, value: Stored): StoredRef;
} = dual(3, replaceStoredValueImpl);

export const releaseStoredValue: {
  (reference: StoredRef): (context: OverlayContext) => void;
  (context: OverlayContext, reference: StoredRef): void;
} = dual(2, releaseStoredValueImpl);

export const storeValue: {
  (value: Stored): (context: OverlayContext) => StoredRef;
  (context: OverlayContext, value: Stored): StoredRef;
} = dual(2, storeValueImpl);

export const createNode: {
  (
    base: Container,
    parent: OverlayNode | undefined,
    parentKind?: ParentKind,
    parentKey?: string | number,
    parentSource?: InsertSource | undefined,
    parentPlacement?: boolean,
  ): (context: OverlayContext) => OverlayNode;
  (
    context: OverlayContext,
    base: Container,
    parent: OverlayNode | undefined,
    parentKind?: ParentKind,
    parentKey?: string | number,
    parentSource?: InsertSource | undefined,
    parentPlacement?: boolean,
  ): OverlayNode;
} = dual((args) => args.length >= 3, createNodeImpl);

export const storedValue: {
  (reference: StoredRef): (context: OverlayContext) => Stored;
  (context: OverlayContext, reference: StoredRef): Stored;
} = dual(2, storedValueImpl);

export const createContext: {
  <T extends object>(
    owner: object,
    baseRevision: number,
    root: T,
    replacement: boolean,
    base: T,
  ): (tracker: WeakRef<TrackerImpl<object>>) => OverlayContext;
  <T extends object>(
    tracker: WeakRef<TrackerImpl<object>>,
    owner: object,
    baseRevision: number,
    root: T,
    replacement: boolean,
    base: T,
  ): OverlayContext;
} = dual(6, createContextImpl);
