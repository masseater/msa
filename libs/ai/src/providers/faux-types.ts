import type modelsTypes from "../models.types.ts";
import type typesModule from "../types.types.ts";

declare namespace fauxTypesModule {
  interface FauxModelDefinition {
    id: string;
    name?: string;
    reasoning?: boolean;
    input?: ("text" | "image")[];
    inputLimits?: typesModule.Model<string>["inputLimits"];
    cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
    contextWindow?: number;
    maxTokens?: number;
  }

  interface FauxProviderState {
    callCount: number;
    deferredFetchCount: number;
    cancelledDeferred: typesModule.DeferredHandle[];
  }

  type FauxResponseFactory = (
    context: typesModule.TranscriptContext,
    options: typesModule.SimpleStreamOptions | undefined,
    state: FauxProviderState,
    model: typesModule.Model<string>,
  ) => typesModule.AssistantMessage | Promise<typesModule.AssistantMessage>;

  type FauxResponseStep = typesModule.AssistantMessage | FauxResponseFactory;

  interface RegisterFauxProviderOptions {
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

  interface FauxProviderRegistration {
    api: string;
    models: [typesModule.Model<string>, ...typesModule.Model<string>[]];
    getModel(): typesModule.Model<string>;
    getModel(modelId: string): typesModule.Model<string> | undefined;
    state: FauxProviderState;
    setResponses: (responses: FauxResponseStep[]) => void;
    appendResponses: (responses: FauxResponseStep[]) => void;
    getPendingResponseCount: () => number;
    unregister: () => void;
  }

  interface FauxProviderHandle {
    provider: modelsTypes.Provider;
    api: string;
    models: [typesModule.Model<string>, ...typesModule.Model<string>[]];
    getModel(): typesModule.Model<string>;
    getModel(modelId: string): typesModule.Model<string> | undefined;
    state: FauxProviderState;
    setResponses: (responses: FauxResponseStep[]) => void;
    appendResponses: (responses: FauxResponseStep[]) => void;
    getPendingResponseCount: () => number;
  }
}

export type { fauxTypesModule as default };
