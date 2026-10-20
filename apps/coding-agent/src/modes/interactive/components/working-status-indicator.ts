import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypes from "../../../core/extensions/index.types.ts";
import themeModule from "../theme/theme.ts";
import StatusIndicator from "./status-indicator.ts";

const { theme } = themeModule;

export default class WorkingStatusIndicator extends StatusIndicator {
  constructor(
    ui: tuiTypes.TUI,
    message: string,
    indicator?: extensionsTypes.WorkingIndicatorOptions,
    colorFn?: (text: string) => string,
  ) {
    super(
      "working",
      ui,
      colorFn ?? ((text) => theme.fg("accent", text)),
      colorFn ?? ((text) => theme.fg("muted", text)),
      message,
      indicator,
    );
  }
}
