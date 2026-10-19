import { describe, expect, test } from "vite-plus/test";

import {
  EMPTY_ENTER_BURST_COUNT,
  EMPTY_ENTER_BURST_IDLE,
  EMPTY_ENTER_BURST_WINDOW_MS,
  type EmptyEnterBurst,
  registerEmptyEnter,
} from "../src/modes/interactive/empty-enter-burst.ts";

function press(burst: EmptyEnterBurst, times: readonly number[]) {
  let current = burst;
  const fires: boolean[] = [];
  for (const at of times) {
    const result = registerEmptyEnter(current, at);
    current = result.burst;
    fires.push(result.fire);
  }
  return { burst: current, fires };
}

describe("registerEmptyEnter", () => {
  test("pins the burst to three presses within one second", () => {
    expect(EMPTY_ENTER_BURST_COUNT).toBe(3);
    expect(EMPTY_ENTER_BURST_WINDOW_MS).toBe(1000);
  });

  test("fires on the third consecutive press and not before", () => {
    const { fires } = press(EMPTY_ENTER_BURST_IDLE, [10_000, 10_100, 10_200]);

    expect(fires).toEqual([false, false, true]);
  });

  test("resets the count when the gap exceeds the window", () => {
    const { fires } = press(EMPTY_ENTER_BURST_IDLE, [
      10_000,
      10_100,
      10_100 + EMPTY_ENTER_BURST_WINDOW_MS + 1,
      10_100 + EMPTY_ENTER_BURST_WINDOW_MS + 2,
    ]);

    expect(fires).toEqual([false, false, false, false]);
  });

  test("keeps counting when each gap stays within the window even if the total span is longer", () => {
    const { fires } = press(EMPTY_ENTER_BURST_IDLE, [
      10_000,
      10_000 + EMPTY_ENTER_BURST_WINDOW_MS,
      10_000 + 2 * EMPTY_ENTER_BURST_WINDOW_MS,
    ]);

    expect(fires).toEqual([false, false, true]);
  });

  test("starts a fresh burst after firing", () => {
    const { fires } = press(
      EMPTY_ENTER_BURST_IDLE,
      [10_000, 10_100, 10_200, 10_300, 10_400, 10_500],
    );

    expect(fires).toEqual([false, false, true, false, false, true]);
  });
});
