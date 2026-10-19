/**
 * The `model_policy` tool: the model's way to read, add, and remove model allow and deny patterns.
 *
 * It writes the same setting and refreshes the same catalog as the model selector, so a change the
 * model makes appears in the next listing and selection. A running session keeps its model.
 */

import type { Api, Model } from "@msa/ai";
import { type Static, Type } from "typebox";

import { readOnlyVariantOf } from "../ask.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import {
  addModelPolicyPattern,
  allowModelReference,
  describeModelPolicyDenial,
  evaluateModelPolicy,
  hiddenModelsByPolicy,
  type ModelPolicy,
  removeModelPolicyPattern,
  saveModelPolicy,
} from "../model-policy.ts";
import type { ModelRuntime } from "../model-runtime.ts";
import type { SettingsManager } from "../settings-manager.ts";

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

export type ModelPolicyToolInput = Static<typeof modelPolicySchema>;

export const modelPolicyToolSystemPromptContribution = {
  snippet: "Read and change which models this session may use",
  guidelines: [
    "Use model_policy before switching models: `list` shows the patterns in effect and the models they hide, so a model that is missing from a listing can be explained and re-allowed",
    "A deny pattern wins over allow patterns, and the running session's own model cannot be denied",
  ],
} as const;

export interface ModelPolicyToolTarget {
  settingsManager: SettingsManager;
  modelRuntime: ModelRuntime;
  /** The model the running session is using, which the policy may not deny. */
  currentModel(): Model<Api> | undefined;
}

function formatPatterns(patterns: readonly string[]): string {
  return patterns.length > 0 ? patterns.join(", ") : "(none)";
}

function formatHidden(
  policy: ModelPolicy,
  models: readonly Model<Api>[],
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

export function createModelPolicyToolDefinition(
  target: ModelPolicyToolTarget,
): ToolDefinition<typeof modelPolicySchema, Record<string, unknown>> {
  const modelPolicy: ToolDefinition<typeof modelPolicySchema, Record<string, unknown>> = {
    name: "model_policy",
    label: "model policy",
    description:
      "Read and change which models this session may use. `list` shows the allow and deny patterns and the models they hide; `deny` and `allow` add a pattern in the --models forms (provider/model, provider/*, *); `remove` drops one. Deny wins over allow, and a change applies to the next listing, selection, and session. The model the running session uses cannot be denied.",
    promptSnippet: modelPolicyToolSystemPromptContribution.snippet,
    promptGuidelines: [...modelPolicyToolSystemPromptContribution.guidelines],
    parameters: modelPolicySchema,
    async execute(_toolCallId, params) {
      const catalog = target.modelRuntime.getCatalogModels();
      const before = target.modelRuntime.getModelPolicy();

      if (params.action === "list") {
        const current = target.currentModel();
        const denial = current ? describeModelPolicyDenial(before, current) : undefined;
        const lines = [
          `allow: ${formatPatterns(before.allow)}`,
          `deny: ${formatPatterns(before.deny)}`,
          ...(current
            ? [`current: ${current.provider}/${current.id} ${denial ?? "allowed"}`]
            : ["current: none"]),
        ];
        const hidden = hiddenModelsByPolicy(before, catalog);
        lines.push(`hidden: ${hidden.length}`);
        lines.push(...formatHidden(before, catalog));
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: {
            action: "list",
            allow: [...before.allow],
            deny: [...before.deny],
            hidden: hidden.length,
          },
        };
      }

      const pattern = params.pattern?.trim();
      if (!pattern) throw new Error(`action ${params.action} requires pattern`);

      const next =
        params.action === "remove"
          ? removeModelPolicyPattern(before, pattern)
          : params.action === "allow"
            ? allowModelReference(before, pattern)
            : addModelPolicyPattern(before, "deny", pattern);

      if (params.action === "deny") {
        const current = target.currentModel();
        if (current && !evaluateModelPolicy(next, current).allowed) {
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
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          action: params.action,
          pattern,
          allow: [...saved.allow],
          deny: [...saved.deny],
          hidden: hidden.length,
          hiddenModels: hidden
            .slice(0, HIDDEN_LIMIT)
            .map((entry) => `${entry.model.provider}/${entry.model.id}`),
        },
      };
    },
  };
  return {
    ...modelPolicy,
    readOnlyVariant: readOnlyVariantOf(modelPolicy, {
      actions: ["list"],
      parameters: modelPolicyReadSchema,
      description:
        "Show which models this session may use: the allow and deny patterns and the models they hide. Changing the policy is not available here.",
      promptSnippet: "Show which models this session may use",
    }),
  };
}
