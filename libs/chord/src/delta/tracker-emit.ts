import { dual } from "effect/Function";

import { overlap } from "./overlap.ts";
import { cloneNode, cloneStored } from "./tracker-clone.ts";
import { nodeBase, nodeParent, storedValue } from "./tracker-context.ts";
import { denseRegionsOf, emissionPlan, emitPlanned } from "./tracker-emit-plan.ts";
import { objectValue } from "./tracker-object.ts";
import { equalTrustedJson, isContainer, resolvePath } from "./tracker-paths.ts";
import {
  type JsonValue,
  MAX_DELTA_OPERATIONS,
  MAX_SIMPLE_OBJECT_NODES,
  type NonEmptyPath,
  type Op,
  type OverlayContext,
  type OverlayNode,
  type Path,
  RESERVED_SEGMENTS,
  type Stored,
} from "./tracker-types.ts";

export function emitOperations(context: OverlayContext): Op[] {
  const simple = emitSimpleObjectOperations(context);
  if (simple !== undefined) return simple;
  const denseRegions = denseRegionsOf(context);
  const plan = emissionPlan(context, denseRegions);
  return emitPlanned(context, plan, denseRegions);
}

function emitSimpleObjectOperations(context: OverlayContext): Op[] | undefined {
  const nodes: OverlayNode[] = [];
  for (const node of context.dirty) {
    if (Array.isArray(nodeBase(node)) || hasReservedMutation(node) || hasPlacementAncestor(node))
      return undefined;
    for (let parent = nodeParent(node); parent !== undefined; parent = nodeParent(parent)) {
      if (Array.isArray(nodeBase(parent))) return undefined;
    }
    const path = resolvePath(node);
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
  const operations: Op[] = [];
  let canMaterializeDirectly = true;
  for (const node of nodes) {
    if (emitObjectOperationsImpl(node, node.preparedPath!, operations))
      canMaterializeDirectly = false;
    if (operations.length > MAX_DELTA_OPERATIONS) return [["r", cloneNode(context.root!)]];
  }
  context.simpleObjectMaterialization = canMaterializeDirectly;
  return operations;
}

export function hasReservedMutation(node: OverlayNode): boolean {
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

function hasFoldedAncestorImpl(node: OverlayNode, folded: ReadonlySet<OverlayNode>): boolean {
  for (let parent = nodeParent(node); parent !== undefined; parent = nodeParent(parent))
    if (folded.has(parent)) return true;
  return false;
}

export function hasPlacementAncestor(node: OverlayNode): boolean {
  for (
    let current: OverlayNode | undefined = node;
    current !== undefined;
    current = nodeParent(current)
  ) {
    if (nodeParent(current) !== undefined && current.parentPlacement) return true;
  }
  return false;
}

function emitObjectWrite(
  node: OverlayNode,
  path: Path,
  operations: Op[],
  key: string,
  value: Stored,
): boolean {
  const nextPath = [...path, key] as unknown as NonEmptyPath;
  const before =
    node.readded?.has(key) === true || !Object.hasOwn(nodeBase(node), key)
      ? undefined
      : (nodeBase(node) as Record<string, JsonValue>)[key];
  const after = cloneStored(value, node.context);
  const emitted = emitChangedValueImpl(operations, nextPath, before, after);
  return isContainer(before) && isContainer(after) && !emitted;
}

function emitObjectOperationsImpl(node: OverlayNode, path: Path, operations: Op[]): boolean {
  if (node.readded !== undefined) {
    for (const key of node.readded) {
      if (Object.hasOwn(nodeBase(node), key))
        operations.push(["d", [...path, key] as unknown as NonEmptyPath]);
    }
  }
  let normalizedContainerWrite = false;
  if (node.writeKey !== undefined)
    normalizedContainerWrite = emitObjectWrite(
      node,
      path,
      operations,
      node.writeKey,
      objectValue(node, node.writeKey),
    );
  if (node.writes !== undefined) {
    for (const [key, valueIndex] of node.writes) {
      if (operations.length > MAX_DELTA_OPERATIONS) return normalizedContainerWrite;
      if (emitObjectWrite(node, path, operations, key, storedValue(node.context, valueIndex)))
        normalizedContainerWrite = true;
    }
  }
  if (node.deleteKey !== undefined && Object.hasOwn(nodeBase(node), node.deleteKey)) {
    operations.push(["d", [...path, node.deleteKey] as unknown as NonEmptyPath]);
  }
  if (node.deletes !== undefined) {
    for (const key of node.deletes) {
      if (operations.length > MAX_DELTA_OPERATIONS) return normalizedContainerWrite;
      if (Object.hasOwn(nodeBase(node), key))
        operations.push(["d", [...path, key] as unknown as NonEmptyPath]);
    }
  }
  return normalizedContainerWrite;
}

function emitChangedValueImpl(
  operations: Op[],
  path: NonEmptyPath,
  before: JsonValue | undefined,
  after: JsonValue,
): boolean {
  if (!isContainer(after) && before === after) return false;
  if (isContainer(before) && isContainer(after) && equalTrustedJson(before, after)) return false;
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

function emitSetImpl(operations: Op[], path: Path, value: JsonValue): void {
  if (path.length === 0) operations.push(["r", value]);
  else operations.push(["s", path as NonEmptyPath, value]);
}

export const emitSet: {
  (path: Path, value: JsonValue): (operations: Op[]) => void;
  (operations: Op[], path: Path, value: JsonValue): void;
} = dual(3, emitSetImpl);

export const emitChangedValue: {
  (
    path: NonEmptyPath,
    before: JsonValue | undefined,
    after: JsonValue,
  ): (operations: Op[]) => boolean;
  (operations: Op[], path: NonEmptyPath, before: JsonValue | undefined, after: JsonValue): boolean;
} = dual(4, emitChangedValueImpl);

export const hasFoldedAncestor: {
  (folded: ReadonlySet<OverlayNode>): (node: OverlayNode) => boolean;
  (node: OverlayNode, folded: ReadonlySet<OverlayNode>): boolean;
} = dual(2, hasFoldedAncestorImpl);

export const emitObjectOperations: {
  (path: Path, operations: Op[]): (node: OverlayNode) => boolean;
  (node: OverlayNode, path: Path, operations: Op[]): boolean;
} = dual(3, emitObjectOperationsImpl);
