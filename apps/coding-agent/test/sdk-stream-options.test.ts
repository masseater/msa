import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  type Api,
  type AssistantMessage,
  createAssistantMessageEventStream,
  type Model,
  normalizeContext,
  type SimpleStreamOptions,
} from "@msa/ai";
import { awaited, runTest, currentTimeMillis, joinPath } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import type { ExtensionFactory } from "../src/core/extensions/types.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { type Settings, SettingsManager } from "../src/core/settings-manager.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";

describe("createAgentSession stream options", () => {
  let tempDir: string;
  let cwd: string;
  let agentDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(joinPath(tmpdir(), "msa-sdk-stream-options-"));
    cwd = joinPath(tempDir, "project");
    agentDir = joinPath(tempDir, "agent");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createModel(api: Api): Model<Api> {
    return {
      id: "capture-model",
      name: "Capture Model",
      api,
      provider: "capture-provider",
      baseUrl: "https://capture.invalid/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
      headers: { "x-model": "model" },
    };
  }

  function createDoneMessage(api: Api, promptTokens = 0): AssistantMessage {
    return {
      role: "assistant",
      content: [{ type: "text" as const, text: "ok" }],
      api,
      provider: "capture-provider",
      model: "capture-model",
      usage: {
        input: 0,
        output: 0,
        cacheRead: promptTokens,
        cacheWrite: 0,
        totalTokens: promptTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: currentTimeMillis(),
    };
  }

  function createDoneStream(api: Api, promptTokens = 0) {
    const stream = createAssistantMessageEventStream();
    stream.end(createDoneMessage(api, promptTokens));
    return stream;
  }

  function captureStreamOptions(
    api: Api,
    settings: Partial<Settings>,
    requestOptions: SimpleStreamOptions = {},
    extensionFactory?: ExtensionFactory,
    providerEvent?: unknown,
  ): Promise<SimpleStreamOptions | undefined> {
    return runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const model = createModel(api);
        const settingsManager = SettingsManager.inMemory(settings);
        const resourceLoader = new DefaultResourceLoader({
          cwd,
          agentDir,
          settingsManager,
          extensionFactories: extensionFactory ? [extensionFactory] : [],
        });
        yield* awaited(resourceLoader.reload());

        const authStorage = AuthStorage.create(joinPath(agentDir, "auth.json"));
        yield* awaited(
          authStorage.modify(model.provider, () =>
            effectRunPromise(
              awaited({
                type: "api_key" as const,
                key: "test-api-key",
              }),
            ),
          ),
        );
        const modelRegistry = yield* awaited(
          createModelRegistry(authStorage, joinPath(agentDir, "models.json")),
        );
        let capturedOptions: SimpleStreamOptions | undefined;

        modelRegistry.registerProvider(model.provider, {
          api,
          headers: { "x-provider": "provider" },
          streamSimple: (requestModel, _context, providerOptions) => {
            capturedOptions = providerOptions;
            if (providerEvent === undefined) return createDoneStream(api);

            const stream = createAssistantMessageEventStream();
            void (() =>
              effectRunPromise(
                Effect.gen(function* () {
                  yield* awaited(
                    providerOptions?.onProviderStreamEvent?.(providerEvent, requestModel),
                  );
                  stream.end(createDoneMessage(api));
                }),
              ))();
            return stream;
          },
        });

        const modelRuntime = getModelRuntime(modelRegistry);
        const sessionManager = SessionManager.inMemory(cwd);
        const { session } = yield* awaited(
          createAgentSession({
            cwd,
            agentDir,
            model,
            modelRuntime,
            settingsManager,
            sessionManager,
            resourceLoader,
          }),
        );

        try {
          if (providerEvent === undefined) {
            const stream = yield* awaited(
              session.agent.streamFunction(
                model,
                normalizeContext({ messages: [] }),
                requestOptions,
              ),
            );
            yield* awaited(stream.result());
          } else {
            yield* awaited(session.prompt("test"));
          }
          return yield* awaited(capturedOptions);
        } finally {
          session.dispose();
          modelRegistry.unregisterProvider(model.provider);
        }
      }),
    );
  }

  function createCacheWarmingSession(
    populate?: (manager: SessionManager, model: Model<Api>) => void,
  ) {
    return runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const model: Model<Api> = {
          ...createModel("anthropic-messages"),
          cost: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
          promptCache: { short: 300 },
        };
        const authStorage = AuthStorage.create(joinPath(agentDir, "auth.json"));
        yield* awaited(
          authStorage.modify(model.provider, () =>
            effectRunPromise(
              awaited({
                type: "api_key" as const,
                key: "test-api-key",
              }),
            ),
          ),
        );
        const modelRegistry = yield* awaited(
          createModelRegistry(authStorage, joinPath(agentDir, "models.json")),
        );
        let providerCalls = 0;
        modelRegistry.registerProvider(model.provider, {
          api: model.api,
          streamSimple: () => {
            providerCalls++;
            return createDoneStream(model.api, 100_000);
          },
        });
        const sessionManager = SessionManager.inMemory(cwd);
        populate?.(sessionManager, model);
        const { session } = yield* awaited(
          createAgentSession({
            cwd,
            agentDir,
            model,
            modelRuntime: getModelRuntime(modelRegistry),
            settingsManager: SettingsManager.inMemory({ cacheWarming: "idle" }),
            sessionManager,
          }),
        );
        return yield* awaited({
          session,
          providerCalls: () => providerCalls,
          dispose: () => {
            session.dispose();
            modelRegistry.unregisterProvider(model.provider);
          },
        });
      }),
    );
  }

  it("schedules cache warming after a completed session request", () =>
    runTest(
      Effect.gen(function* () {
        const fixture = yield* awaited(createCacheWarmingSession());
        try {
          yield* awaited(fixture.session.prompt("test"));
          expect(fixture.session.cacheWarmingStatus?.nextWarmAt).toBeGreaterThan(
            currentTimeMillis(),
          );

          fixture.session.agent.state.messages = [...fixture.session.agent.state.messages];
          fixture.session.agent.state.model = { ...fixture.session.agent.state.model };
          expect(fixture.session.cacheWarmingStatus?.nextWarmAt).toBeGreaterThan(
            currentTimeMillis(),
          );
          fixture.session.agent.state.messages = fixture.session.agent.state.messages.slice(1);
          expect(fixture.session.cacheWarmingStatus?.reason).toBe("conversation context changed");
        } finally {
          fixture.dispose();
        }
      }),
    ));

  it("waits for the next request instead of restoring cache warming", () =>
    runTest(
      Effect.gen(function* () {
        const fixture = yield* awaited(
          createCacheWarmingSession((manager, model) => {
            manager.appendModelChange(model.provider, model.id);
            manager.appendThinkingLevelChange("off");
            manager.appendMessage({
              role: "user",
              content: "test",
              timestamp: currentTimeMillis() - 60_000,
            });
            const assistant = {
              ...createDoneMessage(model.api, 100_000),
              timestamp: currentTimeMillis() - 59_000,
            };
            manager.appendMessage(assistant);
            manager.appendUsage("cache_warm", model.provider, model.id, assistant.usage);
          }),
        );
        try {
          expect(fixture.providerCalls()).toBe(0);
          expect(fixture.session.cacheWarmingStatus).toEqual({
            state: "inactive",
            reason: "waiting for first request",
          });
        } finally {
          fixture.dispose();
        }
      }),
    ));

  it("forwards httpIdleTimeoutMs as timeoutMs for OpenAI Codex", () =>
    runTest(
      Effect.gen(function* () {
        const options = yield* awaited(
          captureStreamOptions("openai-codex-responses", {
            httpIdleTimeoutMs: 1234,
          }),
        );

        expect(options?.timeoutMs).toBe(1234);
      }),
    ));

  it("defaults timeoutMs from httpIdleTimeoutMs for all providers", () =>
    runTest(
      Effect.gen(function* () {
        const options = yield* awaited(
          captureStreamOptions("openai-completions", { httpIdleTimeoutMs: 1234 }),
        );

        expect(options?.timeoutMs).toBe(1234);
      }),
    ));

  it("lets request timeoutMs override httpIdleTimeoutMs for OpenAI Codex", () =>
    runTest(
      Effect.gen(function* () {
        const options = yield* awaited(
          captureStreamOptions(
            "openai-codex-responses",
            { httpIdleTimeoutMs: 1234 },
            { timeoutMs: 0 },
          ),
        );

        expect(options?.timeoutMs).toBe(0);
      }),
    ));

  it("forwards websocketConnectTimeoutMs from settings", () =>
    runTest(
      Effect.gen(function* () {
        const options = yield* awaited(
          captureStreamOptions("openai-codex-responses", {
            websocketConnectTimeoutMs: 1234,
          }),
        );

        expect(options?.websocketConnectTimeoutMs).toBe(1234);
      }),
    ));

  it("lets request websocketConnectTimeoutMs override settings", () =>
    runTest(
      Effect.gen(function* () {
        const options = yield* awaited(
          captureStreamOptions(
            "openai-codex-responses",
            { websocketConnectTimeoutMs: 1234 },
            { websocketConnectTimeoutMs: 0 },
          ),
        );

        expect(options?.websocketConnectTimeoutMs).toBe(0);
      }),
    ));

  it("forwards provider retry settings", () =>
    runTest(
      Effect.gen(function* () {
        const options = yield* awaited(
          captureStreamOptions("openai-completions", {
            retry: { provider: { maxRetries: 2, maxRetryDelayMs: 3000 } },
          }),
        );

        expect(options?.maxRetries).toBe(2);
        expect(options?.maxRetryDelayMs).toBe(3000);
      }),
    ));

  it("forwards provider stream events to extensions", () =>
    runTest(
      Effect.gen(function* () {
        const providerEvent = { openrouter_metadata: { strategy: "direct" } };
        const extensionEvents: unknown[] = [];

        const options = yield* awaited(
          captureStreamOptions(
            "openai-completions",
            {},
            {},
            (msa) => {
              msa.on("provider_stream_event", (event) => {
                extensionEvents.push(event);
              });
            },
            providerEvent,
          ),
        );

        expect(options?.onProviderStreamEvent).toEqual(expect.any(Function));
        expect(extensionEvents).toEqual([
          {
            data: providerEvent,
            type: "provider_stream_event" as const,
            provider: "capture-provider",
            api: "openai-completions" as const,
            model: "capture-model",
          },
        ]);
      }),
    ));

  it("runs before_provider_headers on assembled headers without forwarding the transform", () =>
    runTest(
      Effect.gen(function* () {
        const options = yield* awaited(
          captureStreamOptions(
            "openai-completions",
            {},
            { headers: { "x-explicit": "explicit" } },
            (msa) => {
              msa.on("before_provider_headers", (event) => {
                event.headers["x-hook"] = [
                  event.headers["x-provider"],
                  event.headers["x-model"],
                  event.headers["x-explicit"],
                ].join(":");
              });
            },
          ),
        );

        expect(options?.headers).toMatchObject({
          "x-provider": "provider",
          "x-model": "model",
          "x-explicit": "explicit",
          "x-hook": "provider:model:explicit",
        });
        expect(options).not.toHaveProperty("transformHeaders");
      }),
    ));
});
