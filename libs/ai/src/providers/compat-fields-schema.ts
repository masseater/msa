import { type Static, type TSchemaOptions, Type } from "typebox";

function sessionAffinityFormat(options?: TSchemaOptions) {
  return Type.Union(
    [Type.Literal("openai"), Type.Literal("openai-nosession"), Type.Literal("openrouter")],
    options,
  );
}

export const SessionAffinityFormatSchema = sessionAffinityFormat({
  description: "Session-affinity header format used to route related requests consistently.",
});

export function thinkingTokenBudgetField(options?: TSchemaOptions) {
  return Type.Union(
    [
      Type.Literal("thinking_token_budget"),
      Type.Literal("thinking_budget"),
      Type.Literal("thinking_budget_tokens"),
    ],
    options,
  );
}

export const ThinkingTokenBudgetFieldSchema = thinkingTokenBudgetField({
  description:
    'Top-level request field name used by OpenAI-compatible endpoints to cap reasoning tokens. "thinking_token_budget" is used by vLLM, "thinking_budget" by Qwen, DashScope, or SGLang, and "thinking_budget_tokens" by llama.cpp.',
});

export const ChatTemplateKwargValueSchema = Type.Union([
  Type.String(),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
  Type.Object({
    $var: Type.Union([
      Type.Literal("thinking.enabled"),
      Type.Literal("thinking.effort"),
      Type.Literal("thinking.budget"),
    ]),
    omitWhenOff: Type.Optional(Type.Boolean()),
  }),
]);

export function optionalCompatBoolean(options?: TSchemaOptions) {
  return Type.Optional(Type.Boolean(options));
}

export function optionalSessionAffinityFormat(options?: TSchemaOptions) {
  return Type.Optional(sessionAffinityFormat(options));
}

export type ChatTemplateKwargValue = Static<typeof ChatTemplateKwargValueSchema>;
export type ThinkingTokenBudgetField = Static<typeof ThinkingTokenBudgetFieldSchema>;
export type SessionAffinityFormat = Static<typeof SessionAffinityFormatSchema>;
