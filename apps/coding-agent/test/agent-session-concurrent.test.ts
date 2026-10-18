import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { Agent } from "@msa/agent-core";
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  getModel,
  type ImageContent,
  type TextContent,
} from "@msa/ai/compat";
import { awaited, runTest, currentTimeMillis, joinPath } from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import {
  type BuildSystemPromptOptions,
  type NormalizedBuildSystemPromptOptions,
  normalizeBuildSystemPromptOptions,
} from "../src/core/system-prompt.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "./utilities.ts";

function createAssistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text" as const, text }],
    api: "anthropic-messages" as const,
    provider: "anthropic",
    model: "mock",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: currentTimeMillis(),
  };
}

describe("AgentSession concurrent prompt guard", () => {
  let session: AgentSession;
  let tempDir: string;

  beforeEach(() =>
    runTest(
      Effect.sync(() => {
        tempDir = joinPath(tmpdir(), `msa-concurrent-test-${currentTimeMillis()}`);
        mkdirSync(tempDir, { recursive: true });

        writeFileSync(
          joinPath(tempDir, "settings.json"),
          JSON.stringify({ memory: { enabled: false } }),
        );
      }),
    ),
  );

  afterEach(() =>
    runTest(
      Effect.sync(() => {
        delete (globalThis as typeof globalThis & { testExtensionApi?: unknown }).testExtensionApi;
        delete (globalThis as typeof globalThis & { testCommandRuns?: unknown }).testCommandRuns;
        if (session) {
          session.dispose();
        }
        if (tempDir && existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true });
        }
      }),
    ),
  );

  function createSession() {
    return runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const model = getModel("anthropic", "claude-sonnet-4-5")!;
        let abortSignal: AbortSignal | undefined;

        const agent = new Agent({
          getApiKey: () => "test-key",
          initialState: {
            model,
            systemPrompt: "Test",
            tools: [],
          },
          streamFn: (_model, _context, options) => {
            abortSignal = options?.signal;
            const stream = createAssistantMessageEventStream();
            queueMicrotask(() => {
              stream.push({ type: "start" as const, partial: createAssistantMessage("") });
              const checkAbort = () => {
                if (abortSignal?.aborted) {
                  stream.push({
                    type: "error" as const,
                    reason: "aborted",
                    error: createAssistantMessage("Aborted"),
                  });
                } else {
                  setTimeout(checkAbort, 5);
                }
              };
              checkAbort();
            });
            return stream;
          },
        });

        const sessionManager = SessionManager.inMemory();
        const settingsManager = SettingsManager.create(tempDir, tempDir);
        const authStorage = AuthStorage.create(joinPath(tempDir, "auth.json"));
        const modelRegistry = yield* awaited(createModelRegistry(authStorage, tempDir));

        yield* awaited(
          authStorage.modify("anthropic", () =>
            effectRunPromise(awaited({ type: "api_key" as const, key: "test-key" })),
          ),
        );

        session = new AgentSession({
          agent,
          sessionManager,
          settingsManager,
          cwd: tempDir,
          modelRuntime: getModelRuntime(modelRegistry),
          resourceLoader: createTestResourceLoader(),
        });

        return yield* awaited(session);
      }),
    );
  }

  function waitForStreaming(timeoutMs = 5000): Promise<void> {
    return runTest(
      Effect.gen(function* () {
        const startedAt = currentTimeMillis();
        while (!session.isStreaming) {
          if (currentTimeMillis() - startedAt > timeoutMs)
            throw new Error("Timed out waiting for streaming");
          yield* Effect.sleep(5);
        }
      }),
    );
  }

  it("should throw when prompt() called while streaming", () =>
    runTest(
      Effect.gen(function* () {
        yield* awaited(createSession());

        const firstPrompt = session.prompt("First message");

        yield* awaited(waitForStreaming());

        expect(session.isStreaming).toBe(true);

        yield* awaited(
          expect(session.prompt("Second message")).rejects.toThrow(
            "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
          ),
        );

        yield* awaited(session.abort());
        yield* awaited(firstPrompt.catch(() => {}));
      }),
    ));

  it("should allow steer() while streaming", () =>
    runTest(
      Effect.gen(function* () {
        yield* awaited(createSession());

        const firstPrompt = session.prompt("First message");
        yield* awaited(waitForStreaming());

        yield* awaited(expect(session.steer("Steering message")).resolves.toBe("queued"));
        expect(session.pendingMessageCount).toBe(1);

        yield* awaited(session.abort());
        yield* awaited(firstPrompt.catch(() => {}));
      }),
    ));

  it("should allow followUp() while streaming", () =>
    runTest(
      Effect.gen(function* () {
        yield* awaited(createSession());

        const firstPrompt = session.prompt("First message");
        yield* awaited(waitForStreaming());

        yield* awaited(expect(session.followUp("Follow-up message")).resolves.toBe("queued"));
        expect(session.pendingMessageCount).toBe(1);

        yield* awaited(session.abort());
        yield* awaited(firstPrompt.catch(() => {}));
      }),
    ));

  it("should queue extension-origin steering messages while streaming", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const model = getModel("anthropic", "claude-sonnet-4-5")!;
        let abortSignal: AbortSignal | undefined;
        let sawSteeringMessage = false;
        let lastInputSource: string | undefined;
        const queueEvents: Array<{ steering: readonly string[]; followUp: readonly string[] }> = [];

        const agent = new Agent({
          getApiKey: () => "test-key",
          initialState: {
            model,
            systemPrompt: "Test",
            tools: [],
          },
          streamFn: (_model, context, options) => {
            abortSignal = options?.signal;
            const stream = createAssistantMessageEventStream();
            queueMicrotask(() => {
              const userTexts = context.messages
                .filter((message) => message.role === "user")
                .map((message) => {
                  if (typeof message.content === "string") {
                    return message.content;
                  }
                  return message.content
                    .filter(
                      (part): part is TextContent | ImageContent =>
                        typeof part === "object" && part !== null,
                    )
                    .filter((part): part is TextContent => part.type === "text")
                    .map((part) => part.text)
                    .join("\n");
                });

              if (userTexts.includes("Steer from extension")) {
                sawSteeringMessage = true;
                stream.push({ type: "start" as const, partial: createAssistantMessage("") });
                stream.push({
                  type: "done" as const,
                  reason: "stop",
                  message: createAssistantMessage("Steered"),
                });
                return;
              }

              stream.push({ type: "start" as const, partial: createAssistantMessage("") });
              const checkAbort = () => {
                if (abortSignal?.aborted) {
                  stream.push({
                    type: "error" as const,
                    reason: "aborted",
                    error: createAssistantMessage("Aborted"),
                  });
                } else {
                  setTimeout(checkAbort, 5);
                }
              };
              checkAbort();
            });
            return stream;
          },
        });

        const sessionManager = SessionManager.inMemory();
        const settingsManager = SettingsManager.create(tempDir, tempDir);
        const authStorage = AuthStorage.create(joinPath(tempDir, "auth.json"));
        const modelRegistry = yield* awaited(createModelRegistry(authStorage, tempDir));
        yield* awaited(
          authStorage.modify("anthropic", () =>
            effectRunPromise(awaited({ type: "api_key" as const, key: "test-key" })),
          ),
        );

        const extensionsResult = yield* awaited(
          createTestExtensionsResult([
            (msa) => {
              (globalThis as typeof globalThis & { testExtensionApi?: unknown }).testExtensionApi =
                msa;
            },
            (msa) => {
              msa.on("input", (event) =>
                effectRunPromise(
                  Effect.sync(() => {
                    lastInputSource = event.source;
                  }),
                ),
              );
            },
          ]),
        );

        session = new AgentSession({
          agent,
          sessionManager,
          settingsManager,
          cwd: tempDir,
          modelRuntime: getModelRuntime(modelRegistry),
          resourceLoader: createTestResourceLoader({ extensionsResult }),
        });
        session.subscribe((event) => {
          if (event.type === "queue_update") {
            queueEvents.push({ steering: event.steering, followUp: event.followUp });
          }
        });

        const firstPrompt = session.prompt("First message");
        yield* awaited(waitForStreaming());
        expect(session.isStreaming).toBe(true);

        const msa = (
          globalThis as typeof globalThis & {
            testExtensionApi?: {
              sendUserMessage: (
                content: string,
                options?: { deliverAs?: "steer" | "followUp" },
              ) => void;
            };
          }
        ).testExtensionApi;
        expect(msa).toBeDefined();

        msa!.sendUserMessage("Steer from extension", { deliverAs: "steer" });
        yield* Effect.sleep(25);

        expect(session.pendingMessageCount).toBe(1);
        expect(session.getSteeringMessages()).toContain("Steer from extension");
        expect(lastInputSource).toBe("extension");
        expect(queueEvents.some((event) => event.steering.includes("Steer from extension"))).toBe(
          true,
        );

        yield* awaited(session.abort());
        yield* awaited(firstPrompt.catch(() => {}));

        expect(sawSteeringMessage).toBe(true);
      }),
    ));

  it("should allow prompt() after previous completes", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const model = getModel("anthropic", "claude-sonnet-4-5")!;
        const agent = new Agent({
          getApiKey: () => "test-key",
          initialState: {
            model,
            systemPrompt: "Test",
            tools: [],
          },
          streamFn: () => {
            const stream = createAssistantMessageEventStream();
            queueMicrotask(() => {
              stream.push({ type: "start" as const, partial: createAssistantMessage("") });
              stream.push({
                type: "done" as const,
                reason: "stop",
                message: createAssistantMessage("Done"),
              });
            });
            return stream;
          },
        });

        const sessionManager = SessionManager.inMemory();
        const settingsManager = SettingsManager.create(tempDir, tempDir);
        const authStorage = AuthStorage.create(joinPath(tempDir, "auth.json"));
        const modelRegistry = yield* awaited(createModelRegistry(authStorage, tempDir));
        yield* awaited(
          authStorage.modify("anthropic", () =>
            effectRunPromise(awaited({ type: "api_key" as const, key: "test-key" })),
          ),
        );

        session = new AgentSession({
          agent,
          sessionManager,
          settingsManager,
          cwd: tempDir,
          modelRuntime: getModelRuntime(modelRegistry),
          resourceLoader: createTestResourceLoader(),
        });

        yield* awaited(session.prompt("First message"));

        expect(session.isStreaming).toBe(false);

        yield* awaited(expect(session.prompt("Second message")).resolves.not.toThrow());
      }),
    ));

  it("should wait for queued agent events before emitting tool_call", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const model = getModel("anthropic", "claude-sonnet-4-5")!;
        const tool = {
          name: "dummy",
          description: "Dummy tool",
          label: "dummy",
          parameters: Type.Object({ q: Type.String() }),
          execute: (_toolCallId: string, params: unknown) =>
            effectRunPromise(
              Effect.gen(function* () {
                const q =
                  typeof params === "object" && params !== null && "q" in params
                    ? String((params as { q: unknown }).q)
                    : "";
                return yield* awaited({
                  content: [{ type: "text" as const, text: `result:${q}` }],
                  details: {},
                });
              }),
            ),
        };

        const agent = new Agent({
          getApiKey: () => "test-key",
          initialState: {
            model,
            systemPrompt: "Test",
            tools: [tool],
          },
          streamFn: (_model, context) =>
            effectRunPromise(
              Effect.gen(function* () {
                const stream = createAssistantMessageEventStream();
                queueMicrotask(() => {
                  const toolResultCount = context.messages.filter(
                    (message) => message.role === "toolResult",
                  ).length;
                  if (toolResultCount > 0) {
                    const message: AssistantMessage = {
                      role: "assistant",
                      content: [{ type: "text" as const, text: "done" }],
                      api: "anthropic-messages" as const,
                      provider: "anthropic",
                      model: "mock",
                      usage: {
                        input: 1,
                        output: 1,
                        cacheRead: 0,
                        cacheWrite: 0,
                        totalTokens: 2,
                        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                      },
                      stopReason: "stop",
                      timestamp: currentTimeMillis(),
                    };
                    stream.push({ type: "start" as const, partial: { ...message, content: [] } });
                    stream.push({ type: "done" as const, reason: "stop", message });
                    return;
                  }

                  const message: AssistantMessage = {
                    role: "assistant",
                    content: [
                      {
                        type: "toolCall" as const,
                        id: "toolu_1",
                        name: "dummy",
                        arguments: { q: "x" },
                      },
                      {
                        type: "toolCall" as const,
                        id: "toolu_2",
                        name: "dummy",
                        arguments: { q: "y" },
                      },
                    ],
                    api: "anthropic-messages" as const,
                    provider: "anthropic",
                    model: "mock",
                    usage: {
                      input: 1,
                      output: 1,
                      cacheRead: 0,
                      cacheWrite: 0,
                      totalTokens: 2,
                      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                    },
                    stopReason: "toolUse",
                    timestamp: currentTimeMillis(),
                  };

                  stream.push({ type: "start" as const, partial: { ...message, content: [] } });
                  stream.push({ type: "done" as const, reason: "toolUse", message });
                });
                return yield* awaited(stream);
              }),
            ),
        });

        const sessionManager = SessionManager.inMemory();
        const settingsManager = SettingsManager.create(tempDir, tempDir);
        const authStorage = AuthStorage.create(joinPath(tempDir, "auth.json"));
        const modelRegistry = yield* awaited(createModelRegistry(authStorage, tempDir));
        yield* awaited(
          authStorage.modify("anthropic", () =>
            effectRunPromise(awaited({ type: "api_key" as const, key: "test-key" })),
          ),
        );

        session = new AgentSession({
          agent,
          sessionManager,
          settingsManager,
          cwd: tempDir,
          modelRuntime: getModelRuntime(modelRegistry),
          resourceLoader: createTestResourceLoader(),
          baseToolsOverride: { dummy: tool },
        });

        const snapshots: string[][] = [];
        const sessionWithRunner = session as unknown as {
          _extensionRunner?: {
            hasHandlers: (eventType: string) => boolean;
            emit: (event: { type: string; message?: { role?: string } }) => Promise<void>;
            emitMessageEnd: (event: {
              type: string;
              message?: { role?: string };
            }) => Promise<undefined>;
            emitToolCall: (event: { type: string; toolCallId: string }) => Promise<undefined>;
            emitInput: (
              text: string,
              images: unknown,
              source: "interactive" | "rpc" | "extension",
              streamingBehavior?: "steer" | "followUp",
            ) => Promise<{ action: "continue" }>;
            emitBeforeAgentStart: (
              trigger: unknown,
              systemPromptOptions: BuildSystemPromptOptions,
            ) => Promise<{ messages: []; systemPromptOptions: NormalizedBuildSystemPromptOptions }>;
            invalidate: (message?: string) => void;
          };
        };
        sessionWithRunner._extensionRunner = {
          hasHandlers: (eventType) => eventType === "tool_call",
          emit: () => effectRunPromise(Effect.sync(() => {})),
          emitMessageEnd: () => effectRunPromise(awaited(undefined)),
          emitToolCall: () =>
            effectRunPromise(
              Effect.gen(function* () {
                snapshots.push(
                  sessionManager
                    .getEntries()
                    .filter((entry) => entry.type === "message")
                    .map((entry) => entry.message.role),
                );
                return yield* awaited(undefined);
              }),
            ),
          emitInput: () => effectRunPromise(awaited({ action: "continue" })),
          emitBeforeAgentStart: (_trigger, systemPromptOptions) =>
            effectRunPromise(
              awaited({
                messages: [],
                systemPromptOptions: normalizeBuildSystemPromptOptions(systemPromptOptions),
              }),
            ),
          invalidate: () => {},
        };

        yield* awaited(session.prompt("hi"));
        yield* awaited(session.agent.waitForIdle());

        expect(snapshots).toEqual([
          ["system", "user", "assistant"],
          ["system", "user", "assistant"],
        ]);
      }),
    ));

  it("should persist message_end events in order with slow extension handlers", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const model = getModel("anthropic", "claude-sonnet-4-5")!;
        const tool = {
          name: "dummy",
          description: "Dummy tool",
          label: "dummy",
          parameters: Type.Object({ q: Type.String() }),
          execute: (_toolCallId: string, params: unknown) =>
            effectRunPromise(
              Effect.gen(function* () {
                const q =
                  typeof params === "object" && params !== null && "q" in params
                    ? String((params as { q: unknown }).q)
                    : "";
                return yield* awaited({
                  content: [{ type: "text" as const, text: `result:${q}` }],
                  details: {},
                });
              }),
            ),
        };

        const agent = new Agent({
          getApiKey: () => "test-key",
          initialState: {
            model,
            systemPrompt: "Test",
            tools: [tool],
          },
          streamFn: (_model, context) =>
            effectRunPromise(
              Effect.gen(function* () {
                const stream = createAssistantMessageEventStream();
                queueMicrotask(() => {
                  const hasToolResult = context.messages.some(
                    (message) => message.role === "toolResult",
                  );

                  if (hasToolResult) {
                    const message: AssistantMessage = {
                      role: "assistant",
                      content: [{ type: "text" as const, text: "done" }],
                      api: "anthropic-messages" as const,
                      provider: "anthropic",
                      model: "mock",
                      usage: {
                        input: 1,
                        output: 1,
                        cacheRead: 0,
                        cacheWrite: 0,
                        totalTokens: 2,
                        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                      },
                      stopReason: "stop",
                      timestamp: currentTimeMillis(),
                    };
                    stream.push({ type: "start" as const, partial: { ...message, content: [] } });
                    stream.push({ type: "done" as const, reason: "stop", message });
                    return;
                  }

                  const message: AssistantMessage = {
                    role: "assistant",
                    content: [
                      { type: "text" as const, text: "calling tool" },
                      {
                        type: "toolCall" as const,
                        id: "toolu_1",
                        name: "dummy",
                        arguments: { q: "x" },
                      },
                    ],
                    api: "anthropic-messages" as const,
                    provider: "anthropic",
                    model: "mock",
                    usage: {
                      input: 1,
                      output: 1,
                      cacheRead: 0,
                      cacheWrite: 0,
                      totalTokens: 2,
                      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                    },
                    stopReason: "toolUse",
                    timestamp: currentTimeMillis(),
                  };

                  stream.push({ type: "start" as const, partial: { ...message, content: [] } });
                  stream.push({ type: "done" as const, reason: "toolUse", message });
                });
                return yield* awaited(stream);
              }),
            ),
        });

        const sessionManager = SessionManager.inMemory();
        const settingsManager = SettingsManager.create(tempDir, tempDir);
        const authStorage = AuthStorage.create(joinPath(tempDir, "auth.json"));
        const modelRegistry = yield* awaited(createModelRegistry(authStorage, tempDir));
        yield* awaited(
          authStorage.modify("anthropic", () =>
            effectRunPromise(awaited({ type: "api_key" as const, key: "test-key" })),
          ),
        );

        session = new AgentSession({
          agent,
          sessionManager,
          settingsManager,
          cwd: tempDir,
          modelRuntime: getModelRuntime(modelRegistry),
          resourceLoader: createTestResourceLoader(),
          baseToolsOverride: { dummy: tool },
        });

        const sessionWithRunner = session as unknown as {
          _extensionRunner?: {
            hasHandlers: (eventType: string) => boolean;
            emit: (event: { type: string; message?: { role?: string } }) => Promise<void>;
            emitMessageEnd: (event: {
              type: string;
              message?: { role?: string };
            }) => Promise<undefined>;
            emitInput: (
              text: string,
              images: unknown,
              source: "interactive" | "rpc" | "extension",
              streamingBehavior?: "steer" | "followUp",
            ) => Promise<{ action: "continue" }>;
            emitBeforeAgentStart: (
              trigger: unknown,
              systemPromptOptions: BuildSystemPromptOptions,
            ) => Promise<{ messages: []; systemPromptOptions: NormalizedBuildSystemPromptOptions }>;
            invalidate: (message?: string) => void;
          };
        };
        sessionWithRunner._extensionRunner = {
          hasHandlers: () => false,
          emit: () => effectRunPromise(Effect.sync(() => {})),
          emitMessageEnd: (event) =>
            effectRunPromise(
              Effect.gen(function* () {
                if (event.type === "message_end" && event.message?.role === "assistant") {
                  yield* Effect.sleep(40);
                }
                return yield* awaited(undefined);
              }),
            ),
          emitInput: () => effectRunPromise(awaited({ action: "continue" })),
          emitBeforeAgentStart: (_trigger, systemPromptOptions) =>
            effectRunPromise(
              awaited({
                messages: [],
                systemPromptOptions: normalizeBuildSystemPromptOptions(systemPromptOptions),
              }),
            ),
          invalidate: () => {},
        };

        yield* awaited(session.prompt("hi"));
        yield* awaited(session.agent.waitForIdle());
        yield* Effect.sleep(100);

        const messageEntries = sessionManager
          .getEntries()
          .filter((entry) => entry.type === "message");
        expect(messageEntries.map((entry) => entry.message.role)).toEqual([
          "system",
          "user",
          "assistant",
          "toolResult",
          "system",
          "assistant",
        ]);
      }),
    ));
});
