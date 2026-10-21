import { describe, expect, test } from "vite-plus/test";

import emptyEnterBurst from "../src/modes/interactive/empty-enter-burst.ts";
import type emptyEnterBurstTypes from "../src/modes/interactive/empty-enter-burst.types.ts";

const {
  EMPTY_ENTER_BURST_COUNT,
  EMPTY_ENTER_BURST_IDLE,
  EMPTY_ENTER_BURST_WINDOW_MS,
  registerEmptyEnter,
} = emptyEnterBurst;

function press(burst: emptyEnterBurstTypes.EmptyEnterBurst, times: readonly number[]) {
  let current = burst;
  const fires: boolean[] = [];
  for (const at of times) {
    const result = registerEmptyEnter(current, at);
    current = result.burst;
    fires.push(result.fire);
  }
  return { burst: current, fires };
}

const pinsTheBurstToThreePressesWithin = () => {
  expect(EMPTY_ENTER_BURST_COUNT).toBe(3);
  expect(EMPTY_ENTER_BURST_WINDOW_MS).toBe(1000);
};

const firesOnTheThirdConsecutivePressAnd = () => {
  const { fires } = press(EMPTY_ENTER_BURST_IDLE, [10_000, 10_100, 10_200]);

  expect(fires).toEqual([false, false, true]);
};

const resetsTheCountWhenTheGapExceeds = () => {
  const { fires } = press(EMPTY_ENTER_BURST_IDLE, [
    10_000,
    10_100,
    10_100 + EMPTY_ENTER_BURST_WINDOW_MS + 1,
    10_100 + EMPTY_ENTER_BURST_WINDOW_MS + 2,
  ]);

  expect(fires).toEqual([false, false, false, false]);
};

const keepsCountingWhenEachGapStaysWithin = () => {
  const { fires } = press(EMPTY_ENTER_BURST_IDLE, [
    10_000,
    10_000 + EMPTY_ENTER_BURST_WINDOW_MS,
    10_000 + 2 * EMPTY_ENTER_BURST_WINDOW_MS,
  ]);

  expect(fires).toEqual([false, false, true]);
};

const startsAFreshBurstAfterFiring = () => {
  const { fires } = press(EMPTY_ENTER_BURST_IDLE, [10_000, 10_100, 10_200, 10_300, 10_400, 10_500]);

  expect(fires).toEqual([false, false, true, false, false, true]);
};

describe("registerEmptyEnter", () => {
  test("pins the burst to three presses within one second", pinsTheBurstToThreePressesWithin);

  test("fires on the third consecutive press and not before", firesOnTheThirdConsecutivePressAnd);

  test("resets the count when the gap exceeds the window", resetsTheCountWhenTheGapExceeds);

  test(
    "keeps counting when each gap stays within the window even if the total span is longer",
    keepsCountingWhenEachGapStaysWithin,
  );

  test("starts a fresh burst after firing", startsAFreshBurstAfterFiring);
});
