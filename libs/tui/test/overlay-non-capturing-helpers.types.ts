import type tuiComponentTypes from "../src/tui-component.types.ts";
import type tuiInterfaceTypes from "../src/tui-interface.types.ts";
import type virtualTerminalTypes from "./virtual-terminal.types.ts";

declare namespace overlayNonCapturingHelpersTypes {
  interface OverlayTuiContext {
    readonly tui: tuiInterfaceTypes.TUI;
    readonly terminal: virtualTerminalTypes.VirtualTerminal;
  }

  interface OverlayTuiSetup {
    readonly focus?: tuiComponentTypes.Component;
    readonly root?: tuiComponentTypes.Component;
    readonly width?: number;
    readonly height?: number;
  }
}

export type { overlayNonCapturingHelpersTypes as default };
