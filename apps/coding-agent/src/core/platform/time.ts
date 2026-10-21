import sleep from "@msa/chord/sleep";
import { Clock, DateTime, Deferred, Effect, Exit, Function as Fn, Option } from "effect";

import type platformTypes from "./index.types.ts";

const nowMs = (): number => Effect.runSync(Clock.currentTimeMillis);

const nowIso = (): string => DateTime.now.pipe(Effect.runSync, DateTime.formatIso);

const toEpochMs = (value: string | number): number =>
  Option.match(DateTime.make(value), { onNone: () => Number.NaN, onSome: DateTime.toEpochMillis });

const toDate = (value: string | number): Date =>
  DateTime.toDate(Option.getOrElse(DateTime.make(value), () => DateTime.makeUnsafe(0)));

const localZoned = (value: string | number): DateTime.Zoned =>
  DateTime.makeZonedUnsafe(toDate(value), { timeZone: DateTime.zoneMakeLocal() });

const localTimeZone = (): platformTypes.LocalTimeZone => ({
  name: DateTime.zoneToString(DateTime.zoneMakeLocal()),
  offset: DateTime.zonedOffsetIso(localZoned(nowMs())),
});

const pad = (value: number): string => String(value).padStart(2, "0");

const formatLocalDateTime = (value: string | number): string => {
  const parts = DateTime.toParts(localZoned(value));
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`;
};

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

const { unrefSleep } = sleep;

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
  formatLocalDateTime,
  localTimeZone,
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
