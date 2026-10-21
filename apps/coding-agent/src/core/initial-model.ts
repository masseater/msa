import type agentTypes from "@msa/agent-core/index.types";
import * as Effect from "effect/Effect";

import defaults from "./defaults.ts";
import modelResolver from "./model-resolver.ts";
import type modelResolverTypes from "./model-resolver.types.ts";
import type modelRuntimeTypes from "./model-runtime.types.ts";

const { DEFAULT_THINKING_LEVEL } = defaults;
const { preferredAvailableModel } = modelResolver;

type InitialModelOptions = {
  scopedModels: modelResolverTypes.ScopedModel[];
  isContinuing: boolean;
  defaultProvider?: string | undefined;
  defaultModelId?: string | undefined;
  defaultThinkingLevel?: agentTypes.ThinkingLevel | undefined;
  modelThinkingLevels?: Record<string, agentTypes.ThinkingLevel> | undefined;
  modelRuntime: modelRuntimeTypes.ModelRuntime;
};

const configuredDefaultModel = (
  options: InitialModelOptions,
): modelResolverTypes.InitialModelResult | undefined => {
  const { defaultProvider, defaultModelId, modelRuntime } = options;
  if (
    defaultProvider === undefined ||
    defaultProvider === "" ||
    defaultModelId === undefined ||
    defaultModelId === ""
  ) {
    return undefined;
  }
  const found = modelRuntime.getModel(defaultProvider, defaultModelId);
  if (found === undefined || !modelRuntime.hasConfiguredAuth(found.provider)) return undefined;
  return {
    fallbackMessage: undefined,
    model: found,
    thinkingLevel:
      options.modelThinkingLevels?.[`${defaultProvider}/${defaultModelId}`] ??
      options.defaultThinkingLevel ??
      DEFAULT_THINKING_LEVEL,
  };
};

const pickInitialModel = (options: InitialModelOptions): modelResolverTypes.InitialModelResult => {
  const scopedModel = options.scopedModels[0];
  if (scopedModel !== undefined && !options.isContinuing) {
    const { model } = scopedModel;
    return {
      fallbackMessage: undefined,
      model,
      thinkingLevel:
        scopedModel.thinkingLevel ??
        options.modelThinkingLevels?.[`${model.provider}/${model.id}`] ??
        options.defaultThinkingLevel ??
        DEFAULT_THINKING_LEVEL,
    };
  }
  return (
    configuredDefaultModel(options) ?? {
      fallbackMessage: undefined,
      model: preferredAvailableModel([...options.modelRuntime.getAvailableSnapshot()]),
      thinkingLevel: DEFAULT_THINKING_LEVEL,
    }
  );
};

function findInitialModel(
  options: InitialModelOptions,
): Promise<modelResolverTypes.InitialModelResult> {
  return Effect.runPromise(Effect.sync(() => pickInitialModel(options)));
}

const initialModel = { findInitialModel };

export default initialModel;
