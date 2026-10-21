import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type toolsManagerTypes from "../../../utils/tools-manager.types.ts";
import ThemedText from "../components/themed-text.ts";
import type themedTextTypes from "../components/themed-text.types.ts";
import type InteractiveMode from "../interactive-mode.ts";
import themeModule from "../theme/theme.ts";

const { theme } = themeModule;
const { Spacer } = tuiModule;

export default class StatusMessages {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  private lastStatusSpacer: tuiTypes.Spacer | undefined = undefined;

  private lastStatusText: themedTextTypes.ThemedText | undefined = undefined;

  private lastStatusMessage = "";

  private managedToolStatusStarted = false;

  showExtensionNotify(message: string, type?: "info" | "warning" | "error"): void {
    if (type === "error") {
      this.showError(message);
    } else if (type === "warning") {
      this.showWarning(message);
    } else {
      this.showStatus(message);
    }
  }

  showExtensionError(extensionPath: string, error: string, stack?: string): void {
    const errorMsg = `Extension "${extensionPath}" error: ${error}`;
    const errorText = new ThemedText(() => theme.fg("error", errorMsg), 1, 0);
    this.mode.layout.chatContainer.addChild(errorText);
    if (stack !== undefined && stack !== "") {
      const stackLines = stack.split("\n").slice(1);
      if (stackLines.length > 0) {
        const renderStack = () =>
          stackLines.map((line) => theme.fg("dim", `  ${line.trim()}`)).join("\n");
        this.mode.layout.chatContainer.addChild(new ThemedText(renderStack, 1, 0));
      }
    }
    this.mode.ui.requestRender();
  }

  showStatus(message: string): void {
    const children = this.mode.layout.chatContainer.children;
    const last = children.length > 0 ? children[children.length - 1] : undefined;
    const secondLast = children.length > 1 ? children[children.length - 2] : undefined;

    if (
      last !== undefined &&
      secondLast !== undefined &&
      last === this.lastStatusText &&
      secondLast === this.lastStatusSpacer
    ) {
      this.lastStatusMessage = message;
      this.lastStatusText.invalidate();
      this.mode.ui.requestRender();
      return;
    }

    const spacer = new Spacer(1);
    this.lastStatusMessage = message;
    const text = new ThemedText(() => theme.fg("dim", this.lastStatusMessage), 1, 0);
    this.mode.layout.chatContainer.addChild(spacer);
    this.mode.layout.chatContainer.addChild(text);
    this.lastStatusSpacer = spacer;
    this.lastStatusText = text;
    this.mode.ui.requestRender();
  }

  showError(errorMessage: string): void {
    this.mode.layout.chatContainer.addChild(new Spacer(1));
    this.mode.layout.chatContainer.addChild(
      new ThemedText(
        () => theme.fg("error", `Error: ${errorMessage}`),
        this.mode.display.thinking.outputPad,
        0,
      ),
    );
    this.mode.ui.requestRender();
  }

  showWarning(warningMessage: string): void {
    this.mode.layout.chatContainer.addChild(new Spacer(1));
    this.mode.layout.chatContainer.addChild(
      new ThemedText(() => theme.fg("warning", `Warning: ${warningMessage}`), 1, 0),
    );
    this.mode.ui.requestRender();
  }

  showManagedToolStatus(status: toolsManagerTypes.ToolStatus): void {
    if (!this.managedToolStatusStarted) {
      this.mode.layout.chatContainer.addChild(new Spacer(1));
      this.managedToolStatusStarted = true;
    }
    const message = status.type === "warning" ? `Warning: ${status.message}` : status.message;
    const color = status.type === "warning" ? "warning" : "dim";
    this.mode.layout.chatContainer.addChild(new ThemedText(() => theme.fg(color, message), 1, 0));
    this.lastStatusSpacer = undefined;
    this.lastStatusText = undefined;
    this.mode.ui.requestRender();
  }
}
