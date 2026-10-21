import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";
import { Type } from "typebox";

import ask from "../ask.ts";
import awaitingModule from "../awaiting.ts";
import type extensionsTypesTypes from "../extensions/types.types.ts";
import modelPolicyModule from "../model-policy.ts";
import type modelPolicyTypesModule from "../model-policy.types.ts";
import type modelPolicyTypes from "./model-policy.types.ts";

const { awaited, awaiting } = awaitingModule;

const {
  addModelPolicyPattern,
  allowModelReference,
  describeModelPolicyDenial,
  evaluateModelPolicy,
  hiddenModelsByPolicy,
  removeModelPolicyPattern,
  saveModelPolicy,
} = modelPolicyModule;
const { readOnlyVariantOf } = ask;

const MODEL_POLICY_ACTIONS = ["list", "deny", "allow", "remove"] as const;
const HIDDEN_LIMIT = 10;

const modelPolicySchema = Type.Object({
  action: Type.Union(
    MODEL_POLICY_ACTIONS.map((action) => Type.Literal(action)),
    {
      description:
        "list: show the policy and the models it hides; deny: add a deny pattern; allow: add an allow pattern; remove: drop a pattern from both lists",
    },
  ),
  pattern: Type.Optional(
    Type.String({
      description:
        "Model pattern for deny, allow, and remove: provider/model, provider/*, or *. A :thinking suffix is ignored.",
    }),
  ),
});

const modelPolicyReadSchema = Type.Object({
  action: Type.Literal("list", {
    description: "list: show the policy and the models it hides",
  }),
});

const modelPolicyToolSystemPromptContribution = {
  guidelines: [
    "Use model_policy before switching models: `list` shows the patterns in effect and the models they hide, so a model that is missing from a listing can be explained and re-allowed",
    "A deny pattern wins over allow patterns, and the running session's own model cannot be denied",
  ],
  snippet: "Read and change which models this session may use",
} as const;

function formatPatterns(patterns: readonly string[]): string {
  return patterns.length > 0 ? patterns.join(", ") : "(none)";
}

function formatHidden(
  policy: modelPolicyTypesModule.ModelPolicy,
  models: readonly aiTypes.Model<aiTypes.Api>[],
  limit = HIDDEN_LIMIT,
): string[] {
  const hidden = hiddenModelsByPolicy(policy, models);
  const lines = hidden
    .slice(0, limit)
    .map(
      (entry) =>
        `  ${entry.model.provider}/${entry.model.id} (${entry.pattern || "outside the allow list"})`,
    );
  if (hidden.length > limit) lines.push(`  and ${hidden.length - limit} more`);
  return lines;
}

function createModelPolicyToolDefinition(
  target: modelPolicyTypes.ModelPolicyToolTarget,
): extensionsTypesTypes.ToolDefinition<typeof modelPolicySchema, Record<string, unknown>> {
  const modelPolicy: extensionsTypesTypes.ToolDefinition<
    typeof modelPolicySchema,
    Record<string, unknown>
  > = {
    description:
      "Read and change which models this session may use. `list` shows the allow and deny patterns and the models they hide; `deny` and `allow` add a pattern in the --models forms (provider/model, provider/*, *); `remove` drops one. Deny wins over allow, and a change applies to the next listing, selection, and session. The model the running session uses cannot be denied.",
    execute(_toolCallId, params) {
      return Effect.runPromise(
        awaiting(function* () {
          const catalog = target.modelRuntime.getCatalogModels();
          const before = target.modelRuntime.getModelPolicy();

          if (params.action === "list") {
            const { lines, hidden } = listPolicy(target, before, catalog);
            return yield* awaited({
              content: [{ text: lines.join("\n"), type: "text" }],
              details: {
                action: "list",
                allow: [...before.allow],
                deny: [...before.deny],
                hidden: hidden.length,
              },
            });
          }

          const pattern = params.pattern?.trim();
          if (pattern === undefined || pattern === "")
            throw new Error(`action ${params.action} requires pattern`);

          const { lines, saved, hidden } = changePolicy(params, before, pattern, target, catalog);
          return yield* awaited(policyChangeResult(lines, params, saved, hidden, pattern));
        }),
      );
    },
    label: "model policy",
    name: "model_policy",
    parameters: modelPolicySchema,
    promptGuidelines: [...modelPolicyToolSystemPromptContribution.guidelines],
    promptSnippet: modelPolicyToolSystemPromptContribution.snippet,
  };
  return {
    ...modelPolicy,
    readOnlyVariant: readOnlyVariantOf(modelPolicy, {
      actions: ["list"],
      description:
        "Show which models this session may use: the allow and deny patterns and the models they hide. Changing the policy is not available here.",
      parameters: modelPolicyReadSchema,
      promptSnippet: "Show which models this session may use",
    }),
  };
}

