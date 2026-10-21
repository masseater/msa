import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import platformModule from "../../../core/platform.ts";
import errorsModule from "../../../utils/errors.ts";
import externalEditor from "../external-editor.ts";
import type InteractiveMode from "../interactive-mode.ts";
import themeModule from "../theme/theme.ts";

const { theme } = themeModule;
const { awaited, awaitingWith } = awaitingModule;
const { toErrorMessage } = errorsModule;
const { nowMs, schedule } = platformModule;
const { editWhileSuspended } = externalEditor;

export default class KeyHandlers {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  private lastSigintTime = 0;

  private lastEscapeTime = 0;

  updateEditorBorderColor(): void {
    if (this.mode.input.bash.isBashMode) {
      this.mode.editor.borderColor = theme.getBashModeBorderColor();
    } else {
      const level = this.mode.session.thinkingLevel || "off";
      this.mode.editor.borderColor = theme.getThinkingBorderColor(level);
    }
    this.mode.display.indicator.activeStatusIndicator?.invalidate();
    this.mode.ui.requestRender();
  }

  private cycleThinkingLevel(): void {
    const newLevel = this.mode.session.models.thinking.cycleThinkingLevel();
    if (newLevel === undefined) {
      this.mode.display.status.showStatus("Current model does not support thinking");
    } else {
      this.mode.footer.invalidate();
      this.updateEditorBorderColor();
      this.mode.display.status.showStatus(`Thinking level: ${newLevel}`);
    }
  }

  private cycleModel(direction: "forward" | "backward"): Effect.Effect<void> {
    return awaitingWith(function* () {
      try {
        const result = yield* awaited(this.mode.session.models.selection.cycleModel(direction));
        if (result === undefined) {
          const msg =
            this.mode.session.models.selection.scopedModels.length > 0
              ? "Only one model in scope"
              : "Only one model available";
          this.mode.display.status.showStatus(msg);
        } else {
          this.mode.footer.invalidate();
          this.updateEditorBorderColor();
          const thinkingStr =
            result.model.reasoning && result.thinkingLevel !== "off"
              ? ` (thinking: ${result.thinkingLevel})`
              : "";
          this.mode.display.status.showStatus(
            `Switched to ${result.model.name || result.model.id}${thinkingStr}`,
          );
        }
      } catch (error) {
        this.mode.display.status.showError(toErrorMessage(error));
      }
    }, this);
  }

  handleCtrlZ(): void {
    if (process.platform === "win32") {
      this.mode.display.status.showStatus("Suspend to background is not supported on Windows");
      return;
    }

    const suspendKeepAlive = schedule(() => {}, 2 ** 30);

    const ignoreSigint = () => {};
    process.on("SIGINT", ignoreSigint);

    process.once("SIGCONT", () => {
      suspendKeepAlive.cancel();
      process.removeListener("SIGINT", ignoreSigint);
      this.mode.ui.start();
      this.mode.ui.requestRender(true);
    });

    try {
      this.mode.ui.stop();

      process.kill(0, "SIGTSTP");
    } catch (error) {
      suspendKeepAlive.cancel();
      process.removeListener("SIGINT", ignoreSigint);
      throw error;
    }
  }

  private handleOpenExternalEditor(): Effect.Effect<void> {
    const { editor, settingsManager, ui } = this.mode;
    return editWhileSuspended(
      ui,
      {
        command: settingsManager.terminal.getExternalEditorCommand(),
        content: editor.getExpandedText?.() ?? editor.getText(),
      },
      (content) => editor.setText(content),
    );
  }

  handleCtrlC(): void {
    const now = nowMs();
    if (now - this.lastSigintTime < 500) {
      void void this.mode.lifecycle.shutdown.shutdown();
    } else {
      this.mode.input.editors.clearEditor();
      this.lastSigintTime = now;
    }
  }

  handleCtrlD(): void {
    void void this.mode.lifecycle.shutdown.shutdown();
  }

