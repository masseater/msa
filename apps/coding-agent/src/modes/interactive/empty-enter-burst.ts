import type emptyEnterBurstTypes from "./empty-enter-burst.types.ts";

const EMPTY_ENTER_BURST_COUNT = 3;
const EMPTY_ENTER_BURST_WINDOW_MS = 1000;

const EMPTY_ENTER_BURST_IDLE: emptyEnterBurstTypes.EmptyEnterBurst = { count: 0, lastAt: 0 };

function registerEmptyEnter(
  burst: emptyEnterBurstTypes.EmptyEnterBurst,
  now: number,
): { readonly burst: emptyEnterBurstTypes.EmptyEnterBurst; readonly fire: boolean } {
  const continuing = burst.count > 0 && now - burst.lastAt <= EMPTY_ENTER_BURST_WINDOW_MS;
  const count = continuing ? burst.count + 1 : 1;
  if (count >= EMPTY_ENTER_BURST_COUNT) {
    return { burst: EMPTY_ENTER_BURST_IDLE, fire: true };
  }
  return { burst: { count, lastAt: now }, fire: false };
}

const emptyEnterBurst = {
  EMPTY_ENTER_BURST_COUNT,
  EMPTY_ENTER_BURST_IDLE,
  EMPTY_ENTER_BURST_WINDOW_MS,
  registerEmptyEnter,
};

export default emptyEnterBurst;
