import { fauxAssistantMessage } from "@msa/ai";
import { gate } from "@msa/testing";
import { Effect } from "effect";
import { expect } from "vite-plus/test";
import { createHarness, type Harness } from "./harness.ts";

export function normalizeEventOrder(events: Harness["events"]): string[] {
  const normalized: string[] = [];
  for (const event of events) {
    const label =
      event.type === "message_start" || event.type === "message_end"
        ? `${event.type}:${event.message.role}`
        : event.type === "tool_execution_start" || event.type === "tool_execution_end"
          ? `${event.type}:${event.toolName}`
          : event.type;
    if (label === "message_update" && normalized[normalized.length - 1] === "message_update") {
      continue;
    }
    normalized.push(label);
  }
  return normalized;
}
export const harnesses: Harness[] = [];
export const retriesAfterATransientErrorAnd = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
    }),
  );
  harnesses.push(harness);
  const retryEvents: string[] = [];
  harness.session.subscribe((event) => {
    if (event.type === "auto_retry_start") retryEvents.push(`start:${event.attempt}`);
    if (event.type === "auto_retry_end") retryEvents.push(`end:${event.success}`);
  });

  harness.setResponses([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
    fauxAssistantMessage("recovered"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("test"));

  expect(retryEvents).toEqual(["start:1", "end:true"]);
  expect(harness.eventsOfType("agent_end").map((event) => event.willRetry)).toEqual([true, false]);
  expect(harness.faux.state.callCount).toBe(2);
  expect(harness.session.isRetrying).toBe(false);
});
export const retriesMultipleTransientFailuresAndSucceeds = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
    }),
  );
  harnesses.push(harness);
  const retryEvents: string[] = [];
  harness.session.subscribe((event) => {
    if (event.type === "auto_retry_start") retryEvents.push(`start:${event.attempt}`);
    if (event.type === "auto_retry_end") retryEvents.push(`end:${event.success}`);
  });

  harness.setResponses([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
    fauxAssistantMessage("success"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("test"));

  expect(retryEvents).toEqual(["start:1", "start:2", "end:true"]);
  expect(harness.faux.state.callCount).toBe(3);
});
export const finalizesRetryStateWhenAbortIs = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 0 } },
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
  ]);

  let errorCount = 0;
  harness.session.subscribe((event) => {
    if (event.type !== "message_end" || event.message.role !== "assistant") return;
    if (event.message.stopReason === "error" && ++errorCount === 2) void harness.session.abort();
  });

  yield* Effect.promise(() => harness.session.prompt("test"));

  expect(harness.session.retryAttempt).toBe(0);
  expect(harness.eventsOfType("agent_end").at(-1)?.willRetry).toBe(false);
  expect(harness.eventsOfType("auto_retry_end").at(-1)).toMatchObject({
    success: false,
    attempt: 1,
    finalError: "Retry cancelled",
  });
});
export const exhaustsMaxRetriesAndEmitsA = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 } },
    }),
  );
  harnesses.push(harness);
  const retryEvents: string[] = [];
  harness.session.subscribe((event) => {
    if (event.type === "auto_retry_start") retryEvents.push(`start:${event.attempt}`);
    if (event.type === "auto_retry_end") retryEvents.push(`end:${event.success}`);
  });

  harness.setResponses([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
  ]);

  yield* Effect.promise(() => harness.session.prompt("test"));

  expect(retryEvents).toEqual(["start:1", "start:2", "end:false"]);
  expect(harness.eventsOfType("agent_end").map((event) => event.willRetry)).toEqual([
    true,
    true,
    false,
  ]);
  expect(harness.faux.state.callCount).toBe(3);
  expect(harness.session.isRetrying).toBe(false);
});
export const promptWaitsForRetryCompletionEven = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
      extensionFactories: [
        (msa) => {
          msa.on("message_end", (event) =>
            runPromise(
              Effect.gen(function* () {
                if (event.message.role === "assistant") {
                  yield* Effect.sleep(40);
                }
              }),
            ),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
    fauxAssistantMessage("recovered"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("test"));

  expect(harness.faux.state.callCount).toBe(2);
  expect(harness.session.isRetrying).toBe(false);
});
export const doesNotRetryWhenRetryIs = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({ settings: { retry: { enabled: false } } }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
  ]);

  yield* Effect.promise(() => harness.session.prompt("test"));

  expect(harness.faux.state.callCount).toBe(1);
  expect(harness.eventsOfType("auto_retry_start")).toEqual([]);
});
export const doesNotRetryNonRetryableErrors = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "invalid_api_key" }),
  ]);

  yield* Effect.promise(() => harness.session.prompt("test"));

  expect(harness.faux.state.callCount).toBe(1);
  expect(harness.eventsOfType("auto_retry_start")).toEqual([]);
});
export const cancelsRetrySleepWhenAbortretryIs = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 100 } },
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
  ]);

  const sawRetryStart = gate();
  {
    const unsubscribe = harness.session.subscribe((event) => {
      if (event.type === "auto_retry_start") {
        unsubscribe();
        sawRetryStart.release();
      }
    });
  }

  const promptPromise = harness.session.prompt("test");
  yield* Effect.promise(() => sawRetryStart);
  harness.session.abortRetry();
  yield* Effect.promise(() => promptPromise);

  expect(harness.session.isRetrying).toBe(false);
  expect(harness.eventsOfType("auto_retry_end").map((event) => event.finalError)).toContain(
    "Retry cancelled",
  );
  expect(harness.faux.state.callCount).toBe(1);
});
