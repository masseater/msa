import { Effect } from "effect";

const unrefSleep = (millis: number): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    const signal = AbortSignal.timeout(millis);
    const onAbort = (): void => {
      resume(Effect.void);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });

const unrefSleepModule = {
  unrefSleep,
};

export default unrefSleepModule;
