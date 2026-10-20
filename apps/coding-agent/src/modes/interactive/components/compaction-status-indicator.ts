import type tuiTypes from "@msa/tui/index.types";

import themeModule from "../theme/theme.ts";
import keybindingHints from "./keybinding-hints.ts";
import StatusIndicator from "./status-indicator.ts";
import type statusIndicatorTypes from "./status-indicator.types.ts";

const { theme } = themeModule;
const { keyText } = keybindingHints;

export default class CompactionStatusIndicator extends StatusIndicator {
  constructor(
    ui: tuiTypes.TUI,
    reason: statusIndicatorTypes.CompactionStatusReason,
    colorFn?: (text: string) => string,
  ) {
    const cancelHint = `(${keyText("app.interrupt")} to cancel)`;
    const label =
      reason === "manual"
        ? `Compacting context... ${cancelHint}`
        : `${reason === "overflow" ? "Context overflow detected, " : ""}Auto-compacting... ${cancelHint}`;
    super(
      "compaction",
      ui,
      colorFn ?? ((spinner) => theme.fg("accent", spinner)),
      colorFn ?? ((text) => theme.fg("muted", text)),
      label,
    );
  }
}