const modelPolicy = {
  createModelPolicyToolDefinition,
  modelPolicySchema,
  modelPolicyToolSystemPromptContribution,
};

export default modelPolicy;

function listPolicy(
  target: modelPolicyTypes.ModelPolicyToolTarget,
  before: modelPolicyTypesModule.ModelPolicy,
  catalog: readonly aiTypes.Model<aiTypes.Api>[],
) {
  const current = target.currentModel();
  const denial = current === undefined ? undefined : describeModelPolicyDenial(before, current);
  const lines = [
    `allow: ${formatPatterns(before.allow)}`,
    `deny: ${formatPatterns(before.deny)}`,
    ...(current === undefined
      ? ["current: none"]
      : [`current: ${current.provider}/${current.id} ${denial ?? "allowed"}`]),
  ];
  const hidden = hiddenModelsByPolicy(before, catalog);
  lines.push(`hidden: ${hidden.length}`);
  lines.push(...formatHidden(before, catalog));
  return { hidden, lines };
}

function policyChangeResult(
  lines: string[],
  params: { pattern?: string; action: never },
  saved: modelPolicyTypesModule.ModelPolicy,
  hidden: modelPolicyTypesModule.PolicyHiddenModel<aiTypes.Model<aiTypes.Api>>[],
  pattern: string | undefined,
):
  | agentTypes.AgentToolResult<Record<string, unknown>>
  | PromiseLike<agentTypes.AgentToolResult<Record<string, unknown>>> {
  return {
    content: [{ text: lines.join("\n"), type: "text" }],
    details: {
      action: params.action,
      allow: [...saved.allow],
      deny: [...saved.deny],
      hidden: hidden.length,
      hiddenModels: hidden
        .slice(0, HIDDEN_LIMIT)
        .map((entry) => `${entry.model.provider}/${entry.model.id}`),
      pattern,
    },
  };
}

function changePolicy(
  params: { pattern?: string; action: never },
  before: modelPolicyTypesModule.ModelPolicy,
  pattern: string,
  target: modelPolicyTypes.ModelPolicyToolTarget,
  catalog: readonly aiTypes.Model<aiTypes.Api>[],
) {
  const next =
    params.action === "remove"
      ? removeModelPolicyPattern(before, pattern)
      : params.action === "allow"
        ? allowModelReference(before, pattern)
        : addModelPolicyPattern(before, "deny", pattern);

  if (params.action === "deny") {
    const current = target.currentModel();
    if (current !== undefined && !evaluateModelPolicy(next, current).allowed) {
      throw new Error(
        `Denying "${pattern}" would disable ${current.provider}/${current.id}, the model this session is running. Switch models first, or deny a pattern that leaves it usable.`,
      );
    }
  }

  const saved = saveModelPolicy(target, next);
  const hidden = hiddenModelsByPolicy(saved, catalog);
  const lines = [
    `${params.action} "${pattern}"`,
    `allow: ${formatPatterns(saved.allow)}`,
    `deny: ${formatPatterns(saved.deny)}`,
    `hidden: ${hidden.length}`,
    ...formatHidden(saved, catalog),
  ];
  return { hidden, lines, saved };
}
