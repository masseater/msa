import type { Component } from "../src/tui.ts";

export class StaticOverlay implements Component {
  private lines: string[];
  requestedWidth?: number | undefined;

  constructor(lines: string[], requestedWidth?: number) {
    this.lines = lines;
    this.requestedWidth = requestedWidth;
  }

  render(width: number): string[] {
    // Store the width we were asked to render at for verification
    this.requestedWidth = width;
    return this.lines;
  }

  invalidate(): void {}
}
