import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import agentSessionCompaction4Support from "./agent-session-compaction-4-support.ts";
import agentSessionCompactionSupport from "./agent-session-compaction-support.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { fauxAssistantMessage, fauxToolCall } = ai;

const { afterEachHook4 } = agentSessionCompaction4Support;

const { harnesses } = agentSessionCompactionSupport;

const { createHarness } = harnessModule;

const { gate } = testing;

const includesSteeringQueuedDuringCompactionInPart1 = () =>
  Effect.gen(function* () {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const largeTool: agentTypes.AgentTool = {
      description: "Returns enough content to cross the compaction threshold",
      execute: () =>
        Promise.resolve({
          content: [{ text: `large-tool-result:${"x".repeat(6800)}`, type: "text" }],
          details: {},
        }),
      label: "Large result",
      name: "large_result",
      parameters: Type.Object({}),
    };
    const compactionStarted = gate();
    const compactionReleased = gate();
    const harness = yield* Effect.promise(() =>
      createHarness({
        extensionFactories: [
          (msa) => {
            msa.on("session_before_compact", (event) =>
              runPromise(
                Effect.gen(function* () {
                  compactionStarted.release();
                  yield* Effect.promise(() => compactionReleased);
                  return {
                    compaction: {
                      details: {},
                      firstKeptEntryId: event.preparation.firstKeptEntryId,
                      summary: "compacted history",
                      tokensBefore: event.preparation.tokensBefore,
                    },
                  };
                }),
              ),
            );
          },
        ],
        models: [{ contextWindow: 2600, id: "faux-1", maxTokens: 100 }],
        settings: { compaction: { enabled: true, keepRecentTokens: 1750, reserveTokens: 400 } },
        tools: [largeTool],
      }),
    );
    return { compactionReleased, compactionStarted, harness };
  });

const includesSteeringQueuedDuringCompactionIn = Effect.gen(function* () {
  const { compactionReleased, compactionStarted, harness } =
    yield* includesSteeringQueuedDuringCompactionInPart1();
  harnesses.push(harness);
  let resumedRequest = "";
  harness.setResponses([
    fauxAssistantMessage(`old-history:${"a".repeat(800)}`),
    fauxAssistantMessage(`recent-history:${"b".repeat(800)}`),
    fauxAssistantMessage(fauxToolCall("large_result", {}), { stopReason: "toolUse" }),
    (context) => {
      resumedRequest = JSON.stringify(context.messages);
      return fauxAssistantMessage("finished after compaction");
    },
    fauxAssistantMessage("finished after delayed steering"),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("seed old history"));
  yield* Effect.promise(() => harness.session.run.prompting.prompt("seed recent history"));
  const promptPromise = harness.session.run.prompting.prompt("run the large tool");
  yield* Effect.promise(() => compactionStarted);
  yield* Effect.promise(() => harness.session.run.queue.steer("change direction"));
  compactionReleased.release();
  yield* Effect.promise(() => promptPromise);

  expect(resumedRequest).toContain("change direction");
  expect(harness.faux.state.callCount).toBe(4);
});

const doesNotCompactAfterATerminating = Effect.gen(function* () {
  const terminatingTool: agentTypes.AgentTool = {
    description: "Returns enough content to cross the compaction threshold, then terminates",
    execute: () =>
      Promise.resolve({
        content: [{ text: `large-tool-result:${"x".repeat(6800)}`, type: "text" }],
        details: {},
        terminate: true,
      }),
    label: "Terminate with large result",
    name: "terminate_with_large_result",
    parameters: Type.Object({}),
  };
  return yield* doesNotCompactAfterATerminatingStep1(terminatingTool);
});

const doesNotCompactAfterATerminatingStep1 = (terminatingTool: agentTypes.AgentTool<any, any>) =>
  Effect.gen(function* () {
    const harness = yield* Effect.promise(() =>
      createHarness({
        extensionFactories: [
          (msa) => {
            msa.on("session_before_compact", (event) => ({
              compaction: {
                details: {},
                firstKeptEntryId: event.preparation.firstKeptEntryId,
                summary: "unexpected compaction",
                tokensBefore: event.preparation.tokensBefore,
              },
            }));
          },
        ],
        models: [{ contextWindow: 2600, id: "faux-1", maxTokens: 100 }],
        settings: { compaction: { enabled: true, keepRecentTokens: 1750, reserveTokens: 400 } },
        tools: [terminatingTool],
      }),
    );
    harnesses.push(harness);
    harness.setResponses([
      fauxAssistantMessage(`old-history:${"a".repeat(800)}`),
      fauxAssistantMessage(`recent-history:${"b".repeat(800)}`),
      fauxAssistantMessage(fauxToolCall("terminate_with_large_result", {}), {
        stopReason: "toolUse",
      }),
    ]);
    yield* Effect.promise(() => harness.session.run.prompting.prompt("seed old history"));
    return yield* doesNotCompactAfterATerminatingStep2(harness);
  });

const doesNotCompactAfterATerminatingStep2 = (harness: harnessTypes.Harness) =>
  Effect.gen(function* () {
    yield* Effect.promise(() => harness.session.run.prompting.prompt("seed recent history"));
    yield* Effect.promise(() => harness.session.run.prompting.prompt("run the terminating tool"));
    expect(harness.eventsOfType("compaction_start")).toEqual([]);
    expect(
      harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction"),
    ).toEqual([]);
    expect(harness.getPendingResponseCount()).toBe(0);
  });

const doesNotCompactWhenALength = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ contextWindow: 1_000_000, id: "faux-1", maxTokens: 100 }],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("x".repeat(400), { stopReason: "length" })]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("hello"));

  expect(harness.faux.state.callCount).toBe(1);
  expect(harness.eventsOfType("compaction_start")).toHaveLength(0);
});

const includesSteeringQueuedDuringCompactionInThe = () =>
  Effect.runPromise(includesSteeringQueuedDuringCompactionIn);

const doesNotCompactAfterATerminatingTool = () =>
  Effect.runPromise(doesNotCompactAfterATerminating);

const doesNotCompactWhenALengthStop = () => Effect.runPromise(doesNotCompactWhenALength);

describe("AgentSession compaction characterization", () => {
  afterEach(afterEachHook4);

  it(
    "includes steering queued during compaction in the resumed assistant request",
    includesSteeringQueuedDuringCompactionInThe,
  );

  it("does not compact after a terminating tool result", doesNotCompactAfterATerminatingTool);

  it(
    "does not compact when a length stop reaches the desired output limit",
    doesNotCompactWhenALengthStop,
  );
});
