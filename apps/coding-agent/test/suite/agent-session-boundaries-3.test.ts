import type { AgentTool } from "@msa/agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import agentSessionBoundariesSupport from "./agent-session-boundaries-support.ts";
import harnessModule from "./harness.ts";

const { harnesses } = agentSessionBoundariesSupport;

const { createHarness } = harnessModule;

const doesNotLetAnInvalidExplicit = Effect.gen(function* () {
  const tool: AgentTool = {
    description: "Noop",
    execute: () => Promise.resolve({ content: [{ text: "done", type: "text" }], details: {} }),
    label: "Noop",
    name: "noop",
    parameters: Type.Object({}),
  };
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("turn_end", (event, ctx) => {
            const user = [...ctx.sessionManager.getBranch()]
              .reverse()
              .find((entry) => entry.type === "message" && entry.message.role === "user");
            if (user === undefined) throw new Error("missing user entry");
            return {
              continue: true,
              entries: [user.id, event.messageEntryId, ...event.toolResultEntryIds].map(
                (targetId) => ({
                  replacement: null,
                  targetId,
                  type: "context_edit" as const,
                }),
              ),
            };
          });
        },
      ],
      tools: [tool],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("noop", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("must not run"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(harness.faux.state.callCount).toBe(2);
});

const dispatchesActionableTurnEndForSynthetic = Effect.gen(function* () {
  let turnEnds = 0;
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("turn_end", (event) => {
            turnEnds++;
            expect(event.outcome).toBe("error");
            return {
              entries: [{ customType: "failure-boundary", data: true, type: "custom" }],
            };
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.session.agent.prepareRequest = () => {
    throw new Error("request preparation failed");
  };

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(turnEnds).toBe(1);
  expect(harness.faux.state.callCount).toBe(0);
  expect(harness.sessionManager.getEntries()).toContainEqual(
    expect.objectContaining({ customType: "failure-boundary", type: "custom" }),
  );
});

const doesNotCompactFromUsageBelonging = Effect.gen(function* () {
  let handled = false;
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("message_end", (event) => {
            if (event.message.role !== "assistant") return;
            return {
              message: {
                ...event.message,
                usage: {
                  ...event.message.usage,
                  input: 9_800,
                  output: 1,
                  totalTokens: 9_801,
                },
              },
            };
          });
          msa.on("turn_end", (event) => {
            if (handled) return;
            handled = true;
            return {
              entries: [
                { replacement: null, targetId: event.messageEntryId, type: "context_edit" },
              ],
            };
          });
        },
      ],
      initialActiveToolNames: ["read"],
      models: [{ contextWindow: 10_000, id: "faux-1", maxTokens: 100 }],
      settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 300 } },
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("short response")]);

  yield* Effect.promise(() => harness.session.prompt("small prompt"));

  expect(harness.eventsOfType("compaction_start")).toEqual([]);
  expect(harness.session.getContextUsage()?.tokens).toBeLessThan(4_000);
});

const doesNotTriggerSuccessfulResponseOverflow = Effect.gen(function* () {
  let handled = false;
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("message_end", (event) => {
            if (event.message.role !== "assistant") return;
            return {
              message: {
                ...event.message,
                usage: {
                  ...event.message.usage,
                  input: 5_100,
                  output: 1,
                  totalTokens: 5_101,
                },
              },
            };
          });
          msa.on("turn_end", (_event, ctx) => {
            if (handled) return;
            handled = true;
            const user = [...ctx.sessionManager.getBranch()]
              .reverse()
              .find((entry) => entry.type === "message" && entry.message.role === "user");
            if (user === undefined) throw new Error("missing user entry");
            return {
              entries: [{ replacement: null, targetId: user.id, type: "context_edit" }],
            };
          });
        },
      ],
      initialActiveToolNames: ["read"],
      models: [{ contextWindow: 5_000, id: "faux-1", maxTokens: 100 }],
      settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("done")]);

  yield* Effect.promise(() => harness.session.prompt("large input that is later omitted"));

  expect(harness.eventsOfType("compaction_start")).toEqual([]);
  expect(harness.session.getContextUsage()?.tokens).toBeLessThan(3_000);
});

const doesNotLetAnInvalidExplicitContinuation = () =>
  Effect.runPromise(doesNotLetAnInvalidExplicit);

const dispatchesActionableTurnEndForSyntheticRun = () =>
  Effect.runPromise(dispatchesActionableTurnEndForSynthetic);

const doesNotCompactFromUsageBelongingTo = () =>
  Effect.runPromise(doesNotCompactFromUsageBelonging);

const doesNotTriggerSuccessfulResponseOverflowFrom = () =>
  Effect.runPromise(doesNotTriggerSuccessfulResponseOverflow);

describe("AgentSession actionable boundaries", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it(
    "does not let an invalid explicit continuation suppress natural tool continuation",
    doesNotLetAnInvalidExplicitContinuation,
  );

  it(
    "dispatches actionable turn_end for synthetic run failures",
    dispatchesActionableTurnEndForSyntheticRun,
  );
});

describe("AgentSession actionable boundaries", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it(
    "does not compact from usage belonging to a boundary-omitted assistant",
    doesNotCompactFromUsageBelongingTo,
  );

  it(
    "does not trigger successful-response overflow from usage captured before a boundary edit",
    doesNotTriggerSuccessfulResponseOverflowFrom,
  );
});
