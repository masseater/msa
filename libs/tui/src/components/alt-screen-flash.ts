import { type CancelDelay, runAfter } from "../delay.ts";
import { truncateToWidth } from "../text-truncate.ts";
import type { Component } from "../tui-component.ts";

const DEFAULT_DURATION_MS = 1000;

interface FlashEntry {
  id: number;
  message: string;
  cancel: CancelDelay;
}

export class AltScreenFlashContainer implements Component {
  private readonly entries: FlashEntry[] = [];
  private nextId = 0;
  private readonly requestRender: () => void;

  constructor(requestRender: () => void) {
    this.requestRender = requestRender;
  }

  flash(message: string, durationMs = DEFAULT_DURATION_MS): void {
    const id = this.nextId++;
    const cancel = runAfter(Math.max(0, durationMs), () => {
      const index = this.entries.findIndex((entry) => entry.id === id);
      if (index === -1) return;
      this.entries.splice(index, 1);
      this.requestRender();
    });
    this.entries.push({ id, message, cancel });
    this.requestRender();
  }

  dispose(): void {
    for (const entry of this.entries) entry.cancel();
    this.entries.length = 0;
  }

  invalidate(): void {}

  render(width: number): string[] {
    return this.entries.map((entry) => {
      const message = truncateToWidth(` ${entry.message} `, width, "");
      return `\x1b[7m${message}\x1b[27m`;
    });
  }
}
