import type { AgentMessage, AgentTool } from "@msa/agent-core";
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentSystemPrompt,
  getCurrentTools,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@msa/ai";
import { currentTimeMillis, deferredPromise, gate, toJsonText } from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { estimateTokens } from "../../src/core/compaction/index.ts";
import { createHarness, getUserTexts, type Harness } from "./harness.ts";

type SessionWithCompactionInternals = {
  _checkCompaction: (
    assistantMessage: AssistantMessage,
    skipAbortedCheck?: boolean,
  ) => Promise<boolean>;
  _runAutoCompaction: (reason: "overflow" | "threshold", willRetry: boolean) => Promise<boolean>;
};

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

function createAssistant(
  harness: Harness,
  options: {
    stopReason?: AssistantMessage["stopReason"];
    errorMessage?: string;
    totalTokens?: number;
    timestamp?: number;
  },
): AssistantMessage {
  const model = harness.getModel();
  return {
    ...fauxAssistantMessage("", {
      ...(options.stopReason === undefined ? {} : { stopReason: options.stopReason }),
      ...(options.errorMessage === undefined ? {} : { errorMessage: options.errorMessage }),
      ...(options.timestamp === undefined ? {} : { timestamp: options.timestamp }),
    }),
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: createUsage(options.totalTokens ?? 0),
  };
}

function useSummaryStreamFn(
  harness: Harness,
  summary: string,
  onRequest?: (context: TranscriptContext, options: SimpleStreamOptions | undefined) => void,
): () => number {
  let callCount = 0;
  harness.session.agent.streamFunction = (model, context, options) => {
    callCount++;
    onRequest?.(context, options);
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      const message: AssistantMessage = {
        ...fauxAssistantMessage(summary),
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: createUsage(10),
      };
      stream.push({ type: "done", reason: "stop", message });
    });
    return stream;
  };
  return () => callCount;
}

function seedCompactableSession(harness: Harness): void {
  harness.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
  const now = currentTimeMillis();
  harness.sessionManager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "message to compact" }],
    timestamp: now - 1000,
  });
  const assistant = createAssistant(harness, {
    stopReason: "stop",
    totalTokens: 100,
    timestamp: now - 500,
  });
  assistant.content = [{ type: "text", text: "assistant response to compact" }];
  harness.sessionManager.appendMessage(assistant);
  harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

function createAbortableCompactionHarness(): Promise<{
  harness: Harness;
  compactionStarted: Promise<void>;
}> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const compactionStarted = gate();
      const harness = yield* Effect.promise(() =>
        createHarness({
          settings: { compaction: { keepRecentTokens: 1 } },
          extensionFactories: [
            (msa) => {
              msa.on("session_before_compact", (event) => {
                const cancelled = deferredPromise<{ cancel: true }>();
                event.signal.addEventListener("abort", () => cancelled.resolve({ cancel: true }), {
                  once: true,
                });
                compactionStarted.release();
                return cancelled.promise;
              });
            },
          ],
        }),
      );
      seedCompactableSession(harness);
      return { harness, compactionStarted };
    }),
  );
}

const harnesses: Harness[] = [];

const manuallyCompactsUsingAnExtensionProvided = Effect.gen(function* () {
  const summaryUsage = {
    input: 10,
    output: 20,
    cacheRead: 30,
    cacheWrite: 40,
    totalTokens: 100,
    cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 },
  };
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { compaction: { keepRecentTokens: 1 } },
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) =>
            Promise.resolve({
              compaction: {
                summary: "summary from extension",
                firstKeptEntryId: event.preparation.firstKeptEntryId,
                tokensBefore: event.preparation.tokensBefore,
                usage: summaryUsage,
                details: { source: "extension" },
              },
            }),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);

  yield* Effect.promise(() => harness.session.prompt("one"));
  yield* Effect.promise(() => harness.session.prompt("two"));
  const statsBefore = harness.session.getSessionStats();

  const result = yield* Effect.promise(() => harness.session.compact());
  const compactionEntries = harness.sessionManager
    .getEntries()
    .filter((entry) => entry.type === "compaction");
  const estimatedTokensAfter = harness.session.messages.reduce(
    (sum, message) => sum + estimateTokens(message),
    0,
  );

  expect(result.summary).toBe("summary from extension");
  expect(result.usage).toEqual(summaryUsage);
  expect(result.estimatedTokensAfter).toBe(estimatedTokensAfter);
  expect(compactionEntries).toHaveLength(1);
  const compactionEntry = compactionEntries[0];
  if (compactionEntry?.type === "compaction") {
    expect(compactionEntry.usage).toEqual(summaryUsage);
  }
  const statsAfter = harness.session.getSessionStats();
  expect(statsAfter.tokens.input).toBe(statsBefore.tokens.input + summaryUsage.input);
  expect(statsAfter.tokens.output).toBe(statsBefore.tokens.output + summaryUsage.output);
  expect(statsAfter.tokens.cacheRead).toBe(statsBefore.tokens.cacheRead + summaryUsage.cacheRead);
  expect(statsAfter.tokens.cacheWrite).toBe(
    statsBefore.tokens.cacheWrite + summaryUsage.cacheWrite,
  );
  expect(statsAfter.cost).toBe(statsBefore.cost + summaryUsage.cost.total);
  expect(harness.session.messages[0]?.role).toBe("system");
  expect(harness.session.messages[1]?.role).toBe("compactionSummary");
});

