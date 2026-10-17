import type { ScrollView } from "./components/scroll-view.ts";
import type { LayoutFrame } from "./layout.ts";

export interface AltScreenFrameState {
  previousScreen: string[];
  previousScreenWidth: number;
  previousScreenHeight: number;
  currentLayout: LayoutFrame | undefined;
}

export interface AltScreenView {
  readonly frame: AltScreenFrameState;
  columns(): number;
  rows(): number;
  primaryScrollView(): ScrollView;
  hasOverlay(): boolean;
  requestRender(): void;
}
