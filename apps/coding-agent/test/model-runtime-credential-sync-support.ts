import type { ApiKeyCredential, Model, Provider } from "@msa/ai";
import { awaited, runTest } from "@msa/testing";
import { Deferred, Effect } from "effect";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";

export function model(provider: string): Model<"openai-completions"> {
  return {
    id: "dynamic",
    name: "Dynamic",
    api: "openai-completions" as const,
    provider,
    baseUrl: "https://example.test/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  };
}

const makeProvider = (
  id: string,
  options: {
    login?: () => Promise<ApiKeyCredential>;
    refreshModels?: Provider["refreshModels"];
  } = {},
): Provider<"openai-completions"> => {
  const providerModel = model(id);
  return {
    id,
    name: id,
    auth: {
      apiKey: {
        name: "API key",
        login: () =>
          runTest(awaited(options.login?.() ?? { type: "api_key" as const, key: `${id}-key` })),
        check: ({ credential }) =>
          runTest(
            awaited(
              credential === undefined ? undefined : { type: "api_key" as const, source: "stored" },
            ),
          ),
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
  registered: Provider,
  credentials: AuthStorage = AuthStorage.inMemory(),
): Promise<ModelRuntime> =>
  runTest(
    Effect.gen(function* () {
      const runtime = yield* awaited(
        ModelRuntime.create({
          credentials,
          modelsPath: null,
          allowModelNetwork: false,
        }),
      );
      runtime.registerNativeProvider(registered);
      yield* awaited(runtime.refresh({ allowNetwork: false, providers: [registered.id] }));
      return yield* awaited(runtime);
    }),
  );

export const providers = { create: makeProvider };

export const runtimes = { withProvider };

export interface Gate {
  readonly promise: Effect.Effect<void>;
  open(): void;
}

export const makeGate = (): Gate => {
  const deferred = Deferred.makeUnsafe<void>();
  return {
    promise: Deferred.await(deferred),
    open: () => {
      Effect.runSync(Deferred.succeed(deferred, undefined));
    },
  };
};