const checkpointsTheReplayedSystemStateAnd = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("declared")]);
  yield* Effect.promise(() => harness.session.prompt("declare the prompt"));
  const declared = harness.session.messages[0];
  if (declared?.role !== "system") throw new Error("expected declared system message");
  harness.sessionManager.appendMessage({
    role: "system",
    content: "summarized instruction",
    sections: { early: "<early>1</early>" },
    toolsRemoved: [{ name: "bash" }],
    timestamp: currentTimeMillis(),
  });
  const firstKeptEntryId = harness.sessionManager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "kept before patch" }],
    timestamp: currentTimeMillis(),
  });
  harness.sessionManager.appendMessage({
    role: "system",
    content: "retained instruction",
    sections: { extra: "<extra>late</extra>" },
    toolsRemoved: [{ name: "read" }],
    timestamp: currentTimeMillis(),
  });
  return yield* checkpointsTheReplayedSystemStateAndPart2(harness, declared, firstKeptEntryId);
});

const checkpointsTheReplayedSystemStateAndPart2 = (
  harness: Harness,
  declared: AgentMessage | undefined,
  firstKeptEntryId: string,
) =>
  Effect.sync(() => {
    harness.sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "kept after patch" }],
      timestamp: currentTimeMillis(),
    });
    harness.sessionManager.appendCompaction("compacted", firstKeptEntryId, 100);
    const messages = harness.sessionManager.buildSessionContext().messages;
    expect(messages.map((message) => message.role)).toEqual([
      "system",
      "compactionSummary",
      "user",
      "user",
    ]);
    const checkpoint = messages[0];
    if (checkpoint?.role !== "system") throw new Error("expected checkpoint system message");
    if (declared?.role !== "system") throw new Error("expected declared system message");
    expect(checkpoint.content).toBe("summarized instruction\n\nretained instruction");
    expect(checkpoint.sections).toEqual({
      ...declared.sections,
      early: "<early>1</early>",
      extra: "<extra>late</extra>",
    });
    expect(checkpoint.toolsAdded?.map((tool) => tool.name)).toEqual(
      harness.session.getActiveToolNames().filter((name) => name !== "read" && name !== "bash"),
    );
  });

const allowsAQueuedPromptToStart = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { compaction: { keepRecentTokens: 1 } },
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) =>
            Promise.resolve({
              compaction: {
                summary: "manual compacted",
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
  seedCompactableSession(harness);
  harness.setResponses([fauxAssistantMessage("queued response")]);

  let queuedPrompt: Promise<void> | undefined;
  harness.session.subscribe((event) => {
    if (
      event.type === "compaction_end" &&
      event.reason === "manual" &&
      event.result !== undefined
    ) {
      expect(harness.session.isCompacting).toBe(false);
      queuedPrompt = harness.session.prompt("queued after compaction");
    }
  });

  yield* Effect.promise(() => harness.session.compact());
  if (queuedPrompt === undefined) throw new Error("compaction_end did not start the queued prompt");
  yield* Effect.promise(() => Promise.resolve(queuedPrompt));

  expect(getUserTexts(harness)).toContain("queued after compaction");
  expect(harness.session.getLastAssistantText()).toBe("queued response");
});

const throwsWhenCompactingWithoutAModel = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  harness.session.agent.state.model = undefined as unknown as Model<any>;

  yield* Effect.promise(() =>
    expect(harness.session.compact()).rejects.toThrow("No model selected"),
  );
});

const throwsWhenCompactingWithoutConfiguredAuth = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness({ withConfiguredAuth: false }));
  harnesses.push(harness);

  seedCompactableSession(harness);

  yield* Effect.promise(() =>
    expect(harness.session.compact()).rejects.toThrow(
      `No API key found for ${harness.getModel().provider}.`,
    ),
  );
});

const manuallyCompactsWithACustomStreamfn = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness({ withConfiguredAuth: false }));
  harnesses.push(harness);
  seedCompactableSession(harness);
  const getStreamCallCount = useSummaryStreamFn(harness, "summary from custom stream");

  const result = yield* Effect.promise(() => harness.session.compact());

  expect(result.summary).toContain("summary from custom stream");
  expect(getStreamCallCount()).toBe(1);
});

