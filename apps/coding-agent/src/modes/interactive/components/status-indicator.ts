import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypes from "../../../core/extensions/index.types.ts";
import type statusIndicatorTypes from "./status-indicator.types.ts";
const { truncateToWidth } = tui;

export default class StatusIndicator extends tui.Loader {
  readonly kind: statusIndicatorTypes.StatusIndicatorKind;

  constructor(
    kind: statusIndicatorTypes.StatusIndicatorKind,
    ui: tuiTypes.TUI,
    spinnerColorFn: (str: string) => string,
    messageColorFn: (str: string) => string,
    message: string,
    indicator?: extensionsTypes.WorkingIndicatorOptions,
  ) {
    super(ui, spinnerColorFn, messageColorFn, message, indicator);
    this.kind = kind;
  }

  renderInBorder(width: number): string {
    const line = super.render(width + 2)[1] ?? "";
    return truncateToWidth(
      line.startsWith(" ") ? line.slice(1).trimEnd() : line.trimEnd(),
      width,
      "",
    );
  }

  renderSpinnerInBorder(width: number): string {
    return truncateToWidth(this.getRenderedIndicator(), width, "");
  }

  dispose(): void {
    this.stop();
  }
}
