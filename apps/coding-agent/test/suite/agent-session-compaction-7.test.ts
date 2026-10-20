import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import agentSessionCompactionSupport from "./agent-session-compaction-support.ts";
import agentSessionCompactionSupport2 from "./agent-session-compaction-support2.ts";
import harnessModule from "./harness.ts";

const {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  getCurrentSystemPrompt,
  getCurrentTools,
} = ai;

const { afterEachHook } = agentSessionCompactionSupport2;

const { createUsage, harnesses, seedCompactableSession, useSummaryStreamFn } =
  agentSessionCompactionSupport;

const { createHarness } = harnessModule;

const { toJsonText } = testing;

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
    id: model.provider,
    name: "Faux bearer provider",
    stream: () => createAssistantMessageEventStream(),
    streamSimple: () => createAssistantMessageEventStream(),
  });
  seedCompactableSession(harness);
  const summaryResponse = (
    _context: aiTypes.TranscriptContext,
    options: aiTypes.SimpleStreamOptions | undefined,
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

  const transformContext = vi.fn((messages: agentTypes.AgentMessage[]) =>
    Promise.resolve(messages),
  );
  harness.session.agent.transformContext = transformContext;
  harness.session.agent.sessionId = "active-routing-session";
  harness.session.agent.transport = "websocket";

  let requestContext: aiTypes.TranscriptContext | undefined;
  let requestOptions: aiTypes.SimpleStreamOptions | undefined;
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

const manuallyCompactsWithACustomStreamfnWhen = () =>
  Effect.runPromise(manuallyCompactsWithACustomStreamfn);

const manuallyCompactsWithProviderResolvedBearerAuth = () =>
  Effect.runPromise(manuallyCompactsWithProviderResolvedBearer);

const usesTheStandaloneCompactionRequestContext2 = () =>
  Effect.runPromise(usesTheStandaloneCompactionRequestContext);

const persistsUsageFromMsaGeneratedManualCompaction = () =>
  Effect.runPromise(persistsUsageFromMsaGeneratedManual);

describe("AgentSession compaction characterization", () => {
  afterEach(afterEachHook);

  it(
    "manually compacts with a custom streamFn when registry auth is absent",
    manuallyCompactsWithACustomStreamfnWhen,
  );

  it(
    "manually compacts with provider-resolved bearer auth",
    manuallyCompactsWithProviderResolvedBearerAuth,
  );

  it("uses the standalone compaction request context", usesTheStandaloneCompactionRequestContext2);
});

describe("AgentSession compaction characterization", () => {
  afterEach(afterEachHook);

  it(
    "persists usage from msa-generated manual compaction",
    persistsUsageFromMsaGeneratedManualCompaction,
  );
});
