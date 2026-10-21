import type tuiTypes from "@msa/tui/index.types";

import themeModule from "../theme/theme.ts";
import CountdownTimer from "./countdown-timer.ts";
import keybindingHints from "./keybinding-hints.ts";
import StatusIndicator from "./status-indicator.ts";

const { theme } = themeModule;
const { keyText } = keybindingHints;

const createRetryStatusIndicator = ({
  ui,
  attempt,
  maxAttempts,
  delayMs,
}: {
  readonly ui: tuiTypes.TUI;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly delayMs: number;
}): StatusIndicator => {
  const retryMessage = (seconds: number) =>
    `Retrying (${attempt}/${maxAttempts}) in ${seconds}s... (${keyText("app.interrupt")} to cancel)`;
  const indicator = new StatusIndicator(
    "retry",
    ui,
    (spinner) => theme.fg("warning", spinner),
    (text) => theme.fg("muted", text),
    retryMessage(Math.ceil(delayMs / 1000)),
  );
  const countdown = new CountdownTimer(
    delayMs,
    ui,
    (seconds) => {
      indicator.setMessage(retryMessage(seconds));
    },
    () => {},
  );
  indicator.onDispose(() => countdown.dispose());
  return indicator;
};

export default createRetryStatusIndicator;
