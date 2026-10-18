import type { AgentMessage } from "@msa/agent-core";
import {
  type AnyModel,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  isModelType,
  lazyStream,
  type Message,
  type Model,
  type ModelThinkingLevel,
  type Provider,
  type ThinkingLevelMap,
} from "@msa/ai";
import * as Effect from "effect/Effect";

import type { SessionEntry } from "./session-manager.ts";

export const VIRTUAL_MODEL_API = "msa-virtual";

export const VIRTUAL_MODEL_STATE_ENTRY = "msa.virtual-model-state";

export interface VirtualModelStateData<TState = unknown> {
  provider: string;
  modelId: string;
  state: TState;
}

const THINKING_LEVELS: readonly ModelThinkingLevel[] = [
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
  model: Model<Api>;
  thinkingLevel: ModelThinkingLevel;
  reason: ModelRouteReason;
  previous?: { model: Model<Api>; thinkingLevel?: ModelThinkingLevel | undefined } | undefined;
  failed?:
    | {
        model: Model<Api>;
        thinkingLevel?: ModelThinkingLevel | undefined;
        message: AssistantMessage;
      }
    | undefined;
  state?: TState;
  messages: readonly Message[];
  signal?: AbortSignal | undefined;
}

export interface ModelRoute<TState = unknown> {
  model: Model<Api>;
  thinkingLevel: ModelThinkingLevel;
  state?: TState;
}

export interface VirtualModelDefinition<TState = unknown> {
  provider: string;
  id: string;
  name: string;
  thinkingLevels?: readonly ModelThinkingLevel[];
  contextWindow?: number;
  maxTokens?: number;
  input?: ("text" | "image")[];
  route(request: ModelRouteRequest<TState>): ModelRoute<TState> | Promise<ModelRoute<TState>>;
}

export function isVirtualModel(model: { api: string }): boolean {
  return model.api === VIRTUAL_MODEL_API;
}

export function findLatestResponse(
  messages: readonly AgentMessage[],
): AssistantMessage | undefined {
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
  getModel: (provider: string, modelId: string) => Model<Api> | undefined,
): { provider: string; modelId: string } | undefined {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry === undefined) continue;
    if (entry.type === "model_change") {
      return { provider: entry.provider, modelId: entry.modelId };
    }
    if (
      entry.type === "message" &&
      entry.message.role === "assistant" &&
      !isVirtualModel(entry.message)
    ) {
      const response = { provider: entry.message.provider, modelId: entry.message.model };
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
    if (entry?.type === "model_change") return { provider: entry.provider, modelId: entry.modelId };
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

export function createVirtualModel(definition: Omit<VirtualModelDefinition, "route">): Model<Api> {
  const levels = definition.thinkingLevels ?? ["off"];
  const thinkingLevelMap: ThinkingLevelMap = {};
  for (const level of THINKING_LEVELS)
    thinkingLevelMap[level] = levels.includes(level) ? level : null;
  return {
    id: definition.id,
    name: definition.name,
    api: VIRTUAL_MODEL_API,
    provider: definition.provider,
    baseUrl: "",
    reasoning: levels.some((level) => level !== "off"),
    thinkingLevelMap,
    input: definition.input ?? ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: definition.contextWindow ?? 0,
    maxTokens: definition.maxTokens ?? 0,
  };
}

function unroutedStream(model: Model<Api>): AssistantMessageEventStream {
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
  provider: Provider | undefined,
  virtualModels: readonly Model<Api>[],
): Provider {
  if (provider === undefined) {
    return {
      id: providerId,
      name: providerId,
      auth: {
        apiKey: {
          name: "Virtual model",
          resolve: () => Effect.runPromise(Effect.sync(() => ({ auth: {}, source: "virtual" }))),
        },
      },
      getModels: () => virtualModels,
      stream: unroutedStream,
      streamSimple: unroutedStream,
    };
  }
  const ids = new Set(virtualModels.map((model) => model.id));
  const physical = <TModel extends AnyModel>(models: readonly TModel[]) =>
    models.filter(
      (model) => !isVirtualModel(model) && !(isModelType(model, "chat") && ids.has(model.id)),
    );
  const virtual = <TModel extends AnyModel>(models: readonly TModel[]) =>
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
