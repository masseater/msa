import { Clock, Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { Progress } from "../src/progress.ts";
import timing from "./fixtures/timing.ts";

const { latch } = timing;

const commitsTheFirstChangeAtOnce = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  vi.useFakeTimers({ now: 0 });
  const commits: number[] = [];
  let size = 50 * 1024;
  const progress = new Progress(
    () =>
      Effect.runPromiseWith(services)(
        Effect.map(Clock.currentTimeMillis, (now) => {
          commits.push(now);
          return size;
        }),
      ),
    () => {},
    100,
  );
  progress.mark();
  yield* Effect.promise(() => vi.advanceTimersByTimeAsync(0));
  expect(commits).toEqual([0]);
  size = 10;
  progress.mark();
  progress.mark();
  yield* Effect.promise(() => vi.advanceTimersByTimeAsync(499));
  expect(commits).toEqual([0]);
  yield* Effect.promise(() => vi.advanceTimersByTimeAsync(1));
  expect(commits).toEqual([0, 500]);
  progress.mark();
  yield* Effect.promise(() => vi.advanceTimersByTimeAsync(99));
  expect(commits).toEqual([0, 500]);
  yield* Effect.promise(() => vi.advanceTimersByTimeAsync(1));
  expect(commits).toEqual([0, 500, 600]);
});

const waitsTheConfiguredMinimumIntervalBetween = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  vi.useFakeTimers({ now: 0 });
  const commits: number[] = [];
  const progress = new Progress(
    () =>
      Effect.runPromiseWith(services)(
        Effect.map(Clock.currentTimeMillis, (now) => {
          commits.push(now);
          return 10;
        }),
      ),
    () => {},
    500,
  );
  progress.mark();
  yield* Effect.promise(() => vi.advanceTimersByTimeAsync(0));
  progress.mark();
  yield* Effect.promise(() => vi.advanceTimersByTimeAsync(499));
  expect(commits).toEqual([0]);
  yield* Effect.promise(() => vi.advanceTimersByTimeAsync(1));
  expect(commits).toEqual([0, 500]);
});

const rejectsTheWaitersOfAFailed = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const errors: unknown[] = [];
  const failure = new Error("commit failed");
  const progress = new Progress(
    () =>
      Effect.runPromiseWith(services)(
        Effect.sync(() => {
          throw failure;
        }),
      ),
    (error) => errors.push(error),
    100,
  );
  yield* Effect.promise(() => expect(progress.markAndWait()).rejects.toBe(failure));
  expect(errors).toEqual([failure]);
});

const stopsWaitsForTheCommitIn = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  vi.useFakeTimers({ now: 0 });
  const inFlight = latch();
  const release = inFlight.open;
  const progress = new Progress(
    () =>
      Effect.runPromiseWith(services)(
        Effect.gen(function* () {
          yield* inFlight.wait;
          return 0;
        }),
      ),
    () => {},
    100,
  );
  const first = progress.markAndWait();
  const second = progress.markAndWait();
  const stopped = progress.stop();
  release();
  const pending = yield* Effect.promise(() => stopped);
  yield* Effect.promise(() => first);
  expect(pending).toHaveLength(1);
  pending[0]!.resolve();
  yield* Effect.promise(() => second);
});

describe("Progress", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("commits the first change at once, then waits at least 100 ms and the written size at 100 KiB/s", () =>
    Effect.runPromise(commitsTheFirstChangeAtOnce));

  it("waits the configured minimum interval between small commits", () =>
    Effect.runPromise(waitsTheConfiguredMinimumIntervalBetween));

  it("rejects the waiters of a failed commit and reports its error", () =>
    Effect.runPromise(rejectsTheWaitersOfAFailed));

  it("stops: waits for the commit in flight and hands back waiters no commit covered yet", () =>
    Effect.runPromise(stopsWaitsForTheCommitIn));
});
