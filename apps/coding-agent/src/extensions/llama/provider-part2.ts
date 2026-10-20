import ai from "@msa/ai";
import llamaCppClassifyLazy from "@msa/ai/api/llama-cpp-classify.lazy";
import typesafeSystemOneLazy from "@msa/ai/api/typesafe-system-one.lazy";
import compatModule from "@msa/ai/compat";
import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import platform from "../../core/platform.ts";
import clientModule from "./client.ts";
import type clientTypes from "./client.types.ts";
import LlamaClient from "./llama-client.ts";
import type providerInternalTypes from "./provider-internal.types.ts";
import providerPart1 from "./provider-part1.ts";
import type providerTypes from "./provider.types.ts";

const { llamaCppClassifyApi } = llamaCppClassifyLazy;
const { typesafeSystemOneApi } = typesafeSystemOneLazy;
const { awaited, awaiting } = awaitingModule;
const { nowMs, readEnv } = platform;
const { llamaInferenceUrl, normalizeLlamaServerUrl } = clientModule;
const { isModelType } = ai;
const { stream, streamSimple } = compatModule;
const {
  DEFAULT_LLAMA_SERVER_URL,
  LLAMA_PROVIDER_ID,
  credentialServerUrl,
  isChatModel,
  isLlamaClassifierModel,
  modelIsSelectable,
  resolveServerUrl,
  routerAutoloadEnabled,
  toMsaClassifierModel,
  toMsaModel,
} = providerPart1;

