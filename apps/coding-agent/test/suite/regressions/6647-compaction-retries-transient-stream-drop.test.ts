import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { createAssistantMessageEventStream, fauxAssistantMessage } = ai;

const { createHarness } = harnessModule;

const { currentTimeMillis } = testing;

const harnesses: harnessTypes.Harness[] = [];

function createUsage(totalTokens: number) {
  return {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: totalTokens,
    output: 0,
    totalTokens,
  };
}

function seedCompactableSession(harness: harnessTypes.Harness): void {
  harness.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
  const now = currentTimeMillis();
  harness.sessionManager.appendMessage({
    content: [{ text: "message to compact", type: "text" }],
    role: "user",
    timestamp: now - 1000,
  });
  const model = harness.getModel();
  const assistant: aiTypes.AssistantMessage = {
    ...fauxAssistantMessage("", { stopReason: "stop", timestamp: now - 500 }),
    api: model.api,
    model: model.id,
    provider: model.provider,
    usage: createUsage(100),
  };
  assistant.content = [{ text: "assistant response to compact", type: "text" }];
  harness.sessionManager.appendMessage(assistant);
  harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

function useScriptedStreamFn(
  harness: harnessTypes.Harness,
  script: aiTypes.AssistantMessage[],
): () => number {
  let callCount = 0;
  const streamFunction: agentTypes.StreamFn = (model) => {
    const message = script[callCount] ?? script[script.length - 1]!;
    callCount++;
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      const response = { ...message, api: model.api, model: model.id, provider: model.provider };
      if (response.stopReason === "pending") {
        const error: aiTypes.AssistantMessage = {
          ...response,
          errorMessage: "Scripted response ended without a stop reason",
          stopReason: "error",
        };
        stream.push({ error, reason: "error", type: "error" });
      } else if (response.stopReason === "error" || response.stopReason === "aborted") {
        stream.push({ error: response, reason: response.stopReason, type: "error" });
      } else {
        stream.push({ message: response, reason: response.stopReason, type: "done" });
      }
    });
    return stream;
  };
  harness.session.agent.streamFunction = streamFunction;
  return () => callCount;
}

const retriesATransientTerminatedSummarizationError = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness({ withConfiguredAuth: false }));
  harnesses.push(harness);
  seedCompactableSession(harness);
  harness.settingsManager.applyOverrides({
    retry: { baseDelayMs: 0, enabled: true, maxRetries: 3 },
  });

  const model = harness.getModel();
  const error = (errorMessage: string): aiTypes.AssistantMessage => ({
    ...fauxAssistantMessage("", { errorMessage, stopReason: "error" }),
    usage: createUsage(10),
  });
  const success: aiTypes.AssistantMessage = {
    ...fauxAssistantMessage("recovered summary"),
    usage: createUsage(10),
  };
  const getCallCount = useScriptedStreamFn(harness, [
    error("terminated"),
    error("terminated"),
    success,
  ]);

  const result = yield* Effect.promise(() => harness.session.compact());

  expect(result.summary).toContain("recovered summary");
  expect(getCallCount()).toBe(3);
  const starts = harness.eventsOfType("summarization_retry_scheduled");
  const ends = harness.eventsOfType("summarization_retry_finished");
  expect(starts).toHaveLength(2);
  expect(ends).toHaveLength(1);
  expect(starts[0]).toMatchObject({ attempt: 1, errorMessage: "terminated", maxAttempts: 3 });
  expect(starts[1]).toMatchObject({ attempt: 2, maxAttempts: 3 });
  expect(ends[0]).toMatchObject({ type: "summarization_retry_finished" });

  expect(model.id).toBeTruthy();
});

const doesNotRetryANonRetryable = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness({ withConfiguredAuth: false }));
  harnesses.push(harness);
  seedCompactableSession(harness);
  harness.settingsManager.applyOverrides({
    retry: { baseDelayMs: 0, enabled: true, maxRetries: 3 },
  });

  const error: aiTypes.AssistantMessage = {
    ...fauxAssistantMessage("", { errorMessage: "insufficient_quota", stopReason: "error" }),
    usage: createUsage(10),
  };
  const getCallCount = useScriptedStreamFn(harness, [error]);

  yield* Effect.promise(() =>
    expect(harness.session.compact()).rejects.toThrow("insufficient_quota"),
  );
  expect(getCallCount()).toBe(1);
  expect(harness.eventsOfType("summarization_retry_scheduled")).toHaveLength(0);
});

