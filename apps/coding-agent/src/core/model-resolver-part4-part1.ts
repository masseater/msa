import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import defaults from "./defaults.ts";
import modelResolverPart1 from "./model-resolver-part1.ts";
import type modelResolverTypes from "./model-resolver.types.ts";
import type ModelRuntime from "./model-runtime.ts";
import type modelRuntimeTypes from "./model-runtime.types.ts";

const {
  buildFallbackModel,
  findModelPolicyDenial,
  formatModelPolicyDenialError,
  resolveModelReference,
} = modelResolverPart1;
const { DEFAULT_THINKING_LEVEL } = defaults;

function resolveCliModel(options: {
  cliProvider?: string | undefined;
  cliModel?: string | undefined;
  cliThinking?: agentTypes.ThinkingLevel | undefined;
  inlineApiKey?: boolean | undefined;
  modelRuntime: modelRuntimeTypes.ModelRuntime;
}): modelResolverTypes.ResolveCliModelResult {
  const { cliProvider, cliModel, cliThinking, inlineApiKey, modelRuntime } = options;

  if (cliModel === undefined || cliModel === "") {
    return { error: undefined, model: undefined, warning: undefined };
  }

  const models = [...modelRuntime.getModels()];
  if (models.length === 0) {
    return resolveCliModelPart5();
  }

  const provider =
    cliProvider !== undefined && cliProvider !== ""
      ? models.find((m) => m.provider.toLowerCase() === cliProvider.toLowerCase())?.provider
      : undefined;
  if (
    cliProvider !== undefined &&
    cliProvider !== "" &&
    (provider === undefined || provider === "")
  ) {
    return resolveCliModelPart6(cliProvider);
  }

  const result = resolveModelReference(
    { fuzzy: true, provider, text: cliModel, thinkingSuffix: "strict" },
    models,
    inlineApiKey === true
      ? () => false
      : (providerId) => modelRuntime.hasConfiguredAuth(providerId),
  );
  if (result.status === "resolved") {
    return resolveCliModelPart4(result);
  }
  const denial = resolveCliModelPart3(modelRuntime, provider, cliModel);
  if (denial !== undefined) {
    return resolveCliModelPart7(denial);
  }
  if (result.status === "ambiguous") {
    return resolveCliModelPart1(result, inlineApiKey, cliModel);
  }

  const { target } = result;
  if (target === undefined) {
    return resolveCliModelPart8(cliModel);
  }

  return resolveCliModelPart2(cliThinking, target);
}

function resolveCliModelPart8(cliModel: string): modelResolverTypes.ResolveCliModelResult {
  return {
    error: `Model "${cliModel}" not found. Use --list-models to see available models.`,
    model: undefined,
    warning: undefined,
  };
}

function resolveCliModelPart7(denial: {
  model: aiTypes.Model<aiTypes.Api>;
  message: string;
}): modelResolverTypes.ResolveCliModelResult {
  return {
    error: formatModelPolicyDenialError(denial),
    model: undefined,
    warning: undefined,
  };
}

function resolveCliModelPart6(cliProvider: string): modelResolverTypes.ResolveCliModelResult {
  return {
    error: `Unknown provider "${cliProvider}". Use --list-models to see available providers/models.`,
    model: undefined,
    warning: undefined,
  };
}

function resolveCliModelPart5(): modelResolverTypes.ResolveCliModelResult {
  return {
    error: "No models available. Check your installation or add models to models.json.",
    model: undefined,
    warning: undefined,
  };
}

function resolveCliModelPart4(result: {
  status: "resolved";
  model: aiTypes.Model<aiTypes.Api>;
  thinkingLevel?: agentTypes.ThinkingLevel | undefined;
  warning?: string;
}): modelResolverTypes.ResolveCliModelResult {
  return {
    error: undefined,
    model: result.model,
    thinkingLevel: result.thinkingLevel,
    warning: result.warning,
  };
}

function resolveCliModelPart3(
  modelRuntime: ModelRuntime,
  provider: string | undefined,
  cliModel: string,
) {
  return findModelPolicyDenial({
    catalogModels: modelRuntime.getCatalogModels(),
    policy: modelRuntime.getModelPolicy(),
    provider,
    reference: cliModel,
  });
}

function resolveCliModelPart2(
  cliThinking: string | undefined,
  target: modelResolverTypes.ModelReferenceTarget,
): modelResolverTypes.ResolveCliModelResult {
  const modelId = cliThinking === undefined ? target.modelId : target.modelText;
  const fallbackThinking = cliThinking === undefined ? target.thinkingLevel : undefined;
  const fallbackModel = buildFallbackModel(target.providerModels, modelId);
  const requestedThinking = cliThinking ?? fallbackThinking;
  return {
    error: undefined,
    model:
      requestedThinking !== undefined && requestedThinking !== "off"
        ? { ...fallbackModel, reasoning: true }
        : fallbackModel,
    thinkingLevel: fallbackThinking,
    warning: `Model "${modelId}" not found for provider "${target.provider}". Using custom model id.`,
  };
}

function resolveCliModelPart1(
  result: {
    status: "ambiguous";
    candidates: aiTypes.Model<aiTypes.Api>[];
    usableCount: number;
    thinkingLevel?: agentTypes.ThinkingLevel | undefined;
    warning?: string;
  },
  inlineApiKey: boolean | undefined,
  cliModel: string,
): modelResolverTypes.ResolveCliModelResult {
  const matches = result.candidates
    .map((m) => `${m.provider}/${m.id}`)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
  const authHint =
    inlineApiKey === true
      ? "--api-key does not choose a provider."
      : result.usableCount === 0
        ? "No matching provider is authenticated."
        : "More than one matching provider is authenticated.";
  return {
    error: `Model "${cliModel}" is ambiguous across providers: ${matches}. ${authHint} Use --provider or provider/model.`,
    model: undefined,
    warning: undefined,
  };
}

function findInitialModelPart1():
  | {
      fallbackMessage: undefined;
      model: aiTypes.Model<aiTypes.Api>;
      thinkingLevel: agentTypes.ThinkingLevel;
    }
  | {
      fallbackMessage: undefined;
      model: aiTypes.Model<aiTypes.Api> | undefined;
      thinkingLevel: "medium";
    } {
  return {
    fallbackMessage: undefined,
    model: undefined,
    thinkingLevel: DEFAULT_THINKING_LEVEL,
  };
}

const modelResolverPart4Part1 = {
  findInitialModelPart1,
  resolveCliModel,
};

export default modelResolverPart4Part1;
