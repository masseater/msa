import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import type { SessionEntry } from "./session-manager.ts";

const { isModelType, lazyStream } = ai;

export const VIRTUAL_MODEL_API = "msa-virtual";

export const VIRTUAL_MODEL_STATE_ENTRY = "msa.virtual-model-state";

export interface VirtualModelStateData<TState = unknown> {
  provider: string;
  modelId: string;
  state: TState;
}

const THINKING_LEVELS: readonly aiTypes.ModelThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export type ModelRouteReason = "user" | "continuation" | "retry" | "direct";

export interface ModelRouteRequest<TState = unknown> {
  model: aiTypes.Model<aiTypes.Api>;
  thinkingLevel: aiTypes.ModelThinkingLevel;
  reason: ModelRouteReason;
  previous?:
    | { model: aiTypes.Model<aiTypes.Api>; thinkingLevel?: aiTypes.ModelThinkingLevel | undefined }
    | undefined;
  failed?:
    | {
        model: aiTypes.Model<aiTypes.Api>;
        thinkingLevel?: aiTypes.ModelThinkingLevel | undefined;
        message: aiTypes.AssistantMessage;
      }
    | undefined;
  state?: TState;
  messages: readonly aiTypes.Message[];
  signal?: AbortSignal | undefined;
}

export interface ModelRoute<TState = unknown> {
  model: aiTypes.Model<aiTypes.Api>;
  thinkingLevel: aiTypes.ModelThinkingLevel;
  state?: TState;
}

export interface VirtualModelDefinition<TState = unknown> {
  provider: string;
  id: string;
  name: string;
  thinkingLevels?: readonly aiTypes.ModelThinkingLevel[];
  contextWindow?: number;
  maxTokens?: number;
  input?: ("text" | "image")[];
  route(request: ModelRouteRequest<TState>): ModelRoute<TState> | Promise<ModelRoute<TState>>;
}

export function isVirtualModel(model: { api: string }): boolean {
  return model.api === VIRTUAL_MODEL_API;
}

export function findLatestResponse(
  messages: readonly agentTypes.AgentMessage[],
): aiTypes.AssistantMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (
      message?.role === "assistant" &&
      message.stopReason !== "error" &&
      message.stopReason !== "aborted"
    ) {
      return message;
    }
  }
  return undefined;
}

export function getBranchSelection(
  branch: readonly SessionEntry[],
  getModel: (provider: string, modelId: string) => aiTypes.Model<aiTypes.Api> | undefined,
): { provider: string; modelId: string } | undefined {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry === undefined) continue;
    if (entry.type === "model_change") {
      return { modelId: entry.modelId, provider: entry.provider };
    }
    if (
      entry.type === "message" &&
      entry.message.role === "assistant" &&
      !isVirtualModel(entry.message)
    ) {
      const response = { modelId: entry.message.model, provider: entry.message.provider };
      const change = findLastModelChange(branch, i);
      const model = change && getModel(change.provider, change.modelId);
      return change !== undefined && model !== undefined && isVirtualModel(model)
        ? change
        : response;
    }
  }
  return undefined;
}

function findLastModelChange(
  branch: readonly SessionEntry[],
  before: number,
): { provider: string; modelId: string } | undefined {
  for (let i = before - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry?.type === "model_change") return { modelId: entry.modelId, provider: entry.provider };
  }
  return undefined;
}

export function getVirtualModelState(
  branch: readonly SessionEntry[],
  provider: string,
  modelId: string,
): unknown {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry?.type !== "custom" || entry.customType !== VIRTUAL_MODEL_STATE_ENTRY) continue;
    const data = entry.data as VirtualModelStateData | undefined;
    if (data?.provider === provider && data.modelId === modelId) return data.state;
  }
  return undefined;
}

export function createVirtualModel(
  definition: Omit<VirtualModelDefinition, "route">,
): aiTypes.Model<aiTypes.Api> {
  const levels = definition.thinkingLevels ?? ["off"];
  const thinkingLevelMap: aiTypes.ThinkingLevelMap = {};
  for (const level of THINKING_LEVELS)
    thinkingLevelMap[level] = levels.includes(level) ? level : null;
  return {
    api: VIRTUAL_MODEL_API,
    baseUrl: "",
    contextWindow: definition.contextWindow ?? 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: definition.id,
    input: definition.input ?? ["text", "image"],
    maxTokens: definition.maxTokens ?? 0,
    name: definition.name,
    provider: definition.provider,
    reasoning: levels.some((level) => level !== "off"),
    thinkingLevelMap,
  };
}

function unroutedStream(model: aiTypes.Model<aiTypes.Api>): aiTypes.AssistantMessageEventStream {
  return lazyStream(model, () =>
    Effect.runPromise(
      Effect.sync(() => {
        throw new Error(
          `Virtual model ${model.provider}/${model.id} must be routed before streaming`,
        );
      }),
    ),
  );
}

export function withVirtualModels(
  providerId: string,
  provider: aiTypes.Provider | undefined,
  virtualModels: readonly aiTypes.Model<aiTypes.Api>[],
): aiTypes.Provider {
  if (provider === undefined) {
    return {
      auth: {
        apiKey: {
          name: "Virtual model",
          resolve: () => Effect.runPromise(Effect.sync(() => ({ auth: {}, source: "virtual" }))),
        },
      },
      getModels: () => virtualModels,
      id: providerId,
      name: providerId,
      stream: unroutedStream,
      streamSimple: unroutedStream,
    };
  }
  const ids = new Set(virtualModels.map((model) => model.id));
  const physical = <TModel extends aiTypes.AnyModel>(models: readonly TModel[]) =>
    models.filter(
      (model) => !isVirtualModel(model) && !(isModelType(model, "chat") && ids.has(model.id)),
    );
  const virtual = <TModel extends aiTypes.AnyModel>(models: readonly TModel[]) =>
    models.filter((model) => isVirtualModel(model));
  const { filterModels, filterAllModels } = provider;
  return {
    ...provider,
    getModels: () => [...physical(provider.getModels()), ...virtualModels],
    getAllModels: () => [
      ...physical(provider.getAllModels?.() ?? provider.getModels()),
      ...virtualModels,
    ],
    filterModels: (models, credential) => {
      const real = physical(models);
      return [...(filterModels?.(real, credential) ?? real), ...virtual(models)];
    },
    ...(filterAllModels === undefined
      ? {}
      : {
          filterAllModels: (models, credential) => [
            ...filterAllModels(physical(models), credential),
            ...virtual(models),
          ],
        }),
    stream: (model, context, options) =>
      isVirtualModel(model) ? unroutedStream(model) : provider.stream(model, context, options),
    streamSimple: (model, context, options) =>
      isVirtualModel(model)
        ? unroutedStream(model)
        : provider.streamSimple(model, context, options),
  };
}
