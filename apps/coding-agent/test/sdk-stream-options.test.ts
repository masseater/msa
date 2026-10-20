import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import sdkStreamOptionsSupport from "./sdk-stream-options-support.ts";

const { awaited, currentTimeMillis, runTest } = testing;

const {
  captureStreamOptions,
  cleanupDirs,
  createCacheWarmingSession,
  createDoneMessage,
  prepareDirs,
} = sdkStreamOptionsSupport;

const schedulesCacheWarmingAfterACompletedSession = () =>
  runTest(
    Effect.gen(function* () {
      const fixture = yield* awaited(createCacheWarmingSession());
      try {
        yield* awaited(fixture.session.run.prompting.prompt("test"));
        expect(fixture.session.models.cacheWarming.cacheWarmingStatus?.nextWarmAt).toBeGreaterThan(
          currentTimeMillis(),
        );

        fixture.session.agent.state.messages = [...fixture.session.agent.state.messages];
        fixture.session.agent.state.model = { ...fixture.session.agent.state.model };
        expect(fixture.session.models.cacheWarming.cacheWarmingStatus?.nextWarmAt).toBeGreaterThan(
          currentTimeMillis(),
        );
        fixture.session.agent.state.messages = fixture.session.agent.state.messages.slice(1);
        expect(fixture.session.models.cacheWarming.cacheWarmingStatus?.reason).toBe(
          "conversation context changed",
        );
      } finally {
        fixture.dispose();
      }
    }),
  );

const waitsForTheNextRequestInsteadOf = () =>
  runTest(
    Effect.gen(function* () {
      const fixture = yield* awaited(
        createCacheWarmingSession((manager, model) => {
          manager.appendModelChange(model.provider, model.id);
          manager.appendThinkingLevelChange("off");
          manager.appendMessage({
            content: "test",
            role: "user",
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
        expect(fixture.session.models.cacheWarming.cacheWarmingStatus).toEqual({
          reason: "waiting for first request",
          state: "inactive",
        });
      } finally {
        fixture.dispose();
      }
    }),
  );

const forwardsHttpidletimeoutmsAsTimeoutmsForOpenaiCodex = () =>
  runTest(
    Effect.gen(function* () {
      const options = yield* awaited(
        captureStreamOptions("openai-codex-responses", {
          httpIdleTimeoutMs: 1234,
        }),
      );

      expect(options?.timeoutMs).toBe(1234);
    }),
  );

const defaultsTimeoutmsFromHttpidletimeoutmsForAllProviders = () =>
  runTest(
    Effect.gen(function* () {
      const options = yield* awaited(
        captureStreamOptions("openai-completions", { httpIdleTimeoutMs: 1234 }),
      );

      expect(options?.timeoutMs).toBe(1234);
    }),
  );

describe("createAgentSession stream options", () => {
  beforeEach(prepareDirs);

  afterEach(cleanupDirs);

  it(
    "schedules cache warming after a completed session request",
    schedulesCacheWarmingAfterACompletedSession,
  );

  it(
    "waits for the next request instead of restoring cache warming",
    waitsForTheNextRequestInsteadOf,
  );

  it(
    "forwards httpIdleTimeoutMs as timeoutMs for OpenAI Codex",
    forwardsHttpidletimeoutmsAsTimeoutmsForOpenaiCodex,
  );

  it(
    "defaults timeoutMs from httpIdleTimeoutMs for all providers",
    defaultsTimeoutmsFromHttpidletimeoutmsForAllProviders,
  );
});
