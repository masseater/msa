import type terminalColorsTypes from "./terminal-colors.types.ts";
import type terminalProtocolTypes from "./terminal-protocol.types.ts";
import type tuiComponentTypes from "./tui-component.types.ts";
import type tuiInterface from "./tui-interface.ts";
import type tuiOverlayLayoutTypes from "./tui-overlay-layout.types.ts";

declare namespace tuiInterfaceTypes {
  type TuiInputListenerResult = { consume?: boolean; data?: string } | undefined;

  type TuiInputListener = (data: string) => TuiInputListenerResult;

  interface OverlayUnfocusOptions {
    target: tuiComponentTypes.Component | null;
  }

  interface OverlayBounds {
    row: number;
    col: number;
    width: number;
    height: number;
  }

  interface OverlayHandle {
    hide(): void;
    setHidden(hidden: boolean): void;
    isHidden(): boolean;
    focus(): void;
    unfocus(options?: OverlayUnfocusOptions): void;
    isFocused(): boolean;
    getBounds(): OverlayBounds | undefined;
  }

  type TuiMode = "regular" | "fullscreen";

  interface TuiStopOptions {
    preserveScreen?: boolean;
  }

  interface TUI extends tuiComponentTypes.Component {
    readonly mode: TuiMode;
    children: tuiComponentTypes.Component[];
    terminal: terminalProtocolTypes.Terminal;
    onDebug?: () => void;
    readonly fullRedraws: number;
    addChild(component: tuiComponentTypes.Component): void;
    removeChild(component: tuiComponentTypes.Component): void;
    clear(): void;
    getShowHardwareCursor(): boolean;
    setShowHardwareCursor(enabled: boolean): void;
    getClearOnShrink(): boolean;
    setClearOnShrink(enabled: boolean): void;
    setFocus(component: tuiComponentTypes.Component | null): void;
    showOverlay(
      component: tuiComponentTypes.Component,
      options?: tuiOverlayLayoutTypes.OverlayOptions,
    ): OverlayHandle;
    hideOverlay(): void;
    hasOverlay(): boolean;
    start(): void;
    stop(options?: TuiStopOptions): void;
    renderNow(force?: boolean): void;
    requestRender(force?: boolean): void;
    addInputListener(listener: TuiInputListener): () => void;
    removeInputListener(listener: TuiInputListener): void;
    onTerminalColorSchemeChange(
      listener: (scheme: terminalColorsTypes.TerminalColorScheme) => void,
    ): () => void;
    setTerminalColorSchemeNotifications(enabled: boolean): void;
    queryTerminalColors(options: {
      timeoutMs: number;
      onLateReply?: (colors: terminalColorsTypes.TerminalColors) => void;
    }): Promise<terminalColorsTypes.TerminalColors>;
  }

  interface ViewportTUI extends TUI {
    readonly [tuiInterface.VIEWPORT_TUI]: true;
    setLayoutRoot(component: tuiComponentTypes.Component | undefined): void;
  }
}

export type { tuiInterfaceTypes as default };
