import { dual } from "effect/Function";

import type { ScrollView } from "./components/scroll-view.ts";
import { allocateStackSizes, visibleStackEntries } from "./components/stack.ts";
import {
  getLayoutNode,
  type ScrollLayoutNode,
  type StackLayoutEntry,
  type StackLayoutNode,
} from "./layout-node.ts";
import type { LayoutBox, LayoutRect } from "./layout.ts";
import { type Component, CURSOR_MARKER } from "./tui.ts";
import { visibleWidth } from "./utils.ts";

export interface LayoutContext {
  viewport: { width: number; height: number };
  renderCache: Map<Component, Map<number, string[]>>;
  requestRender: () => void;
  primaryScrollView: ScrollView | undefined;
}

export interface LayoutSlot {
  x: number;
  y: number;
  width: number;
  height: number | undefined;
  clip: LayoutRect;
}

interface StackLayout {
  node: StackLayoutNode;
  entries: readonly StackLayoutEntry[];
}

function intersect(a: LayoutRect, b: LayoutRect): LayoutRect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

function renderCached(context: LayoutContext, component: Component, width: number): string[] {
  const safeWidth = Math.max(1, Math.floor(width));
  let widths = context.renderCache.get(component);
  if (widths === undefined) {
    widths = new Map<number, string[]>();
    context.renderCache.set(component, widths);
  }
  let lines = widths.get(safeWidth);
  if (lines === undefined) {
    lines = component.render(safeWidth);
    widths.set(safeWidth, lines);
  }
  return lines;
}

function measureHeight(context: LayoutContext, component: Component, width: number): number {
  return renderCached(context, component, width).length;
}

function measureWidth(context: LayoutContext, component: Component, width: number): number {
  return renderCached(context, component, width).reduce(
    (max, line) => Math.max(max, visibleWidth(line)),
    0,
  );
}

function withParent(box: LayoutBox, parent: LayoutBox): LayoutBox {
  box.parent = parent;
  return box;
}

function translateBox(box: LayoutBox, deltaY: number): void {
  box.rect.y += deltaY;
  for (const child of box.children) translateBox(child, deltaY);
}

function updateClips(box: LayoutBox, parentClip: LayoutRect): void {
  box.clip = intersect(parentClip, box.rect);
  for (const child of box.children) updateClips(child, box.clip);
}

function emptyBox(component: Component, rect: LayoutRect, clip: LayoutRect): LayoutBox {
  return { component, rect, clip: intersect(clip, rect), children: [], layer: 0 };
}

function layoutLeaf(context: LayoutContext, component: Component, slot: LayoutSlot): LayoutBox {
  const { x, y, width, height } = slot;
  const lines = renderCached(context, component, width);
  const allocatedHeight = height === undefined ? lines.length : Math.max(0, Math.floor(height));
  let lineOffset = 0;
  if (lines.length > allocatedHeight && allocatedHeight > 0) {
    const cursorLine = lines.findIndex((line) => line.includes(CURSOR_MARKER));
    if (cursorLine >= allocatedHeight) lineOffset = cursorLine - allocatedHeight + 1;
  }
  const rect = { x, y, width, height: allocatedHeight };
  return { ...emptyBox(component, rect, slot.clip), lines, lineOffset };
}

function layoutScroll(
  context: LayoutContext,
  component: Component,
  node: ScrollLayoutNode,
  slot: LayoutSlot,
): LayoutBox {
  const { x, y, width, height, clip } = slot;
  const previousScrollTop = node.state.scrollTop;
  const contentWidth = node.state.getContentWidth(width);
  const childBox = layoutComponent(context, node.component, {
    x,
    y: y - previousScrollTop,
    width: contentWidth,
    height: undefined,
    clip,
  });
  const contentHeight = childBox.rect.height;
  const viewportHeight = height === undefined ? contentHeight : Math.max(0, Math.floor(height));
  node.state.updateLayout(contentHeight, viewportHeight, context.requestRender);
  translateBox(childBox, previousScrollTop - node.state.scrollTop);
  const scrollView = node.state as ScrollView;
  if (node.state.primary || context.primaryScrollView === undefined)
    context.primaryScrollView = scrollView;
  const box: LayoutBox = {
    ...emptyBox(component, { x, y, width, height: viewportHeight }, clip),
    children: [childBox],
    scrollView,
    scrollContentLines: renderCached(context, node.component, contentWidth),
  };
  childBox.parent = box;
  updateClips(childBox, box.clip);
  return box;
}

