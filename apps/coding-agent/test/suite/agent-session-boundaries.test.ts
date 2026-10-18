import type { AgentTool } from "@msa/agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { currentTimeMillis, gate } from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createHarness, getMessageText, type Harness } from "./harness.ts";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  const promise = gate();
  return { promise, resolve: () => promise.release() };
}

const harnesses: Harness[] = [];

const commitsARetainNoneTurnEnd = Effect.gen(function* () {
  let handled = false;
  const observedIds: string[] = [];
  const requests: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("turn_end", (event) => {
            observedIds.push(event.messageEntryId);
            if (handled) return;
            handled = true;
            return {
              entries: [
                {
                  type: "compaction",
                  summary: "exact handoff",
                  firstKeptEntryId: null,
                  details: { source: "test" },
                },
              ],
              continue: true,
            };
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  return yield* commitsARetainNoneTurnEndPart2(observedIds, requests, harness);
});

const commitsARetainNoneTurnEndPart2 = (
  observedIds: string[],
  requests: string[],
  harness: Harness,
) =>
  Effect.gen(function* () {
    harness.setResponses([
      fauxAssistantMessage("discarded response"),
      (context) => {
        requests.push(JSON.stringify(context.messages));
        return fauxAssistantMessage("continued from handoff");
      },
    ]);
    yield* Effect.promise(() => harness.session.prompt("discarded prompt"));
    const compaction = harness.sessionManager
      .getEntries()
      .find((entry) => entry.type === "compaction");
    expect(compaction).toMatchObject({ type: "compaction", summary: "exact handoff" });
    if (compaction?.type !== "compaction") throw new Error("expected compaction");
    expect(compaction.firstKeptEntryId).toBe(compaction.id);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("exact handoff");
    expect(requests[0]).not.toContain("discarded prompt");
    expect(requests[0]).not.toContain("discarded response");
    expect(observedIds).toHaveLength(2);
    expect(harness.eventsOfType("agent_settled")).toHaveLength(1);
  });

const keepsABoundaryReplacementVerbatimThrough = Effect.gen(function* () {
  let handled = false;
  const requests: string[] = [];
  const instruction = "EXACT-REPLACEMENT-INSTRUCTION ".repeat(100);
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ id: "faux-1", contextWindow: 2_000, maxTokens: 100 }],
      settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
      extensionFactories: [
        (msa) => {
          msa.on("turn_end", (event, ctx) => {
            if (handled) return;
            handled = true;
            const user = [...ctx.sessionManager.getBranch()]
              .reverse()
              .find((entry) => entry.type === "message" && entry.message.role === "user");
            if (user === undefined) throw new Error("missing user entry");
            return {
              entries: [
                {
                  type: "context_edit",
                  targetId: user.id,
                  replacement: { content: instruction },
                },
                { type: "context_edit", targetId: event.messageEntryId, replacement: null },
                { type: "custom", customType: "bookkeeping", data: { source: "test" } },
              ],
              continue: true,
            };
          });
          msa.on("session_before_compact", (event) => ({
            compaction: {
              summary: "older history summary",
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              tokensBefore: event.preparation.tokensBefore,
            },
          }));
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.sessionManager.appendMessage({
    role: "user",
    content: "older input",
    timestamp: currentTimeMillis() - 2,
  });
  harness.sessionManager.appendMessage(
    fauxAssistantMessage("older answer", { timestamp: currentTimeMillis() - 1 }),
  );
  harness.session.refreshContext();
  harness.setResponses([
    fauxAssistantMessage("answered original input"),
    (context) => {
      requests.push(JSON.stringify(context.messages));
      return fauxAssistantMessage("answered replacement");
    },
  ]);

  yield* Effect.promise(() => harness.session.prompt("original input"));

  expect(harness.eventsOfType("compaction_start").length).toBeGreaterThan(0);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain("EXACT-REPLACEMENT-INSTRUCTION");
});

const keepsBoundaryInputVerbatimThroughThreshold = Effect.gen(function* () {
  let handled = false;
  const requests: string[] = [];
  const instruction = "EXACT-UNSENT-INSTRUCTION ".repeat(100);
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ id: "faux-1", contextWindow: 2_000, maxTokens: 100 }],
      settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
      extensionFactories: [
        (msa) => {
          msa.on("turn_end", () => {
            if (handled) return;
            handled = true;
            return {
              entries: [
                {
                  type: "custom_message",
                  customType: "next-work",
                  content: instruction,
                  display: false,
                },
                { type: "custom", customType: "bookkeeping", data: { source: "test" } },
              ],
              continue: true,
            };
          });
          msa.on("session_before_compact", (event) => ({
            compaction: {
              summary: "older history summary",
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              tokensBefore: event.preparation.tokensBefore,
            },
          }));
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("first"),
    (context) => {
      requests.push(JSON.stringify(context.messages));
      return fauxAssistantMessage("second");
    },
  ]);

  yield* Effect.promise(() => harness.session.prompt("old input ".repeat(500)));

  expect(harness.eventsOfType("compaction_start").length).toBeGreaterThan(0);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain("EXACT-UNSENT-INSTRUCTION");
});

