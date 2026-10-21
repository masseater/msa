import { dual } from "effect/Function";

import trackerClone from "./tracker-clone.ts";
import trackerContext from "./tracker-context.ts";
import trackerEmitArray from "./tracker-emit-array.ts";
import trackerEmitDense from "./tracker-emit-dense.ts";
import trackerEmit from "./tracker-emit.ts";
import trackerObject from "./tracker-object.ts";
import trackerPaths from "./tracker-paths.ts";
import trackerTypes from "./tracker-types.ts";
import type trackerTypesModule from "./tracker-types.types.ts";
const { MAX_DELTA_OPERATIONS, RESERVED_SEGMENTS } = trackerTypes;

interface EmissionPlan {
  readonly emissionPaths: Map<trackerTypesModule.OverlayNode, trackerTypesModule.Path>;
  readonly forcedFolds: Map<trackerTypesModule.OverlayNode, trackerTypesModule.Path>;
}

function denseCandidatesOf(
  context: trackerTypesModule.OverlayContext,
): Map<trackerTypesModule.OverlayNode, trackerTypesModule.DenseCandidates> {
  const denseIndices = new Map<
    trackerTypesModule.OverlayNode,
    trackerTypesModule.DenseCandidates
  >();
  for (const node of context.dirty) {
    trackerEmitDense.recordDenseArrayPosition(node, denseIndices);
    if (!Array.isArray(trackerContext.nodeBase(node))) continue;
    const overlay = trackerObject.arrayOverlay(node);
    if (overlay.structural || (overlay.baseOverrides?.size ?? 0) === 0) continue;
    let candidates = denseIndices.get(node);
    if (candidates === undefined) {
      candidates = {
        bits: undefined,
        indices: [],
        length: (trackerContext.nodeBase(node) as trackerTypesModule.JsonValue[]).length,
      };
      denseIndices.set(node, candidates);
    }
    for (const index of overlay.baseOverrides!.keys())
      trackerEmitDense.addDenseCandidate(candidates, index);
  }
  return denseIndices;
}

function denseRegionsOf(
  context: trackerTypesModule.OverlayContext,
): Map<trackerTypesModule.OverlayNode, trackerTypesModule.DenseRegion[]> {
  const denseRegions = new Map<trackerTypesModule.OverlayNode, trackerTypesModule.DenseRegion[]>();
  for (const [array, candidates] of denseCandidatesOf(context)) {
    const path = trackerPaths.resolvePath(array);
    if (
      path === undefined ||
      path.some((segment) => typeof segment === "string" && RESERVED_SEGMENTS.has(segment))
    ) {
      continue;
    }
    const regions = trackerEmitDense.buildDenseRegions(candidates);
    if (regions.length > 0) denseRegions.set(array, regions);
  }
  return denseRegions;
}

function emissionPlanImpl(
  context: trackerTypesModule.OverlayContext,
  denseRegions: ReadonlyMap<trackerTypesModule.OverlayNode, trackerTypesModule.DenseRegion[]>,
): EmissionPlan {
  const emissionPaths = new Map<trackerTypesModule.OverlayNode, trackerTypesModule.Path>();
  const forcedFolds = new Map<trackerTypesModule.OverlayNode, trackerTypesModule.Path>();
  for (const node of context.dirty) {
    const path = trackerPaths.resolvePath(node);
    if (path === undefined) continue;
    if (trackerEmitDense.hasCoveringDenseRegion(node, path, denseRegions)) continue;
    emissionPaths.set(node, path);
    if (!Array.isArray(trackerContext.nodeBase(node)) && trackerEmit.hasReservedMutation(node))
      forcedFolds.set(node, path);
    const reservedAt = path.findIndex(
      (segment) => typeof segment === "string" && RESERVED_SEGMENTS.has(segment),
    );
    if (reservedAt >= 0) {
      let ancestor = node;
      for (let depth = path.length; depth > reservedAt; depth--)
        ancestor = trackerContext.nodeParent(ancestor)!;
      forcedFolds.set(ancestor, path.slice(0, reservedAt));
    }
  }
  for (const [node, path] of forcedFolds) emissionPaths.set(node, path);
  for (const node of denseRegions.keys()) {
    const path = trackerPaths.resolvePath(node);
    if (path !== undefined && !trackerEmitDense.hasCoveringDenseRegion(node, path, denseRegions))
      emissionPaths.set(node, path);
  }
  return { emissionPaths, forcedFolds };
}

function depthBuckets(
  emissionPaths: ReadonlyMap<trackerTypesModule.OverlayNode, trackerTypesModule.Path>,
): trackerTypesModule.OverlayNode[][] {
  let maxDepth = 0;
  for (const path of emissionPaths.values()) maxDepth = Math.max(maxDepth, path.length);
  const buckets: trackerTypesModule.OverlayNode[][] = Array.from(
    { length: maxDepth + 1 },
    () => [],
  );
  for (const [node, path] of emissionPaths) buckets[path.length]!.push(node);
  return buckets;
}

function emitPlannedImpl(
  context: trackerTypesModule.OverlayContext,
  plan: EmissionPlan,
  denseRegions: ReadonlyMap<trackerTypesModule.OverlayNode, trackerTypesModule.DenseRegion[]>,
): trackerTypesModule.Op[] {
  const operations: trackerTypesModule.Op[] = [];
  const folded = new Set<trackerTypesModule.OverlayNode>();
  for (const bucket of depthBuckets(plan.emissionPaths)) {
    for (const node of bucket) {
      const path = plan.emissionPaths.get(node)!;
      if (trackerEmit.hasPlacementAncestor(node) || trackerEmit.hasFoldedAncestor(node, folded))
        continue;
      if (plan.forcedFolds.has(node)) {
        trackerEmit.emitSet(operations, path, trackerClone.cloneNode(node));
        folded.add(node);
        continue;
      }
      if (Array.isArray(trackerContext.nodeBase(node)))
        trackerEmitArray.emitArrayOperations(node, path, operations, denseRegions.get(node));
      else trackerEmit.emitObjectOperations(node, path, operations);
      if (operations.length > MAX_DELTA_OPERATIONS) {
        trackerEmitDense.clearDenseArray();
        return [["r", trackerClone.cloneNode(context.root!)]];
      }
    }
  }
  trackerEmitDense.clearDenseArray();
  return operations;
}

const emissionPlan: {
  (
    denseRegions: ReadonlyMap<trackerTypesModule.OverlayNode, trackerTypesModule.DenseRegion[]>,
  ): (context: trackerTypesModule.OverlayContext) => EmissionPlan;
  (
    context: trackerTypesModule.OverlayContext,
    denseRegions: ReadonlyMap<trackerTypesModule.OverlayNode, trackerTypesModule.DenseRegion[]>,
  ): EmissionPlan;
} = dual(2, emissionPlanImpl);

const emitPlanned: {
  (
    plan: EmissionPlan,
    denseRegions: ReadonlyMap<trackerTypesModule.OverlayNode, trackerTypesModule.DenseRegion[]>,
  ): (context: trackerTypesModule.OverlayContext) => trackerTypesModule.Op[];
  (
    context: trackerTypesModule.OverlayContext,
    plan: EmissionPlan,
    denseRegions: ReadonlyMap<trackerTypesModule.OverlayNode, trackerTypesModule.DenseRegion[]>,
  ): trackerTypesModule.Op[];
} = dual(3, emitPlannedImpl);

const trackerEmitPlan = {
  denseRegionsOf,
  emissionPlan,
  emitPlanned,
};

export default trackerEmitPlan;