  setupKeyHandlers(): void {
    this.bindCoreActions();
    this.bindViewActions();
    this.bindSessionActions();
    this.bindEditorCallbacks();
  }

  private bindViewActions(): void {
    const { display, commands } = this.mode;
    const editor = this.mode.defaultEditor;
    editor.onAction("app.tools.expand", () => display.resources.toggleToolOutputExpansion());
    editor.onAction("app.thinking.toggle", () => display.thinking.toggleThinkingBlockVisibility());
    editor.onAction(
      "app.editor.external",
      () => void Effect.runFork(this.handleOpenExternalEditor()),
    );
    editor.onAction(
      "app.message.copy",
      () =>
        void commands.info.handleCopyCommand({ flashConfirmation: true, preferSelection: true }),
    );
  }

  private bindSessionActions(): void {
    const { input, commands, selectors } = this.mode;
    const editor = this.mode.defaultEditor;
    editor.onAction("app.message.followUp", () => Effect.runPromise(input.submit.handleFollowUp()));
    editor.onAction("app.message.dequeue", () => input.queue.handleDequeue());
    editor.onAction("app.session.new", () =>
      Effect.runPromise(commands.session.handleClearCommand()),
    );
    editor.onAction("app.session.tree", () => selectors.tree.showTreeSelector());
    editor.onAction("app.session.fork", () => selectors.fork.showUserMessageSelector());
    editor.onAction("app.session.resume", () => selectors.sessions.showSessionSelector());
    selectors.views.orchestratorPane.bindKeys(editor, () => selectors.views.showTasksView());
  }

  private bindEditorCallbacks(): void {
    const { input } = this.mode;
    this.mode.defaultEditor.onChange = (text: string) => {
      const wasBashMode = input.bash.isBashMode;
      input.bash.isBashMode = text.trimStart().startsWith("!");
      if (wasBashMode !== input.bash.isBashMode) {
        this.updateEditorBorderColor();
      }
    };
    this.mode.defaultEditor.onPasteImage = () => {
      void input.clipboard.handleClipboardPaste();
    };
  }

  private bindCoreActions(): void {
    this.mode.defaultEditor.onEscape = () => {
      if (this.mode.session.isStreaming) {
        this.mode.input.queue.restoreQueuedMessagesToEditor({ abort: true });
      } else if (this.mode.session.context.bash.isBashRunning) {
        this.mode.session.context.bash.abortBash();
      } else if (this.mode.input.bash.isBashMode) {
        this.mode.editor.setText("");
        this.mode.input.bash.isBashMode = false;
        this.updateEditorBorderColor();
      } else if (this.mode.editor.getText().trim() === "") {
        const action = this.mode.settingsManager.terminal.getDoubleEscapeAction();
        if (action !== "none") {
          const now = nowMs();
          if (now - this.lastEscapeTime < 500) {
            if (action === "tree") {
              this.mode.selectors.tree.showTreeSelector();
            } else {
              this.mode.selectors.fork.showUserMessageSelector();
            }
            this.lastEscapeTime = 0;
          } else {
            this.lastEscapeTime = now;
          }
        }
      }
    };

    this.mode.defaultEditor.onAction("app.clear", () => this.handleCtrlC());
    this.mode.defaultEditor.onCtrlD = () => this.handleCtrlD();
    this.mode.defaultEditor.onAction("app.suspend", () => this.handleCtrlZ());
    this.mode.defaultEditor.onAction("app.thinking.cycle", () => this.cycleThinkingLevel());
    this.mode.defaultEditor.onAction("app.model.cycleForward", () =>
      Effect.runPromise(this.cycleModel("forward")),
    );
    this.mode.defaultEditor.onAction("app.model.cycleBackward", () =>
      Effect.runPromise(this.cycleModel("backward")),
    );

    this.mode.ui.onDebug = () => this.mode.commands.debug.handleDebugCommand();
    this.mode.defaultEditor.onAction("app.model.select", () =>
      this.mode.models.selector.showModelSelector(),
    );
  }
}
