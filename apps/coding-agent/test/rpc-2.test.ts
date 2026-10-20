import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import processEnv from "../src/core/process-env.ts";
import rpcSupport from "./rpc-support.ts";

const { readEnv } = processEnv;

const { withClient } = rpcSupport;

const { awaited, runTest } = testing;

describe.skipIf(
  readEnv("ANTHROPIC_API_KEY") === undefined && readEnv("ANTHROPIC_OAUTH_TOKEN") === undefined,
)("RPC mode", () => {
  test(
    "should set and get thinking level",
    () =>
      runTest(
        withClient((client) =>
          Effect.gen(function* () {
            yield* awaited(client.setThinkingLevel("high"));

            const state = yield* awaited(client.getState());
            expect(state.thinkingLevel).toBe("high");
          }),
        ),
      ),
    30000,
  );

  test(
    "should cycle thinking level",
    () =>
      runTest(
        withClient((client) =>
          Effect.gen(function* () {
            const initialState = yield* awaited(client.getState());
            const initialLevel = initialState.thinkingLevel;

            const result = yield* awaited(client.cycleThinkingLevel());
            expect(result).toBeDefined();
            expect(result!.level).not.toBe(initialLevel);

            const newState = yield* awaited(client.getState());
            expect(newState.thinkingLevel).toBe(result!.level);
          }),
        ),
      ),
    30000,
  );
});

describe.skipIf(
  readEnv("ANTHROPIC_API_KEY") === undefined && readEnv("ANTHROPIC_OAUTH_TOKEN") === undefined,
)("RPC mode", () => {
  test(
    "should get available thinking levels",
    () =>
      runTest(
        withClient((client) =>
          Effect.gen(function* () {
            const levels = yield* awaited(client.getAvailableThinkingLevels());
            expect(levels.length).toBeGreaterThan(0);

            const state = yield* awaited(client.getState());
            expect(levels).toContain(state.thinkingLevel);

            const initialLevel = state.thinkingLevel;
            const cycled = yield* awaited(client.cycleThinkingLevel());
            if (cycled !== undefined && cycled !== null) {
              expect(levels).toContain(cycled.level);

              if (levels.length > 1) {
                expect(cycled.level).not.toBe(initialLevel);
              }
            }
          }),
        ),
      ),
    30000,
  );
});

describe.skipIf(
  readEnv("ANTHROPIC_API_KEY") === undefined && readEnv("ANTHROPIC_OAUTH_TOKEN") === undefined,
)("RPC mode", () => {
  test(
    "should get available models",
    () =>
      runTest(
        withClient((client) =>
          Effect.gen(function* () {
            const models = yield* awaited(client.getAvailableModels());
            expect(models.length).toBeGreaterThan(0);

            for (const model of models) {
              expect(model.provider).toBeDefined();
              expect(model.id).toBeDefined();
              expect(model.contextWindow).toBeGreaterThan(0);
              expect(typeof model.reasoning).toBe("boolean");
            }
          }),
        ),
      ),
    30000,
  );

  test(
    "should get session stats",
    () =>
      runTest(
        withClient((client) =>
          Effect.gen(function* () {
            yield* awaited(client.promptAndWait("Hello"));

            const stats = yield* awaited(client.getSessionStats());
            expect(stats.sessionFile).toBeDefined();
            expect(stats.sessionId).toBeDefined();
            expect(stats.userMessages).toBeGreaterThanOrEqual(1);
            expect(stats.assistantMessages).toBeGreaterThanOrEqual(1);
          }),
        ),
      ),
    90000,
  );
});

describe.skipIf(
  readEnv("ANTHROPIC_API_KEY") === undefined && readEnv("ANTHROPIC_OAUTH_TOKEN") === undefined,
)("RPC mode", () => {
  test(
    "should create new session",
    () =>
      runTest(
        withClient((client) =>
          Effect.gen(function* () {
            yield* awaited(client.promptAndWait("Hello"));

            let state = yield* awaited(client.getState());
            expect(state.messageCount).toBeGreaterThan(0);

            yield* awaited(client.newSession());

            state = yield* awaited(client.getState());
            expect(state.messageCount).toBe(0);
          }),
        ),
      ),
    90000,
  );
});
