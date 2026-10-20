import crashLog from "../../core/crash-log.ts";
import type extensionsTypes from "../../core/extensions/index.types.ts";
import type truncateTypes from "../../core/tools/truncate.types.ts";
import AssistantMessageComponent from "./components/assistant-message.ts";
import BashExecutionComponent from "./components/bash-execution.ts";
import UserMessageComponent from "./components/user-message.ts";
import type interactiveModeInternalTypes from "./interactive-mode-internal.types.ts";
import InteractiveModeLayer5 from "./interactive-mode-layer-5.ts";
import interactiveModeSupport from "./interactive-mode-support.ts";
import Theme from "./theme/theme-class.ts";

const { formatCrashExtensionHint, quoteIfNeeded } = interactiveModeSupport;
const { findExtensionStackMatches, recordCrash } = crashLog;

export default abstract class InteractiveModeLayer6 extends InteractiveModeLayer5 {
  protected getCrashExtensionHint(error: unknown): string | undefined {
    try {
      return formatCrashExtensionHint(
        findExtensionStackMatches(
          error instanceof Error ? error.stack : undefined,
          this.session.resourceLoader.getExtensions().extensions,
        ),
      );
    } catch {
      return undefined;
    }
  }

  protected recordCrash(kind: "uncaught_exception" | "fatal_error", error: unknown): boolean {
    try {
      return (
        recordCrash({
          cwd: this.session.sessionManager.getCwd(),
          error,
          kind,
          sessionFile: this.session.sessionFile,
        }) !== undefined
      );
    } catch {
      return false;
    }
  }

  protected setHiddenThinkingLabel(label?: string): void {
    this.hiddenThinkingLabel = label ?? this.defaultHiddenThinkingLabel;
    for (const child of this.chatComponents()) {
      if (child instanceof AssistantMessageComponent) {
        child.setHiddenThinkingLabel(this.hiddenThinkingLabel);
      }
    }
    if (this.streamingComponent !== undefined) {
      this.streamingComponent.setHiddenThinkingLabel(this.hiddenThinkingLabel);
    }
    this.ui.requestRender();
  }

  protected setThemeFromExtension(
    themeOrName: Parameters<extensionsTypes.ExtensionUIContext["setTheme"]>[0],
  ): ReturnType<extensionsTypes.ExtensionUIContext["setTheme"]> {
    if (themeOrName instanceof Theme) return this.themeController.setThemeInstance(themeOrName);
    const result = this.themeController.setThemeName(themeOrName);
    if (result.success && this.settingsManager.getTheme() !== themeOrName)
      this.settingsManager.setTheme(themeOrName);
    return result;
  }

  protected mountExtensionCustom(
    component: interactiveModeInternalTypes.CustomComponent,
    options: interactiveModeInternalTypes.ExtensionCustomOptions | undefined,
  ): void {
    if (options?.overlay !== true) {
      this.editorSlot.disposeActiveSelector();
      this.editorSlot.show(component);
      return;
    }
    const overlayOptions = options.overlayOptions;
    const width = (component as { width?: number }).width;
    const resolved =
      overlayOptions === undefined
        ? width !== undefined && width !== 0
          ? { width }
          : undefined
        : typeof overlayOptions === "function"
          ? overlayOptions()
          : overlayOptions;
    const handle = this.ui.showOverlay(component, resolved);
    options.onHandle?.(handle);
  }

  protected insertClipboardFilePaths(filePaths: string[]): void {
    if (filePaths.some((filePath) => /\p{Cc}/u.test(filePath)))
      throw new Error("Clipboard file path contains control characters");
    const paths = this.isBashMode ? filePaths.map(quoteIfNeeded).join(" ") : filePaths.join("\n");
    const cursor = this.editor.getCursor?.();
    const currentLine =
      cursor === undefined ? "" : (this.editor.getText().split("\n")[cursor.line] ?? "");
    const before = cursor !== undefined && cursor.col > 0 ? currentLine[cursor.col - 1] : "";
    const after = cursor === undefined ? "" : currentLine[cursor.col];
    const needsSpace = (character: string | undefined) =>
      character !== undefined && character !== "" && !/\s/u.test(character);
    const leadingSpace = needsSpace(before) ? " " : "";
    const trailingSpace = needsSpace(after) ? " " : "";
    this.editor.insertTextAtCursor?.(`${leadingSpace}${paths}${trailingSpace}`);
    this.ui.requestRender();
  }

  protected addUserComponent(text: string): void {
    this.chatContainer.addChild(
      new UserMessageComponent(
        text,
        this.getMarkdownThemeWithSettings(),
        this.outputPad,
        this.getMarkdownTransformers(),
      ),
    );
  }

  protected updateThinkingBlockVisibility(): void {
    for (const child of this.chatComponents()) {
      if (child instanceof AssistantMessageComponent) {
        child.setHideThinkingBlock(this.hideThinkingBlock);
      }
    }
    this.ui.requestRender();
  }

  protected toggleThinkingBlockVisibility(): void {
    this.hideThinkingBlock = !this.hideThinkingBlock;
    this.settingsManager.setHideThinkingBlock(this.hideThinkingBlock);
    this.updateThinkingBlockVisibility();
    this.showStatus(`Thinking blocks: ${this.hideThinkingBlock ? "hidden" : "visible"}`);
  }

  protected persistScopedModels(
    state: interactiveModeInternalTypes.ScopedModelsState,
    enabledIds: string[] | null,
  ): void {
    const allEnabled =
      enabledIds !== null &&
      enabledIds.length === state.availableModels.length &&
      enabledIds.every((id) => state.availableModelIds.has(id));
    const newPatterns = enabledIds === null || allEnabled ? undefined : enabledIds;
    this.settingsManager.setEnabledModels(newPatterns === undefined ? undefined : [...newPatterns]);
    this.showStatus("Model selection saved to settings");
  }

  protected mountBashComponent(command: string, excludeFromContext: boolean): void {
    this.bashComponent = new BashExecutionComponent(
      command,
      this.ui,
      excludeFromContext,
      this.outputPad,
    );
    if (this.session.isStreaming) {
      this.pendingMessagesContainer.addChild(this.bashComponent);
      this.pendingBashComponents.push(this.bashComponent);
    } else this.chatContainer.addChild(this.bashComponent);
  }

  protected completeBashComponent(result: {
    exitCode: number | undefined;
    cancelled: boolean;
    truncated: boolean;
    output: string;
    fullOutputPath?: string | undefined;
  }): void {
    this.bashComponent?.setComplete(
      result.exitCode,
      result.cancelled,
      result.truncated
        ? ({ content: result.output, truncated: true } as truncateTypes.TruncationResult)
        : undefined,
      result.fullOutputPath,
    );
  }

  protected showExtensionBashResult(
    command: string,
    result: NonNullable<extensionsTypes.UserBashEventResult["result"]>,
    excludeFromContext: boolean,
  ): void {
    this.mountBashComponent(command, excludeFromContext);
    if (result.output !== "") this.bashComponent?.appendOutput(result.output);
    this.completeBashComponent(result);
    this.session.context.bash.recordBashResult(command, result, { excludeFromContext });
    this.bashComponent = undefined;
    this.ui.requestRender();
  }
}
