import layoutNode from "../layout-node.ts";
import type layoutNodeTypes from "../layout-node.types.ts";
import tuiComponent from "../tui-component.ts";
import type tuiComponentTypes from "../tui-component.types.ts";
import type stackTypes from "./stack.types.ts";

const { Container } = tuiComponent;
const { LAYOUT_NODE } = layoutNode;

function isStackEntry(child: stackTypes.StackChild): child is stackTypes.StackEntry {
  return !("render" in child);
}

function normalizeSize(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(0, Math.floor(value));
}

export default abstract class Stack extends Container {
  protected readonly entries: layoutNodeTypes.StackLayoutEntry[] = [];
  protected readonly gap: number;
  protected readonly align: "stretch" | "start" | "center" | "end";
  protected abstract readonly layoutType: "vstack" | "hstack";

  constructor(children: stackTypes.StackChild[] = [], options: stackTypes.StackOptions = {}) {
    super();
    this.gap = normalizeSize(options.gap, 0);
    this.align = options.align ?? "stretch";
    for (const child of children) {
      if (isStackEntry(child)) this.addChild(child.component, child);
      else this.addChild(child);
    }
  }

  override addChild(
    component: tuiComponentTypes.Component,
    options: stackTypes.StackEntryOptions = {},
  ): void {
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

  override removeChild(component: tuiComponentTypes.Component): void {
    super.removeChild(component);
    const index = this.entries.findIndex((entry) => entry.component === component);
    if (index !== -1) this.entries.splice(index, 1);
  }

  override clear(): void {
    super.clear();
    this.entries.length = 0;
  }

  [LAYOUT_NODE](): layoutNodeTypes.StackLayoutNode {
    return {
      align: this.align,
      entries: this.entries,
      gap: this.gap,
      type: this.layoutType,
    };
  }
}