function createLlamaProvider(): providerTypes.LlamaProviderController {
  let models: readonly aiTypes.Model<"openai-completions">[] = [];
  let classifiers: readonly aiTypes.ClassifierModel<providerInternalTypes.LlamaClassifierApi>[] =
    [];
  const fallbackClassifier = llamaCppClassifyApi();
  const decisionClassifier = typesafeSystemOneApi();

  const setCatalog = createLlamaProviderPart1();

  const provider: aiTypes.Provider<"openai-completions"> = {
    auth: {
      apiKey: {
        check: ({ ctx, credential }) =>
          Effect.runPromise(
            awaiting(function* () {
              const serverUrl = yield* awaited(resolveServerUrl(ctx, credential));
              return serverUrl !== undefined && serverUrl !== ""
                ? {
                    source: credential === undefined ? "LLAMA_BASE_URL" : "stored credential",
                    type: "api_key",
                  }
                : undefined;
            }),
          ),
        login: (interaction): Promise<aiTypes.ApiKeyCredential> =>
          Effect.runPromise(
            awaiting(function* () {
              const enteredUrl = yield* awaited(
                interaction.prompt({
                  message: "llama.cpp server URL",
                  placeholder: readEnv("LLAMA_BASE_URL") ?? DEFAULT_LLAMA_SERVER_URL,
                  type: "text",
                }),
              );
              const serverUrl = normalizeLlamaServerUrl(
                enteredUrl.trim() || readEnv("LLAMA_BASE_URL") || DEFAULT_LLAMA_SERVER_URL,
              );
              const apiKey = (yield* awaited(
                interaction.prompt({
                  message: "API key (optional)",
                  type: "secret",
                }),
              )).trim();
              yield* awaited(
                new LlamaClient(serverUrl, apiKey || undefined).list({
                  signal: interaction.signal,
                }),
              );
              return {
                env: { LLAMA_BASE_URL: serverUrl },
                key: apiKey || undefined,
                type: "api_key",
              };
            }),
          ),
        name: "llama.cpp server",
        resolve: ({ ctx, credential }): Promise<aiTypes.AuthResult | undefined> =>
          Effect.runPromise(
            awaiting(function* () {
              const serverUrl = yield* awaited(resolveServerUrl(ctx, credential));
              if (serverUrl === undefined || serverUrl === "") return undefined;
              const apiKey =
                credential?.key ?? (yield* awaited(ctx.env("LLAMA_API_KEY"))) ?? "local";
              return {
                auth: { apiKey, baseUrl: llamaInferenceUrl(serverUrl) },
                env: { ...credential?.env, LLAMA_BASE_URL: serverUrl },
                source: credential === undefined ? "LLAMA_BASE_URL" : "stored credential",
              };
            }),
          ),
      },
    },
    baseUrl: llamaInferenceUrl(DEFAULT_LLAMA_SERVER_URL),
    classify: (model, context, options) =>
      (model.api === "typesafe-system-one" ? decisionClassifier : fallbackClassifier).classify(
        model,
        context,
        options,
      ),
    getAllModels: () => [...models, ...classifiers],
    getModels: () => models,
    id: LLAMA_PROVIDER_ID,
    name: "llama.cpp",
    refreshModels: (context: aiTypes.RefreshModelsContext): Promise<void> =>
      Effect.runPromise(
        awaiting(function* () {
          const cachedContextWindows = new Map<string, number>();
          if (context.stored !== undefined) {
            const stored = context.stored.models.filter(
              (model) => model.provider === LLAMA_PROVIDER_ID,
            );
            const restored = stored.filter(
              (model): model is aiTypes.Model<"openai-completions"> =>
                isModelType(model, "chat") && model.api === "openai-completions",
            );
            const restoredClassifiers = stored.filter(isLlamaClassifierModel);
            for (const model of [...restored, ...restoredClassifiers]) {
              cachedContextWindows.set(model.id, model.contextWindow);
            }
            if (
              !(yield* awaited(
                context.publish({
                  update: () => {
                    models = restored;
                    classifiers = restoredClassifiers;
                  },
                }),
              ))
            ) {
              return;
            }
          }

          if (
            !context.allowNetwork ||
            context.signal.aborted ||
            context.credential?.type !== "api_key"
          )
            return;
          const serverUrl = credentialServerUrl(context.credential);
          if (serverUrl === undefined || serverUrl === "") return;
          const client = new LlamaClient(serverUrl, context.credential.key);
          const catalog = yield* awaited(client.list({ signal: context.signal }));
          if (context.signal.aborted) return;
          const routerAutoload = yield* awaited(
            routerAutoloadEnabled(client, catalog, context.signal),
          );
          if (context.signal.aborted) return;
          const selectable = catalog.filter((model) => modelIsSelectable(model, routerAutoload));

          const refreshed = yield* awaited(
            Promise.all(
              selectable.filter(isChatModel).map((model) =>
                Effect.runPromise(
                  awaiting(function* () {
                    const cachedContextWindow = cachedContextWindows.get(model.id);
                    if (model.status.value !== "loaded")
                      return toMsaModel(model, serverUrl, undefined, cachedContextWindow);
                    const props = yield* awaited(
                      client.props({ model: model.id, signal: context.signal }),
                    );
                    return toMsaModel(model, serverUrl, props, cachedContextWindow);
                  }),
                ),
              ),
            ),
          );
          const refreshedClassifiers = selectable.map((model) =>
            toMsaClassifierModel(model, serverUrl, cachedContextWindows.get(model.id)),
          );
          if (context.signal.aborted) return;
          yield* awaited(
            context.publish({
              persist: { checkedAt: nowMs(), models: [...refreshed, ...refreshedClassifiers] },
              update: () => {
                models = refreshed;
                classifiers = refreshedClassifiers;
              },
            }),
          );
        }),
      ),
    stream: (model, context, options) =>
      stream(model, context, options as aiTypes.ProviderStreamOptions | undefined),
    streamSimple: (model, context, options) => streamSimple(model, context, options),
  };

  return { provider, setCatalog };

  function createLlamaProviderPart1() {
    return createLlamaProviderPart2();
  }

  function createLlamaProviderPart2() {
    return createLlamaProviderPart3();
  }

  function createLlamaProviderPart3() {
    return createLlamaProviderPart4();
  }

  function createLlamaProviderPart4() {
    return createLlamaProviderPart5();
  }

  function createLlamaProviderPart5() {
    return createLlamaProviderPart6();
  }

  function createLlamaProviderPart6() {
    return createLlamaProviderPart7();
  }

  function createLlamaProviderPart7() {
    return (
      catalog: readonly clientTypes.LlamaModelInfo[],
      serverUrl: string,
      options: { routerAutoload?: boolean } = {},
    ): void => {
      const selectable = catalog.filter((model) =>
        modelIsSelectable(model, options.routerAutoload === true),
      );
      models = selectable.filter(isChatModel).map((model) => toMsaModel(model, serverUrl));
      classifiers = selectable.map((model) => toMsaClassifierModel(model, serverUrl));
    };
  }
}

const providerPart2 = {
  createLlamaProvider,
};

export default providerPart2;