const manuallyCompactsWithProviderResolvedBearer = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness({ withConfiguredAuth: false }));
  harnesses.push(harness);
  const model = harness.getModel();
  harness.session.modelRuntime.registerNativeProvider({
    id: model.provider,
    name: "Faux bearer provider",
    auth: {
      apiKey: {
        name: "Faux bearer token",
        resolve: () =>
          Promise.resolve({
            auth: { headers: { Authorization: "Bearer ambient-token" } },
            source: "ambient bearer token",
          }),
      },
    },
    getModels: () => harness.models,
    stream: () => createAssistantMessageEventStream(),
    streamSimple: () => createAssistantMessageEventStream(),
  });
  seedCompactableSession(harness);
  const summaryResponse = (
    _context: TranscriptContext,
    options: SimpleStreamOptions | undefined,
  ) => {
    expect(options?.apiKey).toBeUndefined();
    expect(options?.headers).toEqual({ Authorization: "Bearer ambient-token" });
    return fauxAssistantMessage("summary with bearer auth");
  };
  harness.setResponses([summaryResponse]);

  const result = yield* Effect.promise(() => harness.session.compact());

  expect(result.summary).toContain("summary with bearer auth");
  expect(harness.faux.state.callCount).toBe(1);
});

const usesTheStandaloneCompactionRequestContext = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({ settings: { compaction: { keepRecentTokens: 1 } } }),
  );
  harnesses.push(harness);
  seedCompactableSession(harness);

  const transformContext = vi.fn((messages: AgentMessage[]) => Promise.resolve(messages));
  harness.session.agent.transformContext = transformContext;
  harness.session.agent.sessionId = "active-routing-session";
  harness.session.agent.transport = "websocket";

  let requestContext: TranscriptContext | undefined;
  let requestOptions: SimpleStreamOptions | undefined;
  useSummaryStreamFn(harness, "standalone summary", (context, options) => {
    requestContext = context;
    requestOptions = options;
  });

  yield* Effect.promise(() => harness.session.compact());

  expect(transformContext).not.toHaveBeenCalled();
  expect(getCurrentSystemPrompt(requestContext?.messages ?? [])).not.toBe(
    harness.session.agent.state.systemPrompt,
  );
  expect(getCurrentTools(requestContext?.messages ?? [])).toEqual([]);

  expect(yield* toJsonText(requestContext?.messages)).toContain(
    "# Conversation\\n[User]: message to compact",
  );
  expect(requestOptions).toMatchObject({ cacheRetention: "none" });
  expect(requestOptions?.sessionId).not.toBe("active-routing-session");
  expect(requestOptions?.transport).toBeUndefined();
});

const persistsUsageFromMsaGeneratedManual = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness({ withConfiguredAuth: false }));
  harnesses.push(harness);
  seedCompactableSession(harness);
  useSummaryStreamFn(harness, "summary from custom stream");

  const result = yield* Effect.promise(() => harness.session.compact());

  const compactionEntries = harness.sessionManager
    .getEntries()
    .filter((entry) => entry.type === "compaction");
  expect(result.usage).toEqual(createUsage(10));
  expect(compactionEntries).toHaveLength(1);
  expect(
    compactionEntries[0]?.type === "compaction" ? compactionEntries[0].usage : undefined,
  ).toEqual(createUsage(10));
});

const autoCompactsWithACustomStreamfn = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness({ withConfiguredAuth: false }));
  harnesses.push(harness);
  seedCompactableSession(harness);
  const getStreamCallCount = useSummaryStreamFn(harness, "auto summary from custom stream");
  const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;

  yield* Effect.promise(() => sessionInternals["_runAutoCompaction"]("threshold", false));

  const compactionEntries = harness.sessionManager
    .getEntries()
    .filter((entry) => entry.type === "compaction");
  const compactionEnd = harness.eventsOfType("compaction_end").at(-1);
  expect(compactionEntries).toHaveLength(1);
  expect(compactionEnd?.result?.estimatedTokensAfter).toBeGreaterThan(0);
  expect(getStreamCallCount()).toBe(1);
});

const notifiesExtensionsWhenAutoCompactionFails = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const failedEvents: Array<{
    reason: "manual" | "threshold" | "overflow";
    errorMessage?: string | undefined;
    aborted: boolean;
    willRetry: boolean;
    fromExtension: boolean;
  }> = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("session_compact_failed", (event) =>
            runPromise(
              Effect.sync(() => {
                failedEvents.push(event);
              }),
            ),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);
  seedCompactableSession(harness);
  harness.session.agent.streamFunction = () => {
    throw new Error("summary generator blew up");
  };
  const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;

  yield* Effect.promise(() =>
    expect(sessionInternals["_runAutoCompaction"]("threshold", false)).resolves.toBe(false),
  );

  expect(harness.eventsOfType("compaction_end").at(-1)).toMatchObject({
    reason: "threshold",
    aborted: false,
    willRetry: false,
    errorMessage: "Auto-compaction failed: summary generator blew up",
  });
  expect(failedEvents).toEqual([
    expect.objectContaining({
      type: "session_compact_failed",
      reason: "threshold",
      aborted: false,
      willRetry: false,
      fromExtension: false,
      errorMessage: "Auto-compaction failed: summary generator blew up",
    }),
  ]);
});

