import type { StreamFn } from "@msa/agent-core";
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  fauxAssistantMessage,
} from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { nowMillis } from "../../test-time.ts";
import { createHarness, type Harness } from "../harness.ts";

const harnesses: Harness[] = [];

function createUsage(totalTokens: number) {
  return {
    input: totalTokens,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function seedCompactableSession(harness: Harness): void {
  harness.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
  const now = nowMillis();
  harness.sessionManager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "message to compact" }],
    timestamp: now - 1000,
  });
  const model = harness.getModel();
  const assistant: AssistantMessage = {
    ...fauxAssistantMessage("", { stopReason: "stop", timestamp: now - 500 }),
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: createUsage(100),
  };
  assistant.content = [{ type: "text", text: "assistant response to compact" }];
  harness.sessionManager.appendMessage(assistant);
  harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

function useScriptedStreamFn(harness: Harness, script: AssistantMessage[]): () => number {
  let callCount = 0;
  const streamFunction: StreamFn = (model) => {
    const message = script[callCount] ?? script[script.length - 1]!;
    callCount++;
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      const response = { ...message, api: model.api, provider: model.provider, model: model.id };
      if (response.stopReason === "pending") {
        const error: AssistantMessage = {
          ...response,
          stopReason: "error",
          errorMessage: "Scripted response ended without a stop reason",
        };
        stream.push({ type: "error", reason: "error", error });
      } else if (response.stopReason === "error" || response.stopReason === "aborted") {
        stream.push({ type: "error", reason: response.stopReason, error: response });
      } else {
        stream.push({ type: "done", reason: response.stopReason, message: response });
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
    retry: { enabled: true, maxRetries: 3, baseDelayMs: 0 },
  });

  const model = harness.getModel();
  const error = (errorMessage: string): AssistantMessage => ({
    ...fauxAssistantMessage("", { stopReason: "error", errorMessage }),
    usage: createUsage(10),
  });
  const success: AssistantMessage = {
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
  expect(starts[0]).toMatchObject({ attempt: 1, maxAttempts: 3, errorMessage: "terminated" });
  expect(starts[1]).toMatchObject({ attempt: 2, maxAttempts: 3 });
  expect(ends[0]).toMatchObject({ type: "summarization_retry_finished" });

  expect(model.id).toBeTruthy();
});

const doesNotRetryANonRetryable = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness({ withConfiguredAuth: false }));
  harnesses.push(harness);
  seedCompactableSession(harness);
  harness.settingsManager.applyOverrides({
    retry: { enabled: true, maxRetries: 3, baseDelayMs: 0 },
  });

  const error: AssistantMessage = {
    ...fauxAssistantMessage("", { stopReason: "error", errorMessage: "insufficient_quota" }),
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
    retry: { enabled: false, maxRetries: 3, baseDelayMs: 0 },
  });

  const error: AssistantMessage = {
    ...fauxAssistantMessage("", { stopReason: "error", errorMessage: "terminated" }),
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
    retry: { enabled: true, maxRetries: 2, baseDelayMs: 0 },
  });

  const error: AssistantMessage = {
    ...fauxAssistantMessage("", { stopReason: "error", errorMessage: "terminated" }),
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
    retry: { enabled: true, maxRetries: 5, baseDelayMs: 30_000 },
  });

  const error: AssistantMessage = {
    ...fauxAssistantMessage("", { stopReason: "error", errorMessage: "terminated" }),
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

describe("#6647 compaction retries transient summarization failures", () => {
  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("retries a transient `terminated` summarization error and compacts successfully", () =>
    Effect.runPromise(retriesATransientTerminatedSummarizationError));
  it("does not retry a non-retryable error (insufficient_quota)", () =>
    Effect.runPromise(doesNotRetryANonRetryable));
  it("does not retry when retry is disabled", () => Effect.runPromise(doesNotRetryWhenRetryIs));
  it("stops retrying after maxRetries and reports failure", () =>
    Effect.runPromise(stopsRetryingAfterMaxretriesAndReports));
  it("aborts an in-flight retry backoff via abortCompaction", () =>
    Effect.runPromise(abortsAnInFlightRetryBackoff));
});
