import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type agentSessionTypes from "../src/core/agent-session.types.ts";
import agentSessionRetrySupport from "./agent-session-retry-support.ts";
import sessionKit from "./session-kit.ts";

const { awaited, runTest } = testing;
const { assistantMessage, disposeWorkspace, prepareWorkspace } = sessionKit;
const { createRetrySession, delayAssistantMessageEnd, errorMessage, retryEvents, scriptedStream } =
  agentSessionRetrySupport;

let tempDir = "";

let session: agentSessionTypes.AgentSession | undefined;

const overloadedThenSuccess = (failCount: number) =>
  scriptedStream((call) =>
    call <= failCount ? errorMessage("overloaded_error") : assistantMessage("Success"),
  );

const startSession = (
  stream: ReturnType<typeof scriptedStream>,
  retry: { maxRetries: number; maxAgentDelayMs?: number },
) =>
  Effect.tap(createRetrySession({ cwd: tempDir, retry, streamFn: stream.streamFn }), (created) =>
    Effect.sync(() => {
      session = created;
    }),
  );

const retriesAfterATransientErrorAndSucceeds = () =>
  runTest(
    Effect.gen(function* () {
      const stream = overloadedThenSuccess(1);
      const created = yield* startSession(stream, { maxRetries: 3 });
      const events = retryEvents(created);
      yield* awaited(created.run.prompting.prompt("Test"));
      expect(stream.callCount()).toBe(2);
      expect(events).toEqual(["start:1", "end:success=true"]);
      expect(created.run.retry.isRetrying).toBe(false);
    }),
  );

const exhaustsMaxRetriesAndEmitsFailure = () =>
  runTest(
    Effect.gen(function* () {
      const stream = overloadedThenSuccess(99);
      const created = yield* startSession(stream, { maxRetries: 2 });
      const events = retryEvents(created);
      yield* awaited(created.run.prompting.prompt("Test"));
      expect(stream.callCount()).toBe(3);
      expect(events).toContain("start:1");
      expect(events).toContain("start:2");
      expect(events).toContain("end:success=false");
      expect(created.run.retry.isRetrying).toBe(false);
    }),
  );

const capsAgentRetryDelay = () =>
  runTest(
    Effect.gen(function* () {
      const created = yield* startSession(overloadedThenSuccess(4), {
        maxAgentDelayMs: 5,
        maxRetries: 5,
      });
      const delays: number[] = [];
      created.subscribe((event) => {
        if (event.type === "auto_retry_start") delays.push(event.delayMs);
      });
      yield* awaited(created.run.prompting.prompt("Test"));
      expect(delays).toEqual([1, 2, 4, 5]);
    }),
  );

const promptWaitsForRetryCompletionEvenWhen = () =>
  runTest(
    Effect.gen(function* () {
      const stream = overloadedThenSuccess(1);
      const created = yield* startSession(stream, { maxRetries: 3 });
      delayAssistantMessageEnd(created, 40);
      yield* awaited(created.run.prompting.prompt("Test"));
      expect(stream.callCount()).toBe(2);
      expect(created.run.retry.isRetrying).toBe(false);
    }),
  );

const retriesProviderNetworkErrorFailures = () =>
  runTest(
    Effect.gen(function* () {
      const stream = scriptedStream((call) =>
        call === 1
          ? errorMessage("Provider finish_reason: network_error")
          : assistantMessage("Recovered after retry"),
      );
      const created = yield* startSession(stream, { maxRetries: 3 });
      const events = retryEvents(created);
      yield* awaited(created.run.prompting.prompt("Test"));
      expect(stream.callCount()).toBe(2);
      expect(events).toEqual(["start:1", "end:success=true"]);
    }),
  );

const prepare = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = yield* prepareWorkspace("msa-retry-test-");
    }),
  );

const cleanUp = () =>
  runTest(
    Effect.gen(function* () {
      yield* disposeWorkspace(session, tempDir);
      session = undefined;
    }),
  );

describe("AgentSession retry", () => {
  beforeEach(prepare);

  afterEach(cleanUp);

  it("retries after a transient error and succeeds", retriesAfterATransientErrorAndSucceeds);

  it("exhausts max retries and emits failure", exhaustsMaxRetriesAndEmitsFailure);

  it("caps agent retry delay", capsAgentRetryDelay);

  it(
    "prompt waits for retry completion even when assistant message_end handling is delayed",
    promptWaitsForRetryCompletionEvenWhen,
  );

  it("retries provider network_error failures", retriesProviderNetworkErrorFailures);
});
