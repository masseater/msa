import testing from "@msa/testing";
import { Effect } from "effect";

import type editDiffTypes from "../src/core/tools/edit-diff.types.ts";

const { awaited, currentTimeMillis, runTest } = testing;

function waitForRender(): Promise<void> {
  return runTest(Effect.yieldNow);
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
function createLargeEdits(lines: string[]): editDiffTypes.Edit[] {
  const targets = [50, 150, 250, 350, 450, 550, 650, 750, 850, 950];
  return targets.map((lineNumber) => ({
    newText: `${lines[lineNumber - 1]}\n${lines[lineNumber]} changed\n${lines[lineNumber + 1]}`,
    oldText: `${lines[lineNumber - 1]}\n${lines[lineNumber]}\n${lines[lineNumber + 1]}`,
  }));
}
const tempDirs: string[] = [];

const editToolNoFullRedrawSupport = {
  createLargeEdits,
  tempDirs,
  waitForRender,
  waitForRenderedText,
};

export default editToolNoFullRedrawSupport;
