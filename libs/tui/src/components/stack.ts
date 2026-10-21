import { dual } from "effect/Function";

import type layoutNodeTypes from "../layout-node.types.ts";
import Stack from "./stack-class.ts";

const visibleStackEntries: {
  (
    entries: readonly layoutNodeTypes.StackLayoutEntry[],
    viewport: layoutNodeTypes.LayoutViewport,
  ): layoutNodeTypes.StackLayoutEntry[];
  (
    viewport: layoutNodeTypes.LayoutViewport,
  ): (entries: readonly layoutNodeTypes.StackLayoutEntry[]) => layoutNodeTypes.StackLayoutEntry[];
} = dual(
  2,
  (
    entries: readonly layoutNodeTypes.StackLayoutEntry[],
    viewport: layoutNodeTypes.LayoutViewport,
  ): layoutNodeTypes.StackLayoutEntry[] =>
    entries.filter((entry) => entry.visible?.(viewport) ?? true),
);

function clampSize(size: number, entry: layoutNodeTypes.StackLayoutEntry): number {
  const min = Math.max(0, Math.floor(entry.minSize ?? 0));
  const max = Math.max(min, Math.floor(entry.maxSize ?? Number.MAX_SAFE_INTEGER));
  return Math.max(min, Math.min(max, Math.max(0, Math.floor(size))));
}

function proportionalShares(amount: number, weights: readonly number[]): number[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (amount * weight) / totalWeight);
  const shares = exact.map((value) => Math.floor(value));
  let leftover = amount - shares.reduce((sum, share) => sum + share, 0);
  const byFraction = exact
    .map((value, position) => ({ fraction: value - shares[position]!, position }))
    .toSorted((a, b) => b.fraction - a.fraction || a.position - b.position);
  for (const { position } of byFraction) {
    if (leftover <= 0) break;
    shares[position] = shares[position]! + 1;
    leftover -= 1;
  }
  return shares;
}

function distribute(
  sizes: number[],
  entries: readonly layoutNodeTypes.StackLayoutEntry[],
  amount: number,
  mode: "grow" | "shrink",
): void {
  let remaining = amount;
  while (remaining > 0) {
    const candidates = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry, index }) => {
        if (mode === "grow") {
          return (
            (entry.grow ?? 0) > 0 && sizes[index]! < (entry.maxSize ?? Number.MAX_SAFE_INTEGER)
          );
        }
        return (entry.shrink ?? 1) > 0 && sizes[index]! > (entry.minSize ?? 0);
      });
    if (candidates.length === 0) return;

    const weights = candidates.map(({ entry, index }) =>
      mode === "grow" ? (entry.grow ?? 0) : (entry.shrink ?? 1) * Math.max(1, sizes[index]!),
    );
    const shares = proportionalShares(remaining, weights);
    let distributed = 0;
    for (const [position, { entry, index }] of candidates.entries()) {
      const capacity =
        mode === "grow"
          ? (entry.maxSize ?? Number.MAX_SAFE_INTEGER) - sizes[index]!
          : sizes[index]! - (entry.minSize ?? 0);
      const delta = Math.min(shares[position]!, capacity);
      if (delta <= 0) continue;
      sizes[index] = sizes[index]! + (mode === "grow" ? delta : -delta);
      distributed += delta;
    }
    remaining -= distributed;
    if (distributed === 0) return;
  }
}

const allocateStackSizes: {
  (
    entries: readonly layoutNodeTypes.StackLayoutEntry[],
    intrinsicSizes: readonly number[],
    availableSize: number | undefined,
    gap: number,
  ): number[];
  (
    intrinsicSizes: readonly number[],
    availableSize: number | undefined,
    gap: number,
  ): (entries: readonly layoutNodeTypes.StackLayoutEntry[]) => number[];
} = dual(
  4,
  (
    entries: readonly layoutNodeTypes.StackLayoutEntry[],
    intrinsicSizes: readonly number[],
    availableSize: number | undefined,
    gap: number,
  ): number[] => {
    const sizes = entries.map((entry, index) =>
      clampSize(
        entry.basis === undefined || entry.basis === "auto"
          ? (intrinsicSizes[index] ?? 0)
          : entry.basis,
        entry,
      ),
    );
    if (availableSize === undefined) return sizes;

    const contentSize = Math.max(
      0,
      Math.floor(availableSize) - Math.max(0, entries.length - 1) * gap,
    );
    const total = sizes.reduce((sum, size) => sum + size, 0);
    if (total < contentSize) distribute(sizes, entries, contentSize - total, "grow");
    else if (total > contentSize) distribute(sizes, entries, total - contentSize, "shrink");
    return sizes;
  },
);

const stack = {
  Stack,
  allocateStackSizes,
  proportionalShares,
  visibleStackEntries,
};

export default stack;
