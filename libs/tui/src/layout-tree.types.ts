import type scrollViewTypes from "./components/scroll-view.types.ts";
import type layoutTypes from "./layout.types.ts";
import type tuiComponentTypes from "./tui-component.types.ts";

declare namespace layoutTreeTypes {
  interface LayoutContext {
    viewport: { width: number; height: number };
    renderCache: Map<tuiComponentTypes.Component, Map<number, string[]>>;
    requestRender: () => void;
    primaryScrollView: scrollViewTypes.ScrollView | undefined;
  }

  interface LayoutSlot {
    x: number;
    y: number;
    width: number;
    height: number | undefined;
    clip: layoutTypes.LayoutRect;
  }
}

export type { layoutTreeTypes as default };
