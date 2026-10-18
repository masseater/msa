import { Effect } from "effect";

import type {
  DeferredCancelOptions,
  DeferredFetchOptions,
  DeferredHandle,
  Model,
  SimpleStreamOptions,
  StreamFunction,
} from "../types.ts";
import { callHook } from "../utils/hooks.ts";
import { cancelDeferred, fetchDeferred, submitDeferred } from "./faux-deferred.ts";
import {
  endWithError,
  type FauxEngine,
  originOf,
  resolveFauxResponse,
  streamDetached,
} from "./faux-engine.ts";
import {
  DEFAULT_API,
  DEFAULT_BASE_URL,
  DEFAULT_MAX_TOKEN_SIZE,
  DEFAULT_MIN_TOKEN_SIZE,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_NAME,
  DEFAULT_PROVIDER,
  errorMessage,
  randomId,
} from "./faux-messages.ts";
import { type FauxPacing, streamFauxMessage } from "./faux-stream.ts";
import type {
  FauxModelDefinition,
  FauxResponseStep,
  RegisterFauxProviderOptions,
} from "./faux-types.ts";
import { withUsageEstimate } from "./faux-usage.ts";

const DEFAULT_MODEL_DEFINITION: FauxModelDefinition = {
  id: DEFAULT_MODEL_ID,
  name: DEFAULT_MODEL_NAME,
  reasoning: false,
  input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 16384,
};

function fauxPacing(options: RegisterFauxProviderOptions): FauxPacing {
  const maxSetting = options.tokenSize?.max ?? DEFAULT_MAX_TOKEN_SIZE;
  const minTokenSize = Math.max(
    1,
    Math.min(options.tokenSize?.min ?? DEFAULT_MIN_TOKEN_SIZE, maxSetting),
  );
  return {
    minTokenSize,
    maxTokenSize: Math.max(minTokenSize, maxSetting),
    tokensPerSecond: options.tokensPerSecond,
  };
}

function fauxModels(
  engine: FauxEngine,
  definitions: FauxModelDefinition[] | undefined,
): [Model<string>, ...Model<string>[]] {
  const selected =
    definitions !== undefined && definitions.length > 0 ? definitions : [DEFAULT_MODEL_DEFINITION];
  return selected.map((definition) => ({
    id: definition.id,
    name: definition.name ?? definition.id,
    api: engine.api,
    provider: engine.provider,
    baseUrl: DEFAULT_BASE_URL,
    reasoning: definition.reasoning ?? false,
    input: definition.input ?? ["text", "image"],
    inputLimits: definition.inputLimits,
    cost: definition.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: definition.contextWindow ?? 128000,
    maxTokens: definition.maxTokens ?? 16384,
  })) as [Model<string>, ...Model<string>[]];
}

function fauxStream(
  engine: FauxEngine,
  takeStep: () => FauxResponseStep | undefined,
): StreamFunction<string, SimpleStreamOptions> {
  return (model, context, options) => {
    const step = takeStep();
    engine.state.callCount++;
    return streamDetached({
      engine,
      model,
      run: (stream) =>
        Effect.gen(function* () {
          yield* callHook(() => options?.onResponse?.({ status: 200, headers: {} }, model));
          if (step === undefined) {
            const error = new Error("No more faux responses queued");
            return endWithError(stream)(
              withUsageEstimate({
                message: errorMessage({ error, origin: originOf(engine)(model) }),
                context,
                options,
                promptCache: engine.promptCache,
              }),
            );
          }
          if (options?.deferred !== undefined && options.deferred !== false) {
            return yield* submitDeferred({ engine, stream, step, context, options, model });
          }
          const message = yield* resolveFauxResponse({ engine, step, context, options, model });
          yield* streamFauxMessage({
            stream,
            message,
            pacing: engine.pacing,
            signal: options?.signal,
          });
        }),
    });
  };
}

export function createFauxCore(options: RegisterFauxProviderOptions) {
  const engine: FauxEngine = {
    api: options.api ?? randomId(DEFAULT_API),
    provider: options.provider ?? DEFAULT_PROVIDER,
    state: { callCount: 0, deferredFetchCount: 0, cancelledDeferred: [] },
    promptCache: new Map(),
    pacing: fauxPacing(options),
    deferred: options.deferred,
    deferredResponses: new Map(),
  };
  let pendingResponses: FauxResponseStep[] = [];
  const models = fauxModels(engine, options.models);
  const stream = fauxStream(engine, () => pendingResponses.shift());

  function getModel(): Model<string>;
  function getModel(requestedModelId: string): Model<string> | undefined;
  function getModel(requestedModelId?: string): Model<string> | undefined {
    if (requestedModelId === undefined || requestedModelId === "") return models[0];
    return models.find((candidate) => candidate.id === requestedModelId);
  }

  return {
    api: engine.api,
    provider: engine.provider,
    models,
    stream,
    streamSimple: stream,
    fetchDeferred: (
      model: Model<string>,
      handle: DeferredHandle,
      fetchOptions?: DeferredFetchOptions,
    ) => fetchDeferred({ engine, model, handle, options: fetchOptions }),
    cancelDeferred: (
      model: Model<string>,
      handle: DeferredHandle,
      cancelOptions?: DeferredCancelOptions,
    ) => cancelDeferred({ engine, model, handle, options: cancelOptions }),
    getModel,
    state: engine.state,
    setResponses(responses: FauxResponseStep[]) {
      pendingResponses = [...responses];
    },
    appendResponses(responses: FauxResponseStep[]) {
      pendingResponses.push(...responses);
    },
    getPendingResponseCount() {
      return pendingResponses.length;
    },
  };
}
