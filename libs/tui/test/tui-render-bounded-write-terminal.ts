import { Effect } from "effect";

import type { Terminal } from "../src/terminal-protocol.ts";

class BoundedWriteTerminal implements Terminal {
  readonly writes: string[] = [];
  columns = 80;
  rows = 24;
  readonly kittyProtocolActive = false;

  start(_onInput: (data: string) => void, _onResize: () => void): void {}
  stop(): void {}
  drainInput(_maxMs?: number, _idleMs?: number): Promise<void> {
    return Effect.runPromise(Effect.sync(() => {}));
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
  setProgramStatus(): void {}
}

export default BoundedWriteTerminal;
