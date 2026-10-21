import type tuiTypes from "@msa/tui/index.types";

import themeModule from "../theme/theme.ts";
import keybindingHints from "./keybinding-hints.ts";
import StatusIndicator from "./status-indicator.ts";

const { theme } = themeModule;
const { keyText } = keybindingHints;

const createBranchSummaryStatusIndicator = (ui: tuiTypes.TUI): StatusIndicator =>
  new StatusIndicator(
    "branchSummary",
    ui,
    (spinner) => theme.fg("accent", spinner),
    (text) => theme.fg("muted", text),
    `Summarizing branch... (${keyText("app.interrupt")} to cancel)`,
  );

export default createBranchSummaryStatusIndicator;
