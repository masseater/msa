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

const beforeEachHook4 = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = joinPath(tempRoot(), `msa-compaction-test-${currentTimeMillis()}`);
      yield* makeDirectory(tempDir);

      events = [];
    }),
  );

const afterEachHook4 = () =>
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
    beforeEach(beforeEachHook4);

    afterEach(afterEachHook4);

    it(
      "should work with --no-session mode (in-memory only)",
      () =>
        runTest(
          Effect.gen(function* () {
            yield* awaited(createSession(true));

            yield* awaited(
              session.run.prompting.prompt("What is 2+2? Reply with just the number."),
            );
            yield* awaited(session.agent.waitForIdle());

            yield* awaited(
              session.run.prompting.prompt("What is 3+3? Reply with just the number."),
            );
            yield* awaited(session.agent.waitForIdle());

            const result = yield* awaited(session.compaction.manual.compact());

            expect(result.summary).toBeDefined();
            expect(result.summary.length).toBeGreaterThan(0);

            const entries = sessionManager.getEntries();
            const compactionEntries = entries.filter((e) => e.type === "compaction");
            expect(compactionEntries.length).toBe(1);
          }),
        ),
      120000,
    );
  },
);

describe.skipIf(!(API_KEY !== undefined && API_KEY.length > 0))(
  "AgentSession compaction e2e",
  () => {
    beforeEach(beforeEachHook4);

    afterEach(afterEachHook4);

    it(
      "should emit compaction events during manual compaction",
      () =>
        runTest(
          Effect.gen(function* () {
            yield* awaited(createSession());

            yield* awaited(session.run.prompting.prompt("Say hello"));
            yield* awaited(session.agent.waitForIdle());

            yield* awaited(session.compaction.manual.compact());

            const compactionEvents = events.filter(
              (e) => e.type === "compaction_start" || e.type === "compaction_end",
            );
            expect(compactionEvents).toHaveLength(2);
            expect(compactionEvents[0]).toEqual({
              reason: "manual",
              type: "compaction_start" as const,
            });
            expect(compactionEvents[1]).toMatchObject({
              aborted: false,
              reason: "manual",
              type: "compaction_end" as const,
              willRetry: false,
            });

            const messageEndEvents = events.filter((e) => e.type === "message_end");
            expect(messageEndEvents.length).toBeGreaterThan(0);
          }),
        ),
      120000,
    );
  },
);