const compactsAndResumesAfterALength = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ id: "faux-1", contextWindow: 1000, maxTokens: 100 }],
      settings: { compaction: { keepRecentTokens: 1, reserveTokens: 0 } },
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) =>
            Promise.resolve({
              compaction: {
                summary: "overflow compacted",
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
    fauxAssistantMessage("partial response", { stopReason: "length" }),
    fauxAssistantMessage("completed response"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("x".repeat(5000)));

  expect(harness.faux.state.callCount).toBe(2);
  expect(harness.eventsOfType("compaction_end").at(-1)).toMatchObject({
    reason: "overflow",
    aborted: false,
    willRetry: true,
  });
  expect(harness.session.getLastAssistantText()).toBe("completed response");
});

const includesSteeringQueuedDuringCompactionIn = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const largeTool: AgentTool = {
    name: "large_result",
    label: "Large result",
    description: "Returns enough content to cross the compaction threshold",
    parameters: Type.Object({}),
    execute: () =>
      Promise.resolve({
        content: [{ type: "text", text: `large-tool-result:${"x".repeat(6800)}` }],
        details: {},
      }),
  };
  const compactionStarted = gate();
  const compactionReleased = gate();
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ id: "faux-1", contextWindow: 2600, maxTokens: 100 }],
      settings: { compaction: { enabled: true, reserveTokens: 400, keepRecentTokens: 1750 } },
      tools: [largeTool],
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) =>
            runPromise(
              Effect.gen(function* () {
                compactionStarted.release();
                yield* Effect.promise(() => compactionReleased);
                return {
                  compaction: {
                    summary: "compacted history",
                    firstKeptEntryId: event.preparation.firstKeptEntryId,
                    tokensBefore: event.preparation.tokensBefore,
                    details: {},
                  },
                };
              }),
            ),
          );
        },
      ],
    }),
  );
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

  yield* Effect.promise(() => harness.session.prompt("seed old history"));
  yield* Effect.promise(() => harness.session.prompt("seed recent history"));
  const promptPromise = harness.session.prompt("run the large tool");
  yield* Effect.promise(() => compactionStarted);
  yield* Effect.promise(() => harness.session.steer("change direction"));
  compactionReleased.release();
  yield* Effect.promise(() => promptPromise);

  expect(resumedRequest).toContain("change direction");
  expect(harness.faux.state.callCount).toBe(4);
});

const doesNotCompactAfterATerminating = Effect.gen(function* () {
  const terminatingTool: AgentTool = {
    name: "terminate_with_large_result",
    label: "Terminate with large result",
    description: "Returns enough content to cross the compaction threshold, then terminates",
    parameters: Type.Object({}),
    execute: () =>
      Promise.resolve({
        content: [{ type: "text", text: `large-tool-result:${"x".repeat(6800)}` }],
        details: {},
        terminate: true,
      }),
  };
  return yield* doesNotCompactAfterATerminatingPart2(terminatingTool);
});

const doesNotCompactAfterATerminatingPart2 = (terminatingTool: AgentTool<any, any>) =>
  Effect.gen(function* () {
    const harness = yield* Effect.promise(() =>
      createHarness({
        models: [{ id: "faux-1", contextWindow: 2600, maxTokens: 100 }],
        settings: { compaction: { enabled: true, reserveTokens: 400, keepRecentTokens: 1750 } },
        tools: [terminatingTool],
        extensionFactories: [
          (msa) => {
            msa.on("session_before_compact", (event) => ({
              compaction: {
                summary: "unexpected compaction",
                firstKeptEntryId: event.preparation.firstKeptEntryId,
                tokensBefore: event.preparation.tokensBefore,
                details: {},
              },
            }));
          },
        ],
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
    yield* Effect.promise(() => harness.session.prompt("seed old history"));
    return yield* doesNotCompactAfterATerminatingPart3(harness);
  });

const doesNotCompactAfterATerminatingPart3 = (harness: Harness) =>
  Effect.gen(function* () {
    yield* Effect.promise(() => harness.session.prompt("seed recent history"));
    yield* Effect.promise(() => harness.session.prompt("run the terminating tool"));
    expect(harness.eventsOfType("compaction_start")).toEqual([]);
    expect(
      harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction"),
    ).toEqual([]);
    expect(harness.getPendingResponseCount()).toBe(0);
  });

const doesNotCompactWhenALength = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ id: "faux-1", contextWindow: 1_000_000, maxTokens: 100 }],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("x".repeat(400), { stopReason: "length" })]);

  yield* Effect.promise(() => harness.session.prompt("hello"));

  expect(harness.faux.state.callCount).toBe(1);
  expect(harness.eventsOfType("compaction_start")).toHaveLength(0);
});

