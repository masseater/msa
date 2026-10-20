import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type cacheWarmerTypes from "../src/core/cache-warmer.types.ts";
import ExtensionRunner from "../src/core/extensions/extension-runner.ts";
import type extensionsTypesTypes from "../src/core/extensions/types.types.ts";
import extensionsRunnerEnv from "./extensions-runner-env.ts";
import utilities from "./utilities.ts";
const { cleanupRunnerEnv, env, prepareRunnerEnv } = extensionsRunnerEnv;

const { createTestExtensionsResult } = utilities;

const { awaited, runTest } = testing;

afterEach(() => {
  vi.useRealTimers();
  return env.tempDir === "" ? undefined : cleanupRunnerEnv();
});

const usesTheLastExtensionOverride = () =>
  runTest(
    Effect.gen(function* () {
      const factories: extensionsTypesTypes.ExtensionFactory[] = [
        (msa) => {
          msa.on("cache_warming_decision", () => ({ action: "warm" }));
        },
        (msa) => {
          msa.on("cache_warming_decision", () => ({ action: "stop" }));
        },
      ];
      const loaded = yield* awaited(createTestExtensionsResult(factories));
      yield* prepareRunnerEnv;
      const runner = new ExtensionRunner(
        loaded.extensions,
        loaded.runtime,
        process.cwd(),
        env.sessionManager,
        env.modelRegistry,
      );
      const event: cacheWarmerTypes.CacheWarmingDecisionEvent = {
        action: "warm",
        continuationProbability: 0.15,
        missCost: 0.5,
        type: "cache_warming_decision" as const,
        warmCost: 0.05,
      };

      expect(yield* awaited(runner.emitCacheWarmingDecision(event))).toBe("stop");
    }),
  );

describe("ExtensionRunner.emitCacheWarmingDecision", () => {
  it("uses the last extension override", usesTheLastExtensionOverride);
});
