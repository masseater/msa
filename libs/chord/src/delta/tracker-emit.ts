import { dual } from "effect/Function";

import overlapModule from "./overlap.ts";
import trackerClone from "./tracker-clone.ts";
import trackerContext from "./tracker-context.ts";
import trackerEmitPlan from "./tracker-emit-plan.ts";
import trackerObject from "./tracker-object.ts";
import trackerPaths from "./tracker-paths.ts";
import trackerTypes from "./tracker-types.ts";
import type trackerTypesModule from "./tracker-types.types.ts";
const { MAX_DELTA_OPERATIONS, MAX_SIMPLE_OBJECT_NODES, RESERVED_SEGMENTS } = trackerTypes;
const { overlap } = overlapModule;

function emitOperations(context: trackerTypesModule.OverlayContext): trackerTypesModule.Op[] {
  const simple = emitSimpleObjectOperations(context);
  if (simple !== undefined) return simple;
  const denseRegions = trackerEmitPlan.denseRegionsOf(context);
  const plan = trackerEmitPlan.emissionPlan(context, denseRegions);
  return trackerEmitPlan.emitPlanned(context, plan, denseRegions);
}

function emitSimpleObjectOperations(
  context: trackerTypesModule.OverlayContext,
): trackerTypesModule.Op[] | undefined {
  const nodes: trackerTypesModule.OverlayNode[] = [];
  for (const node of context.dirty) {
    if (
      Array.isArray(trackerContext.nodeBase(node)) ||
      hasReservedMutation(node) ||
      hasPlacementAncestor(node)
    )
      return undefined;
    for (
      let parent = trackerContext.nodeParent(node);
      parent !== undefined;
      parent = trackerContext.nodeParent(parent)
    ) {
      if (Array.isArray(trackerContext.nodeBase(parent))) return undefined;
    }
    const path = trackerPaths.resolvePath(node);
    if (path === undefined) continue;
    for (const segment of path) {
      if (typeof segment === "string" && RESERVED_SEGMENTS.has(segment)) return undefined;
    }
    nodes.push(node);
    if (nodes.length > MAX_SIMPLE_OBJECT_NODES) return undefined;
  }
  for (let index = 1; index < nodes.length; index++) {
    const node = nodes[index]!;
    const depth = node.preparedPath!.length;
    let at = index;
    while (at > 0 && nodes[at - 1]!.preparedPath!.length > depth) {
      nodes[at] = nodes[at - 1]!;
      at -= 1;
    }
    nodes[at] = node;
  }
  const operations: trackerTypesModule.Op[] = [];
  let canMaterializeDirectly = true;
  for (const node of nodes) {
    if (emitObjectOperationsImpl(node, node.preparedPath!, operations))
      canMaterializeDirectly = false;
    if (operations.length > MAX_DELTA_OPERATIONS)
      return [["r", trackerClone.cloneNode(context.root!)]];
  }
  context.simpleObjectMaterialization = canMaterializeDirectly;
  return operations;
}

function hasReservedMutation(node: trackerTypesModule.OverlayNode): boolean {
  if (node.writeKey !== undefined && RESERVED_SEGMENTS.has(node.writeKey)) return true;
  if (node.deleteKey !== undefined && RESERVED_SEGMENTS.has(node.deleteKey)) return true;
  if (node.writes !== undefined) {
    for (const key of node.writes.keys()) if (RESERVED_SEGMENTS.has(key)) return true;
  }
  if (node.deletes !== undefined) {
    for (const key of node.deletes) if (RESERVED_SEGMENTS.has(key)) return true;
  }
  return false;
}

function hasFoldedAncestorImpl(
  node: trackerTypesModule.OverlayNode,
  folded: ReadonlySet<trackerTypesModule.OverlayNode>,
): boolean {
  for (
    let parent = trackerContext.nodeParent(node);
    parent !== undefined;
    parent = trackerContext.nodeParent(parent)
  )
    if (folded.has(parent)) return true;
  return false;
}

function hasPlacementAncestor(node: trackerTypesModule.OverlayNode): boolean {
  for (
    let current: trackerTypesModule.OverlayNode | undefined = node;
    current !== undefined;
    current = trackerContext.nodeParent(current)
  ) {
    if (trackerContext.nodeParent(current) !== undefined && current.parentPlacement) return true;
  }
  return false;
}

function emitObjectWrite(
  node: trackerTypesModule.OverlayNode,
  path: trackerTypesModule.Path,
  operations: trackerTypesModule.Op[],
  key: string,
  value: trackerTypesModule.Stored,
): boolean {
  const nextPath = [...path, key] as unknown as trackerTypesModule.NonEmptyPath;
  const before =
    node.readded?.has(key) === true || !Object.hasOwn(trackerContext.nodeBase(node), key)
      ? undefined
      : (trackerContext.nodeBase(node) as Record<string, trackerTypesModule.JsonValue>)[key];
  const after = trackerClone.cloneStored(value, node.context);
  const emitted = emitChangedValueImpl(operations, nextPath, before, after);
  return trackerPaths.isContainer(before) && trackerPaths.isContainer(after) && !emitted;
}

