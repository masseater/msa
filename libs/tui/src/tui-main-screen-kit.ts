import env from "./env.ts";
import terminalImageKitty from "./terminal-image-kitty.ts";
import termuxSession from "./termux-session.ts";
import tuiMainScreenFrame from "./tui-main-screen-frame.ts";
import tuiMainScreenKitty from "./tui-main-screen-kitty.ts";

const tuiMainScreenKit = {
  env,
  terminalImageKitty,
  termuxSession,
  tuiMainScreenFrame,
  tuiMainScreenKitty,
};

export default tuiMainScreenKit;