function layoutVStack(
  context: LayoutContext,
  component: Component,
  { node, entries }: StackLayout,
  slot: LayoutSlot,
): LayoutBox {
  const { x, y, width, height } = slot;
  const gapTotal = Math.max(0, entries.length - 1) * node.gap;
  const intrinsicHeights = entries.map((entry) =>
    typeof entry.basis === "number" ? entry.basis : measureHeight(context, entry.component, width),
  );
  const sizes = allocateStackSizes(entries, intrinsicHeights, height, node.gap);
  const naturalHeight = sizes.reduce((sum, size) => sum + size, 0) + gapTotal;
  const allocatedHeight = height === undefined ? naturalHeight : Math.max(0, Math.floor(height));
  const box = emptyBox(component, { x, y, width, height: allocatedHeight }, slot.clip);
  let childY = y;
  for (const [index, entry] of entries.entries()) {
    const childSlot = { x, y: childY, width, height: sizes[index]!, clip: box.clip };
    box.children.push(withParent(layoutComponent(context, entry.component, childSlot), box));
    childY += sizes[index]! + node.gap;
  }
  return box;
}

function alignedChildY(node: StackLayoutNode, slotY: number, free: number): number {
  if (node.align === "center") return slotY + Math.floor(free / 2);
  if (node.align === "end") return slotY + free;
  return slotY;
}

function layoutHStackChild(
  context: LayoutContext,
  entry: StackLayoutEntry,
  slot: LayoutSlot & { height: number },
  parent: LayoutBox,
): LayoutBox {
  if (slot.width === 0) {
    return {
      component: entry.component,
      rect: { x: slot.x, y: slot.y, width: 0, height: slot.height },
      clip: { x: slot.x, y: slot.y, width: 0, height: 0 },
      children: [],
      parent,
      layer: 0,
    };
  }
  return withParent(layoutComponent(context, entry.component, slot), parent);
}

function layoutHStack(
  context: LayoutContext,
  component: Component,
  { node, entries }: StackLayout,
  slot: LayoutSlot,
): LayoutBox {
  const { x, y, width, height } = slot;
  const intrinsicWidths = entries.map((entry) =>
    typeof entry.basis === "number" ? entry.basis : measureWidth(context, entry.component, width),
  );
  const widths = allocateStackSizes(entries, intrinsicWidths, width, node.gap);
  const intrinsicHeights = entries.map((entry, index) =>
    measureHeight(context, entry.component, Math.max(1, widths[index]!)),
  );
  const allocatedHeight =
    height === undefined
      ? intrinsicHeights.reduce((max, childHeight) => Math.max(max, childHeight), 0)
      : Math.max(0, height);
  const box = emptyBox(component, { x, y, width, height: allocatedHeight }, slot.clip);
  let childX = x;
  for (const [index, entry] of entries.entries()) {
    const childHeight =
      node.align === "stretch"
        ? allocatedHeight
        : Math.min(allocatedHeight, intrinsicHeights[index]!);
    const childY = alignedChildY(node, y, allocatedHeight - childHeight);
    const childWidth = widths[index]!;
    const childSlot = {
      x: childX,
      y: childY,
      width: childWidth,
      height: childHeight,
      clip: box.clip,
    };
    box.children.push(layoutHStackChild(context, entry, childSlot, box));
    childX += childWidth + node.gap;
  }
  return box;
}

export const layoutComponent: {
  (context: LayoutContext, component: Component, slot: LayoutSlot): LayoutBox;
  (component: Component, slot: LayoutSlot): (context: LayoutContext) => LayoutBox;
} = dual(3, (context: LayoutContext, component: Component, slot: LayoutSlot): LayoutBox => {
  const safeSlot = { ...slot, width: Math.max(1, Math.floor(slot.width)) };
  const node = getLayoutNode(component);
  if (node === undefined) return layoutLeaf(context, component, safeSlot);
  if (node.type === "scroll") return layoutScroll(context, component, node, safeSlot);
  const stack = { node, entries: visibleStackEntries(node.entries, context.viewport) };
  return node.type === "vstack"
    ? layoutVStack(context, component, stack, safeSlot)
    : layoutHStack(context, component, stack, safeSlot);
});
