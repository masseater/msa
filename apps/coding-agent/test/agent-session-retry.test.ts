import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

import { Agent, type AgentEvent, type AgentTool } from "@msa/agent-core";
import { type AssistantMessage, createAssistantMessageEventStream, getModel } from "@msa/ai/compat";
import {
  awaited,
  runTest,
  currentTimeMillis,
  joinPath,
  pathExists,
  removePath,
} from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { createTestResourceLoader } from "./utilities.ts";

function createAssistantMessage(
  text: string,
  overrides?: Partial<AssistantMessage>,
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text" as const, text }],
    api: "anthropic-messages" as const,
    provider: "anthropic-api",
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
    ...overrides,
  };
}

type SessionWithExtensionEmitHook = {
  emitExtensionEvent: (event: AgentEvent) => Promise<void>;
};

describe("AgentSession retry", () => {
  let session: AgentSession;
  let tempDir: string;

  beforeEach(() =>
    runTest(
      Effect.sync(() => {
        tempDir = joinPath(tmpdir(), `msa-retry-test-${currentTimeMillis()}`);
        mkdirSync(tempDir, { recursive: true });
      }),
    ),
  );

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        if (session !== null && session !== undefined) {
          session.dispose();
        }
        if (tempDir.length > 0 && (yield* pathExists(tempDir))) {
          yield* removePath(tempDir);
        }
      }),
    ),
  );

  function createSession(options?: {
    failCount?: number;
    maxRetries?: number;
    maxAgentDelayMs?: number;
    delayAssistantMessageEndMs?: number;
  }) {
    return runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const failCount = options?.failCount ?? 1;
        const maxRetries = options?.maxRetries ?? 3;
        const maxAgentDelayMs = options?.maxAgentDelayMs ?? 60000;
        const delayAssistantMessageEndMs = options?.delayAssistantMessageEndMs ?? 0;
        let callCount = 0;

        const model = getModel("anthropic-api", "claude-sonnet-4-5")!;
        const agent = new Agent({
          getApiKey: () => "test-key",
          initialState: { model, systemPrompt: "Test", tools: [] },
          streamFn: () => {
            callCount++;
            const stream = createAssistantMessageEventStream();
            queueMicrotask(() => {
              if (callCount <= failCount) {
                const msg = createAssistantMessage("", {
                  stopReason: "error",
                  errorMessage: "overloaded_error",
                });
                stream.push({ type: "start" as const, partial: msg });
                stream.push({ type: "error" as const, reason: "error", error: msg });
              } else {
                const msg = createAssistantMessage("Success");
                stream.push({ type: "start" as const, partial: msg });
                stream.push({ type: "done" as const, reason: "stop", message: msg });
              }
            });
            return stream;
          },
        });

        const sessionManager = SessionManager.inMemory();
        const settingsManager = SettingsManager.create(tempDir, tempDir);
        const authStorage = AuthStorage.create(joinPath(tempDir, "auth.json"));
        const modelRegistry = yield* awaited(createModelRegistry(authStorage, tempDir));
        yield* awaited(
          authStorage.modify("anthropic-api", () =>
            effectRunPromise(awaited({ type: "api_key" as const, key: "test-key" })),
          ),
        );
        settingsManager.applyOverrides({
          retry: { enabled: true, maxRetries, baseDelayMs: 1, maxAgentDelayMs },
        });

        session = new AgentSession({
          agent,
          sessionManager,
          settingsManager,
          cwd: tempDir,
          modelRuntime: getModelRuntime(modelRegistry),
          resourceLoader: createTestResourceLoader(),
        });

        if (delayAssistantMessageEndMs > 0) {
          const sessionWithHook = session as unknown as SessionWithExtensionEmitHook;
          const original = sessionWithHook.emitExtensionEvent.bind(sessionWithHook);
          sessionWithHook.emitExtensionEvent = (event: AgentEvent) =>
            effectRunPromise(
              Effect.gen(function* () {
                if (event.type === "message_end" && event.message.role === "assistant") {
                  yield* Effect.sleep(delayAssistantMessageEndMs);
                }
                yield* awaited(original(event));
              }),
            );
        }

        return yield* awaited({ session, getCallCount: () => callCount });
      }),
    );
  }

  it("retries after a transient error and succeeds", () =>
    runTest(
      Effect.gen(function* () {
        const created = yield* awaited(createSession({ failCount: 1 }));
        const events: string[] = [];
        created.session.subscribe((event) => {
          if (event.type === "auto_retry_start") events.push(`start:${event.attempt}`);
          if (event.type === "auto_retry_end") events.push(`end:success=${event.success}`);
        });

        yield* awaited(created.session.prompt("Test"));

        expect(created.getCallCount()).toBe(2);
        expect(events).toEqual(["start:1", "end:success=true"]);
        expect(created.session.isRetrying).toBe(false);
      }),
    ));

  it("exhausts max retries and emits failure", () =>
    runTest(
      Effect.gen(function* () {
        const created = yield* awaited(createSession({ failCount: 99, maxRetries: 2 }));
        const events: string[] = [];
        created.session.subscribe((event) => {
          if (event.type === "auto_retry_start") events.push(`start:${event.attempt}`);
          if (event.type === "auto_retry_end") events.push(`end:success=${event.success}`);
        });

        yield* awaited(created.session.prompt("Test"));

        expect(created.getCallCount()).toBe(3);
        expect(events).toContain("start:1");
        expect(events).toContain("start:2");
        expect(events).toContain("end:success=false");
        expect(created.session.isRetrying).toBe(false);
      }),
    ));

  it("caps agent retry delay", () =>
    runTest(
      Effect.gen(function* () {
        const created = yield* awaited(
          createSession({ failCount: 4, maxRetries: 5, maxAgentDelayMs: 5 }),
        );
        const delays: number[] = [];
        created.session.subscribe((event) => {
          if (event.type === "auto_retry_start") delays.push(event.delayMs);
        });

        yield* awaited(created.session.prompt("Test"));

        expect(delays).toEqual([1, 2, 4, 5]);
      }),
    ));

  it("prompt waits for retry completion even when assistant message_end handling is delayed", () =>
    runTest(
      Effect.gen(function* () {
        const created = yield* awaited(
          createSession({ failCount: 1, delayAssistantMessageEndMs: 40 }),
        );

        yield* awaited(created.session.prompt("Test"));

        expect(created.getCallCount()).toBe(2);
        expect(created.session.isRetrying).toBe(false);
      }),
    ));

  it("retries provider network_error failures", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const created = yield* awaited(createSession({ failCount: 0 }));
        let callCount = 0;
        const streamFn = () => {
          callCount++;
          const stream = createAssistantMessageEventStream();
          queueMicrotask(() => {
            if (callCount === 1) {
              const msg = createAssistantMessage("", {
                stopReason: "error",
                errorMessage: "Provider finish_reason: network_error",
              });
              stream.push({ type: "start" as const, partial: msg });
              stream.push({ type: "error" as const, reason: "error", error: msg });
              return;
            }

            const msg = createAssistantMessage("Recovered after retry");
            stream.push({ type: "start" as const, partial: msg });
            stream.push({ type: "done" as const, reason: "stop", message: msg });
          });
          return stream;
        };
        created.session.dispose();

        const model = getModel("anthropic-api", "claude-sonnet-4-5")!;
        const agent = new Agent({
          getApiKey: () => "test-key",
          initialState: { model, systemPrompt: "Test", tools: [] },
          streamFn: streamFn,
        });
        const sessionManager = SessionManager.inMemory();
        const settingsManager = SettingsManager.create(tempDir, tempDir);
        const authStorage = AuthStorage.create(joinPath(tempDir, "auth.json"));
        const modelRegistry = yield* awaited(createModelRegistry(authStorage, tempDir));
        yield* awaited(
          authStorage.modify("anthropic-api", () =>
            effectRunPromise(awaited({ type: "api_key" as const, key: "test-key" })),
          ),
        );
        settingsManager.applyOverrides({ retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } });
        session = new AgentSession({
          agent,
          sessionManager,
          settingsManager,
          cwd: tempDir,
          modelRuntime: getModelRuntime(modelRegistry),
          resourceLoader: createTestResourceLoader(),
        });

        const events: string[] = [];
        session.subscribe((event) => {
          if (event.type === "auto_retry_start") events.push(`start:${event.attempt}`);
          if (event.type === "auto_retry_end") events.push(`end:success=${event.success}`);
        });

        yield* awaited(session.prompt("Test"));

        expect(callCount).toBe(2);
        expect(events).toEqual(["start:1", "end:success=true"]);
      }),
    ));

  it("prompt waits for full agent loop when retry produces tool calls", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        let callCount = 0;
        const toolExecuted = { value: false };

        const echoTool: AgentTool = {
          name: "echo",
          label: "Echo",
          description: "Echo text back",
          parameters: Type.Object({ text: Type.String() }),
          execute: () =>
            effectRunPromise(
              Effect.gen(function* () {
                toolExecuted.value = true;
                return yield* awaited({
                  content: [{ type: "text" as const, text: "echoed" }],
                  details: undefined,
                });
              }),
            ),
        };

        const model = getModel("anthropic-api", "claude-sonnet-4-5")!;
        const agent = new Agent({
          getApiKey: () => "test-key",
          initialState: { model, systemPrompt: "Test", tools: [] },
          streamFn: () => {
            callCount++;
            const stream = createAssistantMessageEventStream();
            queueMicrotask(() => {
              if (callCount === 1) {
                const msg = createAssistantMessage("", {
                  stopReason: "error",
                  errorMessage: "overloaded_error",
                });
                stream.push({ type: "start" as const, partial: msg });
                stream.push({ type: "error" as const, reason: "error", error: msg });
              } else if (callCount === 2) {
                const msg: AssistantMessage = {
                  ...createAssistantMessage("Looking that up now."),
                  stopReason: "toolUse",
                  content: [
                    { type: "text" as const, text: "Looking that up now." },
                    {
                      type: "toolCall" as const,
                      id: "call_1",
                      name: "echo",
                      arguments: { text: "hello" },
                    },
                  ],
                };
                stream.push({ type: "start" as const, partial: msg });
                stream.push({ type: "done" as const, reason: "toolUse", message: msg });
              } else {
                const msg = createAssistantMessage("Final answer.");
                stream.push({ type: "start" as const, partial: msg });
                stream.push({ type: "done" as const, reason: "stop", message: msg });
              }
            });
            return stream;
          },
        });

        const sessionManager = SessionManager.inMemory();
        const settingsManager = SettingsManager.create(tempDir, tempDir);
        const authStorage = AuthStorage.create(joinPath(tempDir, "auth.json"));
        const modelRegistry = yield* awaited(createModelRegistry(authStorage, tempDir));
        yield* awaited(
          authStorage.modify("anthropic-api", () =>
            effectRunPromise(awaited({ type: "api_key" as const, key: "test-key" })),
          ),
        );
        settingsManager.applyOverrides({ retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } });

        session = new AgentSession({
          agent,
          sessionManager,
          settingsManager,
          cwd: tempDir,
          modelRuntime: getModelRuntime(modelRegistry),
          resourceLoader: createTestResourceLoader(),
          baseToolsOverride: { echo: echoTool },
        });

        yield* awaited(session.prompt("Test"));

        expect(callCount).toBe(3);

        expect(toolExecuted.value).toBe(true);

        expect(session.isStreaming).toBe(false);

        yield* awaited(session.prompt("Follow-up"));
        expect(callCount).toBe(4);
      }),
    ));
});
