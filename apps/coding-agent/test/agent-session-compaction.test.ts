import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { Agent } from "@msa/agent-core";
import { getModel, streamSimple } from "@msa/ai/compat";
import { awaited, runTest, currentTimeMillis, joinPath } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { AgentSession, type AgentSessionEvent } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createCodingTools } from "../src/index.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { API_KEY, createTestResourceLoader } from "./utilities.ts";

describe.skipIf(!API_KEY)("AgentSession compaction e2e", () => {
  let session: AgentSession;
  let tempDir: string;
  let sessionManager: SessionManager;
  let events: AgentSessionEvent[];

  beforeEach(() =>
    runTest(
      Effect.sync(() => {
        tempDir = joinPath(tmpdir(), `msa-compaction-test-${currentTimeMillis()}`);
        mkdirSync(tempDir, { recursive: true });

        events = [];
      }),
    ),
  );

  afterEach(() =>
    runTest(
      Effect.sync(() => {
        if (session) {
          session.dispose();
        }
        if (tempDir && existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true });
        }
      }),
    ),
  );

  function createSession(inMemory = false) {
    return runTest(
      Effect.gen(function* () {
        const model = getModel("anthropic", "claude-sonnet-4-5")!;
        const agent = new Agent({
          getApiKey: () => API_KEY,
          streamFn: streamSimple,
          initialState: {
            model,
            systemPrompt: "You are a helpful assistant. Be concise.",
            tools: createCodingTools(process.cwd()),
          },
        });

        sessionManager = inMemory ? SessionManager.inMemory() : SessionManager.create(tempDir);
        const settingsManager = SettingsManager.create(tempDir, tempDir);

        settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
        const authStorage = AuthStorage.create(joinPath(tempDir, "auth.json"));
        const modelRegistry = yield* awaited(createModelRegistry(authStorage));

        session = new AgentSession({
          agent,
          sessionManager,
          settingsManager,
          cwd: tempDir,
          modelRuntime: getModelRuntime(modelRegistry),
          resourceLoader: createTestResourceLoader(),
        });

        session.subscribe((event) => {
          events.push(event);
        });

        return yield* awaited(session);
      }),
    );
  }

  it(
    "should trigger manual compaction via compact()",
    () =>
      runTest(
        Effect.gen(function* () {
          yield* awaited(createSession());

          yield* awaited(session.prompt("What is 2+2? Reply with just the number."));
          yield* awaited(session.agent.waitForIdle());

          yield* awaited(session.prompt("What is 3+3? Reply with just the number."));
          yield* awaited(session.agent.waitForIdle());

          const result = yield* awaited(session.compact());

          expect(result.summary).toBeDefined();
          expect(result.summary.length).toBeGreaterThan(0);
          expect(result.tokensBefore).toBeGreaterThan(0);

          const messages = session.messages;
          expect(messages.length).toBeGreaterThan(0);

          const firstMsg = messages[0];
          expect(firstMsg?.role).toBe("compactionSummary");
        }),
      ),
    120000,
  );

  it(
    "should maintain valid session state after compaction",
    () =>
      runTest(
        Effect.gen(function* () {
          yield* awaited(createSession());

          yield* awaited(session.prompt("What is the capital of France? One word answer."));
          yield* awaited(session.agent.waitForIdle());

          yield* awaited(session.prompt("What is the capital of Germany? One word answer."));
          yield* awaited(session.agent.waitForIdle());

          yield* awaited(session.compact());

          yield* awaited(session.prompt("What is the capital of Italy? One word answer."));
          yield* awaited(session.agent.waitForIdle());

          expect(session.messages.length).toBeGreaterThan(0);

          const assistantMessages = session.messages.filter((m) => m.role === "assistant");
          expect(assistantMessages.length).toBeGreaterThan(0);
        }),
      ),
    180000,
  );

  it(
    "should persist compaction to session file",
    () =>
      runTest(
        Effect.gen(function* () {
          yield* awaited(createSession());

          yield* awaited(session.prompt("Say hello"));
          yield* awaited(session.agent.waitForIdle());

          yield* awaited(session.prompt("Say goodbye"));
          yield* awaited(session.agent.waitForIdle());

          yield* awaited(session.compact());

          const entries = sessionManager.getEntries();

          const compactionEntries = entries.filter((e) => e.type === "compaction");
          expect(compactionEntries.length).toBe(1);

          const compaction = compactionEntries[0];
          if (compaction === undefined) throw new Error("expected a compaction entry");
          expect(compaction.type).toBe("compaction");
          if (compaction.type === "compaction") {
            expect(compaction.summary.length).toBeGreaterThan(0);
            expect(typeof compaction.firstKeptEntryId).toBe("string");
            expect(compaction.tokensBefore).toBeGreaterThan(0);
          }
        }),
      ),
    120000,
  );

  it(
    "should work with --no-session mode (in-memory only)",
    () =>
      runTest(
        Effect.gen(function* () {
          yield* awaited(createSession(true));

          yield* awaited(session.prompt("What is 2+2? Reply with just the number."));
          yield* awaited(session.agent.waitForIdle());

          yield* awaited(session.prompt("What is 3+3? Reply with just the number."));
          yield* awaited(session.agent.waitForIdle());

          const result = yield* awaited(session.compact());

          expect(result.summary).toBeDefined();
          expect(result.summary.length).toBeGreaterThan(0);

          const entries = sessionManager.getEntries();
          const compactionEntries = entries.filter((e) => e.type === "compaction");
          expect(compactionEntries.length).toBe(1);
        }),
      ),
    120000,
  );

  it(
    "should emit compaction events during manual compaction",
    () =>
      runTest(
        Effect.gen(function* () {
          yield* awaited(createSession());

          yield* awaited(session.prompt("Say hello"));
          yield* awaited(session.agent.waitForIdle());

          yield* awaited(session.compact());

          const compactionEvents = events.filter(
            (e) => e.type === "compaction_start" || e.type === "compaction_end",
          );
          expect(compactionEvents).toHaveLength(2);
          expect(compactionEvents[0]).toEqual({
            type: "compaction_start" as const,
            reason: "manual",
          });
          expect(compactionEvents[1]).toMatchObject({
            type: "compaction_end" as const,
            reason: "manual",
            aborted: false,
            willRetry: false,
          });

          const messageEndEvents = events.filter((e) => e.type === "message_end");
          expect(messageEndEvents.length).toBeGreaterThan(0);
        }),
      ),
    120000,
  );
});
