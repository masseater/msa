import chalk from "chalk";
import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import shell from "../../../utils/shell.ts";
import interactiveModeHelpers from "../interactive-mode-helpers.ts";
import interactiveModeSupport from "../interactive-mode-support.ts";
import type InteractiveMode from "../interactive-mode.ts";

const { killTrackedDetachedChildren } = shell;
const { isDeadTerminalError } = interactiveModeHelpers;
const { formatResumeCommand } = interactiveModeSupport;
const { awaited, awaitingWith } = awaitingModule;

export default class ModeShutdown {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  private signalCleanupHandlers: Array<() => void> = [];

  shutdownRequested = false;

  isShuttingDown = false;

  emergencyTerminalExit(): never {
    this.isShuttingDown = true;
    this.unregisterSignalHandlers();
    killTrackedDetachedChildren();
    process.exit(129);
  }

  unregisterSignalHandlers(): void {
    for (const cleanup of this.signalCleanupHandlers) {
      cleanup();
    }
    this.signalCleanupHandlers = [];
  }

  stop(fullscreenExitOutput = this.mode.settingsManager.terminal.getFullscreenExitOutput()): void {
    this.mode.editorSlot.disposeActiveSelector();
    if (this.mode.settingsManager.terminal.getShowTerminalProgress()) {
      this.mode.ui.terminal.setProgress(false);
    }
    this.mode.display.indicator.clearStatusIndicator();
    this.mode.display.theme.themeController.disableAutoSync();
    this.mode.extensions.dialogs.clearExtensionTerminalInputListeners();
    this.mode.footer.dispose();
    this.mode.layout.footerDataProvider.dispose();
    if (this.mode.lifecycle.events.goalTicker !== undefined)
      this.mode.lifecycle.events.goalTicker.cancel();
    this.mode.lifecycle.events.goalTicker = undefined;
    if (this.mode.lifecycle.events.unsubscribe !== undefined) {
      this.mode.lifecycle.events.unsubscribe();
    }
    if (this.mode.lifecycle.startup.isInitialized) {
      this.mode.lifecycle.screen.stopInteractiveTui(fullscreenExitOutput);
      this.mode.lifecycle.startup.isInitialized = false;
    }
    this.unregisterSignalHandlers();
  }

  shutdown(options?: { fromSignal?: boolean }): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;

        if (options?.fromSignal === true) {
          yield* awaited(this.mode.runtimeHost.dispose());
          this.mode.display.theme.themeController.disableAutoSync();
          yield* awaited(this.mode.ui.terminal.drainInput(1000));
          this.stop();
          process.exit(0);
        }

        this.mode.display.theme.themeController.disableAutoSync();
        yield* awaited(this.mode.ui.terminal.drainInput(1000));

        this.stop();
        yield* awaited(this.mode.runtimeHost.dispose());

        const resumeCommand = yield* awaited(formatResumeCommand(this.mode.sessionManager));
        if (resumeCommand !== undefined && resumeCommand !== "") {
          process.stdout.write(`${chalk.dim("To resume this session:")} ${resumeCommand}\n`);
        }

        process.exit(0);
      }, this),
    );
  }

  checkShutdownRequested(): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (!this.shutdownRequested) return;
      yield* awaited(this.shutdown());
    }, this);
  }

  registerSignalHandlers(): void {
    this.unregisterSignalHandlers();

    const signals: NodeJS.Signals[] = ["SIGTERM"];
    if (process.platform !== "win32") {
      signals.push("SIGHUP");
    }

    for (const signal of signals) {
      const handler = () => {
        killTrackedDetachedChildren();
        void void this.shutdown({ fromSignal: true });
      };
      process.prependListener(signal, handler);
      this.signalCleanupHandlers.push(() => process.off(signal, handler));
    }

    const terminalErrorHandler = (error: Error) => {
      if (isDeadTerminalError(error)) {
        this.emergencyTerminalExit();
      }
      throw error;
    };
    for (const stream of [process.stdin, process.stdout, process.stderr]) {
      stream.on("error", terminalErrorHandler);
      this.signalCleanupHandlers.push(() => stream.off("error", terminalErrorHandler));
    }

    const uncaughtExceptionHandler = (error: Error) =>
      this.mode.lifecycle.crash.uncaughtCrash(error);
    process.prependListener("uncaughtException", uncaughtExceptionHandler);
    this.signalCleanupHandlers.push(() =>
      process.off("uncaughtException", uncaughtExceptionHandler),
    );
  }
}
