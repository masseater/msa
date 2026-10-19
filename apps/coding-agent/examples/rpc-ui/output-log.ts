import type { Component } from "@msa/tui";

export class OutputLog implements Component {
  private lines: string[] = [];
  private maxLines = 1000;
  private visibleLines = 0;

  setVisibleLines(n: number): void {
    this.visibleLines = n;
  }

  append(line: string): void {
    this.lines.push(line);
    if (this.lines.length > this.maxLines) {
      this.lines = this.lines.slice(-this.maxLines);
    }
  }

  appendRaw(text: string): void {
    if (this.lines.length === 0) {
      this.lines.push(text);
      return;
    }
    this.lines[this.lines.length - 1] += text;
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (this.lines.length === 0) return [""];
    const n = this.visibleLines > 0 ? this.visibleLines : this.lines.length;
    return this.lines.slice(-n).map((l) => l.slice(0, width));
  }
}
