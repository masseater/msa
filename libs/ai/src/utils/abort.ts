import { Effect, Fiber, Function } from "effect";

const abortReason = (signal: AbortSignal): unknown => {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
};

const waitForAbort = (signal: AbortSignal): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    const onAbort = () => resume(Effect.void);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", onAbort));
  });

const dieOnAbort: {
  (reason: (signal: AbortSignal) => unknown): (signal: AbortSignal) => Effect.Effect<never>;
  (signal: AbortSignal, reason: (signal: AbortSignal) => unknown): Effect.Effect<never>;
} = Function.dual(
  2,
  (signal: AbortSignal, reason: (signal: AbortSignal) => unknown): Effect.Effect<never> =>
    waitForAbort(signal).pipe(Effect.flatMap(() => Effect.die(reason(signal)))),
);

const sleepUnlessAborted: {
  (
    signal: AbortSignal | undefined,
    reason: (signal: AbortSignal) => unknown,
  ): (ms: number) => Effect.Effect<void>;
  (
    ms: number,
    signal: AbortSignal | undefined,
    reason: (signal: AbortSignal) => unknown,
  ): Effect.Effect<void>;
} = Function.dual(
  3,
  (
    ms: number,
    signal: AbortSignal | undefined,
    reason: (signal: AbortSignal) => unknown,
  ): Effect.Effect<void> =>
    signal === undefined
      ? Effect.sleep(ms)
      : dieOnAbort(signal, reason).pipe(
          Effect.timeoutOrElse({ duration: ms, orElse: () => Effect.void }),
        ),
);

const operationSignal = (signal?: AbortSignal): AbortSignal =>
  signal ?? new AbortController().signal;

const abortable: {
  (signal: AbortSignal): <A>(effect: Effect.Effect<A>) => Effect.Effect<A>;
  <A>(effect: Effect.Effect<A>, signal: AbortSignal): Effect.Effect<A>;
} = Function.dual(2, <A>(effect: Effect.Effect<A>, signal: AbortSignal): Effect.Effect<A> =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkDetach(effect, { startImmediately: true });
    return yield* Effect.raceFirst(Fiber.join(fiber), dieOnAbort(signal, abortReason));
  }),
);

const raceWithAbortSignal: {
  (signal: AbortSignal): <T>(operation: Promise<T>) => Promise<T>;
  <T>(operation: Promise<T>, signal: AbortSignal): Promise<T>;
} = Function.dual(2, <T>(operation: Promise<T>, signal: AbortSignal): Promise<T> =>
  Effect.runPromise(
    Effect.raceFirst(
      Effect.promise(() => operation),
      dieOnAbort(signal, abortReason),
    ),
  ),
);

const abort = {
  abortable,
  dieOnAbort,
  operationSignal,
  raceWithAbortSignal,
  sleepUnlessAborted,
  waitForAbort,
};

export default abort;
