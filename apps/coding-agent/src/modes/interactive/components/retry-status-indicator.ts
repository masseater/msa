import type tuiTypes from "@msa/tui/index.types";

import themeModule from "../theme/theme.ts";
import CountdownTimer from "./countdown-timer.ts";
import type countdownTimerTypes from "./countdown-timer.types.ts";
import keybindingHints from "./keybinding-hints.ts";
import StatusIndicator from "./status-indicator.ts";

const { theme } = themeModule;
const { keyText } = keybindingHints;

export default class RetryStatusIndicator extends StatusIndicator {
  private countdown: countdownTimerTypes.CountdownTimer | undefined;

  constructor(ui: tuiTypes.TUI, attempt: number, maxAttempts: number, delayMs: number) {
    const retryMessage = (seconds: number) =>
      `Retrying (${attempt}/${maxAttempts}) in ${seconds}s... (${keyText("app.interrupt")} to cancel)`;
    super(
      "retry",
      ui,
      (spinner) => theme.fg("warning", spinner),
      (text) => theme.fg("muted", text),
      retryMessage(Math.ceil(delayMs / 1000)),
    );
    this.countdown = new CountdownTimer(
      delayMs,
      ui,
      (seconds) => {
        this.setMessage(retryMessage(seconds));
      },
      () => {
        this.countdown = undefined;
      },
    );
  }

  override dispose(): void {
    this.countdown?.dispose();
    this.countdown = undefined;
    super.dispose();
  }
}
