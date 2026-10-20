import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import chalk from "chalk";
import * as Effect from "effect/Effect";
import { minimatch } from "minimatch";

import { isValidThinkingLevel } from "../cli/args.ts";
import { awaited, awaiting } from "./awaiting.ts";
import { DEFAULT_THINKING_LEVEL } from "./defaults.ts";
import { type ModelPolicy, describeModelPolicyDenial } from "./model-policy.ts";
import type { ModelRuntime } from "./model-runtime.ts";
import { writeError, writeLog, writeWarn } from "./platform.ts";

const { modelsAreEqual } = ai;

export const defaultModelPerProvider: Partial<Record<aiTypes.KnownProvider, string>> = {
  "anthropic-api": "claude-opus-4-8",
  openai: "gpt-5.5",
  "openai-codex": "gpt-6.1-sol",
  opencode: "kimi-k2.6",
  "opencode-go": "kimi-k3",
  openrouter: "moonshotai/kimi-k2.6",
};

export interface ScopedModel {
  model: aiTypes.Model<aiTypes.Api>;
  thinkingLevel?: agentTypes.ThinkingLevel | undefined;
}

export interface ModelReferenceRequest {
  text: string;
  provider?: string | undefined;
  thinkingSuffix: "none" | "strict" | "lenient";
  fuzzy: boolean;
}

export type ModelReferenceResult =
  | {
      status: "resolved";
      model: aiTypes.Model<aiTypes.Api>;
      thinkingLevel?: agentTypes.ThinkingLevel | undefined;
      warning?: string;
    }
  | {
      status: "ambiguous";
      candidates: aiTypes.Model<aiTypes.Api>[];
      usableCount: number;
      thinkingLevel?: agentTypes.ThinkingLevel | undefined;
      warning?: string;
    }
  | {
      status: "not-found";
      target?: ModelReferenceTarget;
    };

export interface ModelReferenceTarget {
  provider: string;
  providerModels: [aiTypes.Model<aiTypes.Api>, ...aiTypes.Model<aiTypes.Api>[]];
  modelText: string;
  modelId: string;
  thinkingLevel?: agentTypes.ThinkingLevel | undefined;
}

type ResolvedOrAmbiguous = Exclude<ModelReferenceResult, { status: "not-found" }>;

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

