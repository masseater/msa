import { Cause, Effect } from "effect";
import { dual } from "effect/Function";

import type coreTypes from "./core.types.ts";
import errorsModule from "./errors.ts";
import type errorsTypes from "./errors.types.ts";
import unrefSleepModule from "./unref-sleep.ts";

const { unrefSleep } = unrefSleepModule;

const { ChordError } = errorsModule;

function linkedSignal(sources: readonly AbortSignal[]): {
  readonly signal: AbortSignal;
  release(): void;
} {
  const controller = new AbortController();
  const detach: (() => void)[] = [];
  const release = (): void => {
    for (const remove of detach.splice(0)) remove();
  };
  for (const source of sources) {
    if (source.aborted) {
      release();
      controller.abort(source.reason);
      break;
    }
    const forward = (): void => {
      release();
      controller.abort(source.reason);
    };
    source.addEventListener("abort", forward, { once: true });
    detach.push(() => source.removeEventListener("abort", forward));
  }
  return { release, signal: controller.signal };
}

const callAborted = (signal: AbortSignal): errorsTypes.ChordError =>
  new ChordError("aborted", "call aborted", { cause: signal.reason });

const abortedBy = (signal: AbortSignal): Effect.Effect<never> =>
  Effect.callback<never>((resume) => {
    const onAbort = (): void => resume(Effect.die(callAborted(signal)));
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", onAbort));
  });

const raceSignal: {
  (signal: AbortSignal): <T>(effect: Effect.Effect<T>) => Effect.Effect<T>;
  <T>(effect: Effect.Effect<T>, signal: AbortSignal): Effect.Effect<T>;
} = dual(2, <T>(effect: Effect.Effect<T>, signal: AbortSignal): Effect.Effect<T> =>
  Effect.suspend(() =>
    signal.aborted ? Effect.die(callAborted(signal)) : Effect.raceFirst(effect, abortedBy(signal)),
  ),
);

const readyTimeout = (ref: coreTypes.RefCore, ms: number): Effect.Effect<never> =>
  Number.isFinite(ms)
    ? Effect.flatMap(unrefSleep(ms), () =>
        Effect.die(
          new ChordError("unavailable", `${ref.address} was not ready after ${ms} ms`, {
            reason: "ready_timeout",
          }),
        ),
      )
    : Effect.never;

const awaitReady: {
  (signals: readonly AbortSignal[], ms: number): (ref: coreTypes.RefCore) => Effect.Effect<void>;
  (ref: coreTypes.RefCore, signals: readonly AbortSignal[], ms: number): Effect.Effect<void>;
} = dual(
  3,
  (ref: coreTypes.RefCore, signals: readonly AbortSignal[], ms: number): Effect.Effect<void> =>
    Effect.acquireUseRelease(
      Effect.sync(() => linkedSignal(signals)),
      (linked) =>
        Effect.raceFirst(
          raceSignal(
            Effect.promise(() => ref.ready),
            linked.signal,
          ),
          readyTimeout(ref, ms),
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.suspend(() => {
              ref.release();
              return Effect.die(Cause.squash(cause));
            }),
          ),
        ),
      (linked) => Effect.sync(linked.release),
    ),
);

const signalModule = {
  awaitReady,
  linkedSignal,
  raceSignal,
};

export default signalModule;
