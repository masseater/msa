import { Clock, Effect } from "effect";

import { sleepUnlessAborted } from "../../utils/abort.ts";

const CANCEL_MESSAGE = "Login cancelled";
const TIMEOUT_MESSAGE = "Device flow timed out";
const SLOW_DOWN_TIMEOUT_MESSAGE =
  "Device flow timed out after one or more slow_down responses. This is often caused by clock drift in WSL or VM environments. Please sync or restart the VM clock and try again.";
const MINIMUM_INTERVAL_MS = 1000;
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const SLOW_DOWN_INTERVAL_INCREMENT_MS = 5000;

type OAuthDeviceCodeIncompletePollResult =
  | { status: "pending" }
  | { status: "slow_down"; intervalSeconds?: number | undefined }
  | { status: "failed"; message: string };

export type OAuthDeviceCodePollResult<T> =
  | OAuthDeviceCodeIncompletePollResult
  | { status: "complete"; value: T };

export type OAuthDeviceCodePollOptions<T> = {
  intervalSeconds?: number | undefined;
  expiresInSeconds?: number | undefined;
  waitBeforeFirstPoll?: boolean | undefined;
  poll: () => Promise<OAuthDeviceCodePollResult<T>>;
  signal: AbortSignal;
};

const cancelled = (): Error => new Error(CANCEL_MESSAGE);

const waitBetweenPolls = (intervalMs: number, remainingMs: number, signal: AbortSignal) =>
  sleepUnlessAborted(Math.min(intervalMs, remainingMs), signal, cancelled);

const nextIntervalMs = (intervalMs: number, intervalSeconds: number | undefined): number =>
  typeof intervalSeconds === "number" && Number.isFinite(intervalSeconds) && intervalSeconds > 0
    ? Math.max(MINIMUM_INTERVAL_MS, Math.floor(intervalSeconds * 1000))
    : Math.max(MINIMUM_INTERVAL_MS, intervalMs + SLOW_DOWN_INTERVAL_INCREMENT_MS);

interface PollState {
  readonly intervalMs: number;
  readonly slowDownResponses: number;
}

const pollUntilDeadline = <T>(
  options: OAuthDeviceCodePollOptions<T>,
  deadline: number,
  state: PollState,
): Effect.Effect<T> =>
  Effect.gen(function* () {
    if ((yield* Clock.currentTimeMillis) >= deadline) {
      return yield* Effect.die(
        new Error(state.slowDownResponses > 0 ? SLOW_DOWN_TIMEOUT_MESSAGE : TIMEOUT_MESSAGE),
      );
    }
    if (options.signal.aborted) return yield* Effect.die(cancelled());

    const result = yield* Effect.promise(() => options.poll());
    if (result.status === "complete") return result.value;
    if (result.status === "failed") return yield* Effect.die(new Error(result.message));

    const next =
      result.status === "slow_down"
        ? {
            intervalMs: nextIntervalMs(state.intervalMs, result.intervalSeconds),
            slowDownResponses: state.slowDownResponses + 1,
          }
        : state;

    const remainingMs = deadline - (yield* Clock.currentTimeMillis);
    if (remainingMs <= 0) {
      return yield* Effect.die(
        new Error(next.slowDownResponses > 0 ? SLOW_DOWN_TIMEOUT_MESSAGE : TIMEOUT_MESSAGE),
      );
    }

    yield* waitBetweenPolls(next.intervalMs, remainingMs, options.signal);
    return yield* pollUntilDeadline(options, deadline, next);
  });

export const pollOAuthDeviceCodeFlow = <T>(options: OAuthDeviceCodePollOptions<T>): Promise<T> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const startedAt = yield* Clock.currentTimeMillis;
      const deadline =
        typeof options.expiresInSeconds === "number"
          ? startedAt + options.expiresInSeconds * 1000
          : Number.POSITIVE_INFINITY;
      const intervalMs = Math.max(
        MINIMUM_INTERVAL_MS,
        Math.floor((options.intervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS) * 1000),
      );

      if (options.waitBeforeFirstPoll === true && deadline - startedAt > 0) {
        yield* waitBetweenPolls(intervalMs, deadline - startedAt, options.signal);
      }

      return yield* pollUntilDeadline(options, deadline, { intervalMs, slowDownResponses: 0 });
    }),
  );
