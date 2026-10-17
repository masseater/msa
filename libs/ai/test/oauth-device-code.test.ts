import { Clock, DateTime, Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { pollOAuthDeviceCodeFlow } from "../src/auth/oauth/device-code.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";

const neverAbortedSignal = new AbortController().signal;

describe("OAuth device-code polling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("polls immediately and returns the completed value", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.useFakeTimers();
        vi.setSystemTime("2026-03-09T00:00:00Z");

        const pollTimes: number[] = [];
        const poll = vi.fn(() => {
          pollTimes.push(currentTimeMillis());
          return Promise.resolve(
            pollTimes.length === 1
              ? { status: "pending" as const }
              : { status: "complete" as const, value: "token" },
          );
        });

        const resultPromise = pollOAuthDeviceCodeFlow({
          intervalSeconds: 2,
          expiresInSeconds: 30,
          poll,
          signal: neverAbortedSignal,
        });

        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(0));
        expect(pollTimes).toEqual([
          DateTime.toEpochMillis(DateTime.makeUnsafe("2026-03-09T00:00:00Z")),
        ]);

        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(1999));
        expect(pollTimes).toEqual([
          DateTime.toEpochMillis(DateTime.makeUnsafe("2026-03-09T00:00:00Z")),
        ]);

        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(1));
        yield* Effect.promise(() => expect(resultPromise).resolves.toBe("token"));
        expect(pollTimes).toEqual([
          DateTime.toEpochMillis(DateTime.makeUnsafe("2026-03-09T00:00:00Z")),
          DateTime.toEpochMillis(DateTime.makeUnsafe("2026-03-09T00:00:02Z")),
        ]);
      }),
    ));
});

describe("OAuth device-code polling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("can wait before the first poll", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.useFakeTimers();
        vi.setSystemTime("2026-03-09T00:00:00Z");

        const pollTimes: number[] = [];
        const resultPromise = pollOAuthDeviceCodeFlow({
          intervalSeconds: 2,
          expiresInSeconds: 30,
          waitBeforeFirstPoll: true,
          poll: () => {
            pollTimes.push(currentTimeMillis());
            return Promise.resolve({ status: "complete" as const, value: "token" });
          },
          signal: neverAbortedSignal,
        });

        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(1999));
        expect(pollTimes).toEqual([]);

        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(1));
        yield* Effect.promise(() => expect(resultPromise).resolves.toBe("token"));
        expect(pollTimes).toEqual([
          DateTime.toEpochMillis(DateTime.makeUnsafe("2026-03-09T00:00:02Z")),
        ]);
      }),
    ));
});

describe("OAuth device-code polling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("increases the interval by 5 seconds after slow_down without a server interval", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.useFakeTimers();
        vi.setSystemTime("2026-03-09T00:00:00Z");
        const startTime = yield* Clock.currentTimeMillis;

        const pollTimes: number[] = [];
        const results = [
          { status: "slow_down" as const },
          { status: "complete" as const, value: "token" },
        ];
        const resultPromise = pollOAuthDeviceCodeFlow({
          intervalSeconds: 2,
          expiresInSeconds: 900,
          poll: () => {
            pollTimes.push(currentTimeMillis());
            const result = results.shift();
            if (result === undefined) return Promise.reject(new Error("Unexpected extra poll"));
            return Promise.resolve(result);
          },
          signal: neverAbortedSignal,
        });

        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(0));
        expect(pollTimes).toEqual([startTime]);

        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(6999));
        expect(pollTimes).toEqual([startTime]);

        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(1));
        yield* Effect.promise(() => expect(resultPromise).resolves.toBe("token"));
        expect(pollTimes).toEqual([startTime, startTime + 7000]);
      }),
    ));
});

describe("OAuth device-code polling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("honors a server-provided slow_down interval", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.useFakeTimers();
        vi.setSystemTime("2026-03-09T00:00:00Z");
        const startTime = yield* Clock.currentTimeMillis;

        const pollTimes: number[] = [];
        const results = [
          { status: "slow_down" as const, intervalSeconds: 30 },
          { status: "complete" as const, value: "token" },
        ];
        const resultPromise = pollOAuthDeviceCodeFlow({
          intervalSeconds: 2,
          expiresInSeconds: 900,
          poll: () => {
            pollTimes.push(currentTimeMillis());
            const result = results.shift();
            if (result === undefined) return Promise.reject(new Error("Unexpected extra poll"));
            return Promise.resolve(result);
          },
          signal: neverAbortedSignal,
        });

        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(0));
        expect(pollTimes).toEqual([startTime]);

        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(29999));
        expect(pollTimes).toEqual([startTime]);

        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(1));
        yield* Effect.promise(() => expect(resultPromise).resolves.toBe("token"));
        expect(pollTimes).toEqual([startTime, startTime + 30000]);
      }),
    ));
});

describe("OAuth device-code polling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("cancels an in-flight wait", () => {
    const controller = new AbortController();
    return Effect.runPromise(
      Effect.gen(function* () {
        vi.useFakeTimers();
        const resultPromise = pollOAuthDeviceCodeFlow({
          intervalSeconds: 5,
          expiresInSeconds: 30,
          poll: () => Promise.resolve({ status: "pending" }),
          signal: controller.signal,
        });

        controller.abort();
        yield* Effect.promise(() => expect(resultPromise).rejects.toThrow("Login cancelled"));
      }),
    );
  });
});
