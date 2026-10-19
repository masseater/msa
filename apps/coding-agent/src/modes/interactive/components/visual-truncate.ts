import { type Component, Text, truncateToWidth } from "@msa/tui";
import { dual } from "effect/Function";

import { theme } from "../theme/theme.ts";
import { expandHint } from "./keybinding-hints.ts";

export interface VisualTruncateResult {
  visualLines: string[];
  skippedCount: number;
}

export const truncateToVisualLines: {
  (
    maxVisualLines: number,
    width: number,
    paddingX?: number,
    keep?: "start" | "end",
  ): (text: string) => VisualTruncateResult;
  (
    text: string,
    maxVisualLines: number,
    width: number,
    paddingX?: number,
    keep?: "start" | "end",
  ): VisualTruncateResult;
} = dual(
  (args) => typeof args[0] === "string",
  (
    text: string,
    maxVisualLines: number,
    width: number,
    paddingX: number = 0,
    keep: "start" | "end" = "end",
  ): VisualTruncateResult => {
    if (text === "") {
      return { visualLines: [], skippedCount: 0 };
    }

    const tempText = new Text(text, paddingX, 0);
    const allVisualLines = tempText.render(width);

    if (allVisualLines.length <= maxVisualLines) {
      return { visualLines: allVisualLines, skippedCount: 0 };
    }

    const truncatedLines =
      keep === "start"
        ? allVisualLines.slice(0, maxVisualLines)
        : allVisualLines.slice(-maxVisualLines);
    const skippedCount = allVisualLines.length - maxVisualLines;

    return { visualLines: truncatedLines, skippedCount };
  },
);

export const collapsedOutput: {
  (pick: "first" | "last", extra?: string): (output: string) => SingleLine;
  (output: string, pick: "first" | "last", extra?: string): SingleLine;
} = dual(
  (args) => args.length > 1 && (args[1] === "first" || args[1] === "last"),
  (output: string, pick: "first" | "last", extra?: string): SingleLine => {
    const lines = output === "" ? [] : output.split("\n");
    const summary = [`${lines.length} ${lines.length === 1 ? "line" : "lines"}`, extra]
      .filter(Boolean)
      .join(", ");
    const shown =
      (pick === "last"
        ? lines.findLast((line) => line.trim())
        : lines.find((line) => line.trim())) ?? "";
    return new SingleLine(
      `${expandHint(summary)}${shown === "" ? "" : `  ${theme.fg("toolOutput", shown.trim())}`}`,
    );
  },
);

export class SingleLine implements Component {
  private text: string;

  constructor(text: string) {
    this.text = text;
  }

  render(width: number): string[] {
    return [truncateToWidth(this.text, width, "...")];
  }

  invalidate(): void {}
}

export interface VisualLinePreviewOptions {
  text: string;
  maxVisualLines: number;
  keep: "start" | "end";
  formatHint: (hidden: number) => string;
}

export class VisualLinePreview implements Component {
  private options: VisualLinePreviewOptions;
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;

  constructor(options: VisualLinePreviewOptions) {
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
