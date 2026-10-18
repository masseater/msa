import type { AgentTool } from "@msa/agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { createHarness, type Harness } from "../harness.ts";

function createNoopTool(): AgentTool {
  return {
    name: "noop",
    label: "No-op",
    description: "Return immediately",
    parameters: Type.Object({}),
    execute: () => Promise.resolve({ content: [{ type: "text", text: "done" }], details: {} }),
  };
}

const harnesses: Harness[] = [];

const persistsTheAbortedResponseBeforeRunning = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let markSecondResponseStarted = () => {};
  const secondResponseStarted = new Promise<void>((resolve) => {
    markSecondResponseStarted = resolve;
  });
  let releaseSecondResponse = () => {};
  const secondResponseReleased = new Promise<void>((resolve) => {
    releaseSecondResponse = resolve;
  });

  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ id: "faux-1", contextWindow: 1000, maxTokens: 1000 }],
      settings: { compaction: { enabled: true, reserveTokens: 200, keepRecentTokens: 2 } },
      tools: [createNoopTool()],
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) =>
            Promise.resolve({
              compaction: {
                summary: `${event.reason} summary`,
                firstKeptEntryId: event.preparation.firstKeptEntryId,
                tokensBefore: event.preparation.tokensBefore,
                details: {},
              },
            }),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("noop", {}), { stopReason: "toolUse" }),
    () =>
      runPromise(
        Effect.gen(function* () {
          markSecondResponseStarted();
          yield* Effect.promise(() => secondResponseReleased);
          return fauxAssistantMessage(`second response:${"x".repeat(4000)}`);
        }),
      ),
  ]);

  const promptPromise = harness.session.prompt("Run the tool, then continue responding.");
  yield* Effect.promise(() => secondResponseStarted);

  const compactPromise = harness.session.compact();
  const compactExpectation = expect(compactPromise).resolves.toMatchObject({
    summary: "manual summary",
  });
  releaseSecondResponse();
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

describe("issue #7253: manual compaction during an active response", () => {
  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("persists the aborted response before running the requested manual compaction", () =>
    Effect.runPromise(persistsTheAbortedResponseBeforeRunning));
});
