import { Clock, DateTime, Deferred, Effect, Exit, Function as Fn, Option } from "effect";

import type platformTypes from "./index.types.ts";

const nowMs = (): number => Effect.runSync(Clock.currentTimeMillis);

const nowIso = (): string => DateTime.now.pipe(Effect.runSync, DateTime.formatIso);

const toEpochMs = (value: string | number): number =>
  Option.match(DateTime.make(value), { onNone: () => Number.NaN, onSome: DateTime.toEpochMillis });

const toDate = (value: string | number): Date =>
  DateTime.toDate(Option.getOrElse(DateTime.make(value), () => DateTime.makeUnsafe(0)));

const schedule: {
  (delayMs: number): (run: () => void) => platformTypes.Scheduled;
  (run: () => void, delayMs: number): platformTypes.Scheduled;
} = Fn.dual(2, (run: () => void, delayMs: number): platformTypes.Scheduled => {
  const fiber = Effect.runFork(Effect.delay(Effect.sync(run), delayMs));
  return {
    cancel: () => {
      fiber.interruptUnsafe();
    },
  };
});

const MAX_TIMER_MS = 2 ** 31 - 1;

const unrefSleep = (delayMs: number): Effect.Effect<void> => {
  const wait = Math.max(0, Math.ceil(delayMs));
  if (wait > MAX_TIMER_MS) {
    return Effect.andThen(unrefSleep(MAX_TIMER_MS), unrefSleep(wait - MAX_TIMER_MS));
  }
  return Effect.callback<void>((resume) => {
    const signal = AbortSignal.timeout(wait);
    const fire = (): void => {
      resume(Effect.void);
    };
    signal.addEventListener("abort", fire, { once: true });
    return Effect.sync(() => {
      signal.removeEventListener("abort", fire);
    });
  });
};

const scheduleUnref: {
  (delayMs: number): (run: () => void) => platformTypes.Scheduled;
  (run: () => void, delayMs: number): platformTypes.Scheduled;
} = Fn.dual(2, (run: () => void, delayMs: number): platformTypes.Scheduled => {
  const fiber = Effect.runFork(Effect.andThen(unrefSleep(delayMs), Effect.sync(run)));
  return {
    cancel: () => {
      fiber.interruptUnsafe();
    },
  };
});

const makeLatch = (): platformTypes.Latch => {
  const gate = Deferred.makeUnsafe<void>();
  return {
    open: () => {
      Deferred.doneUnsafe(gate, Exit.void);
    },
    promise: Deferred.await(gate).pipe(Effect.runPromise),
  };
};

const abortError = (signal: AbortSignal): Error =>
  Object.assign(new Error("The operation was aborted", { cause: signal.reason }), {
    code: "ABORT_ERR",
    name: "AbortError",
  });

const sleepFor: {
  (signal: AbortSignal | undefined): (ms: number) => Effect.Effect<void>;
  (ms: number, signal: AbortSignal | undefined): Effect.Effect<void>;
} = Fn.dual(2, (ms: number, signal: AbortSignal | undefined): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    if (signal?.aborted === true) {
      resume(Effect.die(abortError(signal)));
      return undefined;
    }
    const onAbort = () => {
      timer.cancel();
      if (signal !== undefined) resume(Effect.die(abortError(signal)));
    };
    const timer = schedule(() => {
      signal?.removeEventListener("abort", onAbort);
      resume(Effect.void);
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => {
      timer.cancel();
      signal?.removeEventListener("abort", onAbort);
    });
  }),
);

const platformTime = {
  makeLatch,
  nowIso,
  nowMs,
  schedule,
  scheduleUnref,
  sleepFor,
  toDate,
  toEpochMs,
};

export default platformTime;
