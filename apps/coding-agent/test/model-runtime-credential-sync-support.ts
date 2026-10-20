import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Deferred, Effect } from "effect";

import AuthStorage from "../src/core/auth-storage.ts";
import type authStorageTypes from "../src/core/auth-storage.types.ts";
import ModelRuntime from "../src/core/model-runtime.ts";
import type modelRuntimeTypes from "../src/core/model-runtime.types.ts";
import type modelRuntimeCredentialSyncSupportTypes from "./model-runtime-credential-sync-support.types.ts";
const { awaited, runTest } = testing;

function model(provider: string): aiTypes.Model<"openai-completions"> {
  return {
    api: "openai-completions" as const,
    baseUrl: "https://example.test/v1",
    contextWindow: 1000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "dynamic",
    input: ["text"],
    maxTokens: 100,
    name: "Dynamic",
    provider,
    reasoning: false,
  };
}

const makeProvider = (
  id: string,
  options: {
    login?: () => Promise<aiTypes.ApiKeyCredential>;
    refreshModels?: aiTypes.Provider["refreshModels"];
  } = {},
): aiTypes.Provider<"openai-completions"> => {
  const providerModel = model(id);
  return {
    auth: {
      apiKey: {
        check: ({ credential }) =>
          runTest(
            awaited(
              credential === undefined ? undefined : { source: "stored", type: "api_key" as const },
            ),
          ),
        login: () =>
          runTest(awaited(options.login?.() ?? { key: `${id}-key`, type: "api_key" as const })),
        name: "API key",
        resolve: ({ credential }) =>
          runTest(
            awaited(
              credential === undefined
                ? undefined
                : { auth: { apiKey: credential.key }, source: "stored" },
            ),
          ),
      },
    },
    getModels: () => [providerModel],
    id,
    name: id,
    ...(options.refreshModels === undefined ? {} : { refreshModels: options.refreshModels }),
    stream: () => {
      throw new Error("unused");
    },
    streamSimple: () => {
      throw new Error("unused");
    },
  };
};

const withProvider = (
  registered: aiTypes.Provider,
  credentials: authStorageTypes.AuthStorage = AuthStorage.inMemory(),
): Promise<modelRuntimeTypes.ModelRuntime> =>
  runTest(
    Effect.gen(function* () {
      const runtime = yield* awaited(
        ModelRuntime.create({
          allowModelNetwork: false,
          credentials,
          modelsPath: null,
        }),
      );
      runtime.registerNativeProvider(registered);
      yield* awaited(runtime.refresh({ allowNetwork: false, providers: [registered.id] }));
      return yield* awaited(runtime);
    }),
  );

const providers = { create: makeProvider };

const runtimes = { withProvider };

const makeGate = (): modelRuntimeCredentialSyncSupportTypes.Gate => {
  const deferred = Deferred.makeUnsafe<void>();
  return {
    open: () => {
      Effect.runSync(Deferred.succeed(deferred, undefined));
    },
    promise: Deferred.await(deferred),
  };
};

const modelRuntimeCredentialSyncSupport = {
  makeGate,
  model,
  providers,
  runtimes,
};

export default modelRuntimeCredentialSyncSupport;