const stopsAfterOneCompactAndRetry = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ id: "faux-1", contextWindow: 1_000_000, maxTokens: 100 }],
      settings: { compaction: { keepRecentTokens: 1, reserveTokens: 0 } },
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) =>
            Promise.resolve({
              compaction: {
                summary: "overflow compacted",
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
  return yield* stopsAfterOneCompactAndRetryPart2(harness);
});

const stopsAfterOneCompactAndRetryPart2 = (harness: Harness) =>
  Effect.gen(function* () {
    harness.setResponses([
      () =>
        fauxAssistantMessage("x".repeat(64), {
          stopReason: "length",
          timestamp: currentTimeMillis() + 10_000,
        }),
      () =>
        fauxAssistantMessage("y".repeat(64), {
          stopReason: "length",
          timestamp: currentTimeMillis() + 10_000,
        }),
    ]);
    yield* Effect.promise(() => harness.session.prompt("x".repeat(5000)));
    expect(harness.faux.state.callCount).toBe(2);
    expect(
      harness.eventsOfType("compaction_start").filter((event) => event.reason === "overflow"),
    ).toHaveLength(1);
    expect(harness.eventsOfType("compaction_end").at(-1)?.errorMessage).toBe(
      "Truncated response recovery failed after one compact-and-retry attempt.",
    );
  });

const keepsOverflowWordingWhenARepeated = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ id: "faux-1", contextWindow: 100, maxTokens: 100 }],
    }),
  );
  harnesses.push(harness);
  const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
  const lengthOverflowMessage = createAssistant(harness, {
    stopReason: "length",
    totalTokens: 100,
    timestamp: currentTimeMillis(),
  });
  const runAutoCompactionSpy = vi
    .spyOn(sessionInternals, "_runAutoCompaction")
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

  yield* Effect.promise(() => sessionInternals["_checkCompaction"](lengthOverflowMessage));
  yield* Effect.promise(() =>
    sessionInternals["_checkCompaction"]({
      ...lengthOverflowMessage,
      timestamp: currentTimeMillis() + 1,
    }),
  );

  expect(runAutoCompactionSpy).toHaveBeenCalledTimes(1);
  expect(compactionErrors).toContain(
    "Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model.",
  );
});

const cancelsInProgressManualCompactionWhen = Effect.gen(function* () {
  const { harness, compactionStarted } = yield* Effect.promise(() =>
    createAbortableCompactionHarness(),
  );
  harnesses.push(harness);

  const compactPromise = harness.session.compact();
  const compactExpectation = expect(compactPromise).rejects.toThrow("Compaction cancelled");
  yield* Effect.promise(() => compactionStarted);
  harness.session.abortCompaction();

  yield* Effect.promise(() => compactExpectation);
});

const abortsAnInProgressManualCompaction = Effect.gen(function* () {
  const { harness, compactionStarted } = yield* Effect.promise(() =>
    createAbortableCompactionHarness(),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("continued")]);

  const compactPromise = harness.session.compact();
  const compactExpectation = expect(compactPromise).rejects.toThrow("Compaction cancelled");
  yield* Effect.promise(() => compactionStarted);
  yield* Effect.promise(() => harness.session.abort());
  yield* Effect.promise(() => compactExpectation);

  expect(harness.eventsOfType("compaction_end").at(-1)).toMatchObject({
    reason: "manual",
    aborted: true,
  });
  expect(harness.session.isCompacting).toBe(false);
  expect(harness.session.isIdle).toBe(true);

  yield* Effect.promise(() =>
    expect(harness.session.prompt("next prompt")).resolves.toBeUndefined(),
  );
  expect(harness.session.getLastAssistantText()).toBe("continued");
});

