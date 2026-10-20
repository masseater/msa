import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import interval from "../interval.ts";
import CustomEditor from "./components/custom-editor.ts";
import EarendilAnnouncementComponent from "./components/earendil-announcement.ts";
import ThemedText from "./components/themed-text.ts";
import ToolGroupComponent from "./components/tool-group.ts";
import interactiveModeHelpers from "./interactive-mode-helpers.ts";
import InteractiveModeLayer4 from "./interactive-mode-layer-4.ts";
import themeModule from "./theme/theme.ts";

const { Container, Spacer } = tuiModule;
const { getEditorTheme, getMarkdownTheme, theme } = themeModule;
const { every } = interval;
const { isEmbeddedStatus } = interactiveModeHelpers;

export default abstract class InteractiveModeLayer5 extends InteractiveModeLayer4 {
  protected createDocumentContainer(): tuiTypes.Container {
    const container = new Container();
    container.addChild(this.headerContainer);
    container.addChild(this.loadedResourcesContainer);
    container.addChild(this.chatContainer);
    return container;
  }

  protected createDefaultEditor() {
    return new CustomEditor(this.ui, getEditorTheme(), this.keybindings, {
      autocompleteMaxVisible: this.settingsManager.getAutocompleteMaxVisible(),
      embedWorkingStatus: true,
      paddingX: this.settingsManager.getEditorPaddingX(),
    });
  }

  protected mountInteractiveTui(
    tui: tuiTypes.TuiMainScreen | tuiTypes.TuiAltScreen,
    components: readonly tuiTypes.Component[],
  ): void {
    for (const component of components) tui.addChild(component);
    if (tuiModule.isViewportTUI(tui)) {
      if (this.fullscreenLayoutRoot === undefined)
        throw new Error("Fullscreen layout is not initialized");
      tui.setLayoutRoot(this.fullscreenLayoutRoot);
    }
  }

  protected getMarkdownThemeWithSettings(): tuiTypes.MarkdownTheme {
    return {
      ...getMarkdownTheme(),
      codeBlockIndent: this.settingsManager.getCodeBlockIndent(),
    };
  }

  protected setCustomEditorComponentPart2(
    customEditor: Record<string, unknown>,
    newEditor: tuiTypes.EditorComponent,
  ): void {
    if ("actionHandlers" in customEditor && customEditor["actionHandlers"] instanceof Map) {
      if (customEditor["onEscape"] === undefined) {
        customEditor["onEscape"] = () => this.defaultEditor.onEscape?.();
      }
      if (customEditor["onCtrlD"] === undefined) {
        customEditor["onCtrlD"] = () => this.defaultEditor.onCtrlD?.();
      }
      if (customEditor["onPasteImage"] === undefined) {
        customEditor["onPasteImage"] = () => this.defaultEditor.onPasteImage?.();
      }
      if (customEditor["onExtensionShortcut"] === undefined) {
        customEditor["onExtensionShortcut"] = (data: string) =>
          this.defaultEditor.onExtensionShortcut?.(data);
      }
      for (const [action, handler] of this.defaultEditor.actionHandlers) {
        (customEditor["actionHandlers"] as Map<string, () => void>).set(action, handler);
      }
    }

    this.editor = newEditor;
  }

  protected showExtensionNotify(message: string, type?: "info" | "warning" | "error"): void {
    if (type === "error") {
      this.showError(message);
    } else if (type === "warning") {
      this.showWarning(message);
    } else {
      this.showStatus(message);
    }
  }

  protected showExtensionError(extensionPath: string, error: string, stack?: string): void {
    const errorMsg = `Extension "${extensionPath}" error: ${error}`;
    const errorText = new ThemedText(() => theme.fg("error", errorMsg), 1, 0);
    this.chatContainer.addChild(errorText);
    if (stack !== undefined && stack !== "") {
      const stackLines = stack.split("\n").slice(1);
      if (stackLines.length > 0) {
        const renderStack = () =>
          stackLines.map((line) => theme.fg("dim", `  ${line.trim()}`)).join("\n");
        this.chatContainer.addChild(new ThemedText(renderStack, 1, 0));
      }
    }
    this.ui.requestRender();
  }

