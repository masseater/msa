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

export const raceSignal: {
  (signal: AbortSignal): <T>(promise: Promise<T>) => Effect.Effect<T>;
  <T>(promise: Promise<T>, signal: AbortSignal): Effect.Effect<T>;
} = dual(2, <T>(promise: Promise<T>, signal: AbortSignal): Effect.Effect<T> =>
  Effect.callback<T>((resume) => {
    if (signal.aborted) {
      resume(Effect.die(callAborted(signal)));
      return undefined;
    }
    const onAbort = (): void => resume(Effect.die(callAborted(signal)));
    const settle = (outcome: Effect.Effect<T>): void => {
      signal.removeEventListener("abort", onAbort);
      resume(outcome);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => settle(Effect.succeed(value)),
      (error: unknown) => settle(Effect.die(error)),
    );
    return Effect.sync(() => signal.removeEventListener("abort", onAbort));
  }),
);

export const unrefTimeout: {
  (ms: number): (fire: () => void) => () => void;
  (fire: () => void, ms: number): () => void;
} = dual(2, (fire: () => void, ms: number): (() => void) => {
  const timer = setTimeout(fire, ms);
  (timer as { unref?: () => void }).unref?.();
  return () => clearTimeout(timer);
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
      raceSignal(ref.ready, wait.linked.signal).pipe(
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
