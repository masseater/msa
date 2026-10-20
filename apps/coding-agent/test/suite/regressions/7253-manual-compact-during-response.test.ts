import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { fauxAssistantMessage, fauxToolCall } = ai;

const { createHarness } = harnessModule;

const { gate } = testing;

function createNoopTool(): agentTypes.AgentTool {
  return {
    description: "Return immediately",
    execute: () => Promise.resolve({ content: [{ text: "done", type: "text" }], details: {} }),
    label: "No-op",
    name: "noop",
    parameters: Type.Object({}),
  };
}

const harnesses: harnessTypes.Harness[] = [];

const persistsTheAbortedResponseBeforeRunningPart1 = () =>
  Effect.gen(function* () {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const secondResponseStarted = gate();
    const secondResponseReleased = gate();

    const harness = yield* Effect.promise(() =>
      createHarness({
        extensionFactories: [
          (msa) => {
            msa.on("session_before_compact", (event) =>
              Promise.resolve({
                compaction: {
                  details: {},
                  firstKeptEntryId: event.preparation.firstKeptEntryId,
                  summary: `${event.reason} summary`,
                  tokensBefore: event.preparation.tokensBefore,
                },
              }),
            );
          },
        ],
        models: [{ contextWindow: 1000, id: "faux-1", maxTokens: 1000 }],
        settings: { compaction: { enabled: true, keepRecentTokens: 2, reserveTokens: 200 } },
        tools: [createNoopTool()],
      }),
    );
    return { harness, runPromise, secondResponseReleased, secondResponseStarted };
  });

const persistsTheAbortedResponseBeforeRunning = Effect.gen(function* () {
  const { harness, runPromise, secondResponseReleased, secondResponseStarted } =
    yield* persistsTheAbortedResponseBeforeRunningPart1();
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("noop", {}), { stopReason: "toolUse" }),
    () =>
      runPromise(
        Effect.gen(function* () {
          secondResponseStarted.release();
          yield* Effect.promise(() => secondResponseReleased);
          return fauxAssistantMessage(`second response:${"x".repeat(4000)}`);
        }),
      ),
  ]);

  const promptPromise = harness.session.run.prompting.prompt(
    "Run the tool, then continue responding.",
  );
  yield* Effect.promise(() => secondResponseStarted);

  const compactPromise = harness.session.compaction.manual.compact();
  const compactExpectation = expect(compactPromise).resolves.toMatchObject({
    summary: "manual summary",
  });
  secondResponseReleased.release();
  yield* Effect.promise(() => Promise.all([promptPromise, compactExpectation]));

  expect(harness.eventsOfType("compaction_start").map((event) => event.reason)).toEqual(["manual"]);
  expect(harness.eventsOfType("compaction_end").map((event) => event.reason)).toEqual(["manual"]);
  const entries = harness.sessionManager.getEntries();
  const abortedResponseIndex = entries.findIndex(
    (entry) =>
      entry.type === "message" &&
      entry.message.role === "assistant" &&
      entry.message.stopReason === "aborted",
  );
  const compactionIndex = entries.findIndex((entry) => entry.type === "compaction");
  expect(abortedResponseIndex).toBeGreaterThan(-1);
  expect(compactionIndex).toBeGreaterThan(abortedResponseIndex);
  expect(entries.filter((entry) => entry.type === "compaction")).toHaveLength(1);
});

const persistsTheAbortedResponseBeforeRunningThe = () =>
  Effect.runPromise(persistsTheAbortedResponseBeforeRunning);

const afterEachHook = () => {
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

describe("issue #7253: manual compaction during an active response", () => {
  afterEach(afterEachHook);
  it(
    "persists the aborted response before running the requested manual compaction",
    persistsTheAbortedResponseBeforeRunningThe,
  );
});
