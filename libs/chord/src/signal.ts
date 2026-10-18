import { Cause, Duration, Effect } from "effect";
import { dual } from "effect/Function";

import type { RefCore } from "./core.ts";
import { ChordError } from "./errors.ts";

export function linkedSignal(sources: readonly AbortSignal[]): {
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
  return { signal: controller.signal, release };
}

const callAborted = (signal: AbortSignal): ChordError =>
  new ChordError("aborted", "call aborted", { cause: signal.reason });

const abortedBy = (signal: AbortSignal): Effect.Effect<never> =>
  Effect.callback<never>((resume) => {
    const onAbort = (): void => resume(Effect.die(callAborted(signal)));
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", onAbort));
  });

export const raceSignal: {
  (signal: AbortSignal): <T>(effect: Effect.Effect<T>) => Effect.Effect<T>;
  <T>(effect: Effect.Effect<T>, signal: AbortSignal): Effect.Effect<T>;
} = dual(2, <T>(effect: Effect.Effect<T>, signal: AbortSignal): Effect.Effect<T> =>
  Effect.suspend(() =>
    signal.aborted ? Effect.die(callAborted(signal)) : Effect.raceFirst(effect, abortedBy(signal)),
  ),
);

const readyTimeout = (ref: RefCore, ms: number): Effect.Effect<never> =>
  Number.isFinite(ms)
    ? Effect.flatMap(Effect.sleep(Duration.millis(ms)), () =>
        Effect.die(
          new ChordError("unavailable", `${ref.address} was not ready after ${ms} ms`, {
            reason: "ready_timeout",
          }),
        ),
      )
    : Effect.never;

export const awaitReady: {
  (signals: readonly AbortSignal[], ms: number): (ref: RefCore) => Effect.Effect<void>;
  (ref: RefCore, signals: readonly AbortSignal[], ms: number): Effect.Effect<void>;
} = dual(3, (ref: RefCore, signals: readonly AbortSignal[], ms: number): Effect.Effect<void> =>
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
