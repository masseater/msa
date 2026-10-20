import testing from "@msa/testing";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

const { runTest } = testing;

export default class FakeTerminal implements tuiTypes.Terminal {
  columns = 80;
  rows = 24;
  kittyProtocolActive = true;
  writes: string[] = [];

  start(): void {}
  stop(): void {}
  drainInput(): Promise<void> {
    return runTest(Effect.sync(() => {}));
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

  get fullClearCount(): number {
    return this.writes.filter((write) => write.includes("\x1b[2J\x1b[H\x1b[3J")).length;
  }
}
