import tuiModule from "@msa/tui";
import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import errorsModule from "../../../utils/errors.ts";
import ThemedText from "../components/themed-text.ts";
import type InteractiveMode from "../interactive-mode.ts";
import sessionShare from "../session-share.ts";
import themeModule from "../theme/theme.ts";

const { theme } = themeModule;
const { Spacer } = tuiModule;
const { awaited, awaitingWith } = awaitingModule;
const { toErrorMessage } = errorsModule;
const { shareSession } = sessionShare;

export default class SessionCommands {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  handleNameCommand(text: string): void {
    const name = text.replace(/^\/rename\s*/u, "").trim();
    if (name === "") {
      const currentName = this.mode.sessionManager.getSessionName();
      if (currentName !== undefined && currentName !== "") {
        this.mode.layout.chatContainer.addChild(new Spacer(1));
        this.mode.layout.chatContainer.addChild(
          new ThemedText(() => theme.fg("dim", `Session name: ${currentName}`), 1, 0),
        );
      } else {
        this.mode.display.status.showWarning("Usage: /rename <name>");
      }
      this.mode.ui.requestRender();
      return;
    }

    this.mode.session.context.transcript.setSessionName(name);
    const sessionName = this.mode.sessionManager.getSessionName();
    if (sessionName !== name) {
      this.mode.display.status.showWarning(
        `Session name was normalized from ${JSON.stringify(name)} to ${JSON.stringify(sessionName)}`,
      );
    }
    this.mode.layout.chatContainer.addChild(new Spacer(1));
    const displayName = sessionName ?? name;
    this.mode.layout.chatContainer.addChild(
      new ThemedText(() => theme.fg("dim", `Session name set: ${displayName}`), 1, 0),
    );
    this.mode.ui.requestRender();
  }

  handleCloneCommand(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const leafId = this.mode.sessionManager.getLeafId();
        if (leafId === null || leafId === "") {
          this.mode.display.status.showStatus("Nothing to clone yet");
          return;
        }

        try {
          const result = yield* awaited(this.mode.runtimeHost.fork(leafId, { position: "at" }));
          if (result.cancelled) {
            this.mode.ui.requestRender();
            return;
          }

          this.mode.editor.setText("");
          this.mode.display.status.showStatus("Cloned to new session");
        } catch (error: unknown) {
          this.mode.display.status.showError(toErrorMessage(error));
        }
      }, this),
    );
  }

  handleShareCommand(): Effect.Effect<void> {
    return awaitingWith(function* () {
      yield* awaited(
        shareSession({
          editorSlot: this.mode.editorSlot,
          session: this.mode.session,
          showError: (message) => this.mode.display.status.showError(message),
          showStatus: (message) => this.mode.display.status.showStatus(message),
          ui: this.mode.ui,
        }),
      );
    }, this);
  }

  handleExportCommand(text: string): Effect.Effect<void> {
    return awaitingWith(function* () {
      const outputPath = this.mode.commands.router.getPathCommandArgument(text, "/export");

      try {
        const filePath =
          outputPath?.endsWith(".jsonl") === true
            ? yield* awaited(this.mode.session.context.exports.exportToJsonl(outputPath))
            : yield* awaited(
                this.mode.session.context.exports.exportToHtml(outputPath, {
                  themeName: theme.name,
                }),
              );
        this.mode.display.status.showStatus(`Session exported to: ${filePath}`);
      } catch (error: unknown) {
        this.mode.display.status.showError(
          `Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }, this);
  }

  handleCompactCommand(customInstructions?: string): Effect.Effect<void> {
    return awaitingWith(function* () {
      this.mode.display.indicator.clearStatusIndicator();

      try {
        yield* awaited(this.mode.session.compaction.manual.compact(customInstructions));
      } catch {}
    }, this);
  }

  handleClearCommand(): Effect.Effect<void> {
    return awaitingWith(function* () {
      this.mode.display.indicator.clearStatusIndicator();
      try {
        const result = yield* awaited(this.mode.runtimeHost.newSession());
        if (result.cancelled) {
          return;
        }
        this.mode.layout.chatContainer.addChild(new Spacer(1));
        this.mode.layout.chatContainer.addChild(
          new ThemedText(() => theme.fg("accent", "✓ New session started"), 1, 1),
        );
        this.mode.ui.requestRender();
      } catch (error: unknown) {
        yield* awaited(
          this.mode.lifecycle.fatalErrors.handleFatalRuntimeError(
            "Failed to create session",
            error,
          ),
        );
      }
    }, this);
  }
}
