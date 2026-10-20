import tuiModule from "@msa/tui";
import { Effect } from "effect";

import config from "../../config.ts";
import platformModule from "../../core/platform.ts";
import nodeFs from "../../core/platform/node/fs.ts";
import pathModule from "../path.ts";
import ThemedText from "./components/themed-text.ts";
import InteractiveModeLayer40 from "./interactive-mode-layer-40.ts";
import themeModule from "./theme/theme.ts";

const { nowIso, nowMs } = platformModule;
const { getDebugLogPath } = config;
const { Spacer, visibleWidth } = tuiModule;
const { dirname } = pathModule;
const { theme } = themeModule;

export default abstract class InteractiveModeLayer41 extends InteractiveModeLayer40 {
  protected setupKeyHandlers(): void {
    this.setupKeyHandlersPart1();
    this.defaultEditor.onAction("app.tools.expand", () => this.toggleToolOutputExpansion());
    this.defaultEditor.onAction("app.thinking.toggle", () => this.toggleThinkingBlockVisibility());
    this.defaultEditor.onAction(
      "app.editor.external",
      () => void Effect.runFork(this.handleOpenExternalEditor()),
    );
    this.defaultEditor.onAction(
      "app.message.copy",
      () => void void this.handleCopyCommand({ flashConfirmation: true, preferSelection: true }),
    );
    this.defaultEditor.onAction("app.message.followUp", () =>
      Effect.runPromise(this.handleFollowUp()),
    );
    this.defaultEditor.onAction("app.message.dequeue", () => this.handleDequeue());
    this.defaultEditor.onAction("app.session.new", () =>
      Effect.runPromise(this.handleClearCommand()),
    );
    this.defaultEditor.onAction("app.session.tree", () => this.showTreeSelector());
    this.defaultEditor.onAction("app.session.fork", () => this.showUserMessageSelector());
    this.defaultEditor.onAction("app.session.resume", () => this.showSessionSelector());
    this.orchestratorPane.bindKeys(this.defaultEditor, () => this.showTasksView());

    this.defaultEditor.onChange = (text: string) => {
      const wasBashMode = this.isBashMode;
      this.isBashMode = text.trimStart().startsWith("!");
      if (wasBashMode !== this.isBashMode) {
        this.updateEditorBorderColor();
      }
    };

    this.defaultEditor.onPasteImage = () => {
      void void this.handleClipboardPaste();
    };
  }

  protected setupKeyHandlersPart1(): void {
    this.defaultEditor.onEscape = () => {
      if (this.session.isStreaming) {
        this.restoreQueuedMessagesToEditor({ abort: true });
      } else if (this.session.isBashRunning) {
        this.session.abortBash();
      } else if (this.isBashMode) {
        this.editor.setText("");
        this.isBashMode = false;
        this.updateEditorBorderColor();
      } else if (this.editor.getText().trim() === "") {
        const action = this.settingsManager.getDoubleEscapeAction();
        if (action !== "none") {
          const now = nowMs();
          if (now - this.lastEscapeTime < 500) {
            if (action === "tree") {
              this.showTreeSelector();
            } else {
              this.showUserMessageSelector();
            }
            this.lastEscapeTime = 0;
          } else {
            this.lastEscapeTime = now;
          }
        }
      }
    };

    this.defaultEditor.onAction("app.clear", () => this.handleCtrlC());
    this.defaultEditor.onCtrlD = () => this.handleCtrlD();
    this.defaultEditor.onAction("app.suspend", () => this.handleCtrlZ());
    this.defaultEditor.onAction("app.thinking.cycle", () => this.cycleThinkingLevel());
    this.defaultEditor.onAction("app.model.cycleForward", () =>
      Effect.runPromise(this.cycleModel("forward")),
    );
    this.defaultEditor.onAction("app.model.cycleBackward", () =>
      Effect.runPromise(this.cycleModel("backward")),
    );

    this.ui.onDebug = () => this.handleDebugCommand();
    this.defaultEditor.onAction("app.model.select", () => this.showModelSelector());
  }

  protected handleDebugCommand(): void {
    const width = this.ui.terminal.columns;
    const height = this.ui.terminal.rows;
    const allLines = this.ui.render(width);

    const debugLogPath = getDebugLogPath();
    const debugData = [
      `Debug output at ${nowIso()}`,
      `Terminal: ${width}x${height}`,
      `Total lines: ${allLines.length}`,
      "",
      "=== All rendered lines with visible widths ===",
      ...allLines.map((line, idx) => {
        const vw = visibleWidth(line);
        const escaped = JSON.stringify(line);
        return `[${idx}] (w=${vw}) ${escaped}`;
      }),
      "",
      "=== Agent messages (JSONL) ===",
      ...this.session.messages.map((msg) => JSON.stringify(msg)),
      "",
    ].join("\n");

    nodeFs.mkdirSync(dirname(debugLogPath), { recursive: true });
    nodeFs.writeFileSync(debugLogPath, debugData);

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new ThemedText(
        () => `${theme.fg("accent", "✓ Debug log written")}\n${theme.fg("muted", debugLogPath)}`,
        1,
        1,
      ),
    );
    this.ui.requestRender();
  }
}
