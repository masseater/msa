import { dual } from "effect/Function";

import type scrollViewTypes from "./components/scroll-view.types.ts";
import stackModule from "./components/stack.ts";
import layoutNode from "./layout-node.ts";
import type layoutNodeTypes from "./layout-node.types.ts";
import type layoutTreeTypes from "./layout-tree.types.ts";
import type layoutTypes from "./layout.types.ts";
import tuiComponent from "./tui-component.ts";
import type tuiComponentTypes from "./tui-component.types.ts";
import utils from "./utils.ts";

const { visibleWidth } = utils;
const { CURSOR_MARKER } = tuiComponent;
const { allocateStackSizes, visibleStackEntries } = stackModule;
const { getLayoutNode } = layoutNode;

interface StackLayout {
  node: layoutNodeTypes.StackLayoutNode;
  entries: readonly layoutNodeTypes.StackLayoutEntry[];
}

function intersect(a: layoutTypes.LayoutRect, b: layoutTypes.LayoutRect): layoutTypes.LayoutRect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return { height: Math.max(0, bottom - y), width: Math.max(0, right - x), x, y };
}

function renderCached(
  context: layoutTreeTypes.LayoutContext,
  component: tuiComponentTypes.Component,
  width: number,
): string[] {
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

function measureHeight(
  context: layoutTreeTypes.LayoutContext,
  component: tuiComponentTypes.Component,
  width: number,
): number {
  return renderCached(context, component, width).length;
}

function measureWidth(
  context: layoutTreeTypes.LayoutContext,
  component: tuiComponentTypes.Component,
  width: number,
): number {
  return renderCached(context, component, width).reduce(
    (max, line) => Math.max(max, visibleWidth(line)),
    0,
  );
}

function withParent(
  box: layoutTypes.LayoutBox,
  parent: layoutTypes.LayoutBox,
): layoutTypes.LayoutBox {
  box.parent = parent;
  return box;
}

function translateBox(box: layoutTypes.LayoutBox, deltaY: number): void {
  box.rect.y += deltaY;
  for (const child of box.children) translateBox(child, deltaY);
}

function updateClips(box: layoutTypes.LayoutBox, parentClip: layoutTypes.LayoutRect): void {
  box.clip = intersect(parentClip, box.rect);
  for (const child of box.children) updateClips(child, box.clip);
}

function emptyBox(
  component: tuiComponentTypes.Component,
  rect: layoutTypes.LayoutRect,
  clip: layoutTypes.LayoutRect,
): layoutTypes.LayoutBox {
  return { children: [], clip: intersect(clip, rect), component, layer: 0, rect };
}

function layoutLeaf(
  context: layoutTreeTypes.LayoutContext,
  component: tuiComponentTypes.Component,
  slot: layoutTreeTypes.LayoutSlot,
): layoutTypes.LayoutBox {
  const { x, y, width, height } = slot;
  const lines = renderCached(context, component, width);
  const allocatedHeight = height === undefined ? lines.length : Math.max(0, Math.floor(height));
  let lineOffset = 0;
  if (lines.length > allocatedHeight && allocatedHeight > 0) {
    const cursorLine = lines.findIndex((line) => line.includes(CURSOR_MARKER));
    if (cursorLine >= allocatedHeight) lineOffset = cursorLine - allocatedHeight + 1;
  }
  const rect = { height: allocatedHeight, width, x, y };
  return { ...emptyBox(component, rect, slot.clip), lineOffset, lines };
}

function layoutScroll(
  context: layoutTreeTypes.LayoutContext,
  component: tuiComponentTypes.Component,
  node: layoutNodeTypes.ScrollLayoutNode,
  slot: layoutTreeTypes.LayoutSlot,
): layoutTypes.LayoutBox {
  const { x, y, width, height, clip } = slot;
  const previousScrollTop = node.state.scrollTop;
  const contentWidth = node.state.getContentWidth(width);
  const childBox = layoutComponent(context, node.component, {
    clip,
    height: undefined,
    width: contentWidth,
    x,
    y: y - previousScrollTop,
  });
  const contentHeight = childBox.rect.height;
  const viewportHeight = height === undefined ? contentHeight : Math.max(0, Math.floor(height));
  node.state.updateLayout(contentHeight, viewportHeight, context.requestRender);
  translateBox(childBox, previousScrollTop - node.state.scrollTop);
  const scrollView = node.state as scrollViewTypes.ScrollView;
  if (node.state.primary || context.primaryScrollView === undefined)
    context.primaryScrollView = scrollView;
  const box: layoutTypes.LayoutBox = {
    ...emptyBox(component, { height: viewportHeight, width, x, y }, clip),
    children: [childBox],
    scrollContentLines: renderCached(context, node.component, contentWidth),
    scrollView,
  };
  childBox.parent = box;
  updateClips(childBox, box.clip);
  return box;
}

function layoutVStack(
  context: layoutTreeTypes.LayoutContext,
  component: tuiComponentTypes.Component,
  { node, entries }: StackLayout,
  slot: layoutTreeTypes.LayoutSlot,
): layoutTypes.LayoutBox {
  const { x, y, width, height } = slot;
  const gapTotal = Math.max(0, entries.length - 1) * node.gap;
  const intrinsicHeights = entries.map((entry) =>
    typeof entry.basis === "number" ? entry.basis : measureHeight(context, entry.component, width),
  );
  const sizes = allocateStackSizes(entries, intrinsicHeights, height, node.gap);
  const naturalHeight = sizes.reduce((sum, size) => sum + size, 0) + gapTotal;
  const allocatedHeight = height === undefined ? naturalHeight : Math.max(0, Math.floor(height));
  const box = emptyBox(component, { height: allocatedHeight, width, x, y }, slot.clip);
  let childY = y;
  for (const [index, entry] of entries.entries()) {
    const childSlot = { clip: box.clip, height: sizes[index]!, width, x, y: childY };
    box.children.push(withParent(layoutComponent(context, entry.component, childSlot), box));
    childY += sizes[index]! + node.gap;
  }
  return box;
}

function alignedChildY(node: layoutNodeTypes.StackLayoutNode, slotY: number, free: number): number {
  if (node.align === "center") return slotY + Math.floor(free / 2);
  if (node.align === "end") return slotY + free;
  return slotY;
}

function layoutHStackChild(
  context: layoutTreeTypes.LayoutContext,
  entry: layoutNodeTypes.StackLayoutEntry,
  slot: layoutTreeTypes.LayoutSlot & { height: number },
  parent: layoutTypes.LayoutBox,
): layoutTypes.LayoutBox {
  if (slot.width === 0) {
    return {
      children: [],
      clip: { height: 0, width: 0, x: slot.x, y: slot.y },
      component: entry.component,
      layer: 0,
      parent,
      rect: { height: slot.height, width: 0, x: slot.x, y: slot.y },
    };
  }
  return withParent(layoutComponent(context, entry.component, slot), parent);
}

function layoutHStack(
  context: layoutTreeTypes.LayoutContext,
  component: tuiComponentTypes.Component,
  { node, entries }: StackLayout,
  slot: layoutTreeTypes.LayoutSlot,
): layoutTypes.LayoutBox {
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
  const box = emptyBox(component, { height: allocatedHeight, width, x, y }, slot.clip);
  let childX = x;
  for (const [index, entry] of entries.entries()) {
    const childHeight =
      node.align === "stretch"
        ? allocatedHeight
        : Math.min(allocatedHeight, intrinsicHeights[index]!);
    const childY = alignedChildY(node, y, allocatedHeight - childHeight);
    const childWidth = widths[index]!;
    const childSlot = {
      clip: box.clip,
      height: childHeight,
      width: childWidth,
      x: childX,
      y: childY,
    };
    box.children.push(layoutHStackChild(context, entry, childSlot, box));
    childX += childWidth + node.gap;
  }
  return box;
}

const layoutComponent: {
  (
    context: layoutTreeTypes.LayoutContext,
    component: tuiComponentTypes.Component,
    slot: layoutTreeTypes.LayoutSlot,
  ): layoutTypes.LayoutBox;
  (
    component: tuiComponentTypes.Component,
    slot: layoutTreeTypes.LayoutSlot,
  ): (context: layoutTreeTypes.LayoutContext) => layoutTypes.LayoutBox;
} = dual(
  3,
  (
    context: layoutTreeTypes.LayoutContext,
    component: tuiComponentTypes.Component,
    slot: layoutTreeTypes.LayoutSlot,
  ): layoutTypes.LayoutBox => {
    const safeSlot = { ...slot, width: Math.max(1, Math.floor(slot.width)) };
    const node = getLayoutNode(component);
    if (node === undefined) return layoutLeaf(context, component, safeSlot);
    if (node.type === "scroll") return layoutScroll(context, component, node, safeSlot);
    const stack = { entries: visibleStackEntries(node.entries, context.viewport), node };
    return node.type === "vstack"
      ? layoutVStack(context, component, stack, safeSlot)
      : layoutHStack(context, component, stack, safeSlot);
  },
);

const layoutTree = {
  layoutComponent,
};

export default layoutTree;
