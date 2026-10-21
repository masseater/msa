import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type keybindingsTypes from "../../../core/keybindings.types.ts";
import type customEditorTypes from "./custom-editor.types.ts";
import type statusIndicatorTypes from "./status-indicator.types.ts";

const { visibleWidth } = tuiModule;

export default class CustomEditor extends tuiModule.Editor {
  private keybindings: keybindingsTypes.KeybindingsManager;
  private workingStatusIndicator: statusIndicatorTypes.StatusIndicator | undefined;
  public readonly embedWorkingStatus: boolean;
  public actionHandlers: Map<keybindingsTypes.AppKeybinding, () => void> = new Map();

  public onEscape?: (() => void) | undefined;
  public onCtrlD?: () => void;
  public onPasteImage?: () => void;
  public onExtensionShortcut?: ((data: string) => boolean) | undefined;

  constructor(
    tui: tuiTypes.TUI,
    theme: tuiTypes.EditorTheme,
    keybindings: keybindingsTypes.KeybindingsManager,
    options?: customEditorTypes.CustomEditorOptions,
  ) {
    super(tui, theme, options);
    this.keybindings = keybindings;
    this.embedWorkingStatus = options?.embedWorkingStatus ?? false;
  }

  setWorkingStatusIndicator(indicator: statusIndicatorTypes.StatusIndicator | undefined): void {
    this.workingStatusIndicator = indicator;
  }

  protected override renderTopBorder(width: number, hiddenLineCount: number): string {
    if (!this.embedWorkingStatus || this.workingStatusIndicator === undefined || width <= 0) {
      return super.renderTopBorder(width, hiddenLineCount);
    }

    let status = this.workingStatusIndicator.renderInBorder(Math.max(1, width - 5));
    let statusWidth = visibleWidth(status);
    if (statusWidth === 0) return super.renderTopBorder(width, hiddenLineCount);

    const overflowLabel = hiddenLineCount > 0 ? ` ↑ ${hiddenLineCount} more ` : undefined;
    const overflowLabelWidth =
      overflowLabel !== undefined && overflowLabel !== "" ? visibleWidth(overflowLabel) : 0;
    const overflowStart = Math.floor((width - overflowLabelWidth) / 2);
    const canFitOverflow = () =>
      overflowLabel !== undefined &&
      overflowLabelWidth + 2 <= width &&
      overflowStart - (3 + statusWidth + 1) >= 1;

    if (overflowLabel !== undefined && overflowLabel !== "" && !canFitOverflow()) {
      status = this.workingStatusIndicator.renderSpinnerInBorder(width);
      statusWidth = visibleWidth(status);
    }

    if (canFitOverflow()) {
      const leftBlockWidth = 3 + statusWidth + 1;
      return (
        this.borderColor("── ") +
        status +
        this.borderColor(
          ` ${"─".repeat(overflowStart - leftBlockWidth)}${overflowLabel}${"─".repeat(width - overflowStart - overflowLabelWidth)}`,
        )
      );
    }

    if (width >= statusWidth + 5) {
      return (
        this.borderColor("── ") +
        status +
        this.borderColor(` ${"─".repeat(width - statusWidth - 4)}`)
      );
    }

    status = this.workingStatusIndicator.renderSpinnerInBorder(width);
    statusWidth = visibleWidth(status);
    return this.borderWithStatus(width, statusWidth, status);
  }

  private borderWithStatus(width: number, statusWidth: number, status: string) {
    const prefixWidth = Math.min(3, Math.max(0, width - statusWidth));
    return (
      this.borderColor("─".repeat(prefixWidth)) +
      status +
      this.borderColor("─".repeat(Math.max(0, width - prefixWidth - statusWidth)))
    );
  }

  onAction(action: keybindingsTypes.AppKeybinding, handler: () => void): void {
    this.actionHandlers.set(action, handler);
  }

  override handleInput(data: string): void {
    if (this.handleEditorShortcut(data)) return;
    const handler = this.isHistoryKey(data) ? undefined : this.registeredActionFor(data);
    if (handler === undefined) super.handleInput(data);
    else handler();
  }

  private handleEditorShortcut(data: string): boolean {
    if (this.onExtensionShortcut?.(data) === true) return true;
    if (this.keybindings.matches(data, "app.clipboard.pasteImage")) {
      this.onPasteImage?.();
      return true;
    }
    if (this.keybindings.matches(data, "app.interrupt")) {
      const handler = this.isShowingAutocomplete()
        ? undefined
        : (this.onEscape ?? this.actionHandlers.get("app.interrupt"));
      if (handler === undefined) super.handleInput(data);
      else handler();
      return true;
    }
    if (this.keybindings.matches(data, "app.exit") && this.getText().length === 0) {
      (this.onCtrlD ?? this.actionHandlers.get("app.exit"))?.();
      return true;
    }
    return false;
  }

  private isHistoryKey(data: string): boolean {
    return (
      this.keybindings.matches(data, "tui.editor.historyPrevious") ||
      this.keybindings.matches(data, "tui.editor.historyNext")
    );
  }

  private registeredActionFor(data: string): (() => void) | undefined {
    for (const [action, handler] of this.actionHandlers) {
      if (action === "app.interrupt" || action === "app.exit") continue;
      if (this.keybindings.matches(data, action)) return handler;
    }
    return undefined;
  }
}
