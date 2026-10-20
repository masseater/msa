import type { Component } from "../src/tui-component.ts";
import type { TUI } from "../src/tui-interface.ts";
import type { VirtualTerminal } from "./virtual-terminal.ts";

declare namespace overlayNonCapturingHelpersTypes {
  interface OverlayTuiContext {
    readonly tui: TUI;
    readonly terminal: VirtualTerminal;
  }

  interface OverlayTuiSetup {
    readonly focus?: Component;
    readonly root?: Component;
    readonly width?: number;
    readonly height?: number;
  }
}

export type { overlayNonCapturingHelpersTypes as default };