const refreshesCanonicalContextBeforePublishingBoundary = Effect.gen(function* () {
  let handled = false;
  const snapshots: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("turn_end", () => {
            if (handled) return;
            handled = true;
            return {
              entries: [
                { type: "custom", customType: "metadata", data: true },
                {
                  type: "custom_message",
                  customType: "visible-context",
                  content: "committed context",
                  display: true,
                },
              ],
            };
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.session.subscribe((event) => {
    if (event.type === "entry_appended") snapshots.push(JSON.stringify(harness.session.messages));
  });
  harness.setResponses([fauxAssistantMessage("done")]);

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(snapshots).toHaveLength(2);
  expect(snapshots.every((snapshot) => snapshot.includes("committed context"))).toBe(true);
});

const continuesFromAnAgentBeforeSettle = Effect.gen(function* () {
  let requested = false;
  const requests: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("agent_before_settle", () => {
            if (requested) return;
            requested = true;
            return {
              entries: [
                {
                  type: "custom_message",
                  customType: "test-continuation",
                  content: "continue now",
                  display: false,
                },
              ],
              continue: true,
            };
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  return yield* continuesFromAnAgentBeforeSettlePart2(requests, harness);
});

const continuesFromAnAgentBeforeSettlePart2 = (requests: string[], harness: Harness) =>
  Effect.gen(function* () {
    harness.setResponses([
      fauxAssistantMessage("first"),
      (context) => {
        requests.push(JSON.stringify(context.messages));
        return fauxAssistantMessage("second");
      },
    ]);
    yield* Effect.promise(() => harness.session.prompt("start"));
    expect(requests[0]).toContain("continue now");
    expect(harness.sessionManager.getEntries()).toContainEqual(
      expect.objectContaining({
        type: "custom_message",
        customType: "test-continuation",
        display: false,
      }),
    );
    expect(harness.eventsOfType("agent_start")).toHaveLength(2);
    expect(harness.eventsOfType("agent_settled")).toHaveLength(1);
  });

const persistsCustomContextQueuedByAgent = Effect.gen(function* () {
  let firstRun = true;
  let continued = false;
  const requests: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("agent_end", () => {
            if (!firstRun) return;
            firstRun = false;
            msa.sendMessage(
              {
                customType: "agent-end-context",
                content: "queued after agent end",
                display: false,
              },
              { triggerTurn: false },
            );
          });
          msa.on("agent_before_settle", (event) => {
            if (continued) return;
            continued = true;
            expect(JSON.stringify(event.context.pendingMessages)).toContain(
              "queued after agent end",
            );
            expect(JSON.stringify(event.context.contextMessages)).not.toContain(
              "queued after agent end",
            );
            return { continue: true };
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("first"),
    (context) => {
      requests.push(JSON.stringify(context.messages));
      return fauxAssistantMessage("second");
    },
  ]);

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(requests[0]).toContain("queued after agent end");
  expect(harness.sessionManager.getEntries()).toContainEqual(
    expect.objectContaining({ type: "custom_message", customType: "agent-end-context" }),
  );
});

const keepsAPreSettlementFollowUp = Effect.gen(function* () {
  let handled = false;
  const requests: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("agent_before_settle", () => {
            if (handled) return;
            handled = true;
            msa.sendUserMessage("queued follow-up", { deliverAs: "followUp" });
            return {
              entries: [
                {
                  type: "custom_message",
                  customType: "boundary",
                  content: "boundary context",
                  display: false,
                },
              ],
              continue: true,
            };
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  return yield* keepsAPreSettlementFollowUpPart2(requests, harness);
});

const keepsAPreSettlementFollowUpPart2 = (requests: string[], harness: Harness) =>
  Effect.gen(function* () {
    harness.setResponses([
      fauxAssistantMessage("first"),
      (context) => {
        requests.push(JSON.stringify(context.messages));
        return fauxAssistantMessage("second");
      },
      (context) => {
        requests.push(JSON.stringify(context.messages));
        return fauxAssistantMessage("follow-up response");
      },
    ]);
    yield* Effect.promise(() => harness.session.prompt("start"));
    expect(harness.faux.state.callCount).toBe(3);
    expect(requests[0]).toContain("boundary context");
    expect(requests[0]).not.toContain("queued follow-up");
    expect(requests[1]).toContain("queued follow-up");
  });

const defersRunsStartedByAgentSettled = Effect.gen(function* () {
  let triggered = false;
  const lifecycle: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("agent_start", () => {
            lifecycle.push("start");
          });
          msa.on("agent_settled", (_event, ctx) => {
            lifecycle.push(`settled-first:${ctx.isIdle()}`);
            if (triggered) return;
            triggered = true;
            msa.sendMessage(
              { customType: "settled-trigger", content: "start later", display: false },
              { triggerTurn: true },
            );
          });
          msa.on("agent_settled", (_event, ctx) => {
            lifecycle.push(`settled-second:${ctx.isIdle()}`);
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(lifecycle).toEqual([
    "start",
    "settled-first:true",
    "settled-second:true",
    "start",
    "settled-first:true",
    "settled-second:true",
  ]);
});

const doesNotLetAnInvalidExplicit = Effect.gen(function* () {
  const tool: AgentTool = {
    name: "noop",
    label: "Noop",
    description: "Noop",
    parameters: Type.Object({}),
    execute: () => Promise.resolve({ content: [{ type: "text", text: "done" }], details: {} }),
  };
  const harness = yield* Effect.promise(() =>
    createHarness({
      tools: [tool],
      extensionFactories: [
        (msa) => {
          msa.on("turn_end", (event, ctx) => {
            const user = [...ctx.sessionManager.getBranch()]
              .reverse()
              .find((entry) => entry.type === "message" && entry.message.role === "user");
            if (user === undefined) throw new Error("missing user entry");
            return {
              entries: [user.id, event.messageEntryId, ...event.toolResultEntryIds].map(
                (targetId) => ({
                  type: "context_edit" as const,
                  targetId,
                  replacement: null,
                }),
              ),
              continue: true,
            };
          });
        },
      ],
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
              entries: [{ type: "custom", customType: "failure-boundary", data: true }],
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
    expect.objectContaining({ type: "custom", customType: "failure-boundary" }),
  );
});

const doesNotCompactFromUsageBelonging = Effect.gen(function* () {
  let handled = false;
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ id: "faux-1", contextWindow: 10_000, maxTokens: 100 }],
      settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 300 } },
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
                { type: "context_edit", targetId: event.messageEntryId, replacement: null },
              ],
            };
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("short response")]);

  yield* Effect.promise(() => harness.session.prompt("small prompt"));

  expect(harness.eventsOfType("compaction_start")).toEqual([]);
  expect(harness.session.getContextUsage()?.tokens).toBeLessThan(2_000);
});

const doesNotTriggerSuccessfulResponseOverflow = Effect.gen(function* () {
  let handled = false;
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ id: "faux-1", contextWindow: 5_000, maxTokens: 100 }],
      settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
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
              entries: [{ type: "context_edit", targetId: user.id, replacement: null }],
            };
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("done")]);

  yield* Effect.promise(() => harness.session.prompt("large input that is later omitted"));

  expect(harness.eventsOfType("compaction_start")).toEqual([]);
  expect(harness.session.getContextUsage()?.tokens).toBeLessThan(2_000);
});