  protected handleStartupSubmit(text: string): void {
    this.editor.setText(text);
    this.showStatus("Startup is still in progress");
  }

  protected compactionStatusColor(): ((text: string) => string) | undefined {
    if (!isEmbeddedStatus(this.editor)) return undefined;
    return (text: string) =>
      (
        this.editor.borderColor ?? theme.getThinkingBorderColor(this.session.thinkingLevel || "off")
      )(text);
  }

  protected addMutedLines(render: () => string): void {
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new ThemedText(render, this.outputPad, 0));
    this.ui.requestRender();
  }

  protected updateGoalTicker(): void {
    if (this.session.goal !== undefined) {
      this.goalTicker ??= every(() => this.ui.requestRender(), 1000);
    } else if (this.goalTicker !== undefined) {
      this.goalTicker.cancel();
      this.goalTicker = undefined;
    }
  }

  protected showStatus(message: string): void {
    const children = this.chatContainer.children;
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
      this.ui.requestRender();
      return;
    }

    const spacer = new Spacer(1);
    this.lastStatusMessage = message;
    const text = new ThemedText(() => theme.fg("dim", this.lastStatusMessage), 1, 0);
    this.chatContainer.addChild(spacer);
    this.chatContainer.addChild(text);
    this.lastStatusSpacer = spacer;
    this.lastStatusText = text;
    this.ui.requestRender();
  }

  protected *chatComponents(): Generator<tuiTypes.Component> {
    for (const child of this.chatContainer.children) {
      yield child;
      if (child instanceof ToolGroupComponent) yield* child.items.children;
    }
  }

  protected addSummaryToChat(
    component: { setExpanded(expanded: boolean): void } & tuiTypes.Component,
  ): void {
    this.chatContainer.addChild(new Spacer(1));
    component.setExpanded(this.toolOutputExpanded);
    this.chatContainer.addChild(component);
  }

  protected updateEditorBorderColor(): void {
    if (this.isBashMode) {
      this.editor.borderColor = theme.getBashModeBorderColor();
    } else {
      const level = this.session.thinkingLevel || "off";
      this.editor.borderColor = theme.getThinkingBorderColor(level);
    }
    this.activeStatusIndicator?.invalidate();
    this.ui.requestRender();
  }

  protected cycleThinkingLevel(): void {
    const newLevel = this.session.cycleThinkingLevel();
    if (newLevel === undefined) {
      this.showStatus("Current model does not support thinking");
    } else {
      this.footer.invalidate();
      this.updateEditorBorderColor();
      this.showStatus(`Thinking level: ${newLevel}`);
    }
  }

  showError(errorMessage: string): void {
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new ThemedText(() => theme.fg("error", `Error: ${errorMessage}`), this.outputPad, 0),
    );
    this.ui.requestRender();
  }

  showWarning(warningMessage: string): void {
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new ThemedText(() => theme.fg("warning", `Warning: ${warningMessage}`), 1, 0),
    );
    this.ui.requestRender();
  }

  protected handleNameCommand(text: string): void {
    const name = text.replace(/^\/rename\s*/u, "").trim();
    if (name === "") {
      const currentName = this.sessionManager.getSessionName();
      if (currentName !== undefined && currentName !== "") {
        this.chatContainer.addChild(new Spacer(1));
        this.chatContainer.addChild(
          new ThemedText(() => theme.fg("dim", `Session name: ${currentName}`), 1, 0),
        );
      } else {
        this.showWarning("Usage: /rename <name>");
      }
      this.ui.requestRender();
      return;
    }

    this.session.setSessionName(name);
    const sessionName = this.sessionManager.getSessionName();
    if (sessionName !== name) {
      this.showWarning(
        `Session name was normalized from ${JSON.stringify(name)} to ${JSON.stringify(sessionName)}`,
      );
    }
    this.chatContainer.addChild(new Spacer(1));
    const displayName = sessionName ?? name;
    this.chatContainer.addChild(
      new ThemedText(() => theme.fg("dim", `Session name set: ${displayName}`), 1, 0),
    );
    this.ui.requestRender();
  }

  protected handleDementedDelves(): void {
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new EarendilAnnouncementComponent());
    this.ui.requestRender();
  }
}
