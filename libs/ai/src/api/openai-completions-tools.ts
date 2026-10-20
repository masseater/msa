import type OpenAI from "openai";

import type typesModule from "../types.types.ts";
import constrainedSampling from "./constrained-sampling.ts";
import type openaiCompletionsTypesModule from "./openai-completions-types.types.ts";

const {
  getJsonSchemaToolParameters,
  resolveGrammarConstrainedSampling,
  resolveJsonSchemaStrictSampling,
} = constrainedSampling;

function toCustomTool(
  tool: typesModule.Tool,
  grammar: { format: "lark" | "regex"; definition: string },
): OpenAI.Chat.Completions.ChatCompletionCustomTool {
  return {
    custom: {
      description: tool.description,
      format: {
        grammar: {
          definition: grammar.definition,
          syntax: grammar.format,
        },
        type: "grammar",
      },
      name: tool.name,
    },
    type: "custom",
  };
}

function convertTools(input: {
  tools: typesModule.Tool[];
  compat: openaiCompletionsTypesModule.ResolvedOpenAICompletionsCompat;
}): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const { tools, compat } = input;
  return tools.map((tool) => {
    const grammar = resolveGrammarConstrainedSampling(tool, compat.supportsOpenAIGrammarTools);
    if (grammar !== undefined) {
      return toCustomTool(tool, grammar);
    }

    const strict = resolveJsonSchemaStrictSampling(tool, compat.supportsStrictMode);
    return {
      function: {
        description: tool.description,
        name: tool.name,
        parameters: getJsonSchemaToolParameters(tool, strict) as Record<string, unknown>,
        ...(compat.supportsStrictMode && { strict: strict ?? false }),
      },
      type: "function",
    };
  });
}

const openaiCompletionsTools = {
  convertTools,
};

export default openaiCompletionsTools;
