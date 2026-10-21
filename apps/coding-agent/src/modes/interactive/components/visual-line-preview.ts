import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import visualTruncate from "./visual-truncate.ts";
import type visualTruncateTypes from "./visual-truncate.types.ts";
const { truncateToWidth } = tui;
const { truncateToVisualLines } = visualTruncate;

export default class VisualLinePreview implements tuiTypes.Component {
  private options: visualTruncateTypes.VisualLinePreviewOptions;
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;

  constructor(options: visualTruncateTypes.VisualLinePreviewOptions) {
    this.options = options;
  }

  render(width: number): string[] {
    if (this.cachedLines === undefined || this.cachedWidth !== width) {
      const { text, maxVisualLines, keep, formatHint } = this.options;
      const preview = truncateToVisualLines(text, maxVisualLines, width, 0, keep);
      const lines = preview.visualLines;
      if (preview.skippedCount > 0) {
        const hint = truncateToWidth(formatHint(preview.skippedCount), width, "...");
        this.cachedLines = keep === "start" ? [...lines, hint] : [hint, ...lines];
      } else {
        this.cachedLines = lines;
      }
      this.cachedWidth = width;
    }
    return this.cachedLines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}
