import { dual } from "effect/Function";

import { nodeBase, nodeParent, storedValue } from "./tracker-context.ts";
import { arrayOverlay } from "./tracker-object.ts";
import { resolvePath } from "./tracker-paths.ts";
import {
  type DenseCandidates,
  type DenseRegion,
  type JsonValue,
  type OverlayContext,
  type OverlayNode,
  type Path,
} from "./tracker-types.ts";

let locatedDenseArray: OverlayNode | undefined;

export const clearDenseArray = (): void => {
  locatedDenseArray = undefined;
};

export const forgetDenseArray = (context: OverlayContext): void => {
  if (locatedDenseArray?.context === context) locatedDenseArray = undefined;
};
function locateDenseArrayPosition(node: OverlayNode): boolean {
  let child = node;
  for (let parent = nodeParent(child); parent !== undefined; parent = nodeParent(child)) {
    if (Array.isArray(nodeBase(parent))) {
      const overlay = arrayOverlay(parent);
      if (child.parentKind !== 1 || overlay.structural) return false;
      const sourceIndex = child.parentKey as number;
      const valueIndex = overlay.baseOverrides?.get(sourceIndex);
      const current =
        valueIndex === undefined
          ? (nodeBase(parent) as JsonValue[])[sourceIndex]
          : storedValue(parent.context, valueIndex);
      if (current !== nodeBase(child)) return false;
      locatedDenseArray = parent;
      locatedDenseIndex = sourceIndex;
      return true;
    }
    child = parent;
  }
  return false;
}

function hasCoveringDenseRegionImpl(
  node: OverlayNode,
  path: Path,
  denseRegions: ReadonlyMap<OverlayNode, readonly DenseRegion[]>,
): boolean {
  for (let parent = nodeParent(node); parent !== undefined; parent = nodeParent(parent)) {
    const regions = denseRegions.get(parent);
    if (regions === undefined) continue;
    const parentPath = resolvePath(parent);
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

function addDenseCandidateImpl(candidates: DenseCandidates, index: number): void {
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
  node: OverlayNode,
  groups: Map<OverlayNode, DenseCandidates>,
): void {
  if (!locateDenseArrayPosition(node)) return;
  let candidates = groups.get(locatedDenseArray!);
  if (candidates === undefined) {
    candidates = {
      indices: [],
      bits: undefined,
      length: (nodeBase(locatedDenseArray!) as JsonValue[]).length,
    };
    groups.set(locatedDenseArray!, candidates);
  }
  addDenseCandidateImpl(candidates, locatedDenseIndex);
}

export function buildDenseRegions(candidates: DenseCandidates): DenseRegion[] {
  if (candidates.bits === undefined) return [];
  const regions: DenseRegion[] = [];
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
    if (count >= 256 && count * 2 >= length) regions.push({ start, length });
  }
  return regions;
}

function regionContainingImpl(regions: readonly DenseRegion[], index: number): boolean {
  for (const region of regions)
    if (index >= region.start && index < region.start + region.length) return true;
  return false;
}

export const regionContaining: {
  (index: number): (regions: readonly DenseRegion[]) => boolean;
  (regions: readonly DenseRegion[], index: number): boolean;
} = dual(2, regionContainingImpl);

export const hasCoveringDenseRegion: {
  (
    path: Path,
    denseRegions: ReadonlyMap<OverlayNode, readonly DenseRegion[]>,
  ): (node: OverlayNode) => boolean;
  (
    node: OverlayNode,
    path: Path,
    denseRegions: ReadonlyMap<OverlayNode, readonly DenseRegion[]>,
  ): boolean;
} = dual(3, hasCoveringDenseRegionImpl);

export const recordDenseArrayPosition: {
  (groups: Map<OverlayNode, DenseCandidates>): (node: OverlayNode) => void;
  (node: OverlayNode, groups: Map<OverlayNode, DenseCandidates>): void;
} = dual(2, recordDenseArrayPositionImpl);

export const addDenseCandidate: {
  (index: number): (candidates: DenseCandidates) => void;
  (candidates: DenseCandidates, index: number): void;
} = dual(2, addDenseCandidateImpl);
let locatedDenseIndex = 0;
