import { Effect, type Fiber, Function } from "effect";

import type { Dual2 } from "../dual.ts";

export type Timer = Fiber.Fiber<void>;

export const startTimer: Dual2<number, () => void, Timer> = Function.dual(
  2,
  (delayMs: number, run: () => void): Timer =>
    Effect.runFork(Effect.andThen(Effect.sleep(delayMs), Effect.sync(run))),
);

export const cancelTimer = (timer: Timer | undefined): void => {
  timer?.interruptUnsafe();
};
