import type scrollViewTypes from "./components/scroll-view.types.ts";
import type tuiComponentTypes from "./tui-component.types.ts";

declare namespace layoutTypes {
  interface LayoutRect {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  interface LayoutBox {
    component: tuiComponentTypes.Component;
    rect: LayoutRect;
    clip: LayoutRect;
    children: LayoutBox[];
    parent?: LayoutBox;
    lines?: readonly string[];
    lineOffset?: number;
    scrollView?: scrollViewTypes.ScrollView;
    scrollContentLines?: readonly string[];
    layer: number;
  }

  interface LayoutFrame {
    root: LayoutBox;
    width: number;
    height: number;
    lines: string[];
    primaryScrollView?: scrollViewTypes.ScrollView;
  }

  interface ScrollbarGeometry {
    column: number;
    trackTop: number;
    trackHeight: number;
    thumbTop: number;
    thumbHeight: number;
    maxScrollTop: number;
  }
}

export type { layoutTypes as default };
