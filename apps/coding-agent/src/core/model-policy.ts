import type aiTypes from "@msa/ai/index.types";
import { minimatch } from "minimatch";

import { isValidThinkingLevel } from "../cli/args.ts";
import type { ModelRuntime } from "./model-runtime.ts";
import type { SettingsManager } from "./settings-manager.ts";

export interface PolicyModel {
  provider: string;
  id: string;
}

export interface ModelPolicy {
  allow: readonly string[];
  deny: readonly string[];
}

export const EMPTY_MODEL_POLICY: ModelPolicy = { allow: [], deny: [] };

export type ModelPolicyDecision =
  | { allowed: true; allowedBy: string | undefined }
  | { allowed: false; reason: "deny"; pattern: string }
  | { allowed: false; reason: "not-allowed"; pattern: undefined };

export function isPermissiveModelPolicy(policy: ModelPolicy): boolean {
  return policy.allow.length === 0 && policy.deny.length === 0;
}

export function mergeModelPolicies(...policies: readonly ModelPolicy[]): ModelPolicy {
  const combine = (pick: (policy: ModelPolicy) => readonly string[]): string[] => {
    const seen = new Map<string, string>();
    for (const policy of policies) {
      for (const pattern of pick(policy)) {
        const text = pattern.trim();
        if (text && !seen.has(text.toLowerCase())) seen.set(text.toLowerCase(), text);
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

export function modelPolicyPatternMatches(pattern: string, model: PolicyModel): boolean {
  return patternMatchesId(pattern, model.provider, model.id);
}

function patternMatchesId(pattern: string, modelProvider: string, modelId: string): boolean {
  const text = patternText(pattern);
  if (!text) return false;
  if (text === "*") return true;
  const slash = text.indexOf("/");
  if (slash > 0) {
    const provider = text.slice(0, slash);
    if (provider.toLowerCase() !== modelProvider.toLowerCase()) return false;
    const modelPattern = text.slice(slash + 1);
    if (!modelPattern) return false;
    if (modelPattern === "*") return true;
    return isGlob(modelPattern)
      ? minimatch(modelId, modelPattern, { nocase: true })
      : modelId.toLowerCase() === modelPattern.toLowerCase();
  }
  return isGlob(text)
    ? minimatch(modelId, text, { nocase: true })
    : modelId.toLowerCase() === text.toLowerCase();
}

export function evaluateModelPolicy(policy: ModelPolicy, model: PolicyModel): ModelPolicyDecision {
  const deniedBy = policy.deny.find((pattern) => modelPolicyPatternMatches(pattern, model));
  if (deniedBy !== undefined) return { allowed: false, pattern: deniedBy, reason: "deny" };
  if (policy.allow.length === 0) return { allowed: true, allowedBy: undefined };
  const allowedBy = policy.allow.find((pattern) => modelPolicyPatternMatches(pattern, model));
  if (allowedBy !== undefined) return { allowed: true, allowedBy };
  return { allowed: false, pattern: undefined, reason: "not-allowed" };
}

export function isModelAllowed(policy: ModelPolicy, model: PolicyModel): boolean {
  return evaluateModelPolicy(policy, model).allowed;
}

export function describeModelPolicyDenial(
  policy: ModelPolicy,
  model: PolicyModel,
): string | undefined {
  const decision = evaluateModelPolicy(policy, model);
  if (decision.allowed) return undefined;
  return decision.reason === "deny"
    ? `denied by model policy pattern "${decision.pattern}"`
    : "not in the model policy allow list";
}

export interface PolicyHiddenModel<TModel> {
  model: TModel;
  pattern: string;
  reason: "deny" | "not-allowed";
}

export function hiddenModelsByPolicy<TModel extends PolicyModel>(
  policy: ModelPolicy,
  models: readonly TModel[],
): PolicyHiddenModel<TModel>[] {
  if (isPermissiveModelPolicy(policy)) return [];
  const hidden: PolicyHiddenModel<TModel>[] = [];
  for (const model of models) {
    const decision = evaluateModelPolicy(policy, model);
    if (decision.allowed) continue;
    hidden.push({ model, pattern: decision.pattern ?? "", reason: decision.reason });
  }
  return hidden;
}

export function withModelPolicy(provider: aiTypes.Provider, policy: ModelPolicy): aiTypes.Provider {
  if (isPermissiveModelPolicy(policy)) return provider;
  const visible = <TModel extends aiTypes.AnyModel>(models: readonly TModel[]): TModel[] =>
    models.filter((model) => isModelAllowed(policy, model));
  const { getAllModels } = provider;
  return {
    ...provider,
    getModels: () => visible(provider.getModels()),
    ...(getAllModels ? { getAllModels: () => visible(getAllModels()) } : {}),
  };
}

export function saveModelPolicy(
  target: { settingsManager: SettingsManager; modelRuntime: ModelRuntime },
  policy: ModelPolicy,
): ModelPolicy {
  target.settingsManager.setModelPolicy(policy);
  const saved = target.settingsManager.getModelPolicy();
  target.modelRuntime.setModelPolicy(saved);
  return saved;
}

export function addModelPolicyPattern(
  policy: ModelPolicy,
  kind: "allow" | "deny",
  pattern: string,
): ModelPolicy {
  const text = pattern.trim();
  if (!text) return policy;
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

export function allowModelReference(policy: ModelPolicy, reference: string): ModelPolicy {
  const lifted = removeModelPolicyPattern(policy, reference);
  return lifted.allow.length > 0 ? addModelPolicyPattern(lifted, "allow", reference) : lifted;
}

export function removeModelPolicyPattern(policy: ModelPolicy, pattern: string): ModelPolicy {
  const text = pattern.trim().toLowerCase();
  return {
    allow: policy.allow.filter((entry) => entry.toLowerCase() !== text),
    deny: policy.deny.filter((entry) => entry.toLowerCase() !== text),
  };
}