const resumesAfterThresholdCompactionWhenOnly = Effect.gen(function* () {
  vi.useFakeTimers();
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { compaction: { keepRecentTokens: 1 } },
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) =>
            Promise.resolve({
              compaction: {
                summary: "auto compacted",
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
  harness.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
  yield* Effect.promise(() => harness.session.prompt("first"));
  yield* Effect.promise(() => harness.session.prompt("second"));

  harness.session.agent.followUp({
    role: "custom",
    customType: "test",
    content: [{ type: "text", text: "queued custom" }],
    display: false,
    timestamp: currentTimeMillis(),
  });

  const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;

  yield* Effect.promise(() =>
    expect(sessionInternals["_runAutoCompaction"]("threshold", false)).resolves.toBe(true),
  );
});

const doesNotRetryOverflowRecoveryMore = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
  const overflowMessage = createAssistant(harness, {
    stopReason: "error",
    errorMessage: "prompt is too long",
    timestamp: currentTimeMillis(),
  });
  const runAutoCompactionSpy = vi
    .spyOn(sessionInternals, "_runAutoCompaction")
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

  yield* Effect.promise(() => sessionInternals["_checkCompaction"](overflowMessage));
  yield* Effect.promise(() =>
    sessionInternals["_checkCompaction"]({
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
      settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
      models: [{ id: "faux-1", contextWindow: 1, maxTokens: 100 }],
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) =>
            Promise.resolve({
              compaction: {
                summary: "successful overflow compacted",
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
  harness.setResponses([fauxAssistantMessage("completed answer")]);

  yield* Effect.promise(() => expect(harness.session.prompt("hello")).resolves.toBeUndefined());

  const compactionEnd = harness.eventsOfType("compaction_end").at(-1);
  expect(compactionEnd).toMatchObject({
    reason: "overflow",
    aborted: false,
    willRetry: false,
  });
  expect(harness.faux.state.callCount).toBe(1);
});

const ignoresStalePreCompactionAssistantUsage = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
  const staleTimestamp = currentTimeMillis() - 10_000;
  const staleAssistant = createAssistant(harness, {
    stopReason: "stop",
    totalTokens: 610_000,
    timestamp: staleTimestamp,
  });

  harness.sessionManager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "before compaction" }],
    timestamp: staleTimestamp - 1000,
  });
  harness.sessionManager.appendMessage(staleAssistant);
  const firstKeptEntryId = harness.sessionManager.getEntries()[0]!.id;
  harness.sessionManager.appendCompaction(
    "summary",
    firstKeptEntryId,
    staleAssistant.usage.totalTokens,
    undefined,
    false,
  );
  harness.sessionManager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "after compaction" }],
    timestamp: currentTimeMillis(),
  });

  const runAutoCompactionSpy = vi
    .spyOn(sessionInternals, "_runAutoCompaction")
    .mockResolvedValue(false);

  yield* Effect.promise(() => sessionInternals["_checkCompaction"](staleAssistant, false));

  expect(runAutoCompactionSpy).not.toHaveBeenCalled();
});

const triggersThresholdCompactionForErrorMessages = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
  const successfulAssistant = createAssistant(harness, {
    stopReason: "stop",
    totalTokens: 190_000,
    timestamp: currentTimeMillis(),
  });
  const errorAssistant = createAssistant(harness, {
    stopReason: "error",
    errorMessage: "529 overloaded",
    timestamp: currentTimeMillis() + 1000,
  });
  harness.session.agent.state.messages = [
    {
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: currentTimeMillis() - 1000,
    },
    successfulAssistant,
    {
      role: "user",
      content: [{ type: "text", text: "retry" }],
      timestamp: currentTimeMillis() + 500,
    },
    errorAssistant,
  ];

  const runAutoCompactionSpy = vi
    .spyOn(sessionInternals, "_runAutoCompaction")
    .mockResolvedValue(false);

  yield* Effect.promise(() => sessionInternals["_checkCompaction"](errorAssistant));

  expect(runAutoCompactionSpy).toHaveBeenCalledWith("threshold", false);
});

const doesNotTriggerThresholdCompactionFor = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
  const errorAssistant = createAssistant(harness, {
    stopReason: "error",
    errorMessage: "529 overloaded",
    timestamp: currentTimeMillis(),
  });
  harness.session.agent.state.messages = [
    {
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: currentTimeMillis() - 1000,
    },
    errorAssistant,
  ];

  const runAutoCompactionSpy = vi
    .spyOn(sessionInternals, "_runAutoCompaction")
    .mockResolvedValue(false);

  yield* Effect.promise(() => sessionInternals["_checkCompaction"](errorAssistant));

  expect(runAutoCompactionSpy).not.toHaveBeenCalled();
});

const doesNotTriggerThresholdCompactionWhen = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
  const preCompactionTimestamp = currentTimeMillis() - 10_000;
  const keptAssistant = createAssistant(harness, {
    stopReason: "stop",
    totalTokens: 190_000,
    timestamp: preCompactionTimestamp,
  });
  harness.sessionManager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "before compaction" }],
    timestamp: preCompactionTimestamp - 1000,
  });
  harness.sessionManager.appendMessage(keptAssistant);
  const firstKeptEntryId = harness.sessionManager.getEntries()[0]!.id;
  harness.sessionManager.appendCompaction(
    "summary",
    firstKeptEntryId,
    keptAssistant.usage.totalTokens,
    undefined,
    false,
  );
  const errorAssistant = createAssistant(harness, {
    stopReason: "error",
    errorMessage: "529 overloaded",
    timestamp: currentTimeMillis(),
  });
  return yield* doesNotTriggerThresholdCompactionWhenPart2(
    harness,
    sessionInternals,
    preCompactionTimestamp,
    keptAssistant,
    errorAssistant,
  );
});

