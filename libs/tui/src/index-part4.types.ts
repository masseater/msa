import type terminalCapabilitiesTypes from "./terminal-capabilities.types.ts";
import type terminalColorsTypes from "./terminal-colors.types.ts";
import type terminalImageSizeTypes from "./terminal-image-size.types.ts";
import type terminalImageTypes from "./terminal-image.types.ts";
import type tuiAltScreenTypes from "./tui-alt-screen.types.ts";
import type tuiComponentTypes from "./tui-component.types.ts";
import type tuiInterfaceTypes from "./tui-interface.types.ts";
import type tuiOverlayLayoutTypes from "./tui-overlay-layout.types.ts";

declare namespace tuiTypesPart4 {
  type RgbColor = terminalColorsTypes.RgbColor;
  type TerminalColorScheme = terminalColorsTypes.TerminalColorScheme;
  type TerminalColors = terminalColorsTypes.TerminalColors;
  type CellDimensions = terminalCapabilitiesTypes.CellDimensions;
  type ImageProtocol = terminalCapabilitiesTypes.ImageProtocol;
  type TerminalCapabilities = terminalCapabilitiesTypes.TerminalCapabilities;
  type ImageDimensions = terminalImageSizeTypes.ImageDimensions;
  type ImageRenderOptions = terminalImageTypes.ImageRenderOptions;
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
}

export type { tuiTypesPart4 as default };
