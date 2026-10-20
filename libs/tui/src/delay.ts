import { Effect, Exit } from "effect";
import { dual } from "effect/Function";

import type delayTypes from "./delay.types.ts";

const runAfter: {
  (millis: number, callback: () => void): delayTypes.CancelDelay;
  (callback: () => void): (millis: number) => delayTypes.CancelDelay;
} = dual(2, (millis: number, callback: () => void): delayTypes.CancelDelay => {
  const interrupt = Effect.runCallback(Effect.sleep(millis), {
    onExit: (exit) => {
      if (Exit.isSuccess(exit)) callback();
    },
  });
  return () => interrupt();
});

const runEvery: {
  (millis: number, callback: () => void): delayTypes.CancelDelay;
  (callback: () => void): (millis: number) => delayTypes.CancelDelay;
} = dual(2, (millis: number, callback: () => void): delayTypes.CancelDelay => {
  let cancel: delayTypes.CancelDelay;
  const arm = (): void => {
    cancel = runAfter(millis, () => {
      arm();
      callback();
    });
  };
  arm();
  return () => cancel();
});

const delay = {
  runAfter,
  runEvery,
};

export default delay;