const doesNotTriggerThresholdCompactionWhenPart2 = (
  harness: Harness,
  sessionInternals: SessionWithCompactionInternals,
  preCompactionTimestamp: number,
  keptAssistant: AssistantMessage,
  errorAssistant: AssistantMessage,
) =>
  Effect.gen(function* () {
    harness.session.agent.state.messages = [
      {
        role: "user",
        content: [{ type: "text", text: "kept user" }],
        timestamp: preCompactionTimestamp - 1000,
      },
      keptAssistant,
      {
        role: "user",
        content: [{ type: "text", text: "new prompt" }],
        timestamp: currentTimeMillis() - 500,
      },
      errorAssistant,
    ];
    const runAutoCompactionSpy = vi
      .spyOn(sessionInternals, "_runAutoCompaction")
      .mockResolvedValue(false);
    yield* Effect.promise(() => sessionInternals["_checkCompaction"](errorAssistant));
    expect(runAutoCompactionSpy).not.toHaveBeenCalled();
  });

const doesNotTriggerThresholdCompactionBelow = Effect.gen(function* () {
  const belowThresholdHarness = yield* Effect.promise(() =>
    createHarness({
      settings: { compaction: { enabled: true, reserveTokens: 1000 } },
      models: [{ id: "faux-1", contextWindow: 200_000 }],
    }),
  );
  harnesses.push(belowThresholdHarness);
  const disabledHarness = yield* Effect.promise(() =>
    createHarness({ settings: { compaction: { enabled: false } } }),
  );
  harnesses.push(disabledHarness);

  const belowThresholdInternals =
    belowThresholdHarness.session as unknown as SessionWithCompactionInternals;
  const disabledInternals = disabledHarness.session as unknown as SessionWithCompactionInternals;
  const belowThresholdSpy = vi
    .spyOn(belowThresholdInternals, "_runAutoCompaction")
    .mockResolvedValue(false);
  const disabledSpy = vi.spyOn(disabledInternals, "_runAutoCompaction").mockResolvedValue(false);

  yield* Effect.promise(() =>
    belowThresholdInternals["_checkCompaction"](
      createAssistant(belowThresholdHarness, {
        stopReason: "stop",
        totalTokens: 1_000,
        timestamp: currentTimeMillis(),
      }),
    ),
  );
  yield* Effect.promise(() =>
    disabledInternals["_checkCompaction"](
      createAssistant(disabledHarness, {
        stopReason: "stop",
        totalTokens: 1_000_000,
        timestamp: currentTimeMillis(),
      }),
    ),
  );

  expect(belowThresholdSpy).not.toHaveBeenCalled();
  expect(disabledSpy).not.toHaveBeenCalled();
});

