import altScreenTerminalModes from "./alt-screen-terminal-modes.ts";
import altScreenViewportKeys from "./alt-screen-viewport-keys.ts";
import AltScreenFlashContainer from "./components/alt-screen-flash.ts";
import ScrollView from "./components/scroll-view.ts";
import layout from "./layout.ts";

const tuiAltScreenBaseKit = {
  AltScreenFlashContainer,
  ScrollView,
  altScreenTerminalModes,
  altScreenViewportKeys,
  layout,
};

export default tuiAltScreenBaseKit;
