import type OpenAI from "openai";

import type { Tool } from "../types.ts";
import {
  getJsonSchemaToolParameters,
  resolveGrammarConstrainedSampling,
  resolveJsonSchemaStrictSampling,
} from "./constrained-sampling.ts";
import type { ResolvedOpenAICompletionsCompat } from "./openai-completions-types.ts";

function toCustomTool(
  tool: Tool,
  grammar: { format: "lark" | "regex"; definition: string },
): OpenAI.Chat.Completions.ChatCompletionCustomTool {
  return {
    type: "custom",
    custom: {
      name: tool.name,
      description: tool.description,
      format: {
        type: "grammar",
        grammar: {
          syntax: grammar.format,
          definition: grammar.definition,
        },
      },
    },
  };
}

function convertTools(input: {
  tools: Tool[];
  compat: ResolvedOpenAICompletionsCompat;
}): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const { tools, compat } = input;
  return tools.map((tool) => {
    const grammar = resolveGrammarConstrainedSampling(tool, compat.supportsOpenAIGrammarTools);
    if (grammar !== undefined) {
      return toCustomTool(tool, grammar);
    }

    const strict = resolveJsonSchemaStrictSampling(tool, compat.supportsStrictMode);
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: getJsonSchemaToolParameters(tool, strict) as Record<string, unknown>,
        ...(compat.supportsStrictMode && { strict: strict ?? false }),
      },
    };
  });
}

export { convertTools };
