import type tuiAltScreenTypes from "../tui-alt-screen.types.ts";
import type tuiComponentTypes from "../tui-component.types.ts";
import type tuiInterfaceTypes from "../tui-interface.types.ts";
import type tuiMainScreenTypes from "../tui-main-screen.types.ts";
import type tuiOverlayLayoutTypes from "../tui-overlay-layout.types.ts";
import type wheelScrollTypes from "../wheel-scroll.types.ts";

declare namespace tuiScreenKitTypes {
  type Component = tuiComponentTypes.Component;
  type Focusable = tuiComponentTypes.Focusable;
  type TuiMouseButton = tuiComponentTypes.TuiMouseButton;
  type TuiMouseEvent = tuiComponentTypes.TuiMouseEvent;
  type TuiMouseEventResult = tuiComponentTypes.TuiMouseEventResult;
  type TuiMouseEventType = tuiComponentTypes.TuiMouseEventType;
  type OverlayBounds = tuiInterfaceTypes.OverlayBounds;
  type OverlayHandle = tuiInterfaceTypes.OverlayHandle;
  type OverlayUnfocusOptions = tuiInterfaceTypes.OverlayUnfocusOptions;
  type TUI = tuiInterfaceTypes.TUI;
  type TuiInputListener = tuiInterfaceTypes.TuiInputListener;
  type TuiInputListenerResult = tuiInterfaceTypes.TuiInputListenerResult;
  type TuiMode = tuiInterfaceTypes.TuiMode;
  type TuiStopOptions = tuiInterfaceTypes.TuiStopOptions;
  type ViewportTUI = tuiInterfaceTypes.ViewportTUI;
  type OverlayAnchor = tuiOverlayLayoutTypes.OverlayAnchor;
  type OverlayMargin = tuiOverlayLayoutTypes.OverlayMargin;
  type OverlayOptions = tuiOverlayLayoutTypes.OverlayOptions;
  type SizeValue = tuiOverlayLayoutTypes.SizeValue;
  type TuiAltScreenOptions = tuiAltScreenTypes.TuiAltScreenOptions;
  type Container = tuiComponentTypes.Container;
  type TuiAltScreen = tuiAltScreenTypes.TuiAltScreen;
  type TuiMainScreenRenderState = tuiMainScreenTypes.TuiMainScreenRenderState;
  type WheelScrollLines = wheelScrollTypes.WheelScrollLines;
  type TuiMainScreen = tuiMainScreenTypes.TuiMainScreen;
}

export type { tuiScreenKitTypes as default };
