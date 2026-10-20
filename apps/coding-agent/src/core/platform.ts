import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { dual } from "effect/Function";
import * as Option from "effect/Option";
import * as Random from "effect/Random";

import type platformTypes from "./platform.types.ts";
import processEnv from "./process-env.ts";

const nowMs = (): number => Effect.runSync(Clock.currentTimeMillis);

const writeLog = (...args: readonly unknown[]): void => {
  Effect.runSync(Console.log(...args));
};

const writeWarn = (...args: readonly unknown[]): void => {
  Effect.runSync(Console.warn(...args));
};

const writeError = (...args: readonly unknown[]): void => {
  Effect.runSync(Console.error(...args));
};

const nowIso = (): string => DateTime.now.pipe(Effect.runSync, DateTime.formatIso);

const toEpochMs = (value: string | number): number =>
  Option.match(DateTime.make(value), { onNone: () => Number.NaN, onSome: DateTime.toEpochMillis });

const toDate = (value: string | number): Date =>
  DateTime.toDate(Option.getOrElse(DateTime.make(value), () => DateTime.makeUnsafe(0)));

const { readEnv } = processEnv;

const randomUnit = (): number => Effect.runSync(Random.next);

const schedule: {
  (delayMs: number): (run: () => void) => platformTypes.Scheduled;
  (run: () => void, delayMs: number): platformTypes.Scheduled;
} = dual(2, (run: () => void, delayMs: number): platformTypes.Scheduled => {
  const fiber = Effect.runFork(Effect.delay(Effect.sync(run), delayMs));
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
} = dual(2, (ms: number, signal: AbortSignal | undefined): Effect.Effect<void> =>
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

const platform = {
  makeLatch,
  nowIso,
  nowMs,
  randomUnit,
  readEnv,
  schedule,
  sleepFor,
  toDate,
  toEpochMs,
  writeError,
  writeLog,
  writeWarn,
};

export default platform;
