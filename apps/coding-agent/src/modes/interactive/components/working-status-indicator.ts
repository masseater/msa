import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypes from "../../../core/extensions/index.types.ts";
import themeModule from "../theme/theme.ts";
import StatusIndicator from "./status-indicator.ts";

const { theme } = themeModule;

const createWorkingStatusIndicator = ({
  ui,
  message,
  indicator,
  colorFn,
}: {
  readonly ui: tuiTypes.TUI;
  readonly message: string;
  readonly indicator?: extensionsTypes.WorkingIndicatorOptions | undefined;
  readonly colorFn?: ((text: string) => string) | undefined;
}): StatusIndicator =>
  new StatusIndicator(
    "working",
    ui,
    colorFn ?? ((text) => theme.fg("accent", text)),
    colorFn ?? ((text) => theme.fg("muted", text)),
    message,
    indicator,
  );

export default createWorkingStatusIndicator;
