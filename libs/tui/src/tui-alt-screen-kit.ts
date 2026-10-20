import altScreenClipboard from "./alt-screen-clipboard.ts";
import altScreenMouseProtocol from "./alt-screen-mouse-protocol.ts";
import AltScreenPainter from "./alt-screen-painter.ts";
import AltScreenPointer from "./alt-screen-pointer.ts";
import AltScreenSearchController from "./alt-screen-search-controller.ts";

const tuiAltScreenKit = {
  AltScreenPainter,
  AltScreenPointer,
  AltScreenSearchController,
  altScreenClipboard,
  altScreenMouseProtocol,
};

export default tuiAltScreenKit;
