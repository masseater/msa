import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import defaults from "./defaults.ts";
import modelResolverPart1 from "./model-resolver-part1.ts";
import modelResolverPart4Part1 from "./model-resolver-part4-part1.ts";
import type modelResolverTypes from "./model-resolver.types.ts";
import type ModelRuntime from "./model-runtime.ts";
import type modelRuntimeTypes from "./model-runtime.types.ts";

const { DEFAULT_THINKING_LEVEL } = defaults;
const { defaultModelPerProvider } = modelResolverPart1;
const { findInitialModelPart1 } = modelResolverPart4Part1;

function findInitialModel(options: {
  scopedModels: modelResolverTypes.ScopedModel[];
  isContinuing: boolean;
  defaultProvider?: string | undefined;
  defaultModelId?: string | undefined;
  defaultThinkingLevel?: agentTypes.ThinkingLevel | undefined;
  modelThinkingLevels?: Record<string, agentTypes.ThinkingLevel> | undefined;
  modelRuntime: modelRuntimeTypes.ModelRuntime;
}): Promise<modelResolverTypes.InitialModelResult> {
  return Effect.runPromise(
    Effect.sync(() => {
      const {
        scopedModels,
        isContinuing,
        defaultProvider,
        defaultModelId,
        defaultThinkingLevel,
        modelThinkingLevels,
        modelRuntime,
      } = options;

      let model: aiTypes.Model<aiTypes.Api> | undefined;
      let thinkingLevel: agentTypes.ThinkingLevel = DEFAULT_THINKING_LEVEL;

      const scopedModel = scopedModels[0];
      if (scopedModel !== undefined && !isContinuing) {
        const perModel =
          modelThinkingLevels?.[`${scopedModel.model.provider}/${scopedModel.model.id}`];
        return {
          fallbackMessage: undefined,
          model: scopedModel.model,
          thinkingLevel:
            scopedModel.thinkingLevel ?? perModel ?? defaultThinkingLevel ?? DEFAULT_THINKING_LEVEL,
        };
      }

      if (
        defaultProvider !== undefined &&
        defaultProvider !== "" &&
        defaultModelId !== undefined &&
        defaultModelId !== ""
      ) {
        const found = modelRuntime.getModel(defaultProvider, defaultModelId);
        if (found !== undefined && modelRuntime.hasConfiguredAuth(found.provider)) {
          model = found;
          const perModel = modelThinkingLevels?.[`${defaultProvider}/${defaultModelId}`];
          if (perModel !== undefined) {
            thinkingLevel = perModel;
          } else if (defaultThinkingLevel !== undefined) {
            thinkingLevel = defaultThinkingLevel;
          }
          return { fallbackMessage: undefined, model, thinkingLevel };
        }
      }

      const availableModels = [...modelRuntime.getAvailableSnapshot()];

      if (availableModels.length > 0) {
        for (const provider of Object.keys(defaultModelPerProvider) as aiTypes.KnownProvider[]) {
          const defaultId = defaultModelPerProvider[provider];
          const match = availableModels.find((m) => m.provider === provider && m.id === defaultId);
          if (match !== undefined) {
            return {
              fallbackMessage: undefined,
              model: match,
              thinkingLevel: DEFAULT_THINKING_LEVEL,
            };
          }
        }

        return {
          fallbackMessage: undefined,
          model: availableModels[0],
          thinkingLevel: DEFAULT_THINKING_LEVEL,
        };
      }

      return findInitialModelPart1();
    }),
  );
}

function restoreModelFromSessionPart5(
  modelRuntime: ModelRuntime,
  savedProvider: string,
  savedModelId: string,
) {
  const restoredModel = modelRuntime.getModel(savedProvider, savedModelId);

  const hasConfiguredAuth =
    restoredModel === undefined ? false : modelRuntime.hasConfiguredAuth(restoredModel.provider);
  return { hasConfiguredAuth, restoredModel };
}

const modelResolverPart4Part2 = {
  findInitialModel,
  restoreModelFromSessionPart5,
};

export default modelResolverPart4Part2;
