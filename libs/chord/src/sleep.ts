import { Effect } from "effect";

const MAX_TIMER_MS = 2 ** 31 - 1;

const signalAfter = (millis: number): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    const signal = AbortSignal.timeout(millis);
    const fire = (): void => {
      resume(Effect.void);
    };
    signal.addEventListener("abort", fire, { once: true });
    return Effect.sync(() => {
      signal.removeEventListener("abort", fire);
    });
  });

const waitForever: Effect.Effect<void> = Effect.callback<void>(() => undefined);

const unrefSleep = (millis: number): Effect.Effect<void> => {
  if (millis === Number.POSITIVE_INFINITY) return waitForever;
  const wait = Number.isNaN(millis) ? 0 : Math.max(0, Math.ceil(millis));
  if (wait <= MAX_TIMER_MS) return signalAfter(wait);
  return Effect.andThen(
    signalAfter(MAX_TIMER_MS),
    Effect.suspend(() => unrefSleep(wait - MAX_TIMER_MS)),
  );
};

const sleep: {
  readonly MAX_TIMER_MS: number;
  readonly unrefSleep: (millis: number) => Effect.Effect<void>;
} = {
  MAX_TIMER_MS,
  unrefSleep,
};

export default sleep;
