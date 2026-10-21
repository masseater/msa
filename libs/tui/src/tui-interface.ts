import type tuiInterfaceTypes from "./tui-interface.types.ts";

const VIEWPORT_TUI = Symbol.for("@msa/tui/viewport");

function isViewportTUI(tui: tuiInterfaceTypes.TUI): tui is tuiInterfaceTypes.ViewportTUI {
  return (tui as Partial<tuiInterfaceTypes.ViewportTUI>)[VIEWPORT_TUI] === true;
}

const tuiInterface = {
  VIEWPORT_TUI,
  isViewportTUI,
};

export default tuiInterface;
