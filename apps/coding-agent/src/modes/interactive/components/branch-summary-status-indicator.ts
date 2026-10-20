import type tuiTypes from "@msa/tui/index.types";

import themeModule from "../theme/theme.ts";
import keybindingHints from "./keybinding-hints.ts";
import StatusIndicator from "./status-indicator.ts";

const { theme } = themeModule;
const { keyText } = keybindingHints;

export default class BranchSummaryStatusIndicator extends StatusIndicator {
  constructor(ui: tuiTypes.TUI) {
    super(
      "branchSummary",
      ui,
      (spinner) => theme.fg("accent", spinner),
      (text) => theme.fg("muted", text),
      `Summarizing branch... (${keyText("app.interrupt")} to cancel)`,
    );
  }
}