const doesNotTriggerThresholdCompactionFrom = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ id: "faux-1", contextWindow: 10_000, maxTokens: 100 }],
      settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
    }),
  );
  harnesses.push(harness);
  const userId = harness.sessionManager.appendMessage({
    role: "user",
    content: "small input",
    timestamp: currentTimeMillis() - 3,
  });
  harness.sessionManager.appendContextEdit(userId, { content: "edited input" });
  const response = fauxAssistantMessage("answer", { timestamp: currentTimeMillis() - 2 });
  response.usage = { ...response.usage, input: 50_000, output: 1, totalTokens: 50_001 };
  harness.sessionManager.appendMessage(response);
  harness.sessionManager.appendCompaction("small summary", userId, 50_001);
  harness.session.refreshContext();
  const runAutoCompaction = vi.spyOn(
    harness.session as unknown as {
      _runAutoCompaction: (
        reason: "overflow" | "threshold",
        willRetry: boolean,
      ) => Promise<boolean>;
    },
    "_runAutoCompaction",
  );
  const checkCompaction = (
    harness.session as unknown as {
      _checkCompaction: (message: ReturnType<typeof fauxAssistantMessage>) => Promise<boolean>;
    }
  )["_checkCompaction"].bind(harness.session);
  const error = fauxAssistantMessage("", {
    stopReason: "error",
    errorMessage: "invalid_api_key",
    timestamp: currentTimeMillis() + 1_000,
  });

  yield* Effect.promise(() => checkCompaction(error));

  expect(runAutoCompaction).not.toHaveBeenCalled();
});

