import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type modelResolverInternalTypes from "./model-resolver-internal.types.ts";
import type modelResolverTypes from "./model-resolver.types.ts";
import thinkingLevels from "./thinking-levels.ts";

const { isValidThinkingLevel } = thinkingLevels;

const defaultModelPerProvider: Partial<Record<aiTypes.KnownProvider, string>> = {
  "anthropic-api": "claude-opus-4-8",
  openai: "gpt-5.5",
  "openai-codex": "gpt-6.1-sol",
  opencode: "kimi-k2.6",
  "opencode-go": "kimi-k3",
  openrouter: "moonshotai/kimi-k2.6",
};

function splitThinkingSuffix(
  text: string,
): { base: string; thinkingLevel: agentTypes.ThinkingLevel } | undefined {
  const colonIndex = text.lastIndexOf(":");
  const suffix = text.substring(colonIndex + 1);
  if (colonIndex === -1 || !isValidThinkingLevel(suffix)) return undefined;
  return { base: text.substring(0, colonIndex), thinkingLevel: suffix };
}

function splitProviderPrefix(
  text: string,
  models: readonly aiTypes.Model<aiTypes.Api>[],
): { provider: string; modelText: string } | undefined {
  const slashIndex = text.indexOf("/");
  if (slashIndex === -1) return undefined;
  const prefix = text.substring(0, slashIndex).trim().toLowerCase();
  const modelText = text.substring(slashIndex + 1).trim();
  if (prefix === "" || modelText === "") return undefined;
  const provider = models.find((model) => model.provider.toLowerCase() === prefix)?.provider;
  return provider !== undefined && provider !== "" ? { modelText, provider } : undefined;
}

function resolveModelReference(
  request: modelResolverTypes.ModelReferenceRequest,
  models: readonly aiTypes.Model<aiTypes.Api>[],
  usable: (provider: string) => boolean,
): modelResolverTypes.ModelReferenceResult {
  const text = request.text.trim();
  if (text === "") return { status: "not-found" };
  const constraint = request.provider?.toLowerCase();
  const pool =
    constraint !== undefined && constraint !== ""
      ? models.filter((model) => model.provider.toLowerCase() === constraint)
      : models;
  const result = resolveText(text, request, pool, usable);
  if (result.status !== "not-found") return result;

  const split = splitProviderPrefix(text, pool);
  const anchor =
    constraint !== undefined && constraint !== ""
      ? pool[0]
      : pool.find((model) => model.provider === split?.provider);
  if (anchor === undefined) return result;
  const modelText = split?.modelText ?? text;
  const suffix = request.thinkingSuffix === "none" ? undefined : splitThinkingSuffix(modelText);
  return {
    status: "not-found",
    target: {
      modelId: suffix?.base ?? modelText,
      modelText,
      provider: anchor.provider,
      providerModels: [
        anchor,
        ...pool.filter((model) => model.provider === anchor.provider && model !== anchor),
      ],
      thinkingLevel: suffix?.thinkingLevel,
    },
  };
}

function findExactModelReferenceMatch(
  modelReference: string,
  models: readonly aiTypes.Model<aiTypes.Api>[],
): aiTypes.Model<aiTypes.Api> | undefined {
  const result = resolveModelReference(
    { fuzzy: false, text: modelReference, thinkingSuffix: "none" },
    models,
    () => true,
  );
  return result.status === "resolved" ? result.model : undefined;
}

function resolveText(
  text: string,
  request: modelResolverTypes.ModelReferenceRequest,
  pool: readonly aiTypes.Model<aiTypes.Api>[],
  usable: (provider: string) => boolean,
): modelResolverTypes.ModelReferenceResult {
  const reference = selectReference(text, pool, request.fuzzy, usable);
  if (reference !== undefined) return reference;

  if (request.fuzzy) {
    const fuzzy = selectFuzzy(fuzzyMatches(text, pool), usable);
    if (fuzzy !== undefined) return fuzzy;
  }

  if (request.thinkingSuffix === "none") return { status: "not-found" };
  const thinking = splitThinkingSuffix(text);
  if (thinking !== undefined) {
    const inner = resolveText(thinking.base, request, pool, usable);
    if (inner.status === "not-found") return inner;
    return {
      ...inner,
      thinkingLevel:
        inner.warning !== undefined && inner.warning !== "" ? undefined : thinking.thinkingLevel,
    };
  }
  if (request.thinkingSuffix === "strict") return { status: "not-found" };
  const colonIndex = text.lastIndexOf(":");
  if (colonIndex === -1) return { status: "not-found" };

  const suffix = text.substring(colonIndex + 1);
  const inner = resolveText(text.substring(0, colonIndex), request, pool, usable);
  if (inner.status === "not-found") return inner;
  return {
    ...inner,
    thinkingLevel: undefined,
    warning: `Invalid thinking level "${suffix}" in pattern "${text}". Using default instead.`,
  };
}

