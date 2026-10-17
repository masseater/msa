import type { Component } from "../tui.ts";
import { applyBackgroundToLine, flattenLines, visibleWidth, wrapTextWithAnsi } from "../utils.ts";

export class Text implements Component {
  private text: string;
  private paddingX: number;
  private paddingY: number;
  private customBgFn?: ((text: string) => string) | undefined;

  private cachedText?: string | undefined;
  private cachedWidth?: number | undefined;
  private cachedLines?: string[] | undefined;

  constructor(
    text: string = "",
    paddingX: number = 1,
    paddingY: number = 1,
    customBgFn?: (text: string) => string,
  ) {
    this.text = text;
    this.paddingX = paddingX;
    this.paddingY = paddingY;
    this.customBgFn = customBgFn;
  }

  setText(text: string): void {
    this.text = text;
    this.cachedText = undefined;
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  setCustomBgFn(customBgFn?: (text: string) => string): void {
    this.customBgFn = customBgFn;
    this.cachedText = undefined;
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  setPaddingX(paddingX: number): void {
    this.paddingX = paddingX;
    this.invalidate();
  }

  invalidate(): void {
    this.cachedText = undefined;
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  private renderContentLines(width: number): string[] {
    const normalizedText = this.text.replace(/\t/gu, "   ");

    const paddingX = Math.min(this.paddingX, Math.max(0, Math.floor((width - 1) / 2)));
    const contentWidth = Math.max(1, width - paddingX * 2);

    const margin = " ".repeat(paddingX);
    const contentLines: string[] = [];

    for (const line of wrapTextWithAnsi(normalizedText, contentWidth)) {
      const lineWithMargins = margin + line + margin;

      if (this.customBgFn === undefined) {
        const paddingNeeded = Math.max(0, width - visibleWidth(lineWithMargins));
        contentLines.push(lineWithMargins + " ".repeat(paddingNeeded));
      } else {
        contentLines.push(applyBackgroundToLine(lineWithMargins, width, this.customBgFn));
      }
    }

    return contentLines;
  }

  private renderEmptyLines(width: number): string[] {
    const emptyLine = " ".repeat(width);
    const emptyLines: string[] = [];
    for (let i = 0; i < this.paddingY; i++) {
      const line =
        this.customBgFn === undefined
          ? emptyLine
          : applyBackgroundToLine(emptyLine, width, this.customBgFn);
      emptyLines.push(line);
    }
    return emptyLines;
  }

  render(width: number): string[] {
    if (
      this.cachedLines !== undefined &&
      this.cachedText === this.text &&
      this.cachedWidth === width
    ) {
      return this.cachedLines;
    }

    if (this.text === "" || this.text.trim() === "") {
      const result: string[] = [];
      this.cachedText = this.text;
      this.cachedWidth = width;
      this.cachedLines = result;
      return result;
    }

    const contentLines = this.renderContentLines(width);
    const emptyLines = this.renderEmptyLines(width);

    const result = [...emptyLines, ...contentLines, ...emptyLines];
    flattenLines(result);

    this.cachedText = this.text;
    this.cachedWidth = width;
    this.cachedLines = result;

    return result.length > 0 ? result : [""];
  }
}
