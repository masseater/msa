import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";

const { createProvider } = ai;

const { abortController, awaited, runTest } = testing;

const neverAbortedSignal: AbortSignal = abortController().signal;

function model(id: string): aiTypes.Model<"openai-completions"> {
  return {
    api: "openai-completions" as const,
    baseUrl: "https://example.test/v1",
    contextWindow: 1000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id,
    input: ["text"],
    maxTokens: 100,
    name: id,
    provider: "test-provider",
    reasoning: false,
  };
}

function builtinProvider(): aiTypes.Provider {
  return createProvider({
    api: {
      stream: () => {
        throw new Error("not used");
      },
      streamSimple: () => {
        throw new Error("not used");
      },
    },
    auth: { apiKey: { name: "Test", resolve: () => runTest(awaited({ auth: {} })) } },
    id: "test-provider",
    models: [model("static")],
  });
}

function refreshProvider(
  provider: aiTypes.Provider,
  store: aiTypes.InMemoryModelsStore,
  overrides: Partial<Pick<aiTypes.RefreshModelsContext, "allowNetwork" | "force" | "signal">> = {},
): Promise<void> {
  return runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const publish = (publication: aiTypes.ModelsPublication): Promise<boolean> =>
        effectRunPromise(
          Effect.gen(function* () {
            if (publication.persist === null) yield* awaited(store.delete(provider.id));
            else if (publication.persist !== undefined)
              yield* awaited(store.write(provider.id, publication.persist));
            publication.update?.();
            return yield* awaited(true);
          }),
        );
      yield* awaited(
        provider.refreshModels?.({
          allowNetwork: overrides.allowNetwork ?? true,
          credential: { type: "api_key" as const },
          force: overrides.force,
          publish,
          signal: overrides.signal ?? neverAbortedSignal,
          stored: yield* awaited(store.read(provider.id)),
        }),
      );
    }),
  );
}

const remoteCatalogProviderSupport = {
  builtinProvider,
  model,
  neverAbortedSignal,
  refreshProvider,
};

export default remoteCatalogProviderSupport;
