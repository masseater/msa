import { Cause, Effect } from "effect";
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

export const unrefTimeout: {
  (ms: number): (fire: () => void) => () => void;
  (fire: () => void, ms: number): () => void;
} = dual(2, (fire: () => void, ms: number): (() => void) => {
  const timer = setTimeout(fire, ms);
  (timer as { unref?: () => void }).unref?.();
  return () => clearTimeout(timer);
});

export const unrefInterval: {
  (ms: number): (tick: () => void) => () => void;
  (tick: () => void, ms: number): () => void;
} = dual(2, (tick: () => void, ms: number): (() => void) => {
  const timer = setInterval(tick, ms);
  (timer as { unref?: () => void }).unref?.();
  return () => clearInterval(timer);
});

interface ReadyWait {
  readonly linked: ReturnType<typeof linkedSignal>;
  readonly timeout: AbortSignal;
  readonly stop: () => void;
}

function startReadyWait(ref: RefCore, signals: readonly AbortSignal[], ms: number): ReadyWait {
  const timeout = new AbortController();
  const cancel = Number.isFinite(ms)
    ? unrefTimeout(
        () =>
          timeout.abort(
            new ChordError("unavailable", `${ref.address} was not ready after ${ms} ms`, {
              reason: "ready_timeout",
            }),
          ),
        ms,
      )
    : undefined;
  const linked = linkedSignal([...signals, timeout.signal]);
  return {
    linked,
    timeout: timeout.signal,
    stop: () => {
      cancel?.();
      linked.release();
    },
  };
}

export const awaitReady: {
  (signals: readonly AbortSignal[], ms: number): (ref: RefCore) => Effect.Effect<void>;
  (ref: RefCore, signals: readonly AbortSignal[], ms: number): Effect.Effect<void>;
} = dual(3, (ref: RefCore, signals: readonly AbortSignal[], ms: number): Effect.Effect<void> =>
  Effect.acquireUseRelease(
    Effect.sync(() => startReadyWait(ref, signals, ms)),
    (wait) =>
      raceSignal(
        Effect.promise(() => ref.ready),
        wait.linked.signal,
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.suspend(() => {
            ref.release();
            const reason: unknown = wait.linked.signal.reason;
            return Effect.die(
              reason instanceof ChordError && reason.reason === "ready_timeout"
                ? reason
                : Cause.squash(cause),
            );
          }),
        ),
      ),
    (wait) => Effect.sync(wait.stop),
  ),
);
