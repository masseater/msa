import type scrollViewTypes from "./components/scroll-view.types.ts";
import type layoutTypes from "./layout.types.ts";

declare namespace altScreenViewTypes {
  interface AltScreenFrameState {
    previousScreen: string[];
    previousScreenWidth: number;
    previousScreenHeight: number;
    currentLayout: layoutTypes.LayoutFrame | undefined;
  }

  interface AltScreenView {
    readonly frame: AltScreenFrameState;
    columns(): number;
    rows(): number;
    primaryScrollView(): scrollViewTypes.ScrollView;
    hasOverlay(): boolean;
    requestRender(): void;
  }
}

export type { altScreenViewTypes as default };
