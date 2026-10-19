/**
 * `/ask`: a turn that can only answer.
 *
 * The turn declares the read-only tools and leaves out every other one, so the model has no call
 * that changes anything; a system prompt section tells it to answer and only propose work. The
 * next turn goes back to the full loadout.
 */

import type { TSchema } from "typebox";

import type { ToolDefinition } from "./extensions/types.ts";

/** The system prompt section an ask turn adds. */
export const ASK_SECTION_NAME = "ask";

export const ASK_SECTION_TEXT =
  "This turn is an /ask: reply with an answer only. You may propose work, but do not start it. " +
  "Only read-only tools are declared, so nothing can be changed, started, sent, or saved.";

/** How a prompt reaches a turn that can only answer. */
export type PromptMode = "ask";

/** What `/ask` was typed with: the question, or undefined when `text` is not an `/ask` command. */
export function parseAskCommand(text: string): { question: string } | undefined {
  const match = /^\/ask(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return undefined;
  return { question: (match[1] ?? "").trim() };
}

/**
 * The read-only variant of a tool that reads and writes through its `action` parameter: the same
 * tool narrowed to the actions that only read. A call with another action is refused, so the
 * schema is not the only guard.
 */
export function readOnlyVariantOf(
  tool: ToolDefinition<any, any>,
  variant: {
    /** The actions that only read. */
    actions: readonly string[];
    /** The schema whose `action` allows exactly those actions. */
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

/**
 * The definition an ask turn declares for `definition`: the tool itself when it is marked
 * read-only, its read-only variant when it has one, and nothing otherwise.
 */
export function askDefinition(
  definition: ToolDefinition<any, any>,
): ToolDefinition<any, any> | undefined {
  if (definition.annotations?.readOnlyHint === true) return definition;
  const variant = definition.readOnlyVariant;
  return variant?.annotations?.readOnlyHint === true ? variant : undefined;
}