describe("AgentSession compaction characterization", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("manually compacts using an extension-provided summary", () =>
    Effect.runPromise(manuallyCompactsUsingAnExtensionProvided));
  it("checkpoints the replayed system state and folds summarized and retained system patches into it", () =>
    Effect.runPromise(checkpointsTheReplayedSystemStateAnd));
  it("allows a queued prompt to start when manual compaction ends", () =>
    Effect.runPromise(allowsAQueuedPromptToStart));
  it("throws when compacting without a model", () =>
    Effect.runPromise(throwsWhenCompactingWithoutAModel));
  it("throws when compacting without configured auth", () =>
    Effect.runPromise(throwsWhenCompactingWithoutConfiguredAuth));
  it("manually compacts with a custom streamFn when registry auth is absent", () =>
    Effect.runPromise(manuallyCompactsWithACustomStreamfn));
  it("manually compacts with provider-resolved bearer auth", () =>
    Effect.runPromise(manuallyCompactsWithProviderResolvedBearer));
  it("uses the standalone compaction request context", () =>
    Effect.runPromise(usesTheStandaloneCompactionRequestContext));
  it("persists usage from msa-generated manual compaction", () =>
    Effect.runPromise(persistsUsageFromMsaGeneratedManual));
  it("auto-compacts with a custom streamFn when registry auth is absent", () =>
    Effect.runPromise(autoCompactsWithACustomStreamfn));
  it("notifies extensions when auto-compaction fails", () =>
    Effect.runPromise(notifiesExtensionsWhenAutoCompactionFails));
  it("compacts and resumes after a length stop below the desired output limit", () =>
    Effect.runPromise(compactsAndResumesAfterALength));
  it.each([false, true])(
    "compacts after an oversized tool result in the same run (model override: %s)",
    (modelOverride) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const toolResult = `large-tool-result:${"x".repeat(8000)}`;
          const largeTool: AgentTool = {
            name: "large_result",
            label: "Large result",
            description: "Returns enough content to cross the compaction threshold",
            parameters: Type.Object({}),
            execute: () =>
              Promise.resolve({ content: [{ type: "text", text: toolResult }], details: {} }),
          };
          const order: string[] = [];
          const observedSettings: unknown[] = [];
          const harness = yield* Effect.promise(() =>
            createHarness({
              models: [{ id: "faux-1", contextWindow: 2600, maxTokens: 100 }],
              settings: {
                compaction: modelOverride
                  ? {
                      enabled: true,
                      reserveTokens: 0,
                      keepRecentTokens: 20000,
                      modelOverrides: {
                        "faux/faux-1": { reserveTokens: 400, keepRecentTokens: 1750 },
                      },
                    }
                  : { enabled: true, reserveTokens: 400, keepRecentTokens: 1750 },
              },
              tools: [largeTool],
              extensionFactories: [
                (msa) => {
                  msa.on("session_before_compact", (event) => {
                    order.push("compaction");
                    observedSettings.push(event.preparation.settings);
                    return {
                      compaction: {
                        summary: "compacted history",
                        firstKeptEntryId: event.preparation.firstKeptEntryId,
                        tokensBefore: event.preparation.tokensBefore,
                        details: {},
                      },
                    };
                  });
                },
              ],
            }),
          );
          harnesses.push(harness);
          let resumedRequest = "";
          harness.setResponses([
            fauxAssistantMessage(`old-history:${"a".repeat(800)}`),
            fauxAssistantMessage(`recent-history:${"b".repeat(800)}`),
            fauxAssistantMessage(fauxToolCall("large_result", {}), { stopReason: "toolUse" }),
            (context) => {
              order.push("provider");
              resumedRequest = JSON.stringify(context.messages);
              return fauxAssistantMessage("finished after compaction");
            },
          ]);

          yield* Effect.promise(() => harness.session.prompt("seed old history"));
          yield* Effect.promise(() => harness.session.prompt("seed recent history"));
          const agentStartsBefore = harness.eventsOfType("agent_start").length;
          yield* Effect.promise(() => harness.session.prompt("run the large tool"));

          expect(order.slice(0, 2)).toEqual(["compaction", "provider"]);
          expect(observedSettings[0]).toEqual({
            enabled: true,
            reserveTokens: 400,
            keepRecentTokens: 1750,
          });
          expect(harness.eventsOfType("agent_start")).toHaveLength(agentStartsBefore + 1);
          expect(harness.eventsOfType("compaction_start").at(-1)).toEqual({
            type: "compaction_start",
            reason: "threshold",
          });
          expect(resumedRequest).toContain("compacted history");
          expect(resumedRequest).toContain("large-tool-result");
          expect(harness.session.getLastAssistantText()).toBe("finished after compaction");
        }),
      ),
  );
  it("includes steering queued during compaction in the resumed assistant request", () =>
    Effect.runPromise(includesSteeringQueuedDuringCompactionIn));
  it("does not compact after a terminating tool result", () =>
    Effect.runPromise(doesNotCompactAfterATerminating));
  it("does not compact when a length stop reaches the desired output limit", () =>
    Effect.runPromise(doesNotCompactWhenALength));
  it("stops after one compact-and-retry when a second response is also truncated", () =>
    Effect.runPromise(stopsAfterOneCompactAndRetry));
  it("keeps overflow wording when a repeated length stop fills the context window", () =>
    Effect.runPromise(keepsOverflowWordingWhenARepeated));
  it("cancels in-progress manual compaction when abortCompaction is called", () =>
    Effect.runPromise(cancelsInProgressManualCompactionWhen));
  it("aborts an in-progress manual compaction and waits until the session is idle", () =>
    Effect.runPromise(abortsAnInProgressManualCompaction));
  it("resumes after threshold compaction when only agent-level queued messages exist", () =>
    Effect.runPromise(resumesAfterThresholdCompactionWhenOnly));
  it("does not retry overflow recovery more than once", () =>
    Effect.runPromise(doesNotRetryOverflowRecoveryMore));
  it("compacts successful overflow responses without retrying", () =>
    Effect.runPromise(compactsSuccessfulOverflowResponsesWithoutRetrying));
  it("ignores stale pre-compaction assistant usage on pre-prompt checks", () =>
    Effect.runPromise(ignoresStalePreCompactionAssistantUsage));
  it("triggers threshold compaction for error messages using the last successful usage", () =>
    Effect.runPromise(triggersThresholdCompactionForErrorMessages));
  it("does not trigger threshold compaction for error messages when no prior usage exists", () =>
    Effect.runPromise(doesNotTriggerThresholdCompactionFor));
  it("does not trigger threshold compaction when only kept pre-compaction usage exists", () =>
    Effect.runPromise(doesNotTriggerThresholdCompactionWhen));
  it("does not trigger threshold compaction below the threshold or when disabled", () =>
    Effect.runPromise(doesNotTriggerThresholdCompactionBelow));
});
