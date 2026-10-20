import tuiModule from "@msa/tui";
import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import type extensionsTypes from "../../core/extensions/index.types.ts";
import MissingSessionCwdError from "../../core/missing-session-cwd-error.ts";
import SessionImportFileNotFoundError from "../../core/session-import-file-not-found-error.ts";
import errorsModule from "../../utils/errors.ts";
import ThemedText from "./components/themed-text.ts";
import InteractiveModeLayer31 from "./interactive-mode-layer-31.ts";
import themeModule from "./theme/theme.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { toErrorMessage } = errorsModule;
const { stopThemeWatcher, theme } = themeModule;
const { Spacer } = tuiModule;

export default abstract class InteractiveModeLayer32 extends InteractiveModeLayer31 {
  protected forkFromExtension(
    entryId: string,
    options: Parameters<extensionsTypes.ExtensionCommandContextActions["fork"]>[1],
  ) {
    return Effect.runPromise(
      awaitingWith(function* () {
        try {
          const result = yield* awaited(this.runtimeHost.fork(entryId, options));
          if (!result.cancelled) {
            this.editor.setText(result.selectedText ?? "");
            this.showStatus("Forked to new session");
          }
          return { cancelled: result.cancelled };
        } catch (error: unknown) {
          return yield* awaited(this.handleFatalRuntimeError("Failed to fork session", error));
        }
      }, this),
    );
  }

  protected newSessionFromExtension(
    options: Parameters<extensionsTypes.ExtensionCommandContextActions["newSession"]>[0],
  ) {
    this.clearStatusIndicator();
    return Promise.resolve()
      .then(() => this.runtimeHost.newSession(options))
      .catch((error: unknown) => this.handleFatalRuntimeError("Failed to create session", error));
  }

  protected handleFatalRuntimeError(prefix: string, error: unknown): Promise<never> {
    return Effect.runPromise(
      Effect.sync(() => {
        const message = toErrorMessage(error);
        this.showError(`${prefix}: ${message}`);
        const extensionHint = this.getCrashExtensionHint(error);
        if (extensionHint !== undefined && extensionHint !== "") {
          this.chatContainer.addChild(
            new ThemedText(() => theme.fg("warning", extensionHint), this.outputPad, 0),
          );
        }
        if (this.recordCrash("fatal_error", error)) {
          const instructions = this.crashReportInstructions();
          this.chatContainer.addChild(
            new ThemedText(() => theme.fg("muted", instructions), this.outputPad, 0),
          );
        }
        stopThemeWatcher();
        this.stop("transcript");
        process.exit(1);
      }),
    );
  }

  protected recoverFromImportError(inputPath: string, error: unknown): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (error instanceof MissingSessionCwdError) {
        const selectedCwd = yield* awaited(this.promptForMissingSessionCwd(error));
        if (selectedCwd === undefined || selectedCwd === "") {
          this.showStatus("Import cancelled");
          return;
        }
        yield* performed(this.importSession(inputPath, selectedCwd));
        return;
      }
      if (error instanceof SessionImportFileNotFoundError) {
        this.showError(`Failed to import session: ${error.message}`);
        return;
      }
      yield* awaited(this.handleFatalRuntimeError("Failed to import session", error));
    }, this);
  }

  protected handleImportCommand(text: string): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const inputPath = this.getPathCommandArgument(text, "/import");
        if (inputPath === undefined || inputPath === "") {
          this.showError("Usage: /import <path.jsonl>");
          return;
        }
        const confirmed = yield* awaited(
          this.extensionDialogs.confirm(
            "Import session",
            `Replace current session with ${inputPath}?`,
          ),
        );
        if (!confirmed) {
          this.showStatus("Import cancelled");
          return;
        }
        try {
          this.clearStatusIndicator();
          yield* performed(this.importSession(inputPath));
        } catch (error: unknown) {
          yield* performed(this.recoverFromImportError(inputPath, error));
        }
      }, this),
    );
  }

  protected handleClearCommand(): Effect.Effect<void> {
    return awaitingWith(function* () {
      this.clearStatusIndicator();
      try {
        const result = yield* awaited(this.runtimeHost.newSession());
        if (result.cancelled) {
          return;
        }
        this.chatContainer.addChild(new Spacer(1));
        this.chatContainer.addChild(
          new ThemedText(() => theme.fg("accent", "✓ New session started"), 1, 1),
        );
        this.ui.requestRender();
      } catch (error: unknown) {
        yield* awaited(this.handleFatalRuntimeError("Failed to create session", error));
      }
    }, this);
  }
}
