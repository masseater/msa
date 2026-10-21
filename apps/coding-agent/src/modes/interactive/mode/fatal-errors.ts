import { Effect } from "effect";

import errorsModule from "../../../utils/errors.ts";
import ThemedText from "../components/themed-text.ts";
import type InteractiveMode from "../interactive-mode.ts";
import themeModule from "../theme/theme.ts";

const { theme, stopThemeWatcher } = themeModule;
const { toErrorMessage } = errorsModule;

export default class FatalErrorHandler {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  handleFatalRuntimeError(prefix: string, error: unknown): Promise<never> {
    return Effect.runPromise(
      Effect.sync(() => {
        const message = toErrorMessage(error);
        this.mode.display.status.showError(`${prefix}: ${message}`);
        const extensionHint = this.mode.lifecycle.crash.getCrashExtensionHint(error);
        if (extensionHint !== undefined && extensionHint !== "") {
          this.mode.layout.chatContainer.addChild(
            new ThemedText(
              () => theme.fg("warning", extensionHint),
              this.mode.display.thinking.outputPad,
              0,
            ),
          );
        }
        if (this.mode.lifecycle.crash.recordCrash("fatal_error", error)) {
          const instructions = this.mode.lifecycle.crash.crashReportInstructions();
          this.mode.layout.chatContainer.addChild(
            new ThemedText(
              () => theme.fg("muted", instructions),
              this.mode.display.thinking.outputPad,
              0,
            ),
          );
        }
        stopThemeWatcher();
        this.mode.lifecycle.shutdown.stop("transcript");
        process.exit(1);
      }),
    );
  }
}
