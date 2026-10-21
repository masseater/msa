import sleepModule from "@msa/chord/sleep";
import { Effect, Exit } from "effect";
import { dual } from "effect/Function";

import type delayTypes from "./delay.types.ts";

const { unrefSleep } = sleepModule;

const after = (sleep: Effect.Effect<void>, callback: () => void): delayTypes.CancelDelay => {
  const interrupt = Effect.runCallback(sleep, {
    onExit: (exit) => {
      if (Exit.isSuccess(exit)) callback();
    },
  });
  return () => interrupt();
};

const every = (sleep: Effect.Effect<void>, callback: () => void): delayTypes.CancelDelay => {
  let cancel: delayTypes.CancelDelay;
  const arm = (): void => {
    cancel = after(sleep, () => {
      arm();
      callback();
    });
  };
  arm();
  return () => cancel();
};

const runAfter: {
  (millis: number, callback: () => void): delayTypes.CancelDelay;
  (callback: () => void): (millis: number) => delayTypes.CancelDelay;
} = dual(2, (millis: number, callback: () => void): delayTypes.CancelDelay =>
  after(Effect.sleep(millis), callback),
);

const runEvery: {
  (millis: number, callback: () => void): delayTypes.CancelDelay;
  (callback: () => void): (millis: number) => delayTypes.CancelDelay;
} = dual(2, (millis: number, callback: () => void): delayTypes.CancelDelay =>
  every(Effect.sleep(millis), callback),
);

const runAfterUnref: {
  (millis: number, callback: () => void): delayTypes.CancelDelay;
  (callback: () => void): (millis: number) => delayTypes.CancelDelay;
} = dual(2, (millis: number, callback: () => void): delayTypes.CancelDelay =>
  after(unrefSleep(millis), callback),
);

const runEveryUnref: {
  (millis: number, callback: () => void): delayTypes.CancelDelay;
  (callback: () => void): (millis: number) => delayTypes.CancelDelay;
} = dual(2, (millis: number, callback: () => void): delayTypes.CancelDelay =>
  every(unrefSleep(millis), callback),
);

const delay = {
  runAfter,
  runAfterUnref,
  runEvery,
  runEveryUnref,
};

export default delay;
