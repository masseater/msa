import tui from "@msa/tui";

import themeModule from "../theme/theme.ts";

const { theme } = themeModule;

const { foregroundAnsi, rgbColor } = tui;

const CORAL = rgbColor(228, 138, 122);
const BLUE = rgbColor(79, 142, 179);
const YELLOW = rgbColor(234, 182, 93);
const RESET = "\x1b[0m";

function wordmark(): string {
  const mode = theme.getColorMode();
  return `${foregroundAnsi(CORAL, mode)}m${foregroundAnsi(BLUE, mode)}s${foregroundAnsi(YELLOW, mode)}a${RESET}`;
}

const logo = {
  wordmark,
};

export default logo;
