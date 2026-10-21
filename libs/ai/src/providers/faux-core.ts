import { Effect } from "effect";

import type typesModule from "../types.types.ts";
import fauxCoreKit from "./faux-core-kit.ts";
import fauxEngine from "./faux-engine.ts";
import type fauxEngineTypes from "./faux-engine.types.ts";
import fauxMessages from "./faux-messages.ts";
import fauxStreamModule from "./faux-stream.ts";
import type fauxStreamTypes from "./faux-stream.types.ts";
import type fauxTypesModule from "./faux-types.ts";
import fauxUsage from "./faux-usage.ts";

const { fauxDeferred, hooks } = fauxCoreKit;

const {
  DEFAULT_API,
  DEFAULT_BASE_URL,
  DEFAULT_MAX_TOKEN_SIZE,
  DEFAULT_MIN_TOKEN_SIZE,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_NAME,
  DEFAULT_PROVIDER,
  errorMessage,
  randomId,
} = fauxMessages;
const { endWithError, originOf, resolveFauxResponse, streamDetached } = fauxEngine;
const { callHook } = hooks;
const { withUsageEstimate } = fauxUsage;
const { cancelDeferred, fetchDeferred, submitDeferred } = fauxDeferred;
const { streamFauxMessage } = fauxStreamModule;

const DEFAULT_MODEL_DEFINITION: fauxTypesModule.FauxModelDefinition = {
  contextWindow: 128000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: DEFAULT_MODEL_ID,
  input: ["text", "image"],
  maxTokens: 16384,
  name: DEFAULT_MODEL_NAME,
  reasoning: false,
};

function fauxPacing(
  options: fauxTypesModule.RegisterFauxProviderOptions,
): fauxStreamTypes.FauxPacing {
  const maxSetting = options.tokenSize?.max ?? DEFAULT_MAX_TOKEN_SIZE;
  const minTokenSize = Math.max(
    1,
    Math.min(options.tokenSize?.min ?? DEFAULT_MIN_TOKEN_SIZE, maxSetting),
  );
  return {
    maxTokenSize: Math.max(minTokenSize, maxSetting),
    minTokenSize,
    tokensPerSecond: options.tokensPerSecond,
  };
}

function fauxModels(
  engine: fauxEngineTypes.FauxEngine,
  definitions: fauxTypesModule.FauxModelDefinition[] | undefined,
): [typesModule.Model<string>, ...typesModule.Model<string>[]] {
  const selected =
    definitions !== undefined && definitions.length > 0 ? definitions : [DEFAULT_MODEL_DEFINITION];
  return selected.map((definition) => ({
    api: engine.api,
    baseUrl: DEFAULT_BASE_URL,
    contextWindow: definition.contextWindow ?? 128000,
    cost: definition.cost ?? { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: definition.id,
    input: definition.input ?? ["text", "image"],
    inputLimits: definition.inputLimits,
    maxTokens: definition.maxTokens ?? 16384,
    name: definition.name ?? definition.id,
    provider: engine.provider,
    reasoning: definition.reasoning ?? false,
  })) as [typesModule.Model<string>, ...typesModule.Model<string>[]];
}

function fauxStream(
  engine: fauxEngineTypes.FauxEngine,
  takeStep: () => fauxTypesModule.FauxResponseStep | undefined,
): typesModule.StreamFunction<string, typesModule.SimpleStreamOptions> {
  return (model, context, options) => {
    const step = takeStep();
    engine.state.callCount++;
    return streamDetached({
      engine,
      model,
      run: (stream) =>
        Effect.gen(function* () {
          yield* callHook(() => options?.onResponse?.({ headers: {}, status: 200 }, model));
          if (step === undefined) {
            const error = new Error("No more faux responses queued");
            return endWithError(stream)(
              withUsageEstimate({
                context,
                message: errorMessage({ error, origin: originOf(engine)(model) }),
                options,
                promptCache: engine.promptCache,
              }),
            );
          }
          if (options?.deferred !== undefined && options.deferred !== false) {
            return yield* submitDeferred({ context, engine, model, options, step, stream });
          }
          const message = yield* resolveFauxResponse({ context, engine, model, options, step });
          yield* streamFauxMessage({
            message,
            pacing: engine.pacing,
            signal: options?.signal,
            stream,
          });
        }),
    });
  };
}

function createFauxCore(options: fauxTypesModule.RegisterFauxProviderOptions) {
  const engine: fauxEngineTypes.FauxEngine = {
    api: options.api ?? randomId(DEFAULT_API),
    deferred: options.deferred,
    deferredResponses: new Map(),
    pacing: fauxPacing(options),
    promptCache: new Map(),
    provider: options.provider ?? DEFAULT_PROVIDER,
    state: { callCount: 0, cancelledDeferred: [], deferredFetchCount: 0 },
  };
  let pendingResponses: fauxTypesModule.FauxResponseStep[] = [];
  const models = fauxModels(engine, options.models);
  const stream = fauxStream(engine, () => pendingResponses.shift());

  function getModel(): typesModule.Model<string>;
  function getModel(requestedModelId: string): typesModule.Model<string> | undefined;
  function getModel(requestedModelId?: string): typesModule.Model<string> | undefined {
    if (requestedModelId === undefined || requestedModelId === "") return models[0];
    return models.find((candidate) => candidate.id === requestedModelId);
  }

  return {
    api: engine.api,
    appendResponses(responses: fauxTypesModule.FauxResponseStep[]) {
      pendingResponses.push(...responses);
    },
    cancelDeferred: (
      model: typesModule.Model<string>,
      handle: typesModule.DeferredHandle,
      cancelOptions?: typesModule.DeferredCancelOptions,
    ) => cancelDeferred({ engine, handle, model, options: cancelOptions }),
    fetchDeferred: (
      model: typesModule.Model<string>,
      handle: typesModule.DeferredHandle,
      fetchOptions?: typesModule.DeferredFetchOptions,
    ) => fetchDeferred({ engine, handle, model, options: fetchOptions }),
    getModel,
    getPendingResponseCount() {
      return pendingResponses.length;
    },
    models,
    provider: engine.provider,
    setResponses(responses: fauxTypesModule.FauxResponseStep[]) {
      pendingResponses = [...responses];
    },
    state: engine.state,
    stream,
    streamSimple: stream,
  };
}

const fauxCore = {
  createFauxCore,
};

export default fauxCore;
