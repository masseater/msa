import { Function } from "effect";
import type { Tool as OpenAITool } from "openai/resources/responses/responses.js";

import type { Tool } from "../types.ts";
import {
  getJsonSchemaToolParameters,
  resolveGrammarConstrainedSampling,
  resolveJsonSchemaStrictSampling,
} from "./constrained-sampling.ts";
import type { ConvertResponsesToolsOptions } from "./openai-responses-options.ts";

type FunctionTool = Extract<OpenAITool, { type: "function" }>;

function convertTool(tool: Tool, options: ConvertResponsesToolsOptions | undefined): OpenAITool {
  const deferLoading = options?.toolSearchResult === true ? { defer_loading: true } : {};
  const grammar = resolveGrammarConstrainedSampling(
    tool,
    options?.supportsOpenAIGrammarTools ?? false,
  );
  if (grammar !== undefined) {
    return {
      type: "custom",
      name: tool.name,
      description: tool.description,
      format: { type: "grammar", syntax: grammar.format, definition: grammar.definition },
      ...deferLoading,
    } satisfies OpenAITool;
  }
  const supportsStrictMode = options?.supportsStrictMode ?? true;
  const strict =
    resolveJsonSchemaStrictSampling(tool, supportsStrictMode) ??
    (options?.strict === undefined ? false : options.strict);
  const functionTool: Omit<FunctionTool, "strict"> & { strict?: FunctionTool["strict"] } = {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: getJsonSchemaToolParameters(tool, strict === true) as Record<string, unknown>,
    ...deferLoading,
  };
  if (supportsStrictMode) functionTool.strict = strict;
  return functionTool as OpenAITool;
}

export const convertResponsesTools: {
  (options?: ConvertResponsesToolsOptions): (tools: readonly Tool[]) => OpenAITool[];
  (tools: readonly Tool[], options?: ConvertResponsesToolsOptions): OpenAITool[];
} = Function.dual(
  (args) => Array.isArray(args[0]),
  (tools: readonly Tool[], options?: ConvertResponsesToolsOptions): OpenAITool[] =>
    tools.map((tool) => convertTool(tool, options)),
);
