import chalk from "chalk";
import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import platformModule from "../../core/platform.ts";
import shell from "../../utils/shell.ts";
import interactiveModeHelpers from "./interactive-mode-helpers.ts";
import InteractiveModeLayer32 from "./interactive-mode-layer-32.ts";
import interactiveModeSupport from "./interactive-mode-support.ts";

const { awaited, awaitingWith } = awaitingModule;
const { nowMs } = platformModule;
const { formatResumeCommand } = interactiveModeSupport;
const { killTrackedDetachedChildren } = shell;
const { isDeadTerminalError } = interactiveModeHelpers;

export default abstract class InteractiveModeLayer33 extends InteractiveModeLayer32 {
  protected initPart2(): Effect.Effect<void> {
    return awaitingWith(function* () {
      this.mountInteractiveTui(this.renderer, [
        this.documentContainer,
        this.pendingMessagesContainer,
        this.statusContainer,
        this.extensionWidgets.above,
        this.editorContainer,
        this.extensionWidgets.below,
        this.footerContainer,
      ]);
      this.defaultEditor.onAction("app.clear", () => this.handleCtrlC());
      this.defaultEditor.onCtrlD = () => this.handleCtrlD();
      this.defaultEditor.onSubmit = (text) => this.handleStartupSubmit(text);
      this.ui.setFocus(this.editor);

      this.ui.start();
      this.isInitialized = true;
      this.programStatus.report();
      this.ensurePngTranscoder();

      this.themeController.applyFromSettings();
      yield* awaited(this.themeController.waitForTerminalColors());
    }, this);
  }

  protected handleCtrlC(): void {
    const now = nowMs();
    if (now - this.lastSigintTime < 500) {
      void void this.shutdown();
    } else {
      this.clearEditor();
      this.lastSigintTime = now;
    }
  }

  protected handleCtrlD(): void {
    void void this.shutdown();
  }

  protected shutdown(options?: { fromSignal?: boolean }): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;

        if (options?.fromSignal === true) {
          yield* awaited(this.runtimeHost.dispose());
          this.themeController.disableAutoSync();
          yield* awaited(this.ui.terminal.drainInput(1000));
          this.stop();
          process.exit(0);
        }

        this.themeController.disableAutoSync();
        yield* awaited(this.ui.terminal.drainInput(1000));

        this.stop();
        yield* awaited(this.runtimeHost.dispose());

        const resumeCommand = formatResumeCommand(this.sessionManager);
        if (resumeCommand !== undefined && resumeCommand !== "") {
          process.stdout.write(`${chalk.dim("To resume this session:")} ${resumeCommand}\n`);
        }

        process.exit(0);
      }, this),
    );
  }

  protected checkShutdownRequested(): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (!this.shutdownRequested) return;
      yield* awaited(this.shutdown());
    }, this);
  }

  protected registerSignalHandlers(): void {
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

    const uncaughtExceptionHandler = (error: Error) => this.uncaughtCrash(error);
    process.prependListener("uncaughtException", uncaughtExceptionHandler);
    this.signalCleanupHandlers.push(() =>
      process.off("uncaughtException", uncaughtExceptionHandler),
    );
  }
}
