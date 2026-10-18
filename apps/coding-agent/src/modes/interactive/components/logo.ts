import { foregroundAnsi, rgbColor } from "@msa/tui";

import { theme } from "../theme/theme.ts";

const CORAL = rgbColor(228, 138, 122);
const BLUE = rgbColor(79, 142, 179);
const YELLOW = rgbColor(234, 182, 93);
const RESET = "\x1b[0m";

export function wordmark(): string {
  const mode = theme.getColorMode();
  return `${foregroundAnsi(CORAL, mode)}m${foregroundAnsi(BLUE, mode)}s${foregroundAnsi(YELLOW, mode)}a${RESET}`;
}
