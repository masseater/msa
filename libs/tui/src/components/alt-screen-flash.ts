import delay from "../delay.ts";
import type delayTypes from "../delay.types.ts";
import textTruncate from "../text-truncate.ts";
import type tuiComponentTypes from "../tui-component.types.ts";

const { runAfterUnref } = delay;
const { truncateToWidth } = textTruncate;

const DEFAULT_DURATION_MS = 1000;

interface FlashEntry {
  id: number;
  message: string;
  cancel: delayTypes.CancelDelay;
}

export default class AltScreenFlashContainer implements tuiComponentTypes.Component {
  private readonly entries: FlashEntry[] = [];
  private nextId = 0;
  private readonly requestRender: () => void;

  constructor(requestRender: () => void) {
    this.requestRender = requestRender;
  }

  flash(message: string, durationMs = DEFAULT_DURATION_MS): void {
    const id = this.nextId++;
    const cancel = runAfterUnref(Math.max(0, durationMs), () => {
      const index = this.entries.findIndex((entry) => entry.id === id);
      if (index === -1) return;
      this.entries.splice(index, 1);
      this.requestRender();
    });
    this.entries.push({ cancel, id, message });
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
