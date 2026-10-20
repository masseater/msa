import ai from "@msa/ai";
import llamaCppClassifyLazy from "@msa/ai/api/llama-cpp-classify.lazy";
import typesafeSystemOneLazy from "@msa/ai/api/typesafe-system-one.lazy";
import compatModule from "@msa/ai/compat";
import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import { awaited, awaiting } from "../../core/awaiting.ts";
import { nowMs, readEnv } from "../../core/platform.ts";
import {
  LlamaClient,
  type LlamaModelInfo,
  type LlamaServerProps,
  llamaInferenceUrl,
  normalizeLlamaServerUrl,
} from "./client.ts";

const { isModelType } = ai;
const { llamaCppClassifyApi } = llamaCppClassifyLazy;
const { typesafeSystemOneApi } = typesafeSystemOneLazy;
const { stream, streamSimple } = compatModule;

export const LLAMA_PROVIDER_ID = "llama.cpp";
export const DEFAULT_LLAMA_SERVER_URL = "http://127.0.0.1:8080";
function credentialServerUrl(credential: aiTypes.ApiKeyCredential | undefined): string | undefined {
  const value = credential?.env?.["LLAMA_BASE_URL"];
  return typeof value === "string" && value.trim() !== ""
    ? normalizeLlamaServerUrl(value)
    : undefined;
}

function resolveServerUrl(
  ctx: aiTypes.AuthContext,
  credential: aiTypes.ApiKeyCredential | undefined,
): Promise<string | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      const configured =
        credentialServerUrl(credential) ?? (yield* awaited(ctx.env("LLAMA_BASE_URL")))?.trim();
      return configured !== undefined && configured !== ""
        ? normalizeLlamaServerUrl(configured)
        : undefined;
    }),
  );
}

function modelIsSelectable(model: LlamaModelInfo, routerAutoload: boolean): boolean {
  if (model.status.value === "loaded") return true;

  if (model.status.value === "sleeping") return true;

  return (
    routerAutoload &&
    model.status.value === "unloaded" &&
    model.status.failed !== true &&
    model.source === "preset"
  );
}

function routerAutoloadEnabled(
  client: LlamaClient,
  catalog: readonly LlamaModelInfo[],
  signal: AbortSignal,
): Promise<boolean> {
  return Effect.runPromise(
    awaiting(function* () {
      if (!catalog.some((model) => model.status.value === "unloaded" && model.source === "preset"))
        return false;
      try {
        return (yield* awaited(client.props({ signal }))).models_autoload === true;
      } catch {
        return false;
      }
    }),
  );
}

function configuredContextWindow(model: LlamaModelInfo): number | undefined {
  const args = model.status.args ?? [];
  for (let index = 0; index < args.length - 1; index++) {
    const flag = args[index];
    if (flag !== "--ctx-size" && flag !== "-c" && flag !== "-ctx") continue;
    const contextWindow = Number(args[index + 1]);
    if (Number.isSafeInteger(contextWindow) && contextWindow > 0) return contextWindow;
  }
  return undefined;
}

function contextWindowOf(model: LlamaModelInfo, cachedContextWindow?: number): number {
  const runtimeContextWindow = model.meta?.n_ctx;
  if (runtimeContextWindow !== undefined && runtimeContextWindow !== 0 && runtimeContextWindow > 0)
    return runtimeContextWindow;
  const configuredContext = configuredContextWindow(model);
  if (configuredContext !== undefined && configuredContext !== 0) return configuredContext;
  if (cachedContextWindow !== undefined && cachedContextWindow !== 0 && cachedContextWindow > 0)
    return cachedContextWindow;
  const trainingContextWindow = model.meta?.n_ctx_train;
  return trainingContextWindow !== undefined &&
    trainingContextWindow !== 0 &&
    trainingContextWindow > 0
    ? trainingContextWindow
    : 128000;
}

type LlamaClassifierApi = "llama-cpp-classify" | "typesafe-system-one";

function isDecisionModel(model: LlamaModelInfo): boolean {
  return model.architecture?.output_modalities?.includes("decisions") === true;
}

function isChatModel(model: LlamaModelInfo): boolean {
  return (
    !isDecisionModel(model) || model.architecture?.output_modalities?.includes("text") === true
  );
}

