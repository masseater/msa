import { Effect, Function } from "effect";

import type dualTypes from "../../dual.ts";
import type nodeTimerTypes from "./node-timer.types.ts";

const startTimer: dualTypes.Dual2<number, () => void, nodeTimerTypes.Timer> = Function.dual(
  2,
  (delayMs: number, run: () => void): nodeTimerTypes.Timer =>
    Effect.runFork(Effect.andThen(Effect.sleep(delayMs), Effect.sync(run))),
);

const cancelTimer = (timer: nodeTimerTypes.Timer | undefined): void => {
  timer?.interruptUnsafe();
};

const nodeTimer = {
  cancelTimer,
  startTimer,
};

export default nodeTimer;
