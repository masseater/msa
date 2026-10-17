import { dual } from "effect/Function";

import { cloneNode } from "./tracker-clone.ts";
import { nodeBase, nodeParent } from "./tracker-context.ts";
import { emitArrayOperations } from "./tracker-emit-array.ts";
import {
  addDenseCandidate,
  buildDenseRegions,
  clearDenseArray,
  hasCoveringDenseRegion,
  recordDenseArrayPosition,
} from "./tracker-emit-dense.ts";
import {
  emitObjectOperations,
  emitSet,
  hasFoldedAncestor,
  hasPlacementAncestor,
  hasReservedMutation,
} from "./tracker-emit.ts";
import { arrayOverlay } from "./tracker-object.ts";
import { resolvePath } from "./tracker-paths.ts";
import {
  type DenseCandidates,
  type DenseRegion,
  type JsonValue,
  MAX_DELTA_OPERATIONS,
  type Op,
  type OverlayContext,
  type OverlayNode,
  type Path,
  RESERVED_SEGMENTS,
} from "./tracker-types.ts";

interface EmissionPlan {
  readonly emissionPaths: Map<OverlayNode, Path>;
  readonly forcedFolds: Map<OverlayNode, Path>;
}

function denseCandidatesOf(context: OverlayContext): Map<OverlayNode, DenseCandidates> {
  const denseIndices = new Map<OverlayNode, DenseCandidates>();
  for (const node of context.dirty) {
    recordDenseArrayPosition(node, denseIndices);
    if (!Array.isArray(nodeBase(node))) continue;
    const overlay = arrayOverlay(node);
    if (overlay.structural || (overlay.baseOverrides?.size ?? 0) === 0) continue;
    let candidates = denseIndices.get(node);
    if (candidates === undefined) {
      candidates = { indices: [], bits: undefined, length: (nodeBase(node) as JsonValue[]).length };
      denseIndices.set(node, candidates);
    }
    for (const index of overlay.baseOverrides!.keys()) addDenseCandidate(candidates, index);
  }
  return denseIndices;
}

export function denseRegionsOf(context: OverlayContext): Map<OverlayNode, DenseRegion[]> {
  const denseRegions = new Map<OverlayNode, DenseRegion[]>();
  for (const [array, candidates] of denseCandidatesOf(context)) {
    const path = resolvePath(array);
    if (
      path === undefined ||
      path.some((segment) => typeof segment === "string" && RESERVED_SEGMENTS.has(segment))
    ) {
      continue;
    }
    const regions = buildDenseRegions(candidates);
    if (regions.length > 0) denseRegions.set(array, regions);
  }
  return denseRegions;
}

function emissionPlanImpl(
  context: OverlayContext,
  denseRegions: ReadonlyMap<OverlayNode, DenseRegion[]>,
): EmissionPlan {
  const emissionPaths = new Map<OverlayNode, Path>();
  const forcedFolds = new Map<OverlayNode, Path>();
  for (const node of context.dirty) {
    const path = resolvePath(node);
    if (path === undefined) continue;
    if (hasCoveringDenseRegion(node, path, denseRegions)) continue;
    emissionPaths.set(node, path);
    if (!Array.isArray(nodeBase(node)) && hasReservedMutation(node)) forcedFolds.set(node, path);
    const reservedAt = path.findIndex(
      (segment) => typeof segment === "string" && RESERVED_SEGMENTS.has(segment),
    );
    if (reservedAt >= 0) {
      let ancestor = node;
      for (let depth = path.length; depth > reservedAt; depth--) ancestor = nodeParent(ancestor)!;
      forcedFolds.set(ancestor, path.slice(0, reservedAt));
    }
  }
  for (const [node, path] of forcedFolds) emissionPaths.set(node, path);
  for (const node of denseRegions.keys()) {
    const path = resolvePath(node);
    if (path !== undefined && !hasCoveringDenseRegion(node, path, denseRegions))
      emissionPaths.set(node, path);
  }
  return { emissionPaths, forcedFolds };
}

function depthBuckets(emissionPaths: ReadonlyMap<OverlayNode, Path>): OverlayNode[][] {
  let maxDepth = 0;
  for (const path of emissionPaths.values()) maxDepth = Math.max(maxDepth, path.length);
  const buckets: OverlayNode[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const [node, path] of emissionPaths) buckets[path.length]!.push(node);
  return buckets;
}

function emitPlannedImpl(
  context: OverlayContext,
  plan: EmissionPlan,
  denseRegions: ReadonlyMap<OverlayNode, DenseRegion[]>,
): Op[] {
  const operations: Op[] = [];
  const folded = new Set<OverlayNode>();
  for (const bucket of depthBuckets(plan.emissionPaths)) {
    for (const node of bucket) {
      const path = plan.emissionPaths.get(node)!;
      if (hasPlacementAncestor(node) || hasFoldedAncestor(node, folded)) continue;
      if (plan.forcedFolds.has(node)) {
        emitSet(operations, path, cloneNode(node));
        folded.add(node);
        continue;
      }
      if (Array.isArray(nodeBase(node)))
        emitArrayOperations(node, path, operations, denseRegions.get(node));
      else emitObjectOperations(node, path, operations);
      if (operations.length > MAX_DELTA_OPERATIONS) {
        clearDenseArray();
        return [["r", cloneNode(context.root!)]];
      }
    }
  }
  clearDenseArray();
  return operations;
}

export const emissionPlan: {
  (
    denseRegions: ReadonlyMap<OverlayNode, DenseRegion[]>,
  ): (context: OverlayContext) => EmissionPlan;
  (context: OverlayContext, denseRegions: ReadonlyMap<OverlayNode, DenseRegion[]>): EmissionPlan;
} = dual(2, emissionPlanImpl);

export const emitPlanned: {
  (
    plan: EmissionPlan,
    denseRegions: ReadonlyMap<OverlayNode, DenseRegion[]>,
  ): (context: OverlayContext) => Op[];
  (
    context: OverlayContext,
    plan: EmissionPlan,
    denseRegions: ReadonlyMap<OverlayNode, DenseRegion[]>,
  ): Op[];
} = dual(3, emitPlannedImpl);
