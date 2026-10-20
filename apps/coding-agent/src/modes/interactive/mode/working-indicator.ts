import type extensionsTypes from "../../../core/extensions/index.types.ts";
import type statusIndicatorTypes from "../components/status-indicator.types.ts";
import statusIndicators from "../components/status-indicators.ts";
import interactiveModeHelpers from "../interactive-mode-helpers.ts";
import type InteractiveMode from "../interactive-mode.ts";
import themeModule from "../theme/theme.ts";

const { IdleStatus, WorkingStatusIndicator } = statusIndicators;
const { theme } = themeModule;
const { isEmbeddedStatus } = interactiveModeHelpers;

export default class WorkingIndicator {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  activeStatusIndicator: statusIndicatorTypes.StatusIndicator | undefined = undefined;

  activeWorkingIndicatorEmbedded = false;

  private readonly idleStatus = new IdleStatus();

  workingMessage: string | undefined = undefined;

  workingVisible = true;

  private workingIndicatorOptions: extensionsTypes.WorkingIndicatorOptions | undefined = undefined;

  readonly defaultWorkingMessage = "Working";

  setWorkingIndicator(options?: extensionsTypes.WorkingIndicatorOptions): void {
    this.workingIndicatorOptions = options;
    if (this.activeStatusIndicator?.kind === "working") {
      this.activeStatusIndicator.setIndicator(options);
    }
    this.mode.ui.requestRender();
  }

  setWorkingMessageFromExtension(message: string | undefined): void {
    this.workingMessage = message;
    if (this.activeStatusIndicator?.kind === "working")
      this.activeStatusIndicator.setMessage(message ?? this.defaultWorkingMessage);
  }

  compactionStatusColor(): ((text: string) => string) | undefined {
    if (!isEmbeddedStatus(this.mode.editor)) return undefined;
    return (text: string) =>
      (
        this.mode.editor.borderColor ??
        theme.getThinkingBorderColor(this.mode.session.thinkingLevel || "off")
      )(text);
  }

  setEditorWorkingStatusIndicator(
    indicator: statusIndicatorTypes.StatusIndicator | undefined,
  ): boolean {
    this.mode.defaultEditor.setWorkingStatusIndicator(undefined);
    if (!isEmbeddedStatus(this.mode.editor)) return false;
    this.mode.editor.setWorkingStatusIndicator(indicator);
    return true;
  }

  showStatusIndicator(indicator: statusIndicatorTypes.StatusIndicator): void {
    this.activeStatusIndicator?.dispose();
    this.activeStatusIndicator = indicator;
    this.activeWorkingIndicatorEmbedded = false;
    this.mode.layout.statusContainer.clear();
    this.setEditorWorkingStatusIndicator(undefined);
    if (this.setEditorWorkingStatusIndicator(indicator)) {
      this.activeWorkingIndicatorEmbedded = true;
      return;
    }
    this.mode.layout.statusContainer.addChild(indicator);
  }

  clearStatusIndicator(kind?: statusIndicatorTypes.StatusIndicator["kind"]): void {
    if (kind !== undefined && this.activeStatusIndicator?.kind !== kind) {
      return;
    }
    const clearedIndicator = this.activeStatusIndicator;
    const clearedIndicatorWasEmbedded = this.activeWorkingIndicatorEmbedded;
    clearedIndicator?.dispose();
    this.activeStatusIndicator = undefined;
    this.activeWorkingIndicatorEmbedded = false;
    this.mode.layout.statusContainer.clear();
    this.setEditorWorkingStatusIndicator(undefined);
    if (
      clearedIndicator !== undefined &&
      !clearedIndicatorWasEmbedded &&
      this.mode.options.tuiMode === "regular" &&
      this.mode.ui.getClearOnShrink()
    ) {
      this.mode.layout.statusContainer.addChild(this.idleStatus);
    }
  }

  showWorkingStatusIndicator(): void {
    const colorFn = isEmbeddedStatus(this.mode.editor)
      ? (text: string) =>
          (
            this.mode.editor.borderColor ??
            theme.getThinkingBorderColor(this.mode.session.thinkingLevel || "off")
          )(text)
      : undefined;
    this.showStatusIndicator(
      new WorkingStatusIndicator(
        this.mode.ui,
        this.workingMessage ?? this.defaultWorkingMessage,
        this.workingIndicatorOptions,
        colorFn,
      ),
    );
  }

  setWorkingVisible(visible: boolean): void {
    this.workingVisible = visible;
    if (!visible) {
      this.clearStatusIndicator("working");
      this.mode.ui.requestRender();
      return;
    }
    if (this.mode.session.isStreaming && this.activeStatusIndicator?.kind !== "working") {
      this.showWorkingStatusIndicator();
    }
    this.mode.ui.requestRender();
  }
}
