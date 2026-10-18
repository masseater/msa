import { tmpdir } from "node:os";

import { Agent } from "@msa/agent-core";
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  fauxAssistantMessage,
} from "@msa/ai";
import { getModel, streamSimple } from "@msa/ai/compat";
import {
  awaited,
  runTest,
  currentTimeMillis,
  makeDirectory,
  joinPath,
  pathExists,
  removePath,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { createTestResourceLoader } from "./utilities.ts";

describe("AgentSession auto-compaction queue resume", () => {
  let session: AgentSession;
  let sessionManager: SessionManager;
  let settingsManager: SettingsManager;
  let tempDir: string;

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        tempDir = joinPath(tmpdir(), `msa-auto-compaction-queue-${currentTimeMillis()}`);
        yield* makeDirectory(tempDir);

        const model = getModel("anthropic", "claude-sonnet-4-5")!;
        const agent = new Agent({
          streamFn: streamSimple,
          initialState: {
            model,
            systemPrompt: "Test",
            tools: [],
          },
        });

        sessionManager = SessionManager.inMemory();
        settingsManager = SettingsManager.create(tempDir, tempDir);
        const authStorage = AuthStorage.create(joinPath(tempDir, "auth.json"));
        yield* awaited(
          authStorage.modify("anthropic", () =>
            effectRunPromise(awaited({ type: "api_key" as const, key: "test-key" })),
          ),
        );
        const modelRegistry = yield* awaited(createModelRegistry(authStorage, tempDir));

        session = new AgentSession({
          agent,
          sessionManager,
          settingsManager,
          cwd: tempDir,
          modelRuntime: getModelRuntime(modelRegistry),
          resourceLoader: createTestResourceLoader(),
        });
      }),
    ),
  );

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        session.dispose();
        vi.restoreAllMocks();
        if (tempDir.length > 0 && (yield* pathExists(tempDir))) {
          yield* removePath(tempDir);
        }
      }),
    ),
  );

  it("should resume after threshold compaction when only agent-level queued messages exist", () =>
    runTest(
      Effect.gen(function* () {
        settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
        const model = session.model!;
        const now = currentTimeMillis();
        sessionManager.appendMessage({
          role: "user",
          content: [{ type: "text" as const, text: "message to compact" }],
          timestamp: now - 1000,
        });
        sessionManager.appendMessage({
          role: "assistant",
          content: [{ type: "text" as const, text: "assistant response to compact" }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 100,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 100,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: now - 500,
        });
        session.agent.state.messages = sessionManager.buildSessionContext().messages;
        session.agent.streamFunction = (summaryModel) => {
          const stream = createAssistantMessageEventStream();
          void Promise.resolve().then(() => {
            stream.push({
              type: "done" as const,
              reason: "stop",
              message: {
                ...fauxAssistantMessage("compacted"),
                api: summaryModel.api,
                provider: summaryModel.provider,
                model: summaryModel.id,
                usage: {
                  input: 10,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 10,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                },
              },
            });
          });
          return stream;
        };

        session.agent.followUp({
          role: "custom",
          customType: "test",
          content: [{ type: "text" as const, text: "Queued custom" }],
          display: false,
          timestamp: currentTimeMillis(),
        });

        expect(session.pendingMessageCount).toBe(0);
        expect(session.agent.hasQueuedMessages()).toBe(true);

        const continueSpy = vi.spyOn(session.agent, "continue").mockResolvedValue();

        const runAutoCompaction = (
          session as unknown as {
            _runAutoCompaction: (
              reason: "overflow" | "threshold",
              willRetry: boolean,
            ) => Promise<boolean>;
          }
        )._runAutoCompaction.bind(session);

        yield* awaited(expect(runAutoCompaction("threshold", false)).resolves.toBe(true));

        expect(continueSpy).not.toHaveBeenCalled();
      }),
    ));

  it("should not compact repeatedly after overflow recovery already attempted", () =>
    runTest(
      Effect.gen(function* () {
        const model = session.model!;
        const overflowMessage: AssistantMessage = {
          role: "assistant",
          content: [{ type: "text" as const, text: "" }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "error",
          errorMessage: "prompt is too long",
          timestamp: currentTimeMillis(),
        };

        const runAutoCompactionSpy = vi
          .spyOn(
            session as unknown as {
              _runAutoCompaction: (
                reason: "overflow" | "threshold",
                willRetry: boolean,
              ) => Promise<void>;
            },
            "_runAutoCompaction",
          )
          .mockResolvedValue();

        const events: Array<{ type: string; reason: string; errorMessage?: string | undefined }> =
          [];
        session.subscribe((event) => {
          if (event.type === "compaction_end") {
            events.push({
              type: event.type,
              reason: event.reason,
              errorMessage: event.errorMessage,
            });
          }
        });

        const checkCompaction = (
          session as unknown as {
            _checkCompaction: (
              assistantMessage: AssistantMessage,
              skipAbortedCheck?: boolean,
            ) => Promise<void>;
          }
        )._checkCompaction.bind(session);

        yield* awaited(checkCompaction(overflowMessage));
        yield* awaited(checkCompaction({ ...overflowMessage, timestamp: currentTimeMillis() + 1 }));

        expect(runAutoCompactionSpy).toHaveBeenCalledTimes(1);
        expect(events).toContainEqual({
          type: "compaction_end" as const,
          reason: "overflow",
          errorMessage:
            "Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model.",
        });
      }),
    ));

  it("should ignore stale pre-compaction assistant usage on pre-prompt compaction checks", () =>
    runTest(
      Effect.gen(function* () {
        const model = session.model!;
        const staleAssistantTimestamp = currentTimeMillis() - 10_000;
        const staleAssistant: AssistantMessage = {
          role: "assistant",
          content: [{ type: "text" as const, text: "large response before compaction" }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 600_000,
            output: 10_000,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 610_000,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: staleAssistantTimestamp,
        };

        sessionManager.appendMessage({
          role: "user",
          content: [{ type: "text" as const, text: "before compaction" }],
          timestamp: staleAssistantTimestamp - 1000,
        });
        sessionManager.appendMessage(staleAssistant);

        const firstKeptEntryId = sessionManager.getEntries()[0]!.id;
        sessionManager.appendCompaction(
          "summary",
          firstKeptEntryId,
          staleAssistant.usage.totalTokens,
          undefined,
          false,
        );

        sessionManager.appendMessage({
          role: "user",
          content: [{ type: "text" as const, text: "session recovery payload" }],
          timestamp: currentTimeMillis(),
        });

        const runAutoCompactionSpy = vi
          .spyOn(
            session as unknown as {
              _runAutoCompaction: (
                reason: "overflow" | "threshold",
                willRetry: boolean,
              ) => Promise<void>;
            },
            "_runAutoCompaction",
          )
          .mockResolvedValue();

        const checkCompaction = (
          session as unknown as {
            _checkCompaction: (
              assistantMessage: AssistantMessage,
              skipAbortedCheck?: boolean,
            ) => Promise<void>;
          }
        )._checkCompaction.bind(session);

        yield* awaited(checkCompaction(staleAssistant, false));

        expect(runAutoCompactionSpy).not.toHaveBeenCalled();
      }),
    ));

  it("should trigger threshold compaction for error messages using last successful usage", () =>
    runTest(
      Effect.gen(function* () {
        const model = session.model!;

        const compactionSettings = settingsManager.getCompactionSettings();
        const thresholdTokens =
          (model.contextWindow ?? 200_000) - compactionSettings.reserveTokens + 1;
        const successfulAssistant: AssistantMessage = {
          role: "assistant",
          content: [{ type: "text" as const, text: "large successful response" }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: thresholdTokens - 10_000,
            output: 10_000,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: thresholdTokens,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: currentTimeMillis(),
        };

        const errorAssistant: AssistantMessage = {
          role: "assistant",
          content: [{ type: "text" as const, text: "" }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "error",
          errorMessage: "529 overloaded",
          timestamp: currentTimeMillis() + 1000,
        };

        session.agent.state.messages = [
          {
            role: "user",
            content: [{ type: "text" as const, text: "hello" }],
            timestamp: currentTimeMillis() - 1000,
          },
          successfulAssistant,
          {
            role: "user",
            content: [{ type: "text" as const, text: "another prompt" }],
            timestamp: currentTimeMillis() + 500,
          },
          errorAssistant,
        ];

        const runAutoCompactionSpy = vi
          .spyOn(
            session as unknown as {
              _runAutoCompaction: (
                reason: "overflow" | "threshold",
                willRetry: boolean,
              ) => Promise<void>;
            },
            "_runAutoCompaction",
          )
          .mockResolvedValue();

        const checkCompaction = (
          session as unknown as {
            _checkCompaction: (
              assistantMessage: AssistantMessage,
              skipAbortedCheck?: boolean,
            ) => Promise<void>;
          }
        )._checkCompaction.bind(session);

        yield* awaited(checkCompaction(errorAssistant));

        expect(runAutoCompactionSpy).toHaveBeenCalledWith("threshold", false);
      }),
    ));

  it("should not trigger threshold compaction for error messages when no prior usage exists", () =>
    runTest(
      Effect.gen(function* () {
        const model = session.model!;

        const errorAssistant: AssistantMessage = {
          role: "assistant",
          content: [{ type: "text" as const, text: "" }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "error",
          errorMessage: "529 overloaded",
          timestamp: currentTimeMillis(),
        };

        session.agent.state.messages = [
          {
            role: "user",
            content: [{ type: "text" as const, text: "hello" }],
            timestamp: currentTimeMillis() - 1000,
          },
          errorAssistant,
        ];

        const runAutoCompactionSpy = vi
          .spyOn(
            session as unknown as {
              _runAutoCompaction: (
                reason: "overflow" | "threshold",
                willRetry: boolean,
              ) => Promise<void>;
            },
            "_runAutoCompaction",
          )
          .mockResolvedValue();

        const checkCompaction = (
          session as unknown as {
            _checkCompaction: (
              assistantMessage: AssistantMessage,
              skipAbortedCheck?: boolean,
            ) => Promise<void>;
          }
        )._checkCompaction.bind(session);

        yield* awaited(checkCompaction(errorAssistant));

        expect(runAutoCompactionSpy).not.toHaveBeenCalled();
      }),
    ));

  it("should not trigger threshold compaction for error messages when only kept pre-compaction usage exists", () =>
    runTest(
      Effect.gen(function* () {
        const model = session.model!;
        const preCompactionTimestamp = currentTimeMillis() - 10_000;

        const keptAssistant: AssistantMessage = {
          role: "assistant",
          content: [{ type: "text" as const, text: "kept response from before compaction" }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 180_000,
            output: 10_000,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 190_000,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: preCompactionTimestamp,
        };

        sessionManager.appendMessage({
          role: "user",
          content: [{ type: "text" as const, text: "before compaction" }],
          timestamp: preCompactionTimestamp - 1000,
        });
        sessionManager.appendMessage(keptAssistant);
        const firstKeptEntryId = sessionManager.getEntries()[0]!.id;
        sessionManager.appendCompaction(
          "summary",
          firstKeptEntryId,
          keptAssistant.usage.totalTokens,
          undefined,
          false,
        );

        const errorAssistant: AssistantMessage = {
          role: "assistant",
          content: [{ type: "text" as const, text: "" }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "error",
          errorMessage: "529 overloaded",
          timestamp: currentTimeMillis(),
        };

        session.agent.state.messages = [
          {
            role: "user",
            content: [{ type: "text" as const, text: "kept user msg" }],
            timestamp: preCompactionTimestamp - 1000,
          },
          keptAssistant,
          {
            role: "user",
            content: [{ type: "text" as const, text: "new prompt" }],
            timestamp: currentTimeMillis() - 500,
          },
          errorAssistant,
        ];

        const runAutoCompactionSpy = vi
          .spyOn(
            session as unknown as {
              _runAutoCompaction: (
                reason: "overflow" | "threshold",
                willRetry: boolean,
              ) => Promise<void>;
            },
            "_runAutoCompaction",
          )
          .mockResolvedValue();

        const checkCompaction = (
          session as unknown as {
            _checkCompaction: (
              assistantMessage: AssistantMessage,
              skipAbortedCheck?: boolean,
            ) => Promise<void>;
          }
        )._checkCompaction.bind(session);

        yield* awaited(checkCompaction(errorAssistant));

        expect(runAutoCompactionSpy).not.toHaveBeenCalled();
      }),
    ));
});
