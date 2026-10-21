import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import clientModule from "./client.ts";
import type clientTypes from "./client.types.ts";
import type providerInternalTypes from "./provider-internal.types.ts";

const { llamaInferenceUrl, normalizeLlamaServerUrl } = clientModule;
const { awaited, awaiting } = awaitingModule;
const { isModelType } = ai;

const LLAMA_PROVIDER_ID = "llama.cpp";

const DEFAULT_LLAMA_SERVER_URL = "http://127.0.0.1:8080";

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

function modelIsSelectable(model: clientTypes.LlamaModelInfo, routerAutoload: boolean): boolean {
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
  client: clientTypes.LlamaClient,
  catalog: readonly clientTypes.LlamaModelInfo[],
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

function configuredContextWindow(model: clientTypes.LlamaModelInfo): number | undefined {
  const args = model.status.args ?? [];
  for (let index = 0; index < args.length - 1; index++) {
    const flag = args[index];
    if (flag !== "--ctx-size" && flag !== "-c" && flag !== "-ctx") continue;
    const contextWindow = Number(args[index + 1]);
    if (Number.isSafeInteger(contextWindow) && contextWindow > 0) return contextWindow;
  }
  return undefined;
}

function contextWindowOf(model: clientTypes.LlamaModelInfo, cachedContextWindow?: number): number {
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

function isDecisionModel(model: clientTypes.LlamaModelInfo): boolean {
  return model.architecture?.output_modalities?.includes("decisions") === true;
}

function isChatModel(model: clientTypes.LlamaModelInfo): boolean {
  return (
    !isDecisionModel(model) || model.architecture?.output_modalities?.includes("text") === true
  );
}

function toMsaClassifierModel(
  model: clientTypes.LlamaModelInfo,
  serverUrl: string,
  cachedContextWindow?: number,
): aiTypes.ClassifierModel<providerInternalTypes.LlamaClassifierApi> {
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
): model is aiTypes.ClassifierModel<providerInternalTypes.LlamaClassifierApi> {
  return (
    isModelType(model, "classifier") &&
    (model.api === "llama-cpp-classify" || model.api === "typesafe-system-one")
  );
}

function toMsaModel(
  model: clientTypes.LlamaModelInfo,
  serverUrl: string,
  props?: clientTypes.LlamaServerProps,
  cachedContextWindow?: number,
): aiTypes.Model<"openai-completions"> {
  const contextWindow = contextWindowOf(model, cachedContextWindow);
  const reasoning = props?.chat_template?.includes("enable_thinking") === true;
  return {
    api: "openai-completions",
    baseUrl: llamaInferenceUrl(serverUrl),
    id: model.id,
    name: model.id,
    provider: LLAMA_PROVIDER_ID,
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
    compat: {
      maxTokensField: "max_tokens",
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStore: false,
      supportsStrictMode: false,
      supportsUsageInStreaming: true,
      ...(reasoning && { thinkingFormat: "qwen-chat-template" }),
    },
    contextWindow,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    input:
      model.architecture?.input_modalities?.includes("image") === true
        ? ["text", "image"]
        : ["text"],
    maxTokens: contextWindow,
  };
}

const llamaModels = {
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
};

export default llamaModels;
