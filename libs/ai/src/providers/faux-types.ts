import type { Provider } from "../models.ts";
import type {
  AssistantMessage,
  DeferredHandle,
  Model,
  SimpleStreamOptions,
  TranscriptContext,
} from "../types.ts";

export interface FauxModelDefinition {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: ("text" | "image")[];
  inputLimits?: Model<string>["inputLimits"];
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow?: number;
  maxTokens?: number;
}

export interface FauxProviderState {
  callCount: number;
  deferredFetchCount: number;
  cancelledDeferred: DeferredHandle[];
}

export type FauxResponseFactory = (
  context: TranscriptContext,
  options: SimpleStreamOptions | undefined,
  state: FauxProviderState,
  model: Model<string>,
) => AssistantMessage | Promise<AssistantMessage>;

export type FauxResponseStep = AssistantMessage | FauxResponseFactory;

export interface RegisterFauxProviderOptions {
  api?: string;
  provider?: string;
  models?: FauxModelDefinition[];
  deferred?: {
    pendingFetches?: number;
    pollAfterMs?: number;
  };
  tokensPerSecond?: number;
  tokenSize?: {
    min?: number;
    max?: number;
  };
}

export interface FauxProviderRegistration {
  api: string;
  models: [Model<string>, ...Model<string>[]];
  getModel(): Model<string>;
  getModel(modelId: string): Model<string> | undefined;
  state: FauxProviderState;
  setResponses: (responses: FauxResponseStep[]) => void;
  appendResponses: (responses: FauxResponseStep[]) => void;
  getPendingResponseCount: () => number;
  unregister: () => void;
}

export interface FauxProviderHandle {
  provider: Provider;
  api: string;
  models: [Model<string>, ...Model<string>[]];
  getModel(): Model<string>;
  getModel(modelId: string): Model<string> | undefined;
  state: FauxProviderState;
  setResponses: (responses: FauxResponseStep[]) => void;
  appendResponses: (responses: FauxResponseStep[]) => void;
  getPendingResponseCount: () => number;
}