const doesNotTreatRetainedPreCompaction = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const retained = fauxAssistantMessage("retained");
  retained.usage = { ...retained.usage, input: 10_000, totalTokens: 10_001 };
  const retainedId = harness.sessionManager.appendMessage(retained);
  harness.sessionManager.appendCompaction("summary", retainedId, 10_001);
  harness.session.refreshContext();

  expect(harness.session.getContextUsage()?.tokens).toBeNull();
});

const persistsCustomContextSentDuringPre = Effect.gen(function* () {
  let handled = false;
  const requests: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("agent_before_settle", () => {
            if (handled) return;
            handled = true;
            msa.sendMessage(
              {
                customType: "pending-boundary",
                content: "persist before continue",
                display: false,
              },
              { triggerTurn: false },
            );
            return { continue: true };
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("first"),
    (context) => {
      requests.push(JSON.stringify(context.messages));
      return fauxAssistantMessage("second");
    },
  ]);

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(harness.faux.state.callCount).toBe(2);
  expect(requests[0]).toContain("persist before continue");
  expect(harness.sessionManager.getEntries()).toContainEqual(
    expect.objectContaining({ type: "custom_message", customType: "pending-boundary" }),
  );
});

const doesNotConsumeQueuedInputWhen = Effect.gen(function* () {
  let handled = false;
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("agent_before_settle", (_event, ctx) => {
            if (handled) return;
            handled = true;
            msa.sendUserMessage("still queued", { deliverAs: "followUp" });
            const targets = ctx.sessionManager
              .getBranch()
              .flatMap((entry) =>
                entry.type === "message" &&
                (entry.message.role === "user" ||
                  entry.message.role === "assistant" ||
                  entry.message.role === "toolResult")
                  ? [entry.id]
                  : [],
              );
            return {
              entries: targets.map((targetId) => ({
                type: "context_edit" as const,
                targetId,
                replacement: null,
              })),
              continue: true,
            };
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("must not run")]);

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(harness.faux.state.callCount).toBe(1);
  expect(harness.session.pendingMessageCount).toBe(1);
});

const commitsPreSettlementDraftsButSuppresses = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const started = deferred();
  const release = deferred();
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("agent_before_settle", () =>
            runPromise(
              Effect.gen(function* () {
                started.resolve();
                yield* Effect.promise(() => release.promise);
                return {
                  entries: [{ type: "custom", customType: "committed-after-abort", data: true }],
                  continue: true,
                };
              }),
            ),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("must not run")]);

  const prompt = harness.session.prompt("start");
  yield* Effect.promise(() => started.promise);
  const abort = harness.session.abort();
  release.resolve();
  yield* Effect.promise(() => Promise.all([prompt, abort]));

  expect(harness.faux.state.callCount).toBe(1);
  expect(harness.sessionManager.getEntries()).toContainEqual(
    expect.objectContaining({
      type: "custom",
      customType: "committed-after-abort",
      data: true,
    }),
  );

  expect(harness.eventsOfType("agent_settled")).toEqual([{ type: "agent_settled", aborted: true }]);
});

