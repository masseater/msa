import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { dual } from "effect/Function";
import * as Option from "effect/Option";
import * as Random from "effect/Random";

export const nowMs = (): number => Effect.runSync(Clock.currentTimeMillis);

export const writeLog = (...args: readonly unknown[]): void => {
  Effect.runSync(Console.log(...args));
};

export const writeWarn = (...args: readonly unknown[]): void => {
  Effect.runSync(Console.warn(...args));
};

export const writeError = (...args: readonly unknown[]): void => {
  Effect.runSync(Console.error(...args));
};

export const nowIso = (): string => DateTime.now.pipe(Effect.runSync, DateTime.formatIso);

export const toEpochMs = (value: string | number): number =>
  Option.match(DateTime.make(value), { onNone: () => Number.NaN, onSome: DateTime.toEpochMillis });

export const toDate = (value: string | number): Date =>
  DateTime.toDate(Option.getOrElse(DateTime.make(value), () => DateTime.makeUnsafe(0)));

export { readEnv } from "./process-env.ts";

export const randomUnit = (): number => Effect.runSync(Random.next);

export interface Scheduled {
  readonly cancel: () => void;
}

export const schedule: {
  (delayMs: number): (run: () => void) => Scheduled;
  (run: () => void, delayMs: number): Scheduled;
} = dual(2, (run: () => void, delayMs: number): Scheduled => {
  const fiber = Effect.runFork(Effect.delay(Effect.sync(run), delayMs));
  return {
    cancel: () => {
      fiber.interruptUnsafe();
    },
  };
});

export interface Latch {
  readonly promise: Promise<void>;
  readonly open: () => void;
}

export const makeLatch = (): Latch => {
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

export const sleepFor: {
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
