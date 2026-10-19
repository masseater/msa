import { dual } from "effect/Function";

import {
  LAYOUT_NODE,
  type LayoutViewport,
  type StackLayoutEntry,
  type StackLayoutNode,
} from "../layout-node.ts";
import { type Component, Container } from "../tui-component.ts";

export interface StackEntryOptions {
  basis?: number | "auto";
  grow?: number;
  shrink?: number;
  minSize?: number;
  maxSize?: number;
  visible?: (viewport: LayoutViewport) => boolean;
}

export interface StackEntry extends StackEntryOptions {
  component: Component;
}

export type StackChild = Component | StackEntry;

export interface StackOptions {
  gap?: number;
  align?: "stretch" | "start" | "center" | "end";
}

function isStackEntry(child: StackChild): child is StackEntry {
  return !("render" in child);
}

function normalizeSize(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(0, Math.floor(value));
}

export abstract class Stack extends Container {
  protected readonly entries: StackLayoutEntry[] = [];
  protected readonly gap: number;
  protected readonly align: "stretch" | "start" | "center" | "end";
  protected abstract readonly layoutType: "vstack" | "hstack";

  constructor(children: StackChild[] = [], options: StackOptions = {}) {
    super();
    this.gap = normalizeSize(options.gap, 0);
    this.align = options.align ?? "stretch";
    for (const child of children) {
      if (isStackEntry(child)) this.addChild(child.component, child);
      else this.addChild(child);
    }
  }

  override addChild(component: Component, options: StackEntryOptions = {}): void {
    super.addChild(component);
    this.entries.push({
      component,
      ...(options.basis === undefined ? {} : { basis: options.basis }),
      ...(options.grow === undefined ? {} : { grow: normalizeSize(options.grow, 0) }),
      ...(options.shrink === undefined ? {} : { shrink: normalizeSize(options.shrink, 1) }),
      ...(options.minSize === undefined ? {} : { minSize: normalizeSize(options.minSize, 0) }),
      ...(options.maxSize === undefined
        ? {}
        : { maxSize: normalizeSize(options.maxSize, Number.MAX_SAFE_INTEGER) }),
      ...(options.visible === undefined ? {} : { visible: options.visible }),
    });
  }

  override removeChild(component: Component): void {
    super.removeChild(component);
    const index = this.entries.findIndex((entry) => entry.component === component);
    if (index !== -1) this.entries.splice(index, 1);
  }

  override clear(): void {
    super.clear();
    this.entries.length = 0;
  }

  [LAYOUT_NODE](): StackLayoutNode {
    return {
      type: this.layoutType,
      entries: this.entries,
      gap: this.gap,
      align: this.align,
    };
  }
}

export const visibleStackEntries: {
  (entries: readonly StackLayoutEntry[], viewport: LayoutViewport): StackLayoutEntry[];
  (viewport: LayoutViewport): (entries: readonly StackLayoutEntry[]) => StackLayoutEntry[];
} = dual(2, (entries: readonly StackLayoutEntry[], viewport: LayoutViewport): StackLayoutEntry[] =>
  entries.filter((entry) => entry.visible?.(viewport) ?? true),
);

function clampSize(size: number, entry: StackLayoutEntry): number {
  const min = Math.max(0, Math.floor(entry.minSize ?? 0));
  const max = Math.max(min, Math.floor(entry.maxSize ?? Number.MAX_SAFE_INTEGER));
  return Math.max(min, Math.min(max, Math.max(0, Math.floor(size))));
}

export function proportionalShares(amount: number, weights: readonly number[]): number[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (amount * weight) / totalWeight);
  const shares = exact.map((value) => Math.floor(value));
  let leftover = amount - shares.reduce((sum, share) => sum + share, 0);
  const byFraction = exact
    .map((value, position) => ({ position, fraction: value - shares[position]! }))
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
  entries: readonly StackLayoutEntry[],
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

export const allocateStackSizes: {
  (
    entries: readonly StackLayoutEntry[],
    intrinsicSizes: readonly number[],
    availableSize: number | undefined,
    gap: number,
  ): number[];
  (
    intrinsicSizes: readonly number[],
    availableSize: number | undefined,
    gap: number,
  ): (entries: readonly StackLayoutEntry[]) => number[];
} = dual(
  4,
  (
    entries: readonly StackLayoutEntry[],
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