describe("AgentSession actionable boundaries", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });
  it("commits a retain-none turn_end compaction and explicitly continues once", () =>
    Effect.runPromise(commitsARetainNoneTurnEnd));
  it.each(["steering", "follow-up", "both"] as const)(
    "preserves %s queue scheduling around a turn_end handoff",
    (queueKind) =>
      Effect.runPromise(
        Effect.gen(function* () {
          let handled = false;
          const requests: string[] = [];
          const harness = yield* Effect.promise(() =>
            createHarness({
              extensionFactories: [
                (msa) => {
                  msa.on("turn_end", () => {
                    if (handled) return;
                    handled = true;
                    if (queueKind === "steering" || queueKind === "both") {
                      msa.sendUserMessage("queued steering", { deliverAs: "steer" });
                    }
                    if (queueKind === "follow-up" || queueKind === "both") {
                      msa.sendUserMessage("queued follow-up", { deliverAs: "followUp" });
                    }
                    return {
                      entries: [
                        { type: "compaction", summary: "exact handoff", firstKeptEntryId: null },
                      ],
                      continue: true,
                    };
                  });
                },
              ],
            }),
          );
          harnesses.push(harness);
          harness.setResponses([
            fauxAssistantMessage("first"),
            (context) => {
              requests.push(JSON.stringify(context.messages));
              return fauxAssistantMessage("second");
            },
            (context) => {
              requests.push(JSON.stringify(context.messages));
              return fauxAssistantMessage("third");
            },
          ]);

          yield* Effect.promise(() => harness.session.prompt("start"));

          expect(requests[0]).toContain("exact handoff");
          if (queueKind === "steering") {
            expect(harness.faux.state.callCount).toBe(2);
            expect(requests[0]).toContain("queued steering");
            expect(requests[0]).not.toContain("queued follow-up");
          } else if (queueKind === "follow-up") {
            expect(harness.faux.state.callCount).toBe(2);
            expect(requests[0]).toContain("queued follow-up");
          } else {
            expect(harness.faux.state.callCount).toBe(3);
            expect(requests[0]).toContain("queued steering");
            expect(requests[0]).not.toContain("queued follow-up");
            expect(requests[1]).toContain("queued follow-up");
          }
        }),
      ),
  );
  it("keeps a boundary replacement verbatim through threshold compaction", () =>
    Effect.runPromise(keepsABoundaryReplacementVerbatimThrough));
  it("keeps boundary input verbatim through threshold compaction when metadata follows it", () =>
    Effect.runPromise(keepsBoundaryInputVerbatimThroughThreshold));
  it("refreshes canonical context before publishing boundary entry notifications", () =>
    Effect.runPromise(refreshesCanonicalContextBeforePublishingBoundary));
  it("continues from an agent_before_settle custom message before final settlement", () =>
    Effect.runPromise(continuesFromAnAgentBeforeSettle));
  it("persists custom context queued by agent_end before pre-settlement continuation", () =>
    Effect.runPromise(persistsCustomContextQueuedByAgent));
  it("keeps a pre-settlement follow-up deferred until the explicit continuation would stop", () =>
    Effect.runPromise(keepsAPreSettlementFollowUp));
  it("defers runs started by agent_settled handlers until every settled handler completes", () =>
    Effect.runPromise(defersRunsStartedByAgentSettled));
  it("does not let an invalid explicit continuation suppress natural tool continuation", () =>
    Effect.runPromise(doesNotLetAnInvalidExplicit));
  it("dispatches actionable turn_end for synthetic run failures", () =>
    Effect.runPromise(dispatchesActionableTurnEndForSynthetic));
  it("does not compact from usage belonging to a boundary-omitted assistant", () =>
    Effect.runPromise(doesNotCompactFromUsageBelonging));
  it("does not trigger successful-response overflow from usage captured before a boundary edit", () =>
    Effect.runPromise(doesNotTriggerSuccessfulResponseOverflow));
  it("does not trigger threshold compaction from post-edit usage captured before a later compaction", () =>
    Effect.runPromise(doesNotTriggerThresholdCompactionFrom));
  it("does not treat retained pre-compaction assistant usage as post-compaction usage", () =>
    Effect.runPromise(doesNotTreatRetainedPreCompaction));
  it("persists custom context sent during pre-settlement before continuing", () =>
    Effect.runPromise(persistsCustomContextSentDuringPre));
  it("does not consume queued input when pre-settlement drafts leave system-only context", () =>
    Effect.runPromise(doesNotConsumeQueuedInputWhen));
  it("commits pre-settlement drafts but suppresses continuation when aborted during the hook", () =>
    Effect.runPromise(commitsPreSettlementDraftsButSuppresses));
});