export function resolveModelReference(
  request: ModelReferenceRequest,
  models: readonly aiTypes.Model<aiTypes.Api>[],
  usable: (provider: string) => boolean,
): ModelReferenceResult {
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

export function findExactModelReferenceMatch(
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
  request: ModelReferenceRequest,
  pool: readonly aiTypes.Model<aiTypes.Api>[],
  usable: (provider: string) => boolean,
): ModelReferenceResult {
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
): ResolvedOrAmbiguous | undefined {
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
): ResolvedOrAmbiguous | undefined {
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

export function findModelPolicyDenial(options: {
  reference: string;
  provider?: string | undefined;
  policy: ModelPolicy;
  catalogModels: readonly aiTypes.Model<aiTypes.Api>[];
}): { model: aiTypes.Model<aiTypes.Api>; message: string } | undefined {
  const result = resolveModelReference(
    {
      fuzzy: true,
      provider: options.provider,
      text: options.reference,
      thinkingSuffix: "lenient",
    },
    options.catalogModels,
    () => true,
  );
  const candidates =
    result.status === "resolved"
      ? [result.model]
      : result.status === "ambiguous"
        ? result.candidates
        : [];
  for (const model of candidates) {
    const message = describeModelPolicyDenial(options.policy, model);
    if (message) return { message, model };
  }
  return undefined;
}

export function formatModelPolicyDenialError(denial: {
  model: aiTypes.Model<aiTypes.Api>;
  message: string;
}): string {
  return `Model "${denial.model.provider}/${denial.model.id}" is ${denial.message}. Open /model to change it.`;
}

export interface ModelScopeDiagnostic {
  type: "warning";
  code: "no-match" | "invalid-thinking-level" | "ambiguous";
  message: string;
  pattern: string;
}

export interface ResolveModelScopeResult {
  scopedModels: ScopedModel[];
  diagnostics: ModelScopeDiagnostic[];
}

export function resolveModelScopeFromModels(
  patterns: string[],
  models: readonly aiTypes.Model<aiTypes.Api>[],
): ResolveModelScopeResult {
  const scopedModels: ScopedModel[] = [];
  const diagnostics: ModelScopeDiagnostic[] = [];
  const add = (
    model: aiTypes.Model<aiTypes.Api>,
    thinkingLevel: agentTypes.ThinkingLevel | undefined,
  ) => {
    if (!scopedModels.some((scoped) => modelsAreEqual(scoped.model, model))) {
      scopedModels.push({ model, thinkingLevel });
    }
  };
  const noMatch = (pattern: string) =>
    diagnostics.push({
      code: "no-match",
      message: `No models match pattern "${pattern}"`,
      pattern,
      type: "warning",
    });
  const ambiguous = (pattern: string, candidates: readonly aiTypes.Model<aiTypes.Api>[]) => {
    const providers = [...new Set(candidates.map((m) => m.provider))].sort((a, b) =>
      a.localeCompare(b),
    );
    diagnostics.push({
      code: "ambiguous",
      message: `Pattern "${pattern}" matches several providers: ${providers.join(", ")}. Use provider/id to choose one.`,
      pattern,
      type: "warning",
    });
  };

  for (const pattern of patterns) {
    if (pattern.includes("*") || pattern.includes("?") || pattern.includes("[")) {
      const thinking = splitThinkingSuffix(pattern);
      const globPattern = thinking?.base ?? pattern;
      const thinkingLevel = thinking?.thinkingLevel;

      const exact = resolveModelReference(
        { fuzzy: false, text: globPattern, thinkingSuffix: "none" },
        models,
        () => true,
      );
      let matches: readonly aiTypes.Model<aiTypes.Api>[];
      if (exact.status === "resolved") matches = [exact.model];
      else if (exact.status === "ambiguous") {
        matches = exact.candidates;
        ambiguous(pattern, matches);
      } else {
        matches = models.filter(
          (m) =>
            minimatch(`${m.provider}/${m.id}`, globPattern, { nocase: true }) ||
            minimatch(m.id, globPattern, { nocase: true }),
        );
      }
      if (matches.length === 0) noMatch(pattern);
      for (const model of matches) add(model, thinkingLevel);
      continue;
    }

    const result = resolveModelReference(
      { fuzzy: true, text: pattern, thinkingSuffix: "lenient" },
      models,
      () => true,
    );
    if (result.status === "not-found") {
      noMatch(pattern);
      continue;
    }
    if (result.warning !== undefined && result.warning !== "") {
      diagnostics.push({
        code: "invalid-thinking-level",
        message: result.warning,
        pattern,
        type: "warning",
      });
    }
    if (result.status === "ambiguous") ambiguous(pattern, result.candidates);
    const matches = result.status === "resolved" ? [result.model] : result.candidates;
    for (const model of matches) add(model, result.thinkingLevel);
  }

  return { diagnostics, scopedModels };
}

export function resolveModelScopeWithDiagnostics(
  patterns: string[],
  modelRuntime: ModelRuntime,
  options?: aiTypes.AuthOperationOptions,
): Promise<ResolveModelScopeResult> {
  return Effect.runPromise(
    awaiting(function* () {
      return resolveModelScopeFromModels(
        patterns,
        yield* awaited(modelRuntime.getAvailable(undefined, options)),
      );
    }),
  );
}

export function resolveModelScope(
  patterns: string[],
  modelRuntime: ModelRuntime,
  options?: aiTypes.AuthOperationOptions,
): Promise<ScopedModel[]> {
  return Effect.runPromise(
    awaiting(function* () {
      const { scopedModels, diagnostics } = yield* awaited(
        resolveModelScopeWithDiagnostics(patterns, modelRuntime, options),
      );
      for (const diagnostic of diagnostics) {
        writeWarn(chalk.yellow(`Warning: ${diagnostic.message}`));
      }
      return scopedModels;
    }),
  );
}

export interface ResolveCliModelResult {
  model: aiTypes.Model<aiTypes.Api> | undefined;
  thinkingLevel?: agentTypes.ThinkingLevel | undefined;
  warning: string | undefined;
  error: string | undefined;
}

export function resolveCliModel(options: {
  cliProvider?: string | undefined;
  cliModel?: string | undefined;
  cliThinking?: agentTypes.ThinkingLevel | undefined;
  inlineApiKey?: boolean | undefined;
  modelRuntime: ModelRuntime;
}): ResolveCliModelResult {
  const { cliProvider, cliModel, cliThinking, inlineApiKey, modelRuntime } = options;

  if (cliModel === undefined || cliModel === "") {
    return { error: undefined, model: undefined, warning: undefined };
  }

  const models = [...modelRuntime.getModels()];
  if (models.length === 0) {
    return {
      error: "No models available. Check your installation or add models to models.json.",
      model: undefined,
      warning: undefined,
    };
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
    return {
      error: `Unknown provider "${cliProvider}". Use --list-models to see available providers/models.`,
      model: undefined,
      warning: undefined,
    };
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
  const denial = findModelPolicyDenial({
    catalogModels: modelRuntime.getCatalogModels(),
    policy: modelRuntime.getModelPolicy(),
    provider,
    reference: cliModel,
  });
  if (denial) {
    return {
      error: formatModelPolicyDenialError(denial),
      model: undefined,
      warning: undefined,
    };
  }
  if (result.status === "ambiguous") {
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

  const { target } = result;
  if (target === undefined) {
    return {
      error: `Model "${cliModel}" not found. Use --list-models to see available models.`,
      model: undefined,
      warning: undefined,
    };
  }

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

export interface InitialModelResult {
  model: aiTypes.Model<aiTypes.Api> | undefined;
  thinkingLevel: agentTypes.ThinkingLevel;
  fallbackMessage: string | undefined;
}

export function findInitialModel(options: {
  scopedModels: ScopedModel[];
  isContinuing: boolean;
  defaultProvider?: string | undefined;
  defaultModelId?: string | undefined;
  defaultThinkingLevel?: agentTypes.ThinkingLevel | undefined;
  modelThinkingLevels?: Record<string, agentTypes.ThinkingLevel> | undefined;
  modelRuntime: ModelRuntime;
}): Promise<InitialModelResult> {
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

      return {
        fallbackMessage: undefined,
        model: undefined,
        thinkingLevel: DEFAULT_THINKING_LEVEL,
      };
    }),
  );
}

export function restoreModelFromSession(
  savedProvider: string,
  savedModelId: string,
  currentModel: aiTypes.Model<aiTypes.Api> | undefined,
  shouldPrintMessages: boolean,
  modelRuntime: ModelRuntime,
): Promise<{ model: aiTypes.Model<aiTypes.Api> | undefined; fallbackMessage: string | undefined }> {
  return Effect.runPromise(
    Effect.sync(() => {
      const restoredModel = modelRuntime.getModel(savedProvider, savedModelId);

      const hasConfiguredAuth =
        restoredModel === undefined
          ? false
          : modelRuntime.hasConfiguredAuth(restoredModel.provider);

      if (restoredModel !== undefined && hasConfiguredAuth) {
        if (shouldPrintMessages) {
          writeLog(chalk.dim(`Restored model: ${savedProvider}/${savedModelId}`));
        }
        return { fallbackMessage: undefined, model: restoredModel };
      }

      const reason = restoredModel === undefined ? "model no longer exists" : "no auth configured";

      if (shouldPrintMessages) {
        writeError(
          chalk.yellow(
            `Warning: Could not restore model ${savedProvider}/${savedModelId} (${reason}).`,
          ),
        );
      }

      if (currentModel !== undefined) {
        if (shouldPrintMessages) {
          writeLog(chalk.dim(`Falling back to: ${currentModel.provider}/${currentModel.id}`));
        }
        return {
          fallbackMessage: `Could not restore model ${savedProvider}/${savedModelId} (${reason}). Using ${currentModel.provider}/${currentModel.id}.`,
          model: currentModel,
        };
      }

      const availableModels = [...modelRuntime.getAvailableSnapshot()];

      const firstAvailableModel = availableModels[0];
      if (firstAvailableModel !== undefined) {
        let fallbackModel: aiTypes.Model<aiTypes.Api> | undefined;
        for (const provider of Object.keys(defaultModelPerProvider) as aiTypes.KnownProvider[]) {
          const defaultId = defaultModelPerProvider[provider];
          const match = availableModels.find((m) => m.provider === provider && m.id === defaultId);
          if (match !== undefined) {
            fallbackModel = match;
            break;
          }
        }

        if (fallbackModel === undefined) {
          fallbackModel = firstAvailableModel;
        }

        if (shouldPrintMessages) {
          writeLog(chalk.dim(`Falling back to: ${fallbackModel.provider}/${fallbackModel.id}`));
        }

        return {
          fallbackMessage: `Could not restore model ${savedProvider}/${savedModelId} (${reason}). Using ${fallbackModel.provider}/${fallbackModel.id}.`,
          model: fallbackModel,
        };
      }

      return { fallbackMessage: undefined, model: undefined };
    }),
  );
}
