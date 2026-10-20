import type layoutNode from "./layout-node.ts";
import type tuiComponentTypes from "./tui-component.types.ts";

declare namespace layoutNodeTypes {
  interface LayoutViewport {
    width: number;
    height: number;
  }

  interface StackLayoutEntry {
    component: tuiComponentTypes.Component;
    basis?: number | "auto";
    grow?: number;
    shrink?: number;
    minSize?: number;
    maxSize?: number;
    visible?: (viewport: LayoutViewport) => boolean;
  }

  interface StackLayoutNode {
    type: "vstack" | "hstack";
    entries: readonly StackLayoutEntry[];
    gap: number;
    align: "stretch" | "start" | "center" | "end";
  }

  interface ScrollLayoutState {
    readonly scrollTop: number;
    readonly primary: boolean;
    readonly overscroll: "chain" | "contain";
    readonly viewportHeight: number;
    getContentWidth(width: number): number;
    updateLayout(contentHeight: number, viewportHeight: number, requestRender: () => void): void;
  }

  interface ScrollLayoutNode {
    type: "scroll";
    component: tuiComponentTypes.Component;
    state: ScrollLayoutState;
  }

  type LayoutNode = StackLayoutNode | ScrollLayoutNode;

  interface LayoutComponent extends tuiComponentTypes.Component {
    [layoutNode.LAYOUT_NODE](): LayoutNode;
  }
}

export type { layoutNodeTypes as default };
