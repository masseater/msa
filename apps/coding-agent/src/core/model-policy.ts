/**
 * Model policy: which catalog models a session may use.
 *
 * A policy holds allow and deny patterns in the same `provider/model`, `provider/*`, and `*` forms
 * as the `--models` flag. Deny always wins, and a non-empty allow list restricts use to the models
 * it names. The policy is applied once, where `ModelRuntime` builds each provider, so every caller
 * that lists, resolves, or starts with a model sees the same decision.
 */

import type { AnyModel, Provider } from "@msa/ai";
import { minimatch } from "minimatch";

import { isValidThinkingLevel } from "../cli/args.ts";
import type { ModelRuntime } from "./model-runtime.ts";
import type { SettingsManager } from "./settings-manager.ts";

/** The parts of a model a policy reads; an alias is judged by its own id and the id it resolves to. */
export interface PolicyModel {
  provider: string;
  id: string;
  resolvesTo?: string | undefined;
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

/** Whether a policy restricts anything, so a caller can skip the work of applying it. */
export function isPermissiveModelPolicy(policy: ModelPolicy): boolean {
  return policy.allow.length === 0 && policy.deny.length === 0;
}

/** The patterns of two layers combined, keeping the first spelling of each pattern. */
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

/**
 * Pattern text without the optional `:<thinking>` suffix that `--models` accepts. A suffix that is
 * not a thinking level stays part of the pattern, since model ids may contain colons.
 */
function patternText(pattern: string): string {
  const text = pattern.trim();
  const colon = text.lastIndexOf(":");
  if (colon === -1 || !isValidThinkingLevel(text.slice(colon + 1))) return text;
  return text.slice(0, colon);
}

/**
 * Whether one policy pattern covers a model.
 *
 * - `*` covers every model.
 * - `provider/*` and `provider/<glob>` cover that provider's models, including ids with a `/`.
 * - `<glob>` matches the model id.
 * - An alias is covered by a pattern that covers the id it resolves to.
 * - Anything else is an exact `provider/model` or model id.
 */
export function modelPolicyPatternMatches(pattern: string, model: PolicyModel): boolean {
  return (
    patternMatchesId(pattern, model.provider, model.id) ||
    (model.resolvesTo !== undefined && patternMatchesId(pattern, model.provider, model.resolvesTo))
  );
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

/** The policy's decision for one model. Deny patterns are checked before allow patterns. */
export function evaluateModelPolicy(policy: ModelPolicy, model: PolicyModel): ModelPolicyDecision {
  const deniedBy = policy.deny.find((pattern) => modelPolicyPatternMatches(pattern, model));
  if (deniedBy !== undefined) return { allowed: false, reason: "deny", pattern: deniedBy };
  if (policy.allow.length === 0) return { allowed: true, allowedBy: undefined };
  const allowedBy = policy.allow.find((pattern) => modelPolicyPatternMatches(pattern, model));
  if (allowedBy !== undefined) return { allowed: true, allowedBy };
  return { allowed: false, reason: "not-allowed", pattern: undefined };
}

export function isModelAllowed(policy: ModelPolicy, model: PolicyModel): boolean {
  return evaluateModelPolicy(policy, model).allowed;
}

/** A one-line reason a model is unusable, or undefined when the policy allows it. */
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

/** The models a policy hides, with the pattern that hides them. */
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

/**
 * The provider with only the models the policy allows. This is the single point where the policy
 * takes effect: `Models` derives availability, lookups, and type accessors from these lists.
 */
export function withModelPolicy(provider: Provider, policy: ModelPolicy): Provider {
  if (isPermissiveModelPolicy(policy)) return provider;
  const visible = <TModel extends AnyModel>(models: readonly TModel[]): TModel[] =>
    models.filter((model) => isModelAllowed(policy, model));
  const { getAllModels } = provider;
  return {
    ...provider,
    getModels: () => visible(provider.getModels()),
    ...(getAllModels ? { getAllModels: () => visible(getAllModels()) } : {}),
  };
}

/**
 * Persist a policy and make it take effect. The TUI and the `model_policy` tool both go through
 * here, so both write the same setting and refresh the same catalog.
 */
export function saveModelPolicy(
  target: { settingsManager: SettingsManager; modelRuntime: ModelRuntime },
  policy: ModelPolicy,
): ModelPolicy {
  target.settingsManager.setModelPolicy(policy);
  const saved = target.settingsManager.getModelPolicy();
  target.modelRuntime.setModelPolicy(saved);
  return saved;
}

/**
 * Add a pattern to one side of the policy and drop the same pattern from the other side, so an
 * allow actually lifts a deny instead of losing to it.
 */
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

/**
 * Lift the policy for one model reference. A deny pattern for it is dropped, and it joins the allow
 * list only when an allow list already restricts the policy; otherwise every other model would
 * become hidden.
 */
export function allowModelReference(policy: ModelPolicy, reference: string): ModelPolicy {
  const lifted = removeModelPolicyPattern(policy, reference);
  return lifted.allow.length > 0 ? addModelPolicyPattern(lifted, "allow", reference) : lifted;
}

/** Remove a pattern from both sides, so a deny can be lifted with the same call as an allow. */
export function removeModelPolicyPattern(policy: ModelPolicy, pattern: string): ModelPolicy {
  const text = pattern.trim().toLowerCase();
  return {
    allow: policy.allow.filter((entry) => entry.toLowerCase() !== text),
    deny: policy.deny.filter((entry) => entry.toLowerCase() !== text),
  };
}
