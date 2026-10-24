import { Effect, Schema } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import MissingSessionCwdError from "../../../core/missing-session-cwd-error.ts";
import SessionImportFileNotFoundError from "../../../core/session-import-file-not-found-error.ts";
import type InteractiveMode from "../interactive-mode.ts";

const { awaited, awaitingWith, performed } = awaitingModule;

export default class SessionImport {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  private importSession(inputPath: string, cwd?: string): Effect.Effect<void> {
    return awaitingWith(function* () {
      const result = yield* awaited(
        cwd === undefined
          ? this.mode.runtimeHost.importFromJsonl(inputPath)
          : this.mode.runtimeHost.importFromJsonl(inputPath, cwd),
      );
      this.mode.display.status.showStatus(
        result.cancelled ? "Import cancelled" : `Session imported from: ${inputPath}`,
      );
    }, this);
  }

  private recoverFromImportError(inputPath: string, error: unknown): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (Schema.is(MissingSessionCwdError)(error)) {
        const selectedCwd = yield* awaited(
          this.mode.selectors.sessions.promptForMissingSessionCwd(error),
        );
        if (selectedCwd === undefined || selectedCwd === "") {
          this.mode.display.status.showStatus("Import cancelled");
          return;
        }
        yield* performed(this.importSession(inputPath, selectedCwd));
        return;
      }
      if (Schema.is(SessionImportFileNotFoundError)(error)) {
        this.mode.display.status.showError(`Failed to import session: ${error.message}`);
        return;
      }
      yield* awaited(
        this.mode.lifecycle.fatalErrors.handleFatalRuntimeError("Failed to import session", error),
      );
    }, this);
  }

  handleImportCommand(text: string): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const inputPath = this.mode.commands.router.getPathCommandArgument(text, "/import");
        if (inputPath === undefined || inputPath === "") {
          this.mode.display.status.showError("Usage: /import <path.jsonl>");
          return;
        }
        const confirmed = yield* awaited(
          this.mode.extensions.dialogs.extensionDialogs.confirm(
            "Import session",
            `Replace current session with ${inputPath}?`,
          ),
        );
        if (!confirmed) {
          this.mode.display.status.showStatus("Import cancelled");
          return;
        }
        try {
          this.mode.display.indicator.clearStatusIndicator();
          yield* performed(this.importSession(inputPath));
        } catch (error: unknown) {
          yield* performed(this.recoverFromImportError(inputPath, error));
        }
      }, this),
    );
  }
}
