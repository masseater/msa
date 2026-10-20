import type aiTypes from "@msa/ai/index.types";
import { minimatch } from "minimatch";

import type modelPolicyTypes from "./model-policy.types.ts";
import type modelRuntimeTypes from "./model-runtime.types.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";
import thinkingLevels from "./thinking-levels.ts";

const { isValidThinkingLevel } = thinkingLevels;

const EMPTY_MODEL_POLICY: modelPolicyTypes.ModelPolicy = { allow: [], deny: [] };

function isPermissiveModelPolicy(policy: modelPolicyTypes.ModelPolicy): boolean {
  return policy.allow.length === 0 && policy.deny.length === 0;
}

function mergeModelPolicies(
  ...policies: readonly modelPolicyTypes.ModelPolicy[]
): modelPolicyTypes.ModelPolicy {
  const combine = (pick: (policy: modelPolicyTypes.ModelPolicy) => readonly string[]): string[] => {
    const seen = new Map<string, string>();
    for (const policy of policies) {
      for (const pattern of pick(policy)) {
        const text = pattern.trim();
        if (text !== "" && !seen.has(text.toLowerCase())) seen.set(text.toLowerCase(), text);
      }
    }
    return [...seen.values()];
  };
  return { allow: combine((policy) => policy.allow), deny: combine((policy) => policy.deny) };
}

function isGlob(text: string): boolean {
  return text.includes("*") || text.includes("?") || text.includes("[");
}

function patternText(pattern: string): string {
  const text = pattern.trim();
  const colon = text.lastIndexOf(":");
  if (colon === -1 || !isValidThinkingLevel(text.slice(colon + 1))) return text;
  return text.slice(0, colon);
}

function modelPolicyPatternMatches(pattern: string, model: modelPolicyTypes.PolicyModel): boolean {
  return patternMatchesId(pattern, model.provider, model.id);
}

function patternMatchesId(pattern: string, modelProvider: string, modelId: string): boolean {
  const text = patternText(pattern);
  if (text === "") return false;
  if (text === "*") return true;
  const slash = text.indexOf("/");
  if (slash > 0) {
    const provider = text.slice(0, slash);
    if (provider.toLowerCase() !== modelProvider.toLowerCase()) return false;
    const modelPattern = text.slice(slash + 1);
    if (modelPattern === "") return false;
    if (modelPattern === "*") return true;
    return isGlob(modelPattern)
      ? minimatch(modelId, modelPattern, { nocase: true })
      : modelId.toLowerCase() === modelPattern.toLowerCase();
  }
  return isGlob(text)
    ? minimatch(modelId, text, { nocase: true })
    : modelId.toLowerCase() === text.toLowerCase();
}

function evaluateModelPolicy(
  policy: modelPolicyTypes.ModelPolicy,
  model: modelPolicyTypes.PolicyModel,
): modelPolicyTypes.ModelPolicyDecision {
  const deniedBy = policy.deny.find((pattern) => modelPolicyPatternMatches(pattern, model));
  if (deniedBy !== undefined) return { allowed: false, pattern: deniedBy, reason: "deny" };
  if (policy.allow.length === 0) return { allowed: true, allowedBy: undefined };
  const allowedBy = policy.allow.find((pattern) => modelPolicyPatternMatches(pattern, model));
  if (allowedBy !== undefined) return { allowed: true, allowedBy };
  return { allowed: false, pattern: undefined, reason: "not-allowed" };
}

function isModelAllowed(
  policy: modelPolicyTypes.ModelPolicy,
  model: modelPolicyTypes.PolicyModel,
): boolean {
  return evaluateModelPolicy(policy, model).allowed;
}

function describeModelPolicyDenial(
  policy: modelPolicyTypes.ModelPolicy,
  model: modelPolicyTypes.PolicyModel,
): string | undefined {
  const decision = evaluateModelPolicy(policy, model);
  if (decision.allowed) return undefined;
  return decision.reason === "deny"
    ? `denied by model policy pattern "${decision.pattern}"`
    : "not in the model policy allow list";
}

function hiddenModelsByPolicy<TModel extends modelPolicyTypes.PolicyModel>(
  policy: modelPolicyTypes.ModelPolicy,
  models: readonly TModel[],
): modelPolicyTypes.PolicyHiddenModel<TModel>[] {
  if (isPermissiveModelPolicy(policy)) return [];
  const hidden: modelPolicyTypes.PolicyHiddenModel<TModel>[] = [];
  for (const model of models) {
    const decision = evaluateModelPolicy(policy, model);
    if (decision.allowed) continue;
    hidden.push({ model, pattern: decision.pattern ?? "", reason: decision.reason });
  }
  return hidden;
}

function withModelPolicy(
  provider: aiTypes.Provider,
  policy: modelPolicyTypes.ModelPolicy,
): aiTypes.Provider {
  if (isPermissiveModelPolicy(policy)) return provider;
  const visible = <TModel extends aiTypes.AnyModel>(models: readonly TModel[]): TModel[] =>
    models.filter((model) => isModelAllowed(policy, model));
  const { getAllModels } = provider;
  return {
    ...provider,
    getModels: () => visible(provider.getModels()),
    ...(getAllModels === undefined ? {} : { getAllModels: () => visible(getAllModels()) }),
  };
}

function saveModelPolicy(
  target: {
    settingsManager: settingsManagerTypes.SettingsManager;
    modelRuntime: modelRuntimeTypes.ModelRuntime;
  },
  policy: modelPolicyTypes.ModelPolicy,
): modelPolicyTypes.ModelPolicy {
  target.settingsManager.setModelPolicy(policy);
  const saved = target.settingsManager.getModelPolicy();
  target.modelRuntime.setModelPolicy(saved);
  return saved;
}

function addModelPolicyPattern(
  policy: modelPolicyTypes.ModelPolicy,
  kind: "allow" | "deny",
  pattern: string,
): modelPolicyTypes.ModelPolicy {
  const text = pattern.trim();
  if (text === "") return policy;
  const lower = text.toLowerCase();
  const other = kind === "deny" ? "allow" : "deny";
  const withoutOther = policy[other].filter((entry) => entry.toLowerCase() !== lower);
  const exists = policy[kind].some((entry) => entry.toLowerCase() === lower);
  return {
    ...policy,
    [other]: withoutOther,
    [kind]: exists ? policy[kind] : [...policy[kind], text],
  };
}

function allowModelReference(
  policy: modelPolicyTypes.ModelPolicy,
  reference: string,
): modelPolicyTypes.ModelPolicy {
  const lifted = removeModelPolicyPattern(policy, reference);
  return lifted.allow.length > 0 ? addModelPolicyPattern(lifted, "allow", reference) : lifted;
}

function removeModelPolicyPattern(
  policy: modelPolicyTypes.ModelPolicy,
  pattern: string,
): modelPolicyTypes.ModelPolicy {
  const text = pattern.trim().toLowerCase();
  return {
    allow: policy.allow.filter((entry) => entry.toLowerCase() !== text),
    deny: policy.deny.filter((entry) => entry.toLowerCase() !== text),
  };
}

const modelPolicy = {
  EMPTY_MODEL_POLICY,
  addModelPolicyPattern,
  allowModelReference,
  describeModelPolicyDenial,
  evaluateModelPolicy,
  hiddenModelsByPolicy,
  isModelAllowed,
  isPermissiveModelPolicy,
  mergeModelPolicies,
  modelPolicyPatternMatches,
  removeModelPolicyPattern,
  saveModelPolicy,
  withModelPolicy,
};

export default modelPolicy;
