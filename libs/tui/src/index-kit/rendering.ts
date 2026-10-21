import colorAnsi from "../color-ansi.ts";
import colors from "../colors.ts";
import latex from "../latex.ts";
import oklab from "../oklab.ts";

const renderingKit: {
  readonly colorAnsi: typeof colorAnsi;
  readonly colors: typeof colors;
  readonly latex: typeof latex;
  readonly oklab: typeof oklab;
} = {
  colorAnsi,
  colors,
  latex,
  oklab,
};

export default renderingKit;
