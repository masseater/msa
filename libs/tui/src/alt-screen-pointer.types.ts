import type altScreenMouseRouterTypes from "./alt-screen-mouse-router.types.ts";
import type AltScreenPointerClass from "./alt-screen-pointer.ts";
import type altScreenSearchControllerTypes from "./alt-screen-search-controller.types.ts";
import type tuiComponentTypes from "./tui-component.types.ts";
import type wheelScrollTypes from "./wheel-scroll.types.ts";

declare namespace altScreenPointerTypes {
  interface OverlayDispatch {
    hit: boolean;
    result?: tuiComponentTypes.TuiMouseDispatchResult;
  }

  interface PointerHost extends altScreenMouseRouterTypes.MouseRouterHost {
    readonly search: altScreenSearchControllerTypes.AltScreenSearchController;
    dispatchToOverlay(event: tuiComponentTypes.TuiMouseEvent): OverlayDispatch;
    scrollToBottom(): void;
    openUrl: ((url: string) => void) | undefined;
    onRightClickPaste: (() => void) | undefined;
    scrollToEndIndicator: (() => string) | undefined;
    wheelScrollLines: wheelScrollTypes.WheelScrollLines;
    copyOnSelect(): boolean;
    copySelection(): void;
  }

  type AltScreenPointer = AltScreenPointerClass;
}

export type { altScreenPointerTypes as default };
