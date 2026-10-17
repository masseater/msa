import type { TerminalColors, TerminalColorScheme } from "./terminal-colors.ts";
import type { Terminal } from "./terminal-protocol.ts";
import type { Component } from "./tui-component.ts";
import type { OverlayOptions } from "./tui-overlay-layout.ts";

export type TuiInputListenerResult = { consume?: boolean; data?: string } | undefined;
export type TuiInputListener = (data: string) => TuiInputListenerResult;
export interface OverlayUnfocusOptions {
  target: Component | null;
}

export interface OverlayBounds {
  row: number;
  col: number;
  width: number;
  height: number;
}

export interface OverlayHandle {
  hide(): void;
  setHidden(hidden: boolean): void;
  isHidden(): boolean;
  focus(): void;
  unfocus(options?: OverlayUnfocusOptions): void;
  isFocused(): boolean;
  getBounds(): OverlayBounds | undefined;
}

export type TuiMode = "regular" | "fullscreen";

export interface TuiStopOptions {
  preserveScreen?: boolean;
}

export interface TUI extends Component {
  readonly mode: TuiMode;
  children: Component[];
  terminal: Terminal;
  onDebug?: () => void;
  readonly fullRedraws: number;
  addChild(component: Component): void;
  removeChild(component: Component): void;
  clear(): void;
  getShowHardwareCursor(): boolean;
  setShowHardwareCursor(enabled: boolean): void;
  getClearOnShrink(): boolean;
  setClearOnShrink(enabled: boolean): void;
  setFocus(component: Component | null): void;
  showOverlay(component: Component, options?: OverlayOptions): OverlayHandle;
  hideOverlay(): void;
  hasOverlay(): boolean;
  start(): void;
  stop(options?: TuiStopOptions): void;
  renderNow(force?: boolean): void;
  requestRender(force?: boolean): void;
  addInputListener(listener: TuiInputListener): () => void;
  removeInputListener(listener: TuiInputListener): void;
  onTerminalColorSchemeChange(listener: (scheme: TerminalColorScheme) => void): () => void;
  setTerminalColorSchemeNotifications(enabled: boolean): void;
  queryTerminalColors(options: {
    timeoutMs: number;
    onLateReply?: (colors: TerminalColors) => void;
  }): Promise<TerminalColors>;
}

export const VIEWPORT_TUI = Symbol.for("@msa/tui/viewport");

export interface ViewportTUI extends TUI {
  readonly [VIEWPORT_TUI]: true;
  setLayoutRoot(component: Component | undefined): void;
}

export function isViewportTUI(tui: TUI): tui is ViewportTUI {
  return (tui as Partial<ViewportTUI>)[VIEWPORT_TUI] === true;
}
