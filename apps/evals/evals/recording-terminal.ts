import { stripVTControlCharacters } from "node:util";

import type { ProgramStatus } from "@msa/tui";
import { Effect } from "effect";

export class RecordingTerminal {
  readonly columns = 100;
  readonly rows = 30;
  readonly kittyProtocolActive = true;
  private writes: string[] = [];
  private resizeHandler: (() => void) | undefined;

  start(_onInput: (data: string) => void, onResize: () => void): void {
    this.resizeHandler = onResize;
  }

  stop(): void {
    this.resizeHandler = undefined;
  }

  drainInput(_maxMs?: number, _idleMs?: number): Promise<void> {
    return Promise.resolve();
  }

  write(data: string): void {
    this.writes.push(data);
  }

  moveBy(_lines: number): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(_title: string): void {}
  setProgress(_active: boolean): void {}
  setProgramStatus(_status: ProgramStatus): void {}

  requestResize(): void {
    this.resizeHandler?.();
  }

  takeRenders(): Effect.Effect<string[]> {
    return Effect.sleep("30 millis").pipe(Effect.map(() => this.collectRenders()));
  }

  private collectRenders(): string[] {
    const output = this.writes.join("");
    this.writes = [];
    const startMarker = "\x1b[?2026h";
    const endMarker = "\x1b[?2026l";
    const renders: string[] = [];
    let offset = 0;
    while (true) {
      const start = output.indexOf(startMarker, offset);
      if (start === -1) return renders;
      const contentStart = start + startMarker.length;
      const end = output.indexOf(endMarker, contentStart);
      if (end === -1) throw new Error("TUI emitted an incomplete synchronized render.");
      renders.push(stripVTControlCharacters(output.slice(contentStart, end)));
      offset = end + endMarker.length;
    }
  }
}
