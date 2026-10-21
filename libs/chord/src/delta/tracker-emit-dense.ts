import { dual } from "effect/Function";

import trackerContext from "./tracker-context.ts";
import trackerObject from "./tracker-object.ts";
import trackerPaths from "./tracker-paths.ts";
import type trackerTypesModule from "./tracker-types.types.ts";
let locatedDenseArray: trackerTypesModule.OverlayNode | undefined;

const clearDenseArray = (): void => {
  locatedDenseArray = undefined;
};

const forgetDenseArray = (context: trackerTypesModule.OverlayContext): void => {
  if (locatedDenseArray?.context === context) locatedDenseArray = undefined;
};
function locateDenseArrayPosition(node: trackerTypesModule.OverlayNode): boolean {
  let child = node;
  for (
    let parent = trackerContext.nodeParent(child);
    parent !== undefined;
    parent = trackerContext.nodeParent(child)
  ) {
    if (Array.isArray(trackerContext.nodeBase(parent))) {
      const overlay = trackerObject.arrayOverlay(parent);
      if (child.parentKind !== 1 || overlay.structural) return false;
      const sourceIndex = child.parentKey as number;
      const valueIndex = overlay.baseOverrides?.get(sourceIndex);
      const current =
        valueIndex === undefined
          ? (trackerContext.nodeBase(parent) as trackerTypesModule.JsonValue[])[sourceIndex]
          : trackerContext.storedValue(parent.context, valueIndex);
      if (current !== trackerContext.nodeBase(child)) return false;
      locatedDenseArray = parent;
      locatedDenseIndex = sourceIndex;
      return true;
    }
    child = parent;
  }
  return false;
}

function hasCoveringDenseRegionImpl(
  node: trackerTypesModule.OverlayNode,
  path: trackerTypesModule.Path,
  denseRegions: ReadonlyMap<
    trackerTypesModule.OverlayNode,
    readonly trackerTypesModule.DenseRegion[]
  >,
): boolean {
  for (
    let parent = trackerContext.nodeParent(node);
    parent !== undefined;
    parent = trackerContext.nodeParent(parent)
  ) {
    const regions = denseRegions.get(parent);
    if (regions === undefined) continue;
    const parentPath = trackerPaths.resolvePath(parent);
    if (parentPath === undefined || path.length <= parentPath.length) continue;
    let matches = true;
    for (let index = 0; index < parentPath.length; index++) {
      if (path[index] !== parentPath[index]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    const index = path[parentPath.length];
    if (typeof index === "number" && regionContainingImpl(regions, index)) return true;
  }
  return false;
}

function addDenseCandidateImpl(
  candidates: trackerTypesModule.DenseCandidates,
  index: number,
): void {
  if (candidates.bits !== undefined) {
    candidates.bits[index] = 1;
    return;
  }
  candidates.indices.push(index);
  if (candidates.indices.length < 256) return;
  candidates.bits = new Uint8Array(candidates.length);
  for (const existing of candidates.indices) candidates.bits[existing] = 1;
  candidates.indices.length = 0;
}

function recordDenseArrayPositionImpl(
  node: trackerTypesModule.OverlayNode,
  groups: Map<trackerTypesModule.OverlayNode, trackerTypesModule.DenseCandidates>,
): void {
  if (!locateDenseArrayPosition(node)) return;
  let candidates = groups.get(locatedDenseArray!);
  if (candidates === undefined) {
    candidates = {
      bits: undefined,
      indices: [],
      length: (trackerContext.nodeBase(locatedDenseArray!) as trackerTypesModule.JsonValue[])
        .length,
    };
    groups.set(locatedDenseArray!, candidates);
  }
  addDenseCandidateImpl(candidates, locatedDenseIndex);
}

function buildDenseRegions(
  candidates: trackerTypesModule.DenseCandidates,
): trackerTypesModule.DenseRegion[] {
  if (candidates.bits === undefined) return [];
  const regions: trackerTypesModule.DenseRegion[] = [];
  const bits = candidates.bits;
  for (let at = 0; at < bits.length;) {
    while (at < bits.length && bits[at] === 0) at += 1;
    if (at === bits.length) break;
    const start = at;
    let end = at;
    let count = 0;
    let gap = 0;
    while (at < bits.length) {
      if (bits[at] !== 0) {
        count += 1;
        end = at;
        gap = 0;
      } else if (++gap > 1) break;
      at += 1;
    }
    const length = end - start + 1;
    if (count >= 256 && count * 2 >= length) regions.push({ length, start });
  }
  return regions;
}

function regionContainingImpl(
  regions: readonly trackerTypesModule.DenseRegion[],
  index: number,
): boolean {
  for (const region of regions)
    if (index >= region.start && index < region.start + region.length) return true;
  return false;
}

const regionContaining: {
  (index: number): (regions: readonly trackerTypesModule.DenseRegion[]) => boolean;
  (regions: readonly trackerTypesModule.DenseRegion[], index: number): boolean;
} = dual(2, regionContainingImpl);

const hasCoveringDenseRegion: {
  (
    path: trackerTypesModule.Path,
    denseRegions: ReadonlyMap<
      trackerTypesModule.OverlayNode,
      readonly trackerTypesModule.DenseRegion[]
    >,
  ): (node: trackerTypesModule.OverlayNode) => boolean;
  (
    node: trackerTypesModule.OverlayNode,
    path: trackerTypesModule.Path,
    denseRegions: ReadonlyMap<
      trackerTypesModule.OverlayNode,
      readonly trackerTypesModule.DenseRegion[]
    >,
  ): boolean;
} = dual(3, hasCoveringDenseRegionImpl);

const recordDenseArrayPosition: {
  (
    groups: Map<trackerTypesModule.OverlayNode, trackerTypesModule.DenseCandidates>,
  ): (node: trackerTypesModule.OverlayNode) => void;
  (
    node: trackerTypesModule.OverlayNode,
    groups: Map<trackerTypesModule.OverlayNode, trackerTypesModule.DenseCandidates>,
  ): void;
} = dual(2, recordDenseArrayPositionImpl);

const addDenseCandidate: {
  (index: number): (candidates: trackerTypesModule.DenseCandidates) => void;
  (candidates: trackerTypesModule.DenseCandidates, index: number): void;
} = dual(2, addDenseCandidateImpl);
let locatedDenseIndex = 0;

const trackerEmitDense = {
  addDenseCandidate,
  buildDenseRegions,
  clearDenseArray,
  forgetDenseArray,
  hasCoveringDenseRegion,
  recordDenseArrayPosition,
  regionContaining,
};

export default trackerEmitDense;
