import type { TSchema } from "typebox";

import type { ToolDefinition } from "./extensions/types.ts";

export const ASK_SECTION_NAME = "ask";

export const ASK_SECTION_TEXT =
  "This turn is an /ask: reply with an answer only. You may propose work, but do not start it. " +
  "Only read-only tools are declared, so nothing can be changed, started, sent, or saved.";

export type PromptMode = "ask";

export function parseAskCommand(text: string): { question: string } | undefined {
  const match = /^\/ask(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return undefined;
  return { question: (match[1] ?? "").trim() };
}

export function readOnlyVariantOf(
  tool: ToolDefinition<any, any>,
  variant: {
    actions: readonly string[];

    parameters: TSchema;
    description: string;
    promptSnippet: string;
    promptGuidelines?: string[] | undefined;
  },
): ToolDefinition<any, any> {
  return {
    name: tool.name,
    label: tool.label,
    description: variant.description,
    promptSnippet: variant.promptSnippet,
    promptGuidelines: variant.promptGuidelines,
    parameters: variant.parameters,
    annotations: { readOnlyHint: true },
    execute: (toolCallId, params, signal, onUpdate, ctx) => {
      const action = (params as { action?: unknown }).action;
      if (typeof action !== "string" || !variant.actions.includes(action)) {
        throw new Error(
          `${tool.name} only reads in an /ask turn: action must be ${variant.actions.join(" or ")}`,
        );
      }
      return tool.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  };
}

export function askDefinition(
  definition: ToolDefinition<any, any>,
): ToolDefinition<any, any> | undefined {
  if (definition.annotations?.readOnlyHint === true) return definition;
  const variant = definition.readOnlyVariant;
  return variant?.annotations?.readOnlyHint === true ? variant : undefined;
}
