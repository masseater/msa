import type tuiComponentTypes from "./tui-component.types.ts";
import type tuiInterfaceTypes from "./tui-interface.types.ts";
import type tuiOverlayLayoutTypes from "./tui-overlay-layout.types.ts";
import type OverlayStackClass from "./tui-overlay-stack.ts";

declare namespace tuiOverlayStackTypes {
  type OverlayStackEntry = {
    component: tuiComponentTypes.Component;
    options?: tuiOverlayLayoutTypes.OverlayOptions;
    preFocus: tuiComponentTypes.Component | null;
    hidden: boolean;
    focusOrder: number;
    bounds?: tuiInterfaceTypes.OverlayBounds | undefined;
  };

  type OverlayBlockedFocusResume =
    | { status: "restore-overlay" }
    | { status: "focus-target"; target: tuiComponentTypes.Component | null };

  type EligibleOverlayFocusRestoreState = { status: "eligible"; overlay: OverlayStackEntry };

  type BlockedOverlayFocusRestoreState = {
    status: "blocked";
    overlay: OverlayStackEntry;
    blockedBy: tuiComponentTypes.Component;
    resume: OverlayBlockedFocusResume;
  };

  type ActiveOverlayFocusRestoreState =
    | EligibleOverlayFocusRestoreState
    | BlockedOverlayFocusRestoreState;

  type OverlayFocusRestoreState = { status: "inactive" } | ActiveOverlayFocusRestoreState;

  interface OverlayViewport {
    readonly columns: number;
    readonly rows: number;
  }

  interface OverlayFrame {
    termWidth: number;
    termHeight: number;
    resolveFakeCursors: (lines: string[]) => string[];
  }

  type OverlayStack = OverlayStackClass;
}

export type { tuiOverlayStackTypes as default };