function emitObjectOperationsImpl(
  node: trackerTypesModule.OverlayNode,
  path: trackerTypesModule.Path,
  operations: trackerTypesModule.Op[],
): boolean {
  if (node.readded !== undefined) {
    for (const key of node.readded) {
      if (Object.hasOwn(trackerContext.nodeBase(node), key))
        operations.push(["d", [...path, key] as unknown as trackerTypesModule.NonEmptyPath]);
    }
  }
  let normalizedContainerWrite = false;
  if (node.writeKey !== undefined)
    normalizedContainerWrite = emitObjectWrite(
      node,
      path,
      operations,
      node.writeKey,
      trackerObject.objectValue(node, node.writeKey),
    );
  if (node.writes !== undefined) {
    for (const [key, valueIndex] of node.writes) {
      if (operations.length > MAX_DELTA_OPERATIONS) return normalizedContainerWrite;
      if (
        emitObjectWrite(
          node,
          path,
          operations,
          key,
          trackerContext.storedValue(node.context, valueIndex),
        )
      )
        normalizedContainerWrite = true;
    }
  }
  if (
    node.deleteKey !== undefined &&
    Object.hasOwn(trackerContext.nodeBase(node), node.deleteKey)
  ) {
    operations.push(["d", [...path, node.deleteKey] as unknown as trackerTypesModule.NonEmptyPath]);
  }
  if (node.deletes !== undefined) {
    for (const key of node.deletes) {
      if (operations.length > MAX_DELTA_OPERATIONS) return normalizedContainerWrite;
      if (Object.hasOwn(trackerContext.nodeBase(node), key))
        operations.push(["d", [...path, key] as unknown as trackerTypesModule.NonEmptyPath]);
    }
  }
  return normalizedContainerWrite;
}

function emitChangedValueImpl(
  operations: trackerTypesModule.Op[],
  path: trackerTypesModule.NonEmptyPath,
  before: trackerTypesModule.JsonValue | undefined,
  after: trackerTypesModule.JsonValue,
): boolean {
  if (!trackerPaths.isContainer(after) && before === after) return false;
  if (
    trackerPaths.isContainer(before) &&
    trackerPaths.isContainer(after) &&
    trackerPaths.equalTrustedJson(before, after)
  )
    return false;
  if (typeof before === "string" && typeof after === "string") {
    if (after.length > before.length && after.slice(0, before.length) === before) {
      operations.push(["a", path, after.slice(before.length)]);
      return true;
    }
    const shared = overlap(before, after, 65_536);
    if (shared > 0) {
      operations.push(["t", path, before.length - shared]);
      if (after.length > shared) operations.push(["a", path, after.slice(shared)]);
      return true;
    }
  }
  operations.push(["s", path, after]);
  return true;
}

function emitSetImpl(
  operations: trackerTypesModule.Op[],
  path: trackerTypesModule.Path,
  value: trackerTypesModule.JsonValue,
): void {
  if (path.length === 0) operations.push(["r", value]);
  else operations.push(["s", path as trackerTypesModule.NonEmptyPath, value]);
}

const emitSet: {
  (
    path: trackerTypesModule.Path,
    value: trackerTypesModule.JsonValue,
  ): (operations: trackerTypesModule.Op[]) => void;
  (
    operations: trackerTypesModule.Op[],
    path: trackerTypesModule.Path,
    value: trackerTypesModule.JsonValue,
  ): void;
} = dual(3, emitSetImpl);

const emitChangedValue: {
  (
    path: trackerTypesModule.NonEmptyPath,
    before: trackerTypesModule.JsonValue | undefined,
    after: trackerTypesModule.JsonValue,
  ): (operations: trackerTypesModule.Op[]) => boolean;
  (
    operations: trackerTypesModule.Op[],
    path: trackerTypesModule.NonEmptyPath,
    before: trackerTypesModule.JsonValue | undefined,
    after: trackerTypesModule.JsonValue,
  ): boolean;
} = dual(4, emitChangedValueImpl);

const hasFoldedAncestor: {
  (
    folded: ReadonlySet<trackerTypesModule.OverlayNode>,
  ): (node: trackerTypesModule.OverlayNode) => boolean;
  (
    node: trackerTypesModule.OverlayNode,
    folded: ReadonlySet<trackerTypesModule.OverlayNode>,
  ): boolean;
} = dual(2, hasFoldedAncestorImpl);

const emitObjectOperations: {
  (
    path: trackerTypesModule.Path,
    operations: trackerTypesModule.Op[],
  ): (node: trackerTypesModule.OverlayNode) => boolean;
  (
    node: trackerTypesModule.OverlayNode,
    path: trackerTypesModule.Path,
    operations: trackerTypesModule.Op[],
  ): boolean;
} = dual(3, emitObjectOperationsImpl);

const trackerEmit = {
  emitChangedValue,
  emitObjectOperations,
  emitOperations,
  emitSet,
  hasFoldedAncestor,
  hasPlacementAncestor,
  hasReservedMutation,
};

export default trackerEmit;
