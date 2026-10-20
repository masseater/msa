import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { fauxAssistantMessage } from "../src/providers/faux.ts";
import { type RetryPolicy, retryAssistantCall } from "../src/utils/retry.ts";

describe("retryAssistantCall", () => {
  const enabled: RetryPolicy = { baseDelayMs: 0, enabled: true, maxRetries: 3 };
  it("retries a transient error up to maxRetries then returns the final error", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const produce = vi.fn(() =>
          Promise.resolve(
            fauxAssistantMessage("", { errorMessage: "terminated", stopReason: "error" }),
          ),
        );
        const onRetryScheduled = vi.fn();
        const onRetryFinished = vi.fn();
        const res = yield* Effect.promise(() =>
          retryAssistantCall(produce, enabled, undefined, {
            onRetryFinished,
            onRetryScheduled,
          }),
        );
        expect(res.stopReason).toBe("error");
        expect(produce).toHaveBeenCalledTimes(4);
        expect(onRetryScheduled).toHaveBeenCalledTimes(3);
        expect(onRetryFinished).toHaveBeenCalledWith(false, 3, "terminated");
      }),
    ));
});

describe("retryAssistantCall", () => {
  it("reports capped retry delays", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let n = 0;
        const policy: RetryPolicy = {
          baseDelayMs: 10,
          enabled: true,
          maxAgentDelayMs: 15,
          maxRetries: 4,
        };
        const produce = vi.fn(() => {
          n++;
          return Promise.resolve(
            n < 5
              ? fauxAssistantMessage("", { errorMessage: "terminated", stopReason: "error" })
              : fauxAssistantMessage("recovered"),
          );
        });
        const onRetryScheduled = vi.fn();

        yield* Effect.promise(() =>
          retryAssistantCall(produce, policy, undefined, { onRetryScheduled }),
        );

        expect(onRetryScheduled.mock.calls.map((call) => call[2])).toEqual([10, 15, 15, 15]);
      }),
    ));
});

describe("retryAssistantCall", () => {
  const enabled: RetryPolicy = { baseDelayMs: 0, enabled: true, maxRetries: 3 };
  it("stops retrying once a call succeeds", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let n = 0;
        const produce = vi.fn(() => {
          n++;
          return Promise.resolve(
            n < 3
              ? fauxAssistantMessage("", { errorMessage: "terminated", stopReason: "error" })
              : fauxAssistantMessage("recovered"),
          );
        });
        const onRetryFinished = vi.fn();
        const res = yield* Effect.promise(() =>
          retryAssistantCall(produce, enabled, undefined, { onRetryFinished }),
        );
        expect(res.content).toEqual([{ text: "recovered", type: "text" }]);
        expect(produce).toHaveBeenCalledTimes(3);
        expect(onRetryFinished).toHaveBeenCalledWith(true, 2);
      }),
    ));

  it("reports an aborted retried call as unsuccessful", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let n = 0;
        const produce = vi.fn(() => {
          n++;
          return Promise.resolve(
            n === 1
              ? fauxAssistantMessage("", { errorMessage: "terminated", stopReason: "error" })
              : fauxAssistantMessage("", { stopReason: "aborted" }),
          );
        });
        const onRetryFinished = vi.fn();
        const res = yield* Effect.promise(() =>
          retryAssistantCall(produce, enabled, undefined, { onRetryFinished }),
        );
        expect(res.stopReason).toBe("aborted");
        expect(produce).toHaveBeenCalledTimes(2);
        expect(onRetryFinished).toHaveBeenCalledWith(false, 1);
      }),
    ));
});

describe("retryAssistantCall", () => {
  const disabled: RetryPolicy = { baseDelayMs: 0, enabled: false, maxRetries: 3 };
  it("does not retry when policy is disabled", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const produce = vi.fn(() =>
          Promise.resolve(
            fauxAssistantMessage("", { errorMessage: "terminated", stopReason: "error" }),
          ),
        );
        const onRetryScheduled = vi.fn();
        const onRetryFinished = vi.fn();
        const res = yield* Effect.promise(() =>
          retryAssistantCall(produce, disabled, undefined, {
            onRetryFinished,
            onRetryScheduled,
          }),
        );
        expect(res.stopReason).toBe("error");
        expect(produce).toHaveBeenCalledTimes(1);
        expect(onRetryScheduled).not.toHaveBeenCalled();
        expect(onRetryFinished).not.toHaveBeenCalled();
      }),
    ));
});

describe("retryAssistantCall", () => {
  const enabled: RetryPolicy = { baseDelayMs: 0, enabled: true, maxRetries: 3 };
  it("emits onRetryAttemptStart after backoff before each retried call", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const events: string[] = [];
        let n = 0;
        const produce = vi.fn(() => {
          events.push(`produce:${n}`);
          n++;
          return Promise.resolve(
            n < 3
              ? fauxAssistantMessage("", { errorMessage: "terminated", stopReason: "error" })
              : fauxAssistantMessage("recovered"),
          );
        });
        const onRetryScheduled = vi.fn((attempt: number) => {
          events.push(`retry:${attempt}`);
        });
        const onRetryAttemptStart = vi.fn(() => {
          events.push("attempt-start");
        });
        const res = yield* Effect.promise(() =>
          retryAssistantCall(produce, enabled, undefined, {
            onRetryAttemptStart,
            onRetryScheduled,
          }),
        );
        expect(res.content).toEqual([{ text: "recovered", type: "text" }]);
        expect(onRetryScheduled).toHaveBeenCalledTimes(2);
        expect(onRetryAttemptStart).toHaveBeenCalledTimes(2);
        expect(events).toEqual([
          "produce:0",
          "retry:1",
          "attempt-start",
          "produce:1",
          "retry:2",
          "attempt-start",
          "produce:2",
        ]);
      }),
    ));
});

describe("retryAssistantCall", () => {
  it("aborts backoff sleep via signal, returns an aborted message, and emits onRetryFinished(false)", () => {
    const controller = new AbortController();
    return Effect.runPromise(
      Effect.gen(function* () {
        const produce = vi.fn(() =>
          Promise.resolve(
            fauxAssistantMessage("", { errorMessage: "terminated", stopReason: "error" }),
          ),
        );
        const policy: RetryPolicy = { baseDelayMs: 10_000, enabled: true, maxRetries: 5 };
        const onRetryFinished = vi.fn();
        const p = retryAssistantCall(produce, policy, controller.signal, { onRetryFinished });
        yield* Effect.promise(() => vi.waitFor(() => expect(produce).toHaveBeenCalled()));
        controller.abort();
        const res = yield* Effect.promise(() => p);
        expect(res.stopReason).toBe("aborted");
        expect(res.errorMessage).toBeUndefined();
        expect(produce).toHaveBeenCalledTimes(1);
        expect(onRetryFinished).toHaveBeenCalledWith(false, 1, "terminated");
      }),
    );
  });
});
