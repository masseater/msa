import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import ExtensionRunner from "../src/core/extensions/extension-runner.ts";
import loader from "../src/core/extensions/loader.ts";
import type extensionsTypesTypes from "../src/core/extensions/types.types.ts";
import extensionsRunnerEnv from "./extensions-runner-env.ts";
import extensionsRunnerSupport from "./extensions-runner-support.ts";

const { createExtensionRuntime } = loader;
const { cleanupRunnerEnv, env, prepareRunnerEnv } = extensionsRunnerEnv;

const { extensionActions, extensionContextActions } = extensionsRunnerSupport;

const { awaited, runTest } = testing;

const providerModelConfig: extensionsTypesTypes.ProviderConfig = {
  api: "openai-completions" as const,
  apiKey: "provider-test-key",
  baseUrl: "https://provider.test/v1",
  models: [
    {
      contextWindow: 128000,
      cost: {
        cacheRead: 0.1,
        cacheWrite: 1.25,
        input: 1,
        output: 2,
        tiers: [
          {
            cacheRead: 0.2,
            cacheWrite: 2.5,
            input: 2,
            inputTokensAbove: 272000,
            output: 3,
          },
        ],
      },
      id: "instant-model",
      input: ["text"],
      maxTokens: 4096,
      name: "Instant Model",
      reasoning: false,
    },
  ],
};

const bindcoreIgnoresInvalidQueuedRegistrationsAndReports = () =>
  runTest(
    Effect.gen(function* () {
      const runtime = createExtensionRuntime();
      runtime.registerProvider(
        "broken-provider",
        {
          streamSimple: (() => {
            throw new Error("should not run");
          }) as any,
        },
        "/tmp/broken-extension.ts",
      );

      const runner = new ExtensionRunner(
        [],
        runtime,
        env.tempDir,
        env.sessionManager,
        env.modelRegistry,
      );
      const errors: string[] = [];
      runner.onError((error) => errors.push(`${error.extensionPath}: ${error.error}`));

      expect(() => runner.bindCore(extensionActions, extensionContextActions)).not.toThrow();
      expect(errors).toEqual([
        '/tmp/broken-extension.ts: Provider broken-provider: "api" is required when registering streamSimple.',
      ]);
      yield* awaited(
        expect(env.modelRegistry.refresh()).resolves.toMatchObject({ aborted: false }),
      );
    }),
  );

const preBindUnregisterRemovesAllQueuedRegistrations = () => {
  const runtime = createExtensionRuntime();

  runtime.registerProvider("queued-provider", providerModelConfig);
  runtime.registerProvider("queued-provider", {
    ...providerModelConfig,
    models: [
      {
        contextWindow: 128000,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "instant-model-2",
        input: ["text"],
        maxTokens: 4096,
        name: "Instant Model 2",
        reasoning: false,
      },
    ],
  });
  expect(runtime.pendingProviderRegistrations).toHaveLength(2);

  runtime.unregisterProvider("queued-provider");
  expect(runtime.pendingProviderRegistrations).toHaveLength(0);
};

const postBindRegisterAndUnregisterTakeEffect = () => {
  const runtime = createExtensionRuntime();
  const runner = new ExtensionRunner(
    [],
    runtime,
    env.tempDir,
    env.sessionManager,
    env.modelRegistry,
  );

  runner.bindCore(extensionActions, extensionContextActions);
  expect(runtime.pendingProviderRegistrations).toHaveLength(0);

  runtime.registerProvider("instant-provider", providerModelConfig);
  expect(runtime.pendingProviderRegistrations).toHaveLength(0);
  expect(env.modelRegistry.find("instant-provider", "instant-model")?.cost.tiers).toEqual([
    {
      cacheRead: 0.2,
      cacheWrite: 2.5,
      input: 2,
      inputTokensAbove: 272000,
      output: 3,
    },
  ]);

  runtime.unregisterProvider("instant-provider");
  expect(env.modelRegistry.find("instant-provider", "instant-model")).toBeUndefined();
};

const passesForkOptionsThroughToTheBound = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const runtime = createExtensionRuntime();
      const runner = new ExtensionRunner(
        [],
        runtime,
        env.tempDir,
        env.sessionManager,
        env.modelRegistry,
      );
      const fork = vi.fn(() => effectRunPromise(awaited({ cancelled: false })));

      runner.bindCommandContext({
        fork,
        navigateTree: () => effectRunPromise(awaited({ cancelled: false })),
        newSession: () => effectRunPromise(awaited({ cancelled: false })),
        reload: () => effectRunPromise(Effect.sync(() => {})),
        switchSession: () => effectRunPromise(awaited({ cancelled: false })),
        waitForIdle: () => effectRunPromise(Effect.sync(() => {})),
      });

      const commandContext = runner.createCommandContext();
      yield* awaited(commandContext.fork("entry-1"));
      expect(fork).toHaveBeenCalledWith("entry-1", undefined);

      yield* awaited(commandContext.fork("entry-2", { position: "at" }));
      expect(fork).toHaveBeenLastCalledWith("entry-2", { position: "at" });
    }),
  );

describe("ExtensionRunner", () => {
  beforeEach(() => runTest(prepareRunnerEnv));

  afterEach(cleanupRunnerEnv);

  describe("provider registration", () => {
    it(
      "bindCore ignores invalid queued registrations and reports extension error",
      bindcoreIgnoresInvalidQueuedRegistrationsAndReports,
    );

    it(
      "pre-bind unregister removes all queued registrations for a provider",
      preBindUnregisterRemovesAllQueuedRegistrations,
    );

    it(
      "post-bind register and unregister take effect immediately",
      postBindRegisterAndUnregisterTakeEffect,
    );
  });

  describe("command context", () => {
    it("passes fork options through to the bound handler", passesForkOptionsThroughToTheBound);
  });
});
