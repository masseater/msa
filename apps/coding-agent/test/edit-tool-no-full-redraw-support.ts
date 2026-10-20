import testing from "@msa/testing";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import { type Edit } from "../src/core/tools/edit-diff.ts";

const { awaited, currentTimeMillis, runTest } = testing;

class FakeTerminal implements tuiTypes.Terminal {
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

function waitForRender(): Promise<void> {
  return runTest(Effect.sleep(0));
}

function waitForRenderedText(
  getRender: () => string,
  expectedText: string,
  onRetry?: () => void,
  timeoutMs = 2000,
): Promise<string> {
  return runTest(
    Effect.gen(function* () {
      const deadline = currentTimeMillis() + timeoutMs;
      let lastRender = "";
      while (currentTimeMillis() < deadline) {
        onRetry?.();
        yield* awaited(waitForRender());
        lastRender = getRender();
        if (lastRender.includes(expectedText)) {
          return yield* awaited(lastRender);
        }
      }
      throw new Error(
        `Timed out waiting for render to include "${expectedText}". Last render:\n${lastRender}`,
      );
    }),
  );
}

function createLargeEdits(lines: string[]): Edit[] {
  const targets = [50, 150, 250, 350, 450, 550, 650, 750, 850, 950];
  return targets.map((lineNumber) => ({
    newText: `${lines[lineNumber - 1]}\n${lines[lineNumber]} changed\n${lines[lineNumber + 1]}`,
    oldText: `${lines[lineNumber - 1]}\n${lines[lineNumber]}\n${lines[lineNumber + 1]}`,
  }));
}

const tempDirs: string[] = [];

const editToolNoFullRedrawSupport = {
  FakeTerminal,
  createLargeEdits,
  tempDirs,
  waitForRender,
  waitForRenderedText,
};

export default editToolNoFullRedrawSupport;
