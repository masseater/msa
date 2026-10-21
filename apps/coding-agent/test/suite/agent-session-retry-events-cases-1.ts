import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { fauxAssistantMessage } = ai;

const { createHarness } = harnessModule;

const { gate } = testing;

function normalizeEventOrder(events: harnessTypes.Harness["events"]): string[] {
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
const harnesses: harnessTypes.Harness[] = [];
const retriesAfterATransientErrorAnd = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { baseDelayMs: 1, enabled: true, maxRetries: 3 } },
    }),
  );
  harnesses.push(harness);
  const retryEvents: string[] = [];
  harness.session.subscribe((event) => {
    if (event.type === "auto_retry_start") retryEvents.push(`start:${event.attempt}`);
    if (event.type === "auto_retry_end") retryEvents.push(`end:${event.success}`);
  });

  harness.setResponses([
    fauxAssistantMessage("", { errorMessage: "overloaded_error", stopReason: "error" }),
    fauxAssistantMessage("recovered"),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("test"));

  expect(retryEvents).toEqual(["start:1", "end:true"]);
  expect(harness.eventsOfType("agent_end").map((event) => event.willRetry)).toEqual([true, false]);
  expect(harness.faux.state.callCount).toBe(2);
  expect(harness.session.run.retry.isRetrying).toBe(false);
});
const retriesMultipleTransientFailuresAndSucceeds = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { baseDelayMs: 1, enabled: true, maxRetries: 3 } },
    }),
  );
  harnesses.push(harness);
  const retryEvents: string[] = [];
  harness.session.subscribe((event) => {
    if (event.type === "auto_retry_start") retryEvents.push(`start:${event.attempt}`);
    if (event.type === "auto_retry_end") retryEvents.push(`end:${event.success}`);
  });

  harness.setResponses([
    fauxAssistantMessage("", { errorMessage: "overloaded_error", stopReason: "error" }),
    fauxAssistantMessage("", { errorMessage: "overloaded_error", stopReason: "error" }),
    fauxAssistantMessage("success"),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("test"));

  expect(retryEvents).toEqual(["start:1", "start:2", "end:true"]);
  expect(harness.faux.state.callCount).toBe(3);
});
const finalizesRetryStateWhenAbortIs = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { baseDelayMs: 0, enabled: true, maxRetries: 3 } },
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("", { errorMessage: "overloaded_error", stopReason: "error" }),
    fauxAssistantMessage("", { errorMessage: "overloaded_error", stopReason: "error" }),
  ]);

  let errorCount = 0;
  harness.session.subscribe((event) => {
    if (event.type !== "message_end" || event.message.role !== "assistant") return;
    if (event.message.stopReason === "error" && ++errorCount === 2)
      void harness.session.run.lifecycle.abort();
  });

  yield* Effect.promise(() => harness.session.run.prompting.prompt("test"));

  expect(harness.session.run.retry.retryAttempt).toBe(0);
  expect(harness.eventsOfType("agent_end").at(-1)?.willRetry).toBe(false);
  expect(harness.eventsOfType("auto_retry_end").at(-1)).toMatchObject({
    attempt: 1,
    finalError: "Retry cancelled",
    success: false,
  });
});
const exhaustsMaxRetriesAndEmitsA = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { baseDelayMs: 1, enabled: true, maxRetries: 2 } },
    }),
  );
  harnesses.push(harness);
  const retryEvents: string[] = [];
  harness.session.subscribe((event) => {
    if (event.type === "auto_retry_start") retryEvents.push(`start:${event.attempt}`);
    if (event.type === "auto_retry_end") retryEvents.push(`end:${event.success}`);
  });

  harness.setResponses([
    fauxAssistantMessage("", { errorMessage: "overloaded_error", stopReason: "error" }),
    fauxAssistantMessage("", { errorMessage: "overloaded_error", stopReason: "error" }),
    fauxAssistantMessage("", { errorMessage: "overloaded_error", stopReason: "error" }),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("test"));

  expect(retryEvents).toEqual(["start:1", "start:2", "end:false"]);
  expect(harness.eventsOfType("agent_end").map((event) => event.willRetry)).toEqual([
    true,
    true,
    false,
  ]);
  expect(harness.faux.state.callCount).toBe(3);
  expect(harness.session.run.retry.isRetrying).toBe(false);
});
const promptWaitsForRetryCompletionEven = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const harness = yield* Effect.promise(() =>
    createHarness({
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
      settings: { retry: { baseDelayMs: 1, enabled: true, maxRetries: 3 } },
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("", { errorMessage: "overloaded_error", stopReason: "error" }),
    fauxAssistantMessage("recovered"),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("test"));

  expect(harness.faux.state.callCount).toBe(2);
  expect(harness.session.run.retry.isRetrying).toBe(false);
});
const doesNotRetryWhenRetryIs = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({ settings: { retry: { enabled: false } } }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("", { errorMessage: "overloaded_error", stopReason: "error" }),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("test"));

  expect(harness.faux.state.callCount).toBe(1);
  expect(harness.eventsOfType("auto_retry_start")).toEqual([]);
});
const doesNotRetryNonRetryableErrors = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { baseDelayMs: 1, enabled: true, maxRetries: 3 } },
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("", { errorMessage: "invalid_api_key", stopReason: "error" }),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("test"));

  expect(harness.faux.state.callCount).toBe(1);
  expect(harness.eventsOfType("auto_retry_start")).toEqual([]);
});
const cancelsRetrySleepWhenAbortretryIs = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { baseDelayMs: 100, enabled: true, maxRetries: 3 } },
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("", { errorMessage: "overloaded_error", stopReason: "error" }),
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

  const promptPromise = harness.session.run.prompting.prompt("test");
  yield* Effect.promise(() => sawRetryStart);
  harness.session.run.retry.abortRetry();
  yield* Effect.promise(() => promptPromise);

  expect(harness.session.run.retry.isRetrying).toBe(false);
  expect(harness.eventsOfType("auto_retry_end").map((event) => event.finalError)).toContain(
    "Retry cancelled",
  );
  expect(harness.faux.state.callCount).toBe(1);
});

const agentSessionRetryEventsCases1 = {
  cancelsRetrySleepWhenAbortretryIs,
  doesNotRetryNonRetryableErrors,
  doesNotRetryWhenRetryIs,
  exhaustsMaxRetriesAndEmitsA,
  finalizesRetryStateWhenAbortIs,
  harnesses,
  normalizeEventOrder,
  promptWaitsForRetryCompletionEven,
  retriesAfterATransientErrorAnd,
  retriesMultipleTransientFailuresAndSucceeds,
};

export default agentSessionRetryEventsCases1;