function selectReference(
  text: string,
  pool: readonly aiTypes.Model<aiTypes.Api>[],
  fuzzy: boolean,
  usable: (provider: string) => boolean,
): modelResolverInternalTypes.ResolvedOrAmbiguous | undefined {
  const lowerText = text.toLowerCase();
  const raw = pool.filter((model) => model.id.toLowerCase() === lowerText);
  const split = splitProviderPrefix(text, pool);
  let named: aiTypes.Model<aiTypes.Api> | undefined;
  if (split !== undefined) {
    const providerModels = pool.filter((model) => model.provider === split.provider);
    const lowerModelText = split.modelText.toLowerCase();
    named =
      providerModels.find((model) => model.id.toLowerCase() === lowerModelText) ??
      raw.find((model) => model.provider === split.provider) ??
      (fuzzy ? bestFuzzyMatch(fuzzyMatches(split.modelText, providerModels)) : undefined);
  }

  const others = raw.filter((model) => model !== named);
  const candidates = named === undefined ? others : [named, ...others];
  const [firstCandidate] = candidates;
  if (firstCandidate === undefined) return undefined;
  if (new Set(candidates.map((model) => model.provider)).size === 1)
    return { model: firstCandidate, status: "resolved" };
  if (named !== undefined && usable(named.provider)) return { model: named, status: "resolved" };
  const usableOthers = others.filter((model) => usable(model.provider));
  const [onlyUsable] = usableOthers;
  if (usableOthers.length === 1 && onlyUsable !== undefined)
    return { model: onlyUsable, status: "resolved" };
  if (usableOthers.length === 0 && named !== undefined) return { model: named, status: "resolved" };
  return { candidates, status: "ambiguous", usableCount: usableOthers.length };
}

function fuzzyMatches(
  text: string,
  models: readonly aiTypes.Model<aiTypes.Api>[],
): aiTypes.Model<aiTypes.Api>[] {
  const lowerText = text.toLowerCase();
  return models.filter(
    (model) =>
      model.id.toLowerCase().includes(lowerText) || model.name?.toLowerCase().includes(lowerText),
  );
}

function selectFuzzy(
  matches: aiTypes.Model<aiTypes.Api>[],
  usable: (provider: string) => boolean,
): modelResolverInternalTypes.ResolvedOrAmbiguous | undefined {
  if (matches.length === 0) return undefined;
  const multipleProviders = new Set(matches.map((model) => model.provider)).size > 1;
  const usableMatches = multipleProviders ? matches.filter((model) => usable(model.provider)) : [];
  const pool = usableMatches.length > 0 ? usableMatches : matches;
  const best = bestFuzzyMatch(pool);
  if (best === undefined) return undefined;
  const tied = pool.filter((model) => model.id === best.id);
  if (new Set(tied.map((model) => model.provider)).size === 1)
    return { model: best, status: "resolved" };
  return {
    candidates: tied,
    status: "ambiguous",
    usableCount: usableMatches.length > 0 ? tied.length : 0,
  };
}

function bestFuzzyMatch(
  matches: readonly aiTypes.Model<aiTypes.Api>[],
): aiTypes.Model<aiTypes.Api> | undefined {
  const aliases = matches.filter((model) => isAlias(model.id));
  return [...(aliases.length > 0 ? aliases : matches)].sort((a, b) => b.id.localeCompare(a.id))[0];
}

function isAlias(id: string): boolean {
  return id.endsWith("-latest") || !/-\d{8}$/u.test(id);
}

function buildFallbackModel(
  providerModels: [aiTypes.Model<aiTypes.Api>, ...aiTypes.Model<aiTypes.Api>[]],
  modelId: string,
): aiTypes.Model<aiTypes.Api> {
  const defaultId = defaultModelPerProvider[providerModels[0].provider as aiTypes.KnownProvider];
  const baseModel =
    defaultId !== undefined && defaultId !== ""
      ? (providerModels.find((m) => m.id === defaultId) ?? providerModels[0])
      : providerModels[0];

  return {
    ...baseModel,
    id: modelId,
    name: modelId,
  };
}

function preferredAvailableModel(
  availableModels: readonly aiTypes.Model<aiTypes.Api>[],
): aiTypes.Model<aiTypes.Api> | undefined {
  for (const provider of Object.keys(defaultModelPerProvider) as aiTypes.KnownProvider[]) {
    const defaultId = defaultModelPerProvider[provider];
    const match = availableModels.find((m) => m.provider === provider && m.id === defaultId);
    if (match !== undefined) return match;
  }
  return availableModels[0];
}

const modelResolver = {
  buildFallbackModel,
  defaultModelPerProvider,
  findExactModelReferenceMatch,
  preferredAvailableModel,
  resolveModelReference,
  splitThinkingSuffix,
};

export default modelResolver;