const harnesses3: Harness[] = [];

const keepsTruncatedToolAttemptsInContext = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let executed = false;
  const requests: string[] = [];
  const tool: AgentTool = {
    name: "unsafe_truncated_tool",
    label: "Unsafe truncated tool",
    description: "Must not execute from a length response",
    parameters: Type.Object({ value: Type.String() }),
    execute: () =>
      runPromise(
        Effect.sync(() => {
          executed = true;
          return { content: [{ type: "text", text: "executed" }], details: {} };
        }),
      ),
  };
  const harness = yield* Effect.promise(() => createHarness({ tools: [tool] }));
  harnesses3.push(harness);
  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("unsafe_truncated_tool", { value: "partial" }), {
      stopReason: "length",
    }),
    (context) => {
      requests.push(JSON.stringify(context.messages));
      return fauxAssistantMessage("completed natural continuation");
    },
  ]);

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(executed).toBe(false);
  expect(harness.faux.state.callCount).toBe(2);
  expect(requests[0]).toContain("may be truncated");
  expect(harness.sessionManager.getEntries().some((entry) => entry.type === "context_edit")).toBe(
    false,
  );
});

const resetsLengthRecoveryAfterASuccessful = Effect.gen(function* () {
  const tool: AgentTool = {
    name: "noop",
    label: "Noop",
    description: "Noop",
    parameters: Type.Object({}),
    execute: () => Promise.resolve({ content: [{ type: "text", text: "done" }], details: {} }),
  };
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ id: "faux-1", contextWindow: 1000, maxTokens: 100 }],
      settings: { compaction: { keepRecentTokens: 1, reserveTokens: 0 } },
      tools: [tool],
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) => ({
            compaction: {
              summary: "recovered input",
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              tokensBefore: event.preparation.tokensBefore,
            },
          }));
        },
      ],
    }),
  );
  harnesses3.push(harness);
  return yield* resetsLengthRecoveryAfterASuccessfulPart2(harness);
});

const resetsLengthRecoveryAfterASuccessfulPart2 = (harness: Harness) =>
  Effect.gen(function* () {
    harness.setResponses([
      fauxAssistantMessage("first partial", { stopReason: "length" }),
      fauxAssistantMessage(fauxToolCall("noop", {}), { stopReason: "toolUse" }),
      () =>
        fauxAssistantMessage("second partial", {
          stopReason: "length",
          timestamp: currentTimeMillis() + 1_000,
        }),
      () =>
        fauxAssistantMessage("completed second recovery", {
          timestamp: currentTimeMillis() + 2_000,
        }),
    ]);
    yield* Effect.promise(() => harness.session.prompt("x".repeat(5000)));
    const omittedIds = harness.sessionManager
      .getEntries()
      .filter((entry) => entry.type === "context_edit")
      .map((entry) => entry.targetId);
    const lengthResponses = harness.sessionManager
      .getEntries()
      .filter(
        (entry) =>
          entry.type === "message" &&
          entry.message.role === "assistant" &&
          entry.message.stopReason === "length",
      );
    expect(lengthResponses).toHaveLength(2);
    expect(omittedIds).toEqual(expect.arrayContaining(lengthResponses.map((entry) => entry.id)));
    expect(harness.faux.state.callCount).toBe(3);
  });

const givesADistinctQueuedFollowUp = Effect.gen(function* () {
  let queued = false;
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ id: "faux-1", contextWindow: 1000, maxTokens: 100 }],
      settings: { compaction: { keepRecentTokens: 1, reserveTokens: 0 } },
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) => ({
            compaction: {
              summary: "recovered input",
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              tokensBefore: event.preparation.tokensBefore,
            },
          }));
          msa.on("agent_end", (event) => {
            if (
              queued ||
              !event.messages.some((message) => getMessageText(message) === "first recovered")
            )
              return;
            queued = true;
            msa.sendUserMessage("distinct follow-up", { deliverAs: "followUp" });
          });
        },
      ],
    }),
  );
  harnesses3.push(harness);
  return yield* givesADistinctQueuedFollowUpPart2(harness);
});

