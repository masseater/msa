import agentModule from "@msa/agent-core";
import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import AuthStorage from "../src/core/auth-storage.ts";
import src from "../src/index.ts";
import type srcTypes from "../src/index.types.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";
import utilities from "./utilities.ts";

const { AgentSession, SessionManager, SettingsManager, createCodingTools } = src;
const { getModel, streamSimple } = compat;

const { Agent } = agentModule;

const { API_KEY, createTestResourceLoader } = utilities;

const { createModelRegistry, getModelRuntime } = modelRuntimeTestUtils;

const { awaited, currentTimeMillis, joinPath, makeDirectory, removePath, runTest, tempRoot } =
  testing;

let session: srcTypes.AgentSession;

let tempDir: string;

let sessionManager: srcTypes.SessionManager;

let events: srcTypes.AgentSessionEvent[];

function createSession(inMemory = false) {
  return runTest(
    Effect.gen(function* () {
      const model = getModel("anthropic-api", "claude-sonnet-4-5")!;
      const agent = new Agent({
        getApiKey: () => API_KEY,
        initialState: {
          model,
          systemPrompt: "You are a helpful assistant. Be concise.",
          tools: createCodingTools(process.cwd()),
        },
        streamFn: streamSimple,
      });

      sessionManager = inMemory ? SessionManager.inMemory() : SessionManager.create(tempDir);
      const settingsManager = SettingsManager.create(tempDir, tempDir);

      settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
      const authStorage = AuthStorage.create(joinPath(tempDir, "auth.json"));
      const modelRegistry = yield* awaited(createModelRegistry(authStorage));

      session = new AgentSession({
        agent,
        cwd: tempDir,
        modelRuntime: getModelRuntime(modelRegistry),
        resourceLoader: createTestResourceLoader(),
        sessionManager,
        settingsManager,
      });

      session.subscribe((event) => {
        events.push(event);
      });

      return yield* awaited(session);
    }),
  );
}

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = joinPath(tempRoot(), `msa-compaction-test-${currentTimeMillis()}`);
      yield* makeDirectory(tempDir);

      events = [];
    }),
  );

const afterEachHook = () =>
  runTest(
    Effect.gen(function* () {
      if (session !== null && session !== undefined) {
        session.dispose();
      }
      if (tempDir.length > 0) {
        yield* removePath(tempDir);
      }
    }),
  );

describe.skipIf(!(API_KEY !== undefined && API_KEY.length > 0))(
  "AgentSession compaction e2e",
  () => {
    beforeEach(beforeEachHook);

    afterEach(afterEachHook);

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
  },
);

describe.skipIf(!(API_KEY !== undefined && API_KEY.length > 0))(
  "AgentSession compaction e2e",
  () => {
    beforeEach(beforeEachHook);

    afterEach(afterEachHook);

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
  },
);

describe.skipIf(!(API_KEY !== undefined && API_KEY.length > 0))(
  "AgentSession compaction e2e",
  () => {
    beforeEach(beforeEachHook);

    afterEach(afterEachHook);

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
  },
);
