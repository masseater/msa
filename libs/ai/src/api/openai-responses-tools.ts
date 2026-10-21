import { Function } from "effect";
import type { Tool as OpenAITool } from "openai/resources/responses/responses.js";

import type typesModule from "../types.types.ts";
import constrainedSampling from "./constrained-sampling.ts";
import type openaiResponsesOptionsTypes from "./openai-responses-options.ts";

const {
  getJsonSchemaToolParameters,
  resolveGrammarConstrainedSampling,
  resolveJsonSchemaStrictSampling,
} = constrainedSampling;

type FunctionTool = Extract<OpenAITool, { type: "function" }>;

function convertTool(
  tool: typesModule.Tool,
  options: openaiResponsesOptionsTypes.ConvertResponsesToolsOptions | undefined,
): OpenAITool {
  const deferLoading = options?.toolSearchResult === true ? { defer_loading: true } : {};
  const grammar = resolveGrammarConstrainedSampling(
    tool,
    options?.supportsOpenAIGrammarTools ?? false,
  );
  if (grammar !== undefined) {
    return {
      description: tool.description,
      format: { definition: grammar.definition, syntax: grammar.format, type: "grammar" },
      name: tool.name,
      type: "custom",
      ...deferLoading,
    } satisfies OpenAITool;
  }
  const supportsStrictMode = options?.supportsStrictMode ?? true;
  const strict =
    resolveJsonSchemaStrictSampling(tool, supportsStrictMode) ??
    (options?.strict === undefined ? false : options.strict);
  const functionTool: Omit<FunctionTool, "strict"> & { strict?: FunctionTool["strict"] } = {
    description: tool.description,
    name: tool.name,
    parameters: getJsonSchemaToolParameters(tool, strict === true) as Record<string, unknown>,
    type: "function",
    ...deferLoading,
  };
  if (supportsStrictMode) functionTool.strict = strict;
  return functionTool as OpenAITool;
}

const convertResponsesTools: {
  (
    options?: openaiResponsesOptionsTypes.ConvertResponsesToolsOptions,
  ): (tools: readonly typesModule.Tool[]) => OpenAITool[];
  (
    tools: readonly typesModule.Tool[],
    options?: openaiResponsesOptionsTypes.ConvertResponsesToolsOptions,
  ): OpenAITool[];
} = Function.dual(
  (args) => Array.isArray(args[0]),
  (
    tools: readonly typesModule.Tool[],
    options?: openaiResponsesOptionsTypes.ConvertResponsesToolsOptions,
  ): OpenAITool[] => tools.map((tool) => convertTool(tool, options)),
);

const openaiResponsesTools = {
  convertResponsesTools,
};

export default openaiResponsesTools;
