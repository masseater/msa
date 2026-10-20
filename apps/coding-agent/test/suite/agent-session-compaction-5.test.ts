import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import agentSessionCompaction5Support from "./agent-session-compaction-5-support.ts";
import agentSessionCompactionSupport from "./agent-session-compaction-support.ts";
import type agentSessionCompactionSupportTypes from "./agent-session-compaction-support.types.ts";
import harnessModule from "./harness.ts";

const { fauxAssistantMessage } = ai;

const { afterEachHook5 } = agentSessionCompaction5Support;

const { createAssistant, harnesses } = agentSessionCompactionSupport;

const { createHarness } = harnessModule;

const { currentTimeMillis } = testing;

const resumesAfterThresholdCompactionWhenOnly = Effect.gen(function* () {
  vi.useFakeTimers();
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) =>
            Promise.resolve({
              compaction: {
                details: {},
                firstKeptEntryId: event.preparation.firstKeptEntryId,
                summary: "auto compacted",
                tokensBefore: event.preparation.tokensBefore,
              },
            }),
          );
        },
      ],
      settings: { compaction: { keepRecentTokens: 1 } },
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
  yield* Effect.promise(() => harness.session.prompt("first"));
  yield* Effect.promise(() => harness.session.prompt("second"));

  harness.session.agent.followUp({
    content: [{ text: "queued custom", type: "text" }],
    customType: "test",
    display: false,
    role: "custom",
    timestamp: currentTimeMillis(),
  });

  const sessionInternals =
    harness.session as unknown as agentSessionCompactionSupportTypes.SessionWithCompactionInternals;

  yield* Effect.promise(() =>
    expect(sessionInternals["runAutoCompaction"]("threshold", false)).resolves.toBe(true),
  );
});

const doesNotRetryOverflowRecoveryMore = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const sessionInternals =
    harness.session as unknown as agentSessionCompactionSupportTypes.SessionWithCompactionInternals;
  const overflowMessage = createAssistant(harness, {
    errorMessage: "prompt is too long",
    stopReason: "error",
    timestamp: currentTimeMillis(),
  });
  const runAutoCompactionSpy = vi
    .spyOn(sessionInternals, "runAutoCompaction")
    .mockResolvedValue(false);
  const compactionErrors: string[] = [];
  harness.session.subscribe((event) => {
    if (
      event.type === "compaction_end" &&
      event.errorMessage !== undefined &&
      event.errorMessage !== ""
    ) {
      compactionErrors.push(event.errorMessage);
    }
  });

  yield* Effect.promise(() => sessionInternals["checkCompaction"](overflowMessage));
  yield* Effect.promise(() =>
    sessionInternals["checkCompaction"]({
      ...overflowMessage,
      timestamp: currentTimeMillis() + 1,
    }),
  );

  expect(runAutoCompactionSpy).toHaveBeenCalledTimes(1);
  expect(compactionErrors).toContain(
    "Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model.",
  );
});

const compactsSuccessfulOverflowResponsesWithoutRetrying = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) =>
            Promise.resolve({
              compaction: {
                details: {},
                firstKeptEntryId: event.preparation.firstKeptEntryId,
                summary: "successful overflow compacted",
                tokensBefore: event.preparation.tokensBefore,
              },
            }),
          );
        },
      ],
      models: [{ contextWindow: 1, id: "faux-1", maxTokens: 100 }],
      settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("completed answer")]);

  yield* Effect.promise(() => expect(harness.session.prompt("hello")).resolves.toBeUndefined());

  const compactionEnd = harness.eventsOfType("compaction_end").at(-1);
  expect(compactionEnd).toMatchObject({
    aborted: false,
    reason: "overflow",
    willRetry: false,
  });
  expect(harness.faux.state.callCount).toBe(1);
});

const resumesAfterThresholdCompactionWhenOnlyAgent = () =>
  Effect.runPromise(resumesAfterThresholdCompactionWhenOnly);

const doesNotRetryOverflowRecoveryMoreThan = () =>
  Effect.runPromise(doesNotRetryOverflowRecoveryMore);

const compactsSuccessfulOverflowResponsesWithoutRetrying2 = () =>
  Effect.runPromise(compactsSuccessfulOverflowResponsesWithoutRetrying);

describe("AgentSession compaction characterization", () => {
  afterEach(afterEachHook5);

  it(
    "resumes after threshold compaction when only agent-level queued messages exist",
    resumesAfterThresholdCompactionWhenOnlyAgent,
  );

  it("does not retry overflow recovery more than once", doesNotRetryOverflowRecoveryMoreThan);

  it(
    "compacts successful overflow responses without retrying",
    compactsSuccessfulOverflowResponsesWithoutRetrying2,
  );
});