const givesADistinctQueuedFollowUpPart2 = (harness: Harness) =>
  Effect.gen(function* () {
    harness.setResponses([
      fauxAssistantMessage("first partial", { stopReason: "length" }),
      fauxAssistantMessage("first recovered"),
      () =>
        fauxAssistantMessage("follow-up partial", {
          stopReason: "length",
          timestamp: currentTimeMillis() + 1_000,
        }),
      () => fauxAssistantMessage("follow-up recovered", { timestamp: currentTimeMillis() + 2_000 }),
    ]);
    yield* Effect.promise(() => harness.session.prompt("x".repeat(5000)));
    const lengthIds = harness.sessionManager
      .getEntries()
      .flatMap((entry) =>
        entry.type === "message" &&
        entry.message.role === "assistant" &&
        entry.message.stopReason === "length"
          ? [entry.id]
          : [],
      );
    const omitted = harness.sessionManager
      .getEntries()
      .flatMap((entry) => (entry.type === "context_edit" ? [entry.targetId] : []));
    expect(lengthIds).toHaveLength(2);
    expect(omitted).toEqual(expect.arrayContaining(lengthIds));
    expect(harness.faux.state.callCount).toBe(4);
  });

const finishesRetryBookkeepingWhenARetry = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 } },
    }),
  );
  harnesses3.push(harness);
  harness.setResponses([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "invalid_api_key" }),
  ]);

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(harness.faux.state.callCount).toBe(2);
  expect(harness.eventsOfType("auto_retry_end")).toContainEqual(
    expect.objectContaining({ success: false, attempt: 1, finalError: "invalid_api_key" }),
  );
});

const omitsARecoverableProjectedReplacementBy = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ id: "faux-1", contextWindow: 1_000, maxTokens: 100 }],
      settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", () => ({ cancel: true }));
        },
      ],
    }),
  );
  harnesses3.push(harness);
  harness.sessionManager.appendMessage({
    role: "user",
    content: "x".repeat(5_000),
    timestamp: currentTimeMillis() - 2,
  });
  const partial = fauxAssistantMessage("original partial", {
    stopReason: "length",
    timestamp: currentTimeMillis() - 1,
  });
  const partialId = harness.sessionManager.appendMessage(partial);
  harness.sessionManager.appendContextEdit(partialId, {
    content: [{ type: "text", text: "edited partial" }],
  });
  harness.session.refreshContext();
  harness.setResponses([fauxAssistantMessage("new answer")]);

  yield* Effect.promise(() => harness.session.prompt("next prompt"));

  const edits = harness.sessionManager
    .getEntries()
    .filter((entry) => entry.type === "context_edit");
  expect(edits.filter((entry) => entry.targetId === partialId).at(-1)?.replacement).toBeNull();
  expect(
    harness.sessionManager
      .buildSessionProjection()
      .messages.some((message) => getMessageText(message) === "edited partial"),
  ).toBe(false);
});

const recoversAnExplicitOverflowErrorAfter = Effect.gen(function* () {
  let replaced = false;
  let overflowId: string | undefined;
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ id: "faux-1", contextWindow: 1_000, maxTokens: 100 }],
      settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
      extensionFactories: [
        (msa) => {
          msa.on("turn_end", (event) => {
            if (replaced || event.outcome !== "error") return;
            replaced = true;
            overflowId = event.messageEntryId;
            return {
              entries: [
                {
                  type: "context_edit",
                  targetId: event.messageEntryId,
                  replacement: { content: [{ type: "text", text: "retained error" }] },
                },
              ],
            };
          });
          msa.on("session_before_compact", (event) => ({
            compaction: {
              summary: "recovered overflow",
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              tokensBefore: event.preparation.tokensBefore,
            },
          }));
        },
      ],
    }),
  );
  harnesses3.push(harness);
  harness.setResponses([
    fauxAssistantMessage("retained error", {
      stopReason: "error",
      errorMessage: "prompt is too long",
    }),
    fauxAssistantMessage("recovered"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("x".repeat(5_000)));

  expect(harness.faux.state.callCount).toBe(2);
  expect(overflowId).toBeDefined();
  const edits = harness.sessionManager
    .getEntries()
    .filter((entry) => entry.type === "context_edit");
  expect(edits.filter((entry) => entry.targetId === overflowId).at(-1)?.replacement).toBeNull();
});