const doesNotRetryWhenRetryIs = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness({ withConfiguredAuth: false }));
  harnesses.push(harness);
  seedCompactableSession(harness);
  harness.settingsManager.applyOverrides({
    retry: { baseDelayMs: 0, enabled: false, maxRetries: 3 },
  });

  const error: aiTypes.AssistantMessage = {
    ...fauxAssistantMessage("", { errorMessage: "terminated", stopReason: "error" }),
    usage: createUsage(10),
  };
  const getCallCount = useScriptedStreamFn(harness, [error]);

  yield* Effect.promise(() => expect(harness.session.compact()).rejects.toThrow("terminated"));
  expect(getCallCount()).toBe(1);
  expect(harness.eventsOfType("summarization_retry_scheduled")).toHaveLength(0);
});

const stopsRetryingAfterMaxretriesAndReports = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness({ withConfiguredAuth: false }));
  harnesses.push(harness);
  seedCompactableSession(harness);
  harness.settingsManager.applyOverrides({
    retry: { baseDelayMs: 0, enabled: true, maxRetries: 2 },
  });

  const error: aiTypes.AssistantMessage = {
    ...fauxAssistantMessage("", { errorMessage: "terminated", stopReason: "error" }),
    usage: createUsage(10),
  };
  const getCallCount = useScriptedStreamFn(harness, [error, error, error]);

  yield* Effect.promise(() => expect(harness.session.compact()).rejects.toThrow("terminated"));
  expect(getCallCount()).toBe(3);
  const starts = harness.eventsOfType("summarization_retry_scheduled");
  const ends = harness.eventsOfType("summarization_retry_finished");
  expect(starts).toHaveLength(2);
  expect(ends).toHaveLength(1);
  expect(ends[0]).toMatchObject({ type: "summarization_retry_finished" });
});

const abortsAnInFlightRetryBackoff = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness({ withConfiguredAuth: false }));
  harnesses.push(harness);
  seedCompactableSession(harness);
  harness.settingsManager.applyOverrides({
    retry: { baseDelayMs: 30_000, enabled: true, maxRetries: 5 },
  });

  const error: aiTypes.AssistantMessage = {
    ...fauxAssistantMessage("", { errorMessage: "terminated", stopReason: "error" }),
    usage: createUsage(10),
  };
  useScriptedStreamFn(harness, [error, error, error]);

  const compactPromise = harness.session.compact();

  yield* Effect.sleep(0);
  harness.session.abortCompaction();

  yield* Effect.promise(() => expect(compactPromise).rejects.toThrow());
  const compactionEnd = harness.eventsOfType("compaction_end").at(-1);
  expect(compactionEnd).toMatchObject({ aborted: true });
});

const retriesATransientTerminatedSummarizationErrorAnd = () =>
  Effect.runPromise(retriesATransientTerminatedSummarizationError);

const doesNotRetryANonRetryableError = () => Effect.runPromise(doesNotRetryANonRetryable);

const doesNotRetryWhenRetryIsDisabled = () => Effect.runPromise(doesNotRetryWhenRetryIs);

const stopsRetryingAfterMaxretriesAndReportsFailure = () =>
  Effect.runPromise(stopsRetryingAfterMaxretriesAndReports);

const abortsAnInFlightRetryBackoffVia = () => Effect.runPromise(abortsAnInFlightRetryBackoff);

const afterEachHook = () => {
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

describe("#6647 compaction retries transient summarization failures", () => {
  afterEach(afterEachHook);
  it(
    "retries a transient `terminated` summarization error and compacts successfully",
    retriesATransientTerminatedSummarizationErrorAnd,
  );
  it("does not retry a non-retryable error (insufficient_quota)", doesNotRetryANonRetryableError);
  it("does not retry when retry is disabled", doesNotRetryWhenRetryIsDisabled);
  it(
    "stops retrying after maxRetries and reports failure",
    stopsRetryingAfterMaxretriesAndReportsFailure,
  );
  it("aborts an in-flight retry backoff via abortCompaction", abortsAnInFlightRetryBackoffVia);
});
