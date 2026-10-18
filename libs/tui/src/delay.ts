import { Effect, Exit } from "effect";
import { dual } from "effect/Function";

export type CancelDelay = () => void;

export const runAfter: {
  (millis: number, callback: () => void): CancelDelay;
  (callback: () => void): (millis: number) => CancelDelay;
} = dual(2, (millis: number, callback: () => void): CancelDelay => {
  const interrupt = Effect.runCallback(Effect.sleep(millis), {
    onExit: (exit) => {
      if (Exit.isSuccess(exit)) callback();
    },
  });
  return () => interrupt();
});

export const runEvery: {
  (millis: number, callback: () => void): CancelDelay;
  (callback: () => void): (millis: number) => CancelDelay;
} = dual(2, (millis: number, callback: () => void): CancelDelay => {
  let cancel: CancelDelay;
  const arm = (): void => {
    cancel = runAfter(millis, () => {
      arm();
      callback();
    });
  };
  arm();
  return () => cancel();
});