const keepsFollowUpWorkBehindAn = Effect.gen(function* () {
  let queued = false;
  const requests: string[] = [];
  const lifecycle: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 } },
      extensionFactories: [
        (msa) => {
          msa.on("turn_end", (event) => {
            if (queued || event.outcome !== "error") return;
            queued = true;
            msa.sendUserMessage("queued follow-up", { deliverAs: "followUp" });
          });
        },
      ],
    }),
  );
  harnesses3.push(harness);
  harness.session.subscribe((event) => {
    if (event.type === "agent_end" || event.type === "auto_retry_start") lifecycle.push(event.type);
  });
  harness.setResponses([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
    (context) => {
      requests.push(JSON.stringify(context.messages));
      return fauxAssistantMessage("retry recovered");
    },
    (context) => {
      requests.push(JSON.stringify(context.messages));
      return fauxAssistantMessage("follow-up completed");
    },
  ]);

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(harness.faux.state.callCount).toBe(3);
  expect(requests[0]).not.toContain("queued follow-up");
  expect(requests[1]).toContain("queued follow-up");
  expect(lifecycle.slice(0, 2)).toEqual(["agent_end", "auto_retry_start"]);
});

const marksTheExhaustedRetryRunAs = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
    }),
  );
  harnesses3.push(harness);
  harness.setResponses([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
  ]);

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(harness.eventsOfType("agent_end").map((event) => event.willRetry)).toEqual([true, false]);
  expect(harness.eventsOfType("auto_retry_end")).toContainEqual(
    expect.objectContaining({ success: false, attempt: 1 }),
  );
});

const keepsOmissionsAndDoesNotRetry = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ id: "faux-1", contextWindow: 1000, maxTokens: 100 }],
      settings: {
        compaction: { keepRecentTokens: 1, reserveTokens: 0 },
        retry: { enabled: false, maxRetries: 0, baseDelayMs: 1 },
      },
    }),
  );
  harnesses3.push(harness);
  harness.setResponses([
    fauxAssistantMessage("partial response", { stopReason: "length" }),
    fauxAssistantMessage("summary failed", {
      stopReason: "error",
      errorMessage: "summary failed",
    }),
    fauxAssistantMessage("must not retry"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("x".repeat(5000)));

  const entries = harness.sessionManager.getEntries();
  expect(entries.some((entry) => entry.type === "context_edit")).toBe(true);
  expect(entries.some((entry) => entry.type === "compaction")).toBe(false);
  expect(
    entries.some(
      (entry) => entry.type === "message" && getMessageText(entry.message) === "partial response",
    ),
  ).toBe(true);
  expect(
    harness.sessionManager
      .buildSessionProjection()
      .messages.some((message) => getMessageText(message) === "partial response"),
  ).toBe(false);
  expect(harness.faux.state.callCount).toBe(2);
});

describe("durable length recovery", () => {
  afterEach(() => {
    while (harnesses3.length > 0) harnesses3.pop()?.cleanup();
  });
  it("keeps truncated tool attempts in context for the natural next turn", () =>
    Effect.runPromise(keepsTruncatedToolAttemptsInContext));
  it("resets length recovery after a successful intermediate assistant turn", () =>
    Effect.runPromise(resetsLengthRecoveryAfterASuccessful));
  it("gives a distinct queued follow-up its own length-recovery budget", () =>
    Effect.runPromise(givesADistinctQueuedFollowUp));
  it("finishes retry bookkeeping when a retry receives a nonretryable error", () =>
    Effect.runPromise(finishesRetryBookkeepingWhenARetry));
  it("omits a recoverable projected replacement by its source entry ID", () =>
    Effect.runPromise(omitsARecoverableProjectedReplacementBy));
  it("recovers an explicit overflow error after a retained boundary replacement", () =>
    Effect.runPromise(recoversAnExplicitOverflowErrorAfter));
  it("keeps follow-up work behind an automatic error retry", () =>
    Effect.runPromise(keepsFollowUpWorkBehindAn));
  it("marks the exhausted retry run as final", () =>
    Effect.runPromise(marksTheExhaustedRetryRunAs));
  it("keeps omissions and does not retry when recovery compaction fails", () =>
    Effect.runPromise(keepsOmissionsAndDoesNotRetry));
});