function toMsaClassifierModel(
  model: LlamaModelInfo,
  serverUrl: string,
  cachedContextWindow?: number,
): aiTypes.ClassifierModel<LlamaClassifierApi> {
  const decision = isDecisionModel(model);
  return {
    api: decision ? "typesafe-system-one" : "llama-cpp-classify",
    baseUrl: decision ? llamaInferenceUrl(serverUrl) : serverUrl,
    contextWindow: contextWindowOf(model, cachedContextWindow),
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: model.id,
    input: ["text"],
    name: model.id,
    provider: LLAMA_PROVIDER_ID,
    type: "classifier",
  };
}

function isLlamaClassifierModel(
  model: aiTypes.AnyModel,
): model is aiTypes.ClassifierModel<LlamaClassifierApi> {
  return (
    isModelType(model, "classifier") &&
    (model.api === "llama-cpp-classify" || model.api === "typesafe-system-one")
  );
}

function toMsaModel(
  model: LlamaModelInfo,
  serverUrl: string,
  props?: LlamaServerProps,
  cachedContextWindow?: number,
): aiTypes.Model<"openai-completions"> {
  const contextWindow = contextWindowOf(model, cachedContextWindow);
  const reasoning = props?.chat_template?.includes("enable_thinking") === true;
  return {
    id: model.id,
    name: model.id,
    api: "openai-completions",
    provider: LLAMA_PROVIDER_ID,
    baseUrl: llamaInferenceUrl(serverUrl),
    reasoning,
    ...(reasoning && {
      thinkingLevelMap: {
        high: null,
        low: null,
        medium: "medium",
        minimal: null,
        off: "off",
        xhigh: null,
      },
    }),
    input:
      model.architecture?.input_modalities?.includes("image") === true
        ? ["text", "image"]
        : ["text"],
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    contextWindow,
    maxTokens: contextWindow,
    compat: {
      maxTokensField: "max_tokens",
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStore: false,
      supportsStrictMode: false,
      supportsUsageInStreaming: true,
      ...(reasoning && { thinkingFormat: "qwen-chat-template" }),
    },
  };
}

export interface LlamaProviderController {
  provider: aiTypes.Provider<"openai-completions">;
  setCatalog(
    models: readonly LlamaModelInfo[],
    serverUrl: string,
    options?: { routerAutoload?: boolean },
  ): void;
}

export function createLlamaProvider(): LlamaProviderController {
  let models: readonly aiTypes.Model<"openai-completions">[] = [];
  let classifiers: readonly aiTypes.ClassifierModel<LlamaClassifierApi>[] = [];
  const fallbackClassifier = llamaCppClassifyApi();
  const decisionClassifier = typesafeSystemOneApi();

  const setCatalog = (
    catalog: readonly LlamaModelInfo[],
    serverUrl: string,
    options: { routerAutoload?: boolean } = {},
  ): void => {
    const selectable = catalog.filter((model) =>
      modelIsSelectable(model, options.routerAutoload === true),
    );
    models = selectable.filter(isChatModel).map((model) => toMsaModel(model, serverUrl));
    classifiers = selectable.map((model) => toMsaClassifierModel(model, serverUrl));
  };

  const provider: aiTypes.Provider<"openai-completions"> = {
    auth: {
      apiKey: {
        check: ({ ctx, credential }) =>
          Effect.runPromise(
            awaiting(function* () {
              const serverUrl = yield* awaited(resolveServerUrl(ctx, credential));
              return serverUrl !== undefined && serverUrl !== ""
                ? {
                    type: "api_key",
                    source: credential === undefined ? "LLAMA_BASE_URL" : "stored credential",
                  }
                : undefined;
            }),
          ),
        login: (interaction): Promise<aiTypes.ApiKeyCredential> =>
          Effect.runPromise(
            awaiting(function* () {
              const enteredUrl = yield* awaited(
                interaction.prompt({
                  type: "text",
                  message: "llama.cpp server URL",
                  placeholder: readEnv("LLAMA_BASE_URL") ?? DEFAULT_LLAMA_SERVER_URL,
                }),
              );
              const serverUrl = normalizeLlamaServerUrl(
                enteredUrl.trim() || readEnv("LLAMA_BASE_URL") || DEFAULT_LLAMA_SERVER_URL,
              );
              const apiKey = (yield* awaited(
                interaction.prompt({
                  type: "secret",
                  message: "API key (optional)",
                }),
              )).trim();
              yield* awaited(
                new LlamaClient(serverUrl, apiKey || undefined).list({
                  signal: interaction.signal,
                }),
              );
              return {
                type: "api_key",
                key: apiKey || undefined,
                env: { LLAMA_BASE_URL: serverUrl },
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
              persist: { models: [...refreshed, ...refreshedClassifiers], checkedAt: nowMs() },
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
}
