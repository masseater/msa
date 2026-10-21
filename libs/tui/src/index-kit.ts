import inputKit from "./index-kit/input.ts";
import layoutKit from "./index-kit/layout.ts";
import renderingKit from "./index-kit/rendering.ts";
import terminalKit from "./index-kit/terminal.ts";
import widgetsKit from "./index-kit/widgets.ts";

const indexKit: typeof layoutKit &
  typeof widgetsKit &
  typeof inputKit &
  typeof terminalKit &
  typeof renderingKit = {
  ...layoutKit,
  ...widgetsKit,
  ...inputKit,
  ...terminalKit,
  ...renderingKit,
};

export default indexKit;
