import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import modelPolicyDenial from "./model-policy-denial.ts";
import modelResolver from "./model-resolver.ts";
import type modelResolverTypes from "./model-resolver.types.ts";
import type modelRuntimeTypes from "./model-runtime.types.ts";

const { buildFallbackModel, resolveModelReference } = modelResolver;
const { findModelPolicyDenial, formatModelPolicyDenialError } = modelPolicyDenial;

type Result = modelResolverTypes.ResolveCliModelResult;

type CliModelOptions = {
  cliProvider?: string | undefined;
  cliModel?: string | undefined;
  cliThinking?: agentTypes.ThinkingLevel | undefined;
  inlineApiKey?: boolean | undefined;
  modelRuntime: modelRuntimeTypes.ModelRuntime;
};

const cliError = (error: string): Result => ({ error, model: undefined, warning: undefined });

const ambiguousCliModel = (
  candidates: readonly aiTypes.Model<aiTypes.Api>[],
  usableCount: number,
  inlineApiKey: boolean | undefined,
  cliModel: string,
): Result => {
  const matches = candidates
    .map((m) => `${m.provider}/${m.id}`)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
  const authHint =
    inlineApiKey === true
      ? "--api-key does not choose a provider."
      : usableCount === 0
        ? "No matching provider is authenticated."
        : "More than one matching provider is authenticated.";
  return cliError(
    `Model "${cliModel}" is ambiguous across providers: ${matches}. ${authHint} Use --provider or provider/model.`,
  );
};

const customCliModel = (
  cliThinking: string | undefined,
  target: modelResolverTypes.ModelReferenceTarget,
): Result => {
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
};

const unresolvedCliModel = (
  result: Exclude<modelResolverTypes.ModelReferenceResult, { status: "resolved" }>,
  options: CliModelOptions & { cliModel: string },
  provider: string | undefined,
): Result => {
  const { modelRuntime, cliModel } = options;
  const denial = findModelPolicyDenial({
    catalogModels: modelRuntime.getCatalogModels(),
    policy: modelRuntime.getModelPolicy(),
    provider,
    reference: cliModel,
  });
  if (denial !== undefined) return cliError(formatModelPolicyDenialError(denial));
  if (result.status === "ambiguous") {
    return ambiguousCliModel(result.candidates, result.usableCount, options.inlineApiKey, cliModel);
  }
  if (result.target === undefined) {
    return cliError(`Model "${cliModel}" not found. Use --list-models to see available models.`);
  }
  return customCliModel(options.cliThinking, result.target);
};

function resolveCliModel(options: CliModelOptions): Result {
  const { cliProvider, cliModel, inlineApiKey, modelRuntime } = options;
  if (cliModel === undefined || cliModel === "") {
    return { error: undefined, model: undefined, warning: undefined };
  }
  const models = [...modelRuntime.getModels()];
  if (models.length === 0) {
    return cliError("No models available. Check your installation or add models to models.json.");
  }
  const hasCliProvider = cliProvider !== undefined && cliProvider !== "";
  const provider = hasCliProvider
    ? models.find((m) => m.provider.toLowerCase() === cliProvider.toLowerCase())?.provider
    : undefined;
  if (hasCliProvider && (provider === undefined || provider === "")) {
    return cliError(
      `Unknown provider "${cliProvider}". Use --list-models to see available providers/models.`,
    );
  }
  const result = resolveModelReference(
    { fuzzy: true, provider, text: cliModel, thinkingSuffix: "strict" },
    models,
    inlineApiKey === true
      ? () => false
      : (providerId) => modelRuntime.hasConfiguredAuth(providerId),
  );
  if (result.status === "resolved") {
    return {
      error: undefined,
      model: result.model,
      thinkingLevel: result.thinkingLevel,
      warning: result.warning,
    };
  }
  return unresolvedCliModel(result, { ...options, cliModel }, provider);
}

const cliModelFlag = { resolveCliModel };

export default cliModelFlag;
